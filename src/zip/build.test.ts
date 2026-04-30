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
  return { id, filename, included: false };
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

async function unzipBlobBytes(blob: Blob): Promise<Record<string, Uint8Array>> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  return unzipSync(buffer);
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

  it('packages attachment blobs at adjacent paths and rewrites refs to spec filenames', async () => {
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
    const blobs = new Map<string, Blob>([
      ['file-DALLE0001', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })],
    ]);

    const zip = await buildZip([{ conversation: conv, attachmentBlobs: blobs }]);
    const entries = await unzipBlob(zip);
    const bytes = await unzipBlobBytes(zip);

    const names = Object.keys(entries).sort();
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^aiuse\/2026-04\/2026-04-28--sunset--[a-z0-9]{4}--sunset\.png$/);
    expect(names[1]).toMatch(/^aiuse\/2026-04\/2026-04-28--sunset--[a-z0-9]{4}\.md$/);

    // Markdown should reference the same full filename.
    const mdName = names[1];
    expect(mdName).toBeDefined();
    if (mdName === undefined) return;
    const md = entries[mdName];
    expect(md).toBeDefined();
    if (md === undefined) return;
    const expectedAttachmentName = names[0]?.split('/').pop() ?? '';
    expect(md).toContain(`<attachment:${expectedAttachmentName}>`);

    // Attachment bytes preserved.
    const attBytes = bytes[names[0] ?? ''];
    expect(attBytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('uses the same `rand` for the .md and its attachments', async () => {
    const ref = imageRef('img-1', 'photo.jpg');
    const conv: NormalizedConversation = {
      id: 'c1',
      title: 'Vacation',
      createdAt: new Date('2026-04-28T00:00:00Z'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', ref },
            { type: 'text', text: 'what is this' },
          ],
        },
      ],
    };
    const blobs = new Map<string, Blob>([['img-1', new Blob([new Uint8Array([0])])]]);

    const zip = await buildZip([{ conversation: conv, attachmentBlobs: blobs }]);
    const names = Object.keys(await unzipBlob(zip));
    const mdName = names.find((n) => n.endsWith('.md')) ?? '';
    const attName = names.find((n) => !n.endsWith('.md')) ?? '';
    const mdMatch = /--([a-z0-9]{4})\.md$/.exec(mdName);
    const attMatch = /--([a-z0-9]{4})--/.exec(attName);
    expect(mdMatch?.[1]).toBeDefined();
    expect(attMatch?.[1]).toBeDefined();
    expect(mdMatch?.[1]).toBe(attMatch?.[1]);
  });

  it('emits bare <attachment> in the markdown when no blob is provided', async () => {
    const ref = imageRef('img-1', 'unknown.bin');
    const conv: NormalizedConversation = {
      id: 'c1',
      title: 'Missing attachment',
      createdAt: new Date('2026-04-28T00:00:00Z'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', ref },
            { type: 'text', text: 'see file' },
          ],
        },
      ],
    };
    // No attachmentBlobs map — renderer should emit bare <attachment>
    const zip = await buildZip([{ conversation: conv }]);
    const entries = await unzipBlob(zip);
    const names = Object.keys(entries);
    expect(names).toHaveLength(1); // only the .md
    const md = Object.values(entries)[0] ?? '';
    expect(md).toContain('<attachment>');
    expect(md).not.toContain('<attachment:');
  });

  it('partial attachment coverage works (one blob present, one missing)', async () => {
    const ref1 = imageRef('have', 'have.png');
    const ref2 = imageRef('missing', 'missing.png');
    const conv: NormalizedConversation = {
      id: 'c1',
      title: 'Mixed',
      createdAt: new Date('2026-04-28T00:00:00Z'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', ref: ref1 },
            { type: 'image', ref: ref2 },
          ],
        },
      ],
    };
    const blobs = new Map<string, Blob>([['have', new Blob([new Uint8Array([5])])]]);
    const zip = await buildZip([{ conversation: conv, attachmentBlobs: blobs }]);
    const entries = await unzipBlob(zip);
    const names = Object.keys(entries).sort();
    expect(names).toHaveLength(2); // .md + 1 attachment
    const md = entries[names.find((n) => n.endsWith('.md')) ?? ''] ?? '';
    expect(md).toContain('<attachment:'); // included one
    expect(md).toContain('<attachment>'); // bare fallback for missing one
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
