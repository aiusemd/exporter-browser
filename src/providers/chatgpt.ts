import type {
  AttachmentRef,
  ContentBlock,
  NormalizedConversation,
  NormalizedMessage,
} from '../types.js';
import type { ConversationSummary, ListOpts, Provider, SessionInfo } from './provider.js';

/**
 * Subset of the ChatGPT /backend-api/conversation/{id} response shape that
 * the normalizer actually reads. Other fields are ignored.
 */
export interface ChatGPTConversation {
  title: string;
  create_time: number;
  update_time?: number;
  conversation_id: string;
  current_node: string;
  mapping: Record<string, ChatGPTNode>;
}

export interface ChatGPTNode {
  id: string;
  parent: string | null;
  children: string[];
  message: ChatGPTMessage | null;
}

export interface ChatGPTMessage {
  id: string;
  author: ChatGPTAuthor;
  content: ChatGPTContent;
  recipient: string;
  status: string;
  weight: number;
  // Optional because some real-world responses omit the field entirely;
  // the fixtures we've captured always send `metadata: {}`.
  metadata?: ChatGPTMessageMetadata;
}

interface ChatGPTAuthor {
  role: string;
  name?: string | null;
}

interface ChatGPTContent {
  content_type: string;
  parts?: ReadonlyArray<string | ChatGPTPart>;
  language?: string;
  text?: string;
}

type ChatGPTPart =
  | string
  | ChatGPTImageAssetPointer
  | ChatGPTAudioTranscription
  | ChatGPTAudioAssetPart;

interface ChatGPTImageAssetPointer {
  content_type: 'image_asset_pointer';
  asset_pointer: string;
  size_bytes?: number | null;
  width?: number;
  height?: number;
}

interface ChatGPTAudioTranscription {
  content_type: 'audio_transcription';
  text: string;
}

// Voice-mode messages also carry audio (and combined audio+video) asset
// pointers next to the transcription. The sediment:// URLs expire, and we
// don't package binaries, so these parts are recognised but not rendered.
interface ChatGPTAudioAssetPart {
  content_type: 'audio_asset_pointer' | 'real_time_user_audio_video_asset_pointer';
}

interface ChatGPTMessageMetadata {
  is_visually_hidden_from_conversation?: boolean;
  attachments?: ReadonlyArray<ChatGPTAttachmentMetadata>;
}

interface ChatGPTAttachmentMetadata {
  id: string;
  name: string;
  mime_type?: string;
  size?: number;
}

/**
 * Convert a ChatGPT conversation response into the provider-agnostic shape
 * the format module renders. This is a pure function — no network, no
 * mutation, no chrome.* calls — so it's safe to test in Node.
 *
 * Algorithm (per AIUSE plan section 6):
 *   1. Walk parent links from `current_node` up to the synthetic root.
 *   2. Collect the message at each non-null node, reversed to root → leaf order.
 *   3. Skip visually-hidden, empty-system, reasoning, and browsing-trace messages.
 *   4. Combine assistant→tool calls with the immediately following tool result
 *      into a single `Tool` message.
 */
export function normalize(raw: ChatGPTConversation): NormalizedConversation {
  const branch = walkCanonicalBranch(raw);
  const messages: NormalizedMessage[] = [];

  for (let i = 0; i < branch.length; i++) {
    const msg = branch[i];
    if (msg === undefined || shouldSkip(msg)) continue;

    if (isToolCall(msg)) {
      const next = branch[i + 1];
      if (next !== undefined && isToolResult(next) && !shouldSkip(next)) {
        const combined = combineToolCallAndResult(msg, next);
        if (combined !== null) messages.push(combined);
        i++; // consume the result message
        continue;
      }
      // Unpaired tool call (rare) — skip rather than emit a half block.
      continue;
    }

    const normalized = toNormalizedMessage(msg);
    if (normalized !== null) messages.push(normalized);
  }

  return {
    id: raw.conversation_id,
    title: raw.title,
    createdAt: new Date(raw.create_time * 1000),
    messages,
  };
}

function walkCanonicalBranch(raw: ChatGPTConversation): ChatGPTMessage[] {
  const path: ChatGPTMessage[] = [];
  let cursor: string | null = raw.current_node;
  const visited = new Set<string>();
  while (cursor !== null) {
    if (visited.has(cursor)) break; // defensive against malformed cycles
    visited.add(cursor);
    const entry: ChatGPTNode | undefined = raw.mapping[cursor];
    if (entry === undefined) break;
    if (entry.message !== null) path.unshift(entry.message);
    cursor = entry.parent;
  }
  return path;
}

