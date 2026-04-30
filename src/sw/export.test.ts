import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/provider.js';
import type { ExportProgressMessage } from '../state/messages.js';
import type { NormalizedConversation } from '../types.js';
import type { DownloadsApi, PortLike, RunExportDeps } from './export.js';
import { runExport } from './export.js';

function makeConversation(id: string, title: string, isoDate: string): NormalizedConversation {
  return {
    id,
    title,
    createdAt: new Date(isoDate),
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi back' }] },
    ],
  };
}

function makeImageConversation(
  id: string,
  title: string,
  isoDate: string,
  imageRefs: { id: string; filename: string }[],
): NormalizedConversation {
  return {
    id,
    title,
    createdAt: new Date(isoDate),
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'gen image' }] },
      {
        role: 'tool',
        toolName: 'dalle.text2im',
        content: [
          { type: 'code', language: 'json', code: '{"prompt":"x"}' },
          ...imageRefs.map((r) => ({
            type: 'image' as const,
            ref: { ...r, included: false as const },
          })),
        ],
      },
    ],
  };
}

interface MockPort extends PortLike {
  messages: ExportProgressMessage[];
}

function makeMockPort(): MockPort {
  const messages: ExportProgressMessage[] = [];
  return {
    messages,
    postMessage: (m) => {
      messages.push(m);
    },
    disconnect: vi.fn(),
  };
}

interface DownloadCall {
  options: chrome.downloads.DownloadOptions;
  id: number;
}

interface DownloadsHarness {
  api: DownloadsApi;
  calls: DownloadCall[];
}

function makeDownloadsHarness(): DownloadsHarness {
  const calls: DownloadCall[] = [];
  let nextId = 1;
  return {
    calls,
    api: {
      download: async (options) => {
        const id = nextId++;
        calls.push({ options, id });
        return id;
      },
    },
  };
}

function makeProvider(
  conversations: Record<string, NormalizedConversation | Error>,
  attachments: Record<string, Blob | Error> = {},
): Provider {
  return {
    name: 'chatgpt',
    getSession: vi.fn(),
    listConversations: vi.fn(),
    getConversation: vi.fn(async (id: string) => {
      const v = conversations[id];
      if (v === undefined) throw new Error(`no fixture for ${id}`);
      if (v instanceof Error) throw v;
      return v;
    }),
    fetchAttachment: vi.fn(async (ref) => {
      const v = attachments[ref.id];
      if (v === undefined) throw new Error(`no attachment fixture for ${ref.id}`);
      if (v instanceof Error) throw v;
      return v;
    }),
  };
}

function makeDeps(harness: DownloadsHarness, now: Date): RunExportDeps {
  return {
    downloads: harness.api,
    blobToUrl: async (blob) => `data:application/zip;base64,STUB-${blob.size}`,
    now: () => now,
  };
}

