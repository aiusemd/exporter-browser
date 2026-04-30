import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { AttachmentRef, NormalizedConversation } from '../types.js';
import { buildZip } from './build.js';

function plainConversation(
  title: string,
  createdISO: string,
  override: Partial<NormalizedConversation> = {},
): NormalizedConversation {
  return {
    id: title,
    title,
    createdAt: new Date(createdISO),
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi back' }] },
    ],
    ...override,
  };
}

function imageRef(id: string, filename: string): AttachmentRef {
  return { id, filename };
}

async function unzipBlob(blob: Blob): Promise<Record<string, string>> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const entries = unzipSync(buffer);
  const decoder = new TextDecoder();
  const out: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(entries)) {
    out[name] = decoder.decode(bytes);
  }
  return out;
}

describe('buildZip', () => {
  it('returns an empty (but valid) ZIP for zero packages', async () => {
    const zip = await buildZip([]);
    expect(zip).toBeInstanceOf(Blob);
    const entries = await unzipBlob(zip);
    expect(Object.keys(entries)).toHaveLength(0);
  });

  it('writes one .md per conversation under aiuse/YYYY-MM/', async () => {
    const conv = plainConversation('Greeting', '2026-04-28T10:00:00Z');
    const zip = await buildZip([{ conversation: conv }]);
    const entries = await unzipBlob(zip);
    const names = Object.keys(entries);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^aiuse\/2026-04\/2026-04-28--greeting--[a-z0-9]{4}\.md$/);
  });

  it('renders the conversation markdown into the .md file', async () => {
    const conv = plainConversation('Greeting', '2026-04-28T00:00:00Z');
    const zip = await buildZip([{ conversation: conv }]);
    const entries = await unzipBlob(zip);
    const content = Object.values(entries)[0];
    expect(content).toBeDefined();
    expect(content).toBe('### User\nhello\n\n### Assistant\nhi back');
  });

  it('groups conversations into separate YYYY-MM folders by createdAt', async () => {
    const conv1 = plainConversation('April thing', '2026-04-15T00:00:00Z');
    const conv2 = plainConversation('March thing', '2026-03-20T00:00:00Z');
    const zip = await buildZip([{ conversation: conv1 }, { conversation: conv2 }]);
    const names = Object.keys(await unzipBlob(zip));
    expect(names).toHaveLength(2);
    expect(names.some((n) => n.startsWith('aiuse/2026-04/'))).toBe(true);
    expect(names.some((n) => n.startsWith('aiuse/2026-03/'))).toBe(true);
  });

  it('emits <attachment:filename> markers in the markdown without packaging the binary', async () => {
    const ref = imageRef('file-DALLE0001', 'sunset.png');
    const conv: NormalizedConversation = {
      id: 'c1',
      title: 'Sunset',
      createdAt: new Date('2026-04-28T00:00:00Z'),
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'gen sunset' }] },
        {
          role: 'tool',
          toolName: 'dalle.text2im',
          content: [
            { type: 'code', language: 'json', code: '{"prompt":"sunset"}' },
            { type: 'image', ref },
          ],
        },
      ],
    };

    const zip = await buildZip([{ conversation: conv }]);
    const entries = await unzipBlob(zip);
    const names = Object.keys(entries);
    // Only the .md — attachment binaries are intentionally not packaged.
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^aiuse\/2026-04\/2026-04-28--sunset--[a-z0-9]{4}\.md$/);

    const md = entries[names[0] ?? ''] ?? '';
    expect(md).toContain('<attachment:sunset.png>');
  });

  it('forwards render options through (truncation applied via buildZip)', async () => {
    const conv: NormalizedConversation = {
      id: 'c1',
      title: 'Long',
      createdAt: new Date('2026-04-28T00:00:00Z'),
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(50) }] }],
    };
    const zip = await buildZip([{ conversation: conv }], { render: { truncateLimit: 20 } });
    const md = Object.values(await unzipBlob(zip))[0] ?? '';
    expect(md).toBe(`### User\n${'x'.repeat(20)}<truncated>`);
  });
});