function shouldSkip(msg: ChatGPTMessage): boolean {
  if (msg.metadata?.is_visually_hidden_from_conversation === true) return true;

  // Reasoning blocks — modern models emit these as a separate content type.
  // v1 omits them entirely.
  if (msg.content.content_type === 'thoughts') return true;
  if (msg.content.content_type === 'reasoning_recap') return true;

  // Browsing trace — drop the call/result entirely. The final assistant
  // response (which has recipient='all') survives because it's not a
  // browsing message.
  if (isBrowsingMessage(msg)) return true;

  // Empty system messages that ChatGPT injects for routing.
  if (msg.author.role === 'system' && isEmptyTextContent(msg.content)) return true;

  return false;
}

function isBrowsingMessage(msg: ChatGPTMessage): boolean {
  if (msg.author.role === 'assistant' && msg.recipient === 'browser') return true;
  if (msg.author.role === 'tool' && msg.author.name === 'browser') return true;
  return false;
}

function isEmptyTextContent(content: ChatGPTContent): boolean {
  if (content.content_type !== 'text') return false;
  const parts = content.parts ?? [];
  return parts.every((p) => typeof p === 'string' && p.trim().length === 0);
}

function isToolCall(msg: ChatGPTMessage): boolean {
  return msg.author.role === 'assistant' && msg.recipient !== 'all';
}

function isToolResult(msg: ChatGPTMessage): boolean {
  return msg.author.role === 'tool';
}

function combineToolCallAndResult(
  call: ChatGPTMessage,
  result: ChatGPTMessage,
): NormalizedMessage | null {
  const toolName = call.recipient;
  const content: ContentBlock[] = [];
  const attachments: AttachmentRef[] = [];

  const callBlock = callContentToBlock(call.content, toolName);
  if (callBlock !== null) content.push(callBlock);

  const resultMeta = result.metadata?.attachments ?? [];
  appendResultBlocks(result.content, resultMeta, content, attachments);

  if (content.length === 0) return null;

  return attachments.length > 0
    ? { role: 'tool', toolName, content, attachments }
    : { role: 'tool', toolName, content };
}

function callContentToBlock(content: ChatGPTContent, fallbackLang: string): ContentBlock | null {
  if (content.content_type === 'code') {
    return {
      type: 'code',
      language: content.language ?? fallbackLang,
      code: content.text ?? '',
    };
  }
  if (content.content_type === 'text') {
    const text = stringPartsToText(content);
    if (text.length === 0) return null;
    return { type: 'code', language: fallbackLang, code: text };
  }
  return null;
}

function appendResultBlocks(
  content: ChatGPTContent,
  attachmentMeta: ReadonlyArray<ChatGPTAttachmentMetadata>,
  blocks: ContentBlock[],
  attachments: AttachmentRef[],
): void {
  if (content.content_type === 'execution_output') {
    blocks.push({ type: 'tool_output', output: content.text ?? '' });
    return;
  }

  if (content.content_type === 'multimodal_text') {
    for (const part of content.parts ?? []) {
      if (typeof part === 'string') {
        if (part.length > 0) blocks.push({ type: 'text', text: part });
      } else if (part.content_type === 'image_asset_pointer') {
        const ref = imageAssetToAttachment(part, attachmentMeta);
        attachments.push(ref);
        blocks.push({ type: 'image', ref });
      } else if (part.content_type === 'audio_transcription') {
        if (part.text.length > 0) blocks.push({ type: 'text', text: part.text });
      }
    }
    return;
  }

  if (typeof content.text === 'string' && content.text.length > 0) {
    blocks.push({ type: 'tool_output', output: content.text });
  }
}

function toNormalizedMessage(msg: ChatGPTMessage): NormalizedMessage | null {
  switch (msg.author.role) {
    case 'system':
      return systemMessage(msg);
    case 'user':
      return userMessage(msg);
    case 'assistant':
      return assistantMessage(msg);
    default:
      // Orphan tool result without a preceding call, or any unknown role.
      return null;
  }
}

function systemMessage(msg: ChatGPTMessage): NormalizedMessage | null {
  const text = stringPartsToText(msg.content);
  if (text.trim().length === 0) return null;
  return { role: 'system', content: [{ type: 'text', text }] };
}