describe('runExport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits PROGRESS for each conversation and a terminal COMPLETE with no failures', async () => {
    const provider = makeProvider({
      a: makeConversation('a', 'Alpha', '2026-04-28T00:00:00Z'),
      b: makeConversation('b', 'Beta', '2026-04-28T01:00:00Z'),
    });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    const deps = makeDeps(harness, new Date('2026-04-30T12:34:56Z'));
    const ctrl = new AbortController();

    await runExport(provider, ['a', 'b'], port, ctrl.signal, deps);

    const types = port.messages.map((m) => m.type);
    expect(types).toEqual(['PROGRESS', 'PROGRESS', 'PROGRESS', 'COMPLETE']);

    expect(port.messages[0]).toEqual({ type: 'PROGRESS', done: 0, total: 2 });
    expect(port.messages[1]).toMatchObject({
      type: 'PROGRESS',
      done: 1,
      total: 2,
      currentTitle: 'Alpha',
    });
    expect(port.messages[2]).toMatchObject({
      type: 'PROGRESS',
      done: 2,
      total: 2,
      currentTitle: 'Beta',
    });

    const complete = port.messages[3];
    expect(complete?.type).toBe('COMPLETE');
    if (complete?.type !== 'COMPLETE') throw new Error('expected COMPLETE');
    expect(complete.filename).toBe('aiuse-2026-04-30-123456.zip');
    expect(complete.failedIds).toEqual([]);
    expect(complete.bytes).toBeGreaterThan(0);
  });

  it('triggers chrome.downloads.download with the produced ZIP', async () => {
    const provider = makeProvider({
      a: makeConversation('a', 'Alpha', '2026-04-28T00:00:00Z'),
    });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    const deps = makeDeps(harness, new Date('2026-04-30T00:00:00Z'));
    const ctrl = new AbortController();

    await runExport(provider, ['a'], port, ctrl.signal, deps);

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.options.filename).toMatch(/^aiuse-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/);
    expect(harness.calls[0]?.options.url).toMatch(/^data:application\/zip;base64,/);
    expect(harness.calls[0]?.options.saveAs).toBe(false);
  });

  it('continues past per-conversation fetch failures and reports them in COMPLETE.failedIds', async () => {
    const provider = makeProvider({
      a: makeConversation('a', 'Alpha', '2026-04-28T00:00:00Z'),
      b: new Error('fetch broke'),
      c: makeConversation('c', 'Gamma', '2026-04-28T02:00:00Z'),
    });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    const deps = makeDeps(harness, new Date('2026-04-30T00:00:00Z'));
    const ctrl = new AbortController();

    await runExport(provider, ['a', 'b', 'c'], port, ctrl.signal, deps);

    const complete = port.messages.at(-1);
    expect(complete?.type).toBe('COMPLETE');
    if (complete?.type !== 'COMPLETE') throw new Error('expected COMPLETE');
    expect(complete.failedIds).toEqual(['b']);
    // ZIP still produced — should contain 2 markdowns (a and c) packaged.
    expect(harness.calls).toHaveLength(1);
  });

  it('aborts mid-iteration when the signal fires; no further fetches, no COMPLETE', async () => {
    const provider = makeProvider({
      a: makeConversation('a', 'Alpha', '2026-04-28T00:00:00Z'),
      b: makeConversation('b', 'Beta', '2026-04-28T01:00:00Z'),
    });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    const deps = makeDeps(harness, new Date('2026-04-30T00:00:00Z'));
    const ctrl = new AbortController();

    // Abort after the first conversation lands.
    const originalGet = provider.getConversation;
    provider.getConversation = vi.fn(async (id: string) => {
      const result = await originalGet(id);
      if (id === 'a') ctrl.abort();
      return result;
    });

    await runExport(provider, ['a', 'b'], port, ctrl.signal, deps);

    expect(provider.getConversation).toHaveBeenCalledTimes(1);
    const types = port.messages.map((m) => m.type);
    expect(types).not.toContain('COMPLETE');
    expect(harness.calls).toHaveLength(0);
  });

  it('default blobToUrl encodes the ZIP bytes into a base64 data URL', async () => {
    const provider = makeProvider({
      a: makeConversation('a', 'Alpha', '2026-04-28T00:00:00Z'),
    });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    const deps: RunExportDeps = {
      downloads: harness.api,
      now: () => new Date('2026-04-30T00:00:00Z'),
    };
    const ctrl = new AbortController();

    await runExport(provider, ['a'], port, ctrl.signal, deps);

    expect(harness.calls).toHaveLength(1);
    const url = harness.calls[0]?.options.url ?? '';
    expect(url.startsWith('data:application/zip;base64,')).toBe(true);
    const base64 = url.slice('data:application/zip;base64,'.length);
    const decoded = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    // PK\x03\x04 — standard ZIP local-file-header signature.
    expect(decoded[0]).toBe(0x50);
    expect(decoded[1]).toBe(0x4b);
    expect(decoded[2]).toBe(0x03);
    expect(decoded[3]).toBe(0x04);
  });

  it('fetches each attachment in the conversation and packages the bytes into the ZIP', async () => {
    const conv = makeImageConversation('a', 'Sunset', '2026-04-28T00:00:00Z', [
      { id: 'file-1', filename: 'sunset.png' },
      { id: 'file-2', filename: 'overlay.png' },
    ]);
    const png1 = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const png2 = new Blob([new Uint8Array([4, 5, 6, 7])], { type: 'image/png' });

    const provider = makeProvider({ a: conv }, { 'file-1': png1, 'file-2': png2 });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    let captured: Blob | null = null;
    const deps: RunExportDeps = {
      downloads: harness.api,
      blobToUrl: async (b) => {
        captured = b;
        return 'data:application/zip;base64,STUB';
      },
      now: () => new Date('2026-04-30T00:00:00Z'),
    };
    const ctrl = new AbortController();

    await runExport(provider, ['a'], port, ctrl.signal, deps);

    expect(provider.fetchAttachment).toHaveBeenCalledTimes(2);
    expect(captured).not.toBeNull();
    if (captured === null) return;
    const bytes = new Uint8Array(await (captured as Blob).arrayBuffer());
    const entries = unzipSync(bytes);
    const names = Object.keys(entries).sort();
    // Expect: 1 .md + 2 attachment files, all sharing the same rand suffix.
    expect(names).toHaveLength(3);
    expect(names.find((n) => n.endsWith('--sunset.png'))).toBeDefined();
    expect(names.find((n) => n.endsWith('--overlay.png'))).toBeDefined();
    expect(names.find((n) => n.endsWith('.md'))).toBeDefined();
    // Markdown should reference the resolved filenames.
    const mdName = names.find((n) => n.endsWith('.md')) ?? '';
    const md = new TextDecoder().decode(entries[mdName]);
    expect(md).toMatch(/<attachment:[^>]+--sunset\.png>/);
    expect(md).toMatch(/<attachment:[^>]+--overlay\.png>/);
  });

  it('skips attachments whose fetch fails — markdown emits bare <attachment>, run still completes', async () => {
    const conv = makeImageConversation('a', 'Mixed', '2026-04-28T00:00:00Z', [
      { id: 'have', filename: 'have.png' },
      { id: 'gone', filename: 'gone.png' },
    ]);
    const havePng = new Blob([new Uint8Array([9])], { type: 'image/png' });

    const provider = makeProvider({ a: conv }, { have: havePng, gone: new Error('CDN expired') });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    let captured: Blob | null = null;
    const deps: RunExportDeps = {
      downloads: harness.api,
      blobToUrl: async (b) => {
        captured = b;
        return 'data:application/zip;base64,STUB';
      },
      now: () => new Date('2026-04-30T00:00:00Z'),
    };
    const ctrl = new AbortController();

    await runExport(provider, ['a'], port, ctrl.signal, deps);

    // Run completes successfully even though one attachment failed.
    const complete = port.messages.at(-1);
    expect(complete?.type).toBe('COMPLETE');
    if (complete?.type !== 'COMPLETE') throw new Error('expected COMPLETE');
    expect(complete.failedIds).toEqual([]);

    if (captured === null) return;
    const entries = unzipSync(new Uint8Array(await (captured as Blob).arrayBuffer()));
    const names = Object.keys(entries);
    // 1 .md + 1 attachment (the missing one is dropped).
    expect(names).toHaveLength(2);
    const mdName = names.find((n) => n.endsWith('.md')) ?? '';
    const md = new TextDecoder().decode(entries[mdName]);
    // Present blob: full filename. Missing blob: bare <attachment> per spec.
    expect(md).toMatch(/<attachment:[^>]+--have\.png>/);
    expect(md).toMatch(/<attachment>/);
  });

  it('produces a valid ZIP whose entries match the AIUSE folder shape', async () => {
    const provider = makeProvider({
      a: makeConversation('a', 'Alpha', '2026-04-28T00:00:00Z'),
    });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    let captured: Blob | null = null;
    const deps: RunExportDeps = {
      downloads: harness.api,
      blobToUrl: async (b) => {
        captured = b;
        return 'data:application/zip;base64,STUB';
      },
      now: () => new Date('2026-04-30T00:00:00Z'),
    };
    const ctrl = new AbortController();

    await runExport(provider, ['a'], port, ctrl.signal, deps);

    expect(captured).not.toBeNull();
    if (captured === null) return;
    const bytes = new Uint8Array(await (captured as Blob).arrayBuffer());
    const entries = unzipSync(bytes);
    const names = Object.keys(entries);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^aiuse\/2026-04\/2026-04-28--alpha--[a-z0-9]{4}\.md$/);
  });
});
