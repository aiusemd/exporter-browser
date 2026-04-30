import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderConversation } from '../format/aiuse.js';
import { type ChatGPTConversation, normalize } from './chatgpt.js';

const FIXTURES_DIR = join(__dirname, '../../test/fixtures');

function loadFixture(name: string): ChatGPTConversation {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as ChatGPTConversation;
}

describe('normalize: structure', () => {
  it('drops the empty system header and keeps user + assistant for chatgpt-simple', () => {
    const conv = normalize(loadFixture('chatgpt-simple.json'));
    expect(conv.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(conv.title).toBe('Greeting');
    expect(conv.createdAt.toISOString()).toBe('2025-04-28T00:00:00.123Z');
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Hello, how are you?' }],
    });
    expect(conv.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: "I'm doing well, thanks for asking!" }],
    });
  });

  it('preserves heading/list markdown in chatgpt-markdown', () => {
    const conv = normalize(loadFixture('chatgpt-markdown.json'));
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[1]?.content[0]).toEqual({
      type: 'text',
      text: '# Presentation\n## Slide 1\n* Bullet a\n* Bullet b\n* Bullet c\n',
    });
  });

  it('keeps prose-with-fenced-code as a text block for chatgpt-code', () => {
    const conv = normalize(loadFixture('chatgpt-code.json'));
    expect(conv.messages).toHaveLength(2);
    const assistant = conv.messages[1];
    expect(assistant?.role).toBe('assistant');
    const block = assistant?.content[0];
    expect(block?.type).toBe('text');
    if (block?.type === 'text') {
      expect(block.text).toContain('```js');
      expect(block.text).toContain('function reverse');
    }
  });

  it('walks only the canonical branch in chatgpt-regen-tree, dropping discarded sibling', () => {
    const conv = normalize(loadFixture('chatgpt-regen-tree.json'));
    expect(conv.messages).toHaveLength(2);
    const assistant = conv.messages[1];
    if (assistant?.content[0]?.type === 'text') {
      expect(assistant.content[0].text).toMatch(/largest city in the country/);
      expect(assistant.content[0].text).not.toMatch(/^The capital is Paris\.$/);
    }
  });

  it('combines code-interpreter call + tool output into a single Tool message', () => {
    const conv = normalize(loadFixture('chatgpt-code-interpreter.json'));
    // user, tool (combined), assistant
    expect(conv.messages).toHaveLength(3);
    const tool = conv.messages[1];
    expect(tool).toEqual({
      role: 'tool',
      toolName: 'python',
      content: [
        { type: 'code', language: 'python', code: 'import math\nprint(math.factorial(10))' },
        { type: 'tool_output', output: '3628800\n' },
      ],
    });
  });

  it('combines DALL-E call + image_asset_pointer result into a single Tool message', () => {
    const conv = normalize(loadFixture('chatgpt-dalle.json'));
    expect(conv.messages).toHaveLength(3);
    const tool = conv.messages[1];
    expect(tool?.role).toBe('tool');
    expect(tool?.toolName).toBe('dalle.text2im');
    const blocks = tool?.content ?? [];
    expect(blocks[0]).toEqual({
      type: 'code',
      language: 'json',
      code: '{"prompt":"a serene sunset over mountains, photorealistic","size":"1024x1024"}',
    });
    expect(blocks[1]?.type).toBe('image');
    if (blocks[1]?.type === 'image') {
      expect(blocks[1].ref.id).toBe('file-DALLE0001');
      expect(blocks[1].ref.filename).toBe('file-DALLE0001.png');
    }
    expect(tool?.attachments).toHaveLength(1);
  });

  it('drops the entire browsing trace, leaving only user and final assistant', () => {
    const conv = normalize(loadFixture('chatgpt-browsing.json'));
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0]?.role).toBe('user');
    expect(conv.messages[1]?.role).toBe('assistant');
  });

  it('extracts user-uploaded image as an attachment in chatgpt-multimodal', () => {
    const conv = normalize(loadFixture('chatgpt-multimodal.json'));
    expect(conv.messages).toHaveLength(2);
    const user = conv.messages[0];
    expect(user?.role).toBe('user');
    expect(user?.attachments).toHaveLength(1);
    expect(user?.attachments?.[0]).toEqual({
      id: 'file-USERIMG0001',
      filename: 'vacation.jpg',
      mimeType: 'image/jpeg',
    });
    const blocks = user?.content ?? [];
    expect(blocks[0]?.type).toBe('image');
    expect(blocks[1]).toEqual({ type: 'text', text: 'What is in this photo?' });
  });
});