function userMessage(msg: ChatGPTMessage): NormalizedMessage | null {
  const content: ContentBlock[] = [];
  const attachments: AttachmentRef[] = [];
  const attachmentMeta = msg.metadata?.attachments ?? [];

  if (msg.content.content_type === 'multimodal_text') {
    for (const part of msg.content.parts ?? []) {
      if (typeof part === 'string') {
        if (part.length > 0) content.push({ type: 'text', text: part });
      } else if (part.content_type === 'image_asset_pointer') {
        const ref = imageAssetToAttachment(part, attachmentMeta);
        attachments.push(ref);
        content.push({ type: 'image', ref });
      } else if (part.content_type === 'audio_transcription') {
        if (part.text.length > 0) content.push({ type: 'text', text: part.text });
      }
    }
  } else if (msg.content.content_type === 'text') {
    const text = stringPartsToText(msg.content);
    if (text.trim().length === 0) return null;
    content.push({ type: 'text', text });
  }

  if (content.length === 0) return null;

  return attachments.length > 0
    ? { role: 'user', content, attachments }
    : { role: 'user', content };
}

function assistantMessage(msg: ChatGPTMessage): NormalizedMessage | null {
  // Assistant messages with a non-'all' recipient are tool calls and must be
  // handled in the combine path; if we got here unpaired, drop the half-block.
  if (msg.recipient !== 'all') return null;

  const content: ContentBlock[] = [];

  if (msg.content.content_type === 'text') {
    const text = stringPartsToText(msg.content);
    if (text.trim().length > 0) content.push({ type: 'text', text });
  } else if (msg.content.content_type === 'code') {
    content.push({
      type: 'code',
      language: msg.content.language ?? '',
      code: msg.content.text ?? '',
    });
  } else if (msg.content.content_type === 'multimodal_text') {
    for (const part of msg.content.parts ?? []) {
      if (typeof part === 'string') {
        if (part.length > 0) content.push({ type: 'text', text: part });
      } else if (part.content_type === 'audio_transcription') {
        if (part.text.length > 0) content.push({ type: 'text', text: part.text });
      }
    }
  }

  if (content.length === 0) return null;

  return { role: 'assistant', content };
}

function stringPartsToText(content: ChatGPTContent): string {
  const parts = content.parts ?? [];
  return parts.filter((p): p is string => typeof p === 'string').join('\n');
}

