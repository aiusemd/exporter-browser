import { describe, expect, it } from 'vitest';
import type { AttachmentRef, NormalizedConversation, NormalizedMessage } from '../types.js';
import { renderConversation } from './aiuse.js';

function conv(messages: NormalizedMessage[]): NormalizedConversation {
  return {
    id: 'test-id',
    title: 'Test',
    createdAt: new Date('2026-04-28T00:00:00Z'),
    messages,
  };
}

function attachment(filename: string, opts: Partial<AttachmentRef> = {}): AttachmentRef {
  return {
    id: filename,
    filename,
    ...opts,
  };
}

describe('renderConversation: prose bodies', () => {
  it('renders a plain Q&A as User/Assistant headers without wrappers', () => {
    const result = renderConversation(
      conv([
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there.' }] },
      ]),
    );
    expect(result.markdown).toBe('### User\nHello\n\n### Assistant\nHi there.');
    expect(result.attachments).toEqual([]);
  });

  it('wraps an assistant reply with structural markdown in a markdown fence', () => {
    const result = renderConversation(
      conv([
        {
          role: 'assistant',
          content: [{ type: 'text', text: '# Heading\n\n- a\n- b' }],
        },
      ]),
    );
    expect(result.markdown).toBe('### Assistant\n```markdown\n# Heading\n\n- a\n- b\n```');
  });

  it('wraps a single-code-block assistant reply in a ```lang fence', () => {
    const result = renderConversation(
      conv([
        {
          role: 'assistant',
          content: [{ type: 'code', language: 'js', code: 'return 1;' }],
        },
      ]),
    );
    expect(result.markdown).toBe('### Assistant\n```js\nreturn 1;\n```');
  });

  it('escalates the markdown fence around content that already contains ``` fences', () => {
    const result = renderConversation(
      conv([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Here is a snippet:' },
            { type: 'code', language: 'js', code: 'const x = 1;' },
          ],
        },
      ]),
    );
    // Inner fence is ```js (3 backticks); outer markdown wrapper must be 4.
    expect(result.markdown).toBe(
      '### Assistant\n````markdown\nHere is a snippet:\n\n```js\nconst x = 1;\n```\n````',
    );
  });

  it('treats numbered-list lines as structured markdown', () => {
    const result = renderConversation(
      conv([
        {
          role: 'assistant',
          content: [{ type: 'text', text: '1. first\n2. second' }],
        },
      ]),
    );
    expect(result.markdown).toBe('### Assistant\n```markdown\n1. first\n2. second\n```');
  });

  it('strips ChatGPT citation markers from prose', () => {
    const result = renderConversation(
      conv([
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Distance is 384,400 km 【4:0†source】.' }],
        },
      ]),
    );
    expect(result.markdown).toBe('### Assistant\nDistance is 384,400 km .');
  });

  it('redacts secrets via the default pattern set', () => {
    const result = renderConversation(
      conv([
        {
          role: 'user',
          content: [{ type: 'text', text: 'My key is sk-abcdefghijklmnopqrstuvwxyz0123456789' }],
        },
      ]),
    );
    expect(result.markdown).toBe('### User\nMy key is <redacted>');
  });

  it('truncates oversize content and appends <truncated>', () => {
    const result = renderConversation(
      conv([
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'x'.repeat(50) }],
        },
      ]),
      { truncateLimit: 20 },
    );
    expect(result.markdown).toBe(`### Assistant\n${'x'.repeat(20)}<truncated>`);
  });

  it('applies the truncate limit to the assembled body, not per-block', () => {
    // Two text blocks of 30 chars each — combined exceeds the 20-char limit
    // even though neither block alone would. The spec's 4000-char rule is
    // per-reply, not per-block.
    const result = renderConversation(
      conv([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'A'.repeat(30) },
            { type: 'text', text: 'B'.repeat(30) },
          ],
        },
      ]),
      { truncateLimit: 20 },
    );
    expect(result.markdown).toBe(`### Assistant\n${'A'.repeat(20)}<truncated>`);
  });

  it('falls back to ```text fence for a single prose code block with no language', () => {
    const result = renderConversation(
      conv([
        {
          role: 'assistant',
          content: [{ type: 'code', language: '', code: 'unknown stuff' }],
        },
      ]),
    );
    expect(result.markdown).toBe('### Assistant\n```text\nunknown stuff\n```');
  });

  it('skips empty system messages', () => {
    const result = renderConversation(
      conv([
        { role: 'system', content: [{ type: 'text', text: '' }] },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ]),
    );
    expect(result.markdown).toBe('### User\nhi');
  });

  it('renders a non-empty system message', () => {
    const result = renderConversation(
      conv([{ role: 'system', content: [{ type: 'text', text: 'Be concise.' }] }]),
    );
    expect(result.markdown).toBe('### System\nBe concise.');
  });

  it('emits <attachment:filename> for an image attachment in a user message', () => {
    const ref = attachment('vacation.jpg');
    const result = renderConversation(
      conv([
        {
          role: 'user',
          content: [
            { type: 'image', ref },
            { type: 'text', text: 'What is in this photo?' },
          ],
        },
      ]),
    );
    expect(result.markdown).toBe('### User\n<attachment:vacation.jpg>\n\nWhat is in this photo?');
    expect(result.attachments).toEqual([ref]);
  });

  it('falls back to bare <attachment> only when the ref has no filename', () => {
    const ref: AttachmentRef = { id: 'x', filename: '' };
    const result = renderConversation(
      conv([
        {
          role: 'user',
          content: [{ type: 'image', ref }],
        },
      ]),
    );
    expect(result.markdown).toBe('### User\n<attachment>');
  });
});

