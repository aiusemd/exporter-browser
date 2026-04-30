import type {
  AttachmentRef,
  ContentBlock,
  NormalizedConversation,
  NormalizedMessage,
  Role,
} from '../types.js';
import { wrap } from './fences.js';
import { type RedactOptions, redact } from './redact.js';
import { truncate } from './truncate.js';

export interface RenderOptions {
  redact?: RedactOptions;
  truncateLimit?: number;
}

export interface RenderResult {
  markdown: string;
  attachments: AttachmentRef[];
}

const ROLE_HEADERS: Record<Role, string> = {
  user: '### User',
  assistant: '### Assistant',
  system: '### System',
  tool: '### Tool',
};

// Lines starting with ATX heading, list marker, blockquote, or table row.
// Multiline so any line in the content can flag the message as structured.
const STRUCTURED_LINE = /^(#{1,6} |[-*+] |\d+\.\s|>|\|.*\|)/m;

// ChatGPT citation markers like 【4:0†source】. Not human-readable in the
// exported logs and the source URLs they reference are dropped anyway.
const CITATION_MARKER = /【[^】]*】/g;

export function renderConversation(
  conv: NormalizedConversation,
  options: RenderOptions = {},
): RenderResult {
  const sections: string[] = [];
  const attachments: AttachmentRef[] = [];

  for (const message of conv.messages) {
    const rendered = renderMessage(message, options);
    if (rendered === null) continue;
    sections.push(rendered.markdown);
    attachments.push(...rendered.attachments);
  }

  return {
    markdown: sections.join('\n\n'),
    attachments,
  };
}

function renderMessage(message: NormalizedMessage, options: RenderOptions): RenderResult | null {
  if (message.role === 'system' && isEmpty(message.content)) return null;

  const body =
    message.role === 'tool'
      ? renderToolBody(message, options)
      : renderProseBody(message.content, options);

  if (body.markdown.length === 0 && body.attachments.length === 0) return null;

  return {
    markdown: `${ROLE_HEADERS[message.role]}\n${body.markdown}`,
    attachments: body.attachments,
  };
}

function renderToolBody(message: NormalizedMessage, options: RenderOptions): RenderResult {
  const attachments: AttachmentRef[] = [];
  const fragments: string[] = [];

  for (const block of message.content) {
    if (block.type === 'code') {
      const code = applyTextTransforms(block.code, options);
      fragments.push(wrap(code, block.language || 'text'));
    } else if (block.type === 'tool_output') {
      const output = applyTextTransforms(block.output, options);
      fragments.push(wrap(output, 'text'));
    } else if (block.type === 'text') {
      const text = applyTextTransforms(block.text, options);
      if (text.length > 0) fragments.push(wrap(text, 'text'));
    } else if (block.type === 'image') {
      attachments.push(block.ref);
      fragments.push(attachmentRef(block.ref));
    }
  }

  const combined = fragments.join('\n');
  return { markdown: truncate(combined, options.truncateLimit), attachments };
}

function renderProseBody(blocks: ContentBlock[], options: RenderOptions): RenderResult {
  // Whole-message-is-one-code-block: emit the bare ```lang block.
  if (blocks.length === 1 && blocks[0]?.type === 'code') {
    const block = blocks[0];
    const code = applyTextTransforms(block.code, options);
    const cut = truncate(code, options.truncateLimit);
    return { markdown: wrap(cut, block.language || 'text'), attachments: [] };
  }

  const attachments: AttachmentRef[] = [];
  const fragments: string[] = [];
  let hasStructure = false;

  for (const block of blocks) {
    if (block.type === 'text') {
      const text = applyTextTransforms(block.text, options);
      if (text.length === 0) continue;
      fragments.push(text);
      if (STRUCTURED_LINE.test(text) || text.includes('```')) hasStructure = true;
    } else if (block.type === 'code') {
      const code = applyTextTransforms(block.code, options);
      fragments.push(wrap(code, block.language || 'text'));
      hasStructure = true;
    } else if (block.type === 'image') {
      attachments.push(block.ref);
      fragments.push(attachmentRef(block.ref));
    } else if (block.type === 'tool_output') {
      const output = applyTextTransforms(block.output, options);
      fragments.push(wrap(output, 'text'));
      hasStructure = true;
    }
  }

  const combined = fragments.join('\n\n');

  if (combined.length === 0) return { markdown: '', attachments };

  // Apply the spec's 4000-char limit to the assembled body, not per-block.
  // truncate() is fence-aware so cuts inside embedded code blocks walk back
  // to safe positions before any outer ```markdown wrap is added.
  const cut = truncate(combined, options.truncateLimit);

  if (hasStructure) {
    return { markdown: wrap(cut, 'markdown'), attachments };
  }

  return { markdown: cut, attachments };
}

function attachmentRef(ref: AttachmentRef): string {
  // Filename-only marker. Per design, exports don't package the binaries —
  // the marker is informational so a reader knows there was a file at this
  // point in the conversation. Falls back to a bare `<attachment>` only when
  // we have no name at all (shouldn't happen with the current normalizers).
  return ref.filename ? `<attachment:${ref.filename}>` : '<attachment>';
}

function applyTextTransforms(text: string, options: RenderOptions): string {
  // Citation strip + redact only. Per-message truncation is applied to the
  // assembled body in render*Body — the AIUSE 4000-char rule applies to the
  // whole reply, not to each block.
  let result = text.replace(CITATION_MARKER, '');
  result = redact(result, options.redact);
  return result;
}

function isEmpty(blocks: ContentBlock[]): boolean {
  return blocks.every((block) => {
    if (block.type === 'text') return block.text.trim().length === 0;
    if (block.type === 'code') return block.code.trim().length === 0;
    if (block.type === 'tool_output') return block.output.trim().length === 0;
    return false;
  });
}