function imageAssetToAttachment(
  pointer: ChatGPTImageAssetPointer,
  metadata: ReadonlyArray<ChatGPTAttachmentMetadata> = [],
): AttachmentRef {
  // asset_pointer looks like 'file-service://file-XXX'. Strip the scheme so
  // the id matches the metadata.attachments entry shape.
  const id = pointer.asset_pointer.replace(/^file-service:\/\//, '');
  const meta = metadata.find((m) => m.id === id);
  return meta?.mime_type !== undefined
    ? { id, filename: meta.name, mimeType: meta.mime_type }
    : { id, filename: meta?.name ?? `${id}.png` };
}

// ─── Runtime ────────────────────────────────────────────────────────────────

const SESSION_URL = 'https://chatgpt.com/api/auth/session';
const CONVERSATIONS_URL = 'https://chatgpt.com/backend-api/conversations';
const CONVERSATION_URL = 'https://chatgpt.com/backend-api/conversation';
const PAGE_LIMIT = 100;
const PAGE_THROTTLE_MS = 250;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 250;

interface ChatGPTSessionResponse {
  accessToken?: string;
  expires?: string;
  user?: { name?: string; email?: string };
}

interface ChatGPTConversationListItem {
  id: string;
  title: string;
  create_time: number | string;
  // null/missing for conversations never updated after creation; fall back to create_time.
  update_time: number | string | null;
}

interface ChatGPTConversationListResponse {
  items: ChatGPTConversationListItem[];
  total: number;
  limit: number;
  offset: number;
}

export class ChatGPTProvider implements Provider {
  readonly name = 'chatgpt' as const;

  #token: string | null = null;

  async getSession(): Promise<SessionInfo> {
    let res: Response;
    try {
      res = await fetch(SESSION_URL, { credentials: 'include' });
    } catch {
      return { authenticated: false };
    }

    if (!res.ok) return { authenticated: false };

    let body: ChatGPTSessionResponse | null;
    try {
      const text = await res.text();
      if (text.length === 0) return { authenticated: false };
      body = JSON.parse(text) as ChatGPTSessionResponse | null;
    } catch {
      return { authenticated: false };
    }

    if (body === null || typeof body.accessToken !== 'string' || body.accessToken.length === 0) {
      return { authenticated: false };
    }

    this.#token = body.accessToken;

    const info: SessionInfo = { authenticated: true };
    if (body.user !== undefined) {
      const user: { name?: string; email?: string } = {};
      if (typeof body.user.name === 'string') user.name = body.user.name;
      if (typeof body.user.email === 'string') user.email = body.user.email;
      info.user = user;
    }
    if (typeof body.expires === 'string') {
      info.expiresAt = new Date(body.expires);
    }
    return info;
  }

  async *listConversations(opts?: ListOpts): AsyncIterable<ConversationSummary> {
    const limit = opts?.limit;
    const signal = opts?.signal;
    let offset = 0;
    let yielded = 0;
    let isFirstPage = true;

    while (true) {
      if (signal?.aborted) return;

      if (!isFirstPage) {
        await delay(PAGE_THROTTLE_MS);
        if (signal?.aborted) return;
      }
      isFirstPage = false;

      const url = `${CONVERSATIONS_URL}?offset=${offset}&limit=${PAGE_LIMIT}&order=updated`;
      const init: RequestInit =
        signal !== undefined ? { method: 'GET', signal } : { method: 'GET' };
      const res = await this.#authedFetch(url, init);
      const page = (await res.json()) as ChatGPTConversationListResponse;

      const items = page.items ?? [];
      for (const item of items) {
        if (signal?.aborted) return;
        yield mapSummary(item);
        yielded++;
        if (limit !== undefined && yielded >= limit) return;
      }

      const fetched = offset + items.length;
      if (items.length === 0 || fetched >= page.total) return;
      offset = fetched;
    }
  }

  async getConversation(id: string): Promise<NormalizedConversation> {
    const url = `${CONVERSATION_URL}/${encodeURIComponent(id)}`;
    const res = await this.#authedFetch(url, { method: 'GET' });
    const raw = (await res.json()) as ChatGPTConversation;
    return normalize(raw);
  }

  async fetchAttachment(_ref: AttachmentRef): Promise<Blob> {
    // Exports intentionally don't package attachment binaries — the markdown
    // emits a `<attachment:filename>` marker so a reader knows there was a
    // file at that point in the conversation, but we don't bulk up the ZIP
    // with the bytes. Provider interface keeps the method for a potential
    // future opt-in, but no caller invokes it today.
    throw new Error('Attachment binaries are not packaged in exports');
  }

  async #authedFetch(url: string, init: RequestInit): Promise<Response> {
    if (this.#token === null) {
      const session = await this.getSession();
      if (!session.authenticated || this.#token === null) {
        throw new Error('Not authenticated with ChatGPT');
      }
    }

    const res = await this.#retryFetch(url, this.#withAuth(init));
    if (res.status !== 401) return res;

    // Token may have expired mid-export; refresh once and retry.
    this.#token = null;
    const session = await this.getSession();
    if (!session.authenticated || this.#token === null) {
      throw new Error('Not authenticated with ChatGPT');
    }
    return this.#retryFetch(url, this.#withAuth(init));
  }

  #withAuth(init: RequestInit): RequestInit {
    const headers = new Headers(init.headers);
    if (this.#token !== null) headers.set('Authorization', `Bearer ${this.#token}`);
    return { ...init, headers, credentials: 'include' };
  }

  async #retryFetch(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, init);
        if (res.status >= 500 && res.status < 600) {
          if (attempt === MAX_RETRIES) return res;
          await delay(BASE_BACKOFF_MS * 2 ** attempt);
          continue;
        }
        return res;
      } catch (err) {
        // Caller-initiated abort: propagate immediately, never retry.
        if (init.signal?.aborted === true) throw err;
        lastError = err;
        if (attempt === MAX_RETRIES) throw err;
        await delay(BASE_BACKOFF_MS * 2 ** attempt);
      }
    }
    // Unreachable: loop either returns or throws on the final attempt.
    throw lastError instanceof Error ? lastError : new Error('retryFetch exhausted');
  }
}

function mapSummary(item: ChatGPTConversationListItem): ConversationSummary {
  const createdAt = toDate(item.create_time);
  // Loose != null catches both `null` (typed shape) and `undefined` (real
  // responses sometimes omit the field entirely).
  const updatedAt = item.update_time != null ? toDate(item.update_time) : createdAt;
  return {
    id: item.id,
    title: item.title,
    createdAt,
    updatedAt,
  };
}

function toDate(value: number | string): Date {
  if (typeof value === 'number') return new Date(value * 1000);
  // Some ChatGPT endpoints return ISO strings; both shapes coexist in the wild.
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return new Date(asNumber * 1000);
  return new Date(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
