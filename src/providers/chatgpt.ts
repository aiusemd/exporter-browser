import type {
  AttachmentRef,
  ContentBlock,
  NormalizedConversation,
  NormalizedMessage,
} from '../types.js';

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

type ChatGPTPart = string | ChatGPTImageAssetPointer;

interface ChatGPTImageAssetPointer {
  content_type: 'image_asset_pointer';
  asset_pointer: string;
  size_bytes?: number | null;
  width?: number;
  height?: number;
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
      if (typeof part === 'string' && part.length > 0) {
        content.push({ type: 'text', text: part });
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
  // asset_pointer looks like 'file-service://file-XXX'. The file id is what
  // the /backend-api/files/{id}/download endpoint expects.
  const id = pointer.asset_pointer.replace(/^file-service:\/\//, '');
  const meta = metadata.find((m) => m.id === id);
  return meta?.mime_type !== undefined
    ? {
        id,
        filename: meta.name,
        mimeType: meta.mime_type,
        included: false,
      }
    : {
        id,
        filename: meta?.name ?? `${id}.png`,
        included: false,
      };
}