describe('renderConversation: tool messages', () => {
  it('renders a code-interpreter call as ```python input + ```text output', () => {
    const result = renderConversation(
      conv([
        {
          role: 'tool',
          toolName: 'python',
          content: [
            { type: 'code', language: 'python', code: 'print(2+2)' },
            { type: 'tool_output', output: '4\n' },
          ],
        },
      ]),
    );
    expect(result.markdown).toBe('### Tool\n```python\nprint(2+2)\n```\n```text\n4\n```');
  });

  it('renders a DALL-E call as ```json args + <attachment:filename>', () => {
    const ref = attachment('sunset.png');
    const result = renderConversation(
      conv([
        {
          role: 'tool',
          toolName: 'dalle.text2im',
          content: [
            {
              type: 'code',
              language: 'json',
              code: '{"prompt":"sunset","size":"1024x1024"}',
            },
            { type: 'image', ref },
          ],
        },
      ]),
    );
    expect(result.markdown).toBe(
      '### Tool\n```json\n{"prompt":"sunset","size":"1024x1024"}\n```\n<attachment:sunset.png>',
    );
    expect(result.attachments).toEqual([ref]);
  });

  it('falls back to ```text fence for a tool code block with no language', () => {
    const result = renderConversation(
      conv([
        {
          role: 'tool',
          toolName: 'shell',
          content: [{ type: 'code', language: '', code: 'ls -la' }],
        },
      ]),
    );
    expect(result.markdown).toBe('### Tool\n```text\nls -la\n```');
  });
});

describe('renderConversation: full conversation', () => {
  it('joins multiple messages with one blank line between them', () => {
    const result = renderConversation(
      conv([
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
        { role: 'user', content: [{ type: 'text', text: 'c' }] },
      ]),
    );
    expect(result.markdown).toBe('### User\na\n\n### Assistant\nb\n\n### User\nc');
  });

  it('aggregates attachments across messages in conversation order', () => {
    const a = attachment('a.png');
    const b = attachment('b.png');
    const result = renderConversation(
      conv([
        { role: 'user', content: [{ type: 'image', ref: a }] },
        {
          role: 'tool',
          toolName: 'dalle.text2im',
          content: [
            { type: 'code', language: 'json', code: '{}' },
            { type: 'image', ref: b },
          ],
        },
      ]),
    );
    expect(result.attachments).toEqual([a, b]);
  });

  it('returns an empty markdown for a conversation with only skippable messages', () => {
    const result = renderConversation(
      conv([{ role: 'system', content: [{ type: 'text', text: '' }] }]),
    );
    expect(result.markdown).toBe('');
    expect(result.attachments).toEqual([]);
  });
});