describe('normalize → render: integration snapshots', () => {
  it('chatgpt-simple → spec-valid markdown', () => {
    const result = renderConversation(normalize(loadFixture('chatgpt-simple.json')));
    expect(result.markdown).toBe(
      "### User\nHello, how are you?\n\n### Assistant\nI'm doing well, thanks for asking!",
    );
    expect(result.attachments).toEqual([]);
  });

  it('chatgpt-markdown → wraps assistant body in ```markdown', () => {
    const result = renderConversation(normalize(loadFixture('chatgpt-markdown.json')));
    expect(result.markdown).toBe(
      '### User\nCreate bullet points for my presentation\n\n' +
        '### Assistant\n```markdown\n# Presentation\n## Slide 1\n* Bullet a\n* Bullet b\n* Bullet c\n```',
    );
  });

  it('chatgpt-code → escalates outer fence around inner ```js block', () => {
    const result = renderConversation(normalize(loadFixture('chatgpt-code.json')));
    expect(result.markdown).toBe(
      '### User\nHow do I reverse an ascii string in javascript?\n\n' +
        '### Assistant\n````markdown\nHere\'s a one-liner:\n\n```js\nfunction reverse(s) {\n  return s.split("").reverse().join("");\n}\n```\n````',
    );
  });

  it('chatgpt-regen-tree → only canonical assistant reply appears', () => {
    const result = renderConversation(normalize(loadFixture('chatgpt-regen-tree.json')));
    expect(result.markdown).toBe(
      '### User\nWhat is the capital of France?\n\n' +
        "### Assistant\nParis is the capital of France — it's also the largest city in the country.",
    );
  });

  it('chatgpt-code-interpreter → ### Tool with ```python input + ```text output', () => {
    const result = renderConversation(normalize(loadFixture('chatgpt-code-interpreter.json')));
    expect(result.markdown).toBe(
      '### User\nWhat is 10 factorial?\n\n' +
        '### Tool\n```python\nimport math\nprint(math.factorial(10))\n```\n```text\n3628800\n```\n\n' +
        '### Assistant\n10! = 3,628,800.',
    );
  });

  it('chatgpt-dalle → ### Tool with ```json args + bare <attachment>', () => {
    const result = renderConversation(normalize(loadFixture('chatgpt-dalle.json')));
    expect(result.markdown).toBe(
      '### User\nGenerate an image of a sunset over mountains.\n\n' +
        '### Tool\n```json\n{"prompt":"a serene sunset over mountains, photorealistic","size":"1024x1024"}\n```\n<attachment>\n\n' +
        "### Assistant\nHere's the sunset over mountains as requested.",
    );
    // Spec: bare `<attachment>` since we don't package the binary. The
    // normalizer still tracks the underlying ref/filename for downstream
    // tooling, just not in the rendered marker.
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.filename).toBe('file-DALLE0001.png');
  });

  it('chatgpt-browsing → drops the entire trace; citation marker stripped from final reply', () => {
    const result = renderConversation(normalize(loadFixture('chatgpt-browsing.json')));
    expect(result.markdown).toBe(
      "### User\nWhat's the average distance from Earth to the Moon?\n\n" +
        "### Assistant\nThe Moon's average distance from Earth is about 384,400 km .",
    );
  });

  it('chatgpt-multimodal → user message renders attachment ref before text', () => {
    const result = renderConversation(normalize(loadFixture('chatgpt-multimodal.json')));
    expect(result.markdown).toBe(
      '### User\n<attachment>\n\nWhat is in this photo?\n\n' +
        '### Assistant\nThe photo shows a beach scene with palm trees and clear blue water.',
    );
    expect(result.attachments).toHaveLength(1);
  });
});
