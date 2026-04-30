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

function makeProvider(conversations: Record<string, NormalizedConversation | Error>): Provider {
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
    fetchAttachment: vi.fn(),
  };
}

function makeDeps(harness: DownloadsHarness, now: Date): RunExportDeps {
  return {
    downloads: harness.api,
    blobToUrl: async (blob) => `data:application/zip;base64,STUB-${blob.size}`,
    now: () => now,
  };
}

interface NotifierCall {
  kind: 'success' | 'failure';
  title: string;
  message: string;
}

function makeNotifier(): {
  notify: (k: 'success' | 'failure', t: string, m: string) => void;
  calls: NotifierCall[];
} {
  const calls: NotifierCall[] = [];
  return {
    calls,
    notify: (kind, title, message) => {
      calls.push({ kind, title, message });
    },
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

  it('fires a success notification on COMPLETE with the count and filename', async () => {
    const provider = makeProvider({
      a: makeConversation('a', 'Alpha', '2026-04-28T00:00:00Z'),
      b: makeConversation('b', 'Beta', '2026-04-28T01:00:00Z'),
    });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    const notifier = makeNotifier();
    const deps: RunExportDeps = {
      ...makeDeps(harness, new Date('2026-04-30T00:00:00Z')),
      notifier,
    };

    await runExport(provider, ['a', 'b'], port, new AbortController().signal, deps);

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.kind).toBe('success');
    expect(notifier.calls[0]?.title).toBe('AIUSE export complete');
    expect(notifier.calls[0]?.message).toMatch(
      /Saved 2 conversations to aiuse-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/,
    );
  });

  it('reports failed-conversation count in the success notification when partial', async () => {
    const provider = makeProvider({
      a: makeConversation('a', 'Alpha', '2026-04-28T00:00:00Z'),
      b: new Error('fetch broke'),
    });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    const notifier = makeNotifier();
    const deps: RunExportDeps = {
      ...makeDeps(harness, new Date('2026-04-30T00:00:00Z')),
      notifier,
    };

    await runExport(provider, ['a', 'b'], port, new AbortController().signal, deps);

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.kind).toBe('success');
    expect(notifier.calls[0]?.message).toMatch(
      /Saved 1 conversation to aiuse-.+\.zip \(1 could not be packaged\)$/,
    );
  });

  it('fires a failure notification on terminal ERROR (e.g. download throws)', async () => {
    const provider = makeProvider({
      a: makeConversation('a', 'Alpha', '2026-04-28T00:00:00Z'),
    });
    const port = makeMockPort();
    const notifier = makeNotifier();
    const deps: RunExportDeps = {
      downloads: {
        download: async () => {
          throw new Error('downloads API unavailable');
        },
      },
      blobToUrl: async () => 'data:application/zip;base64,STUB',
      now: () => new Date('2026-04-30T00:00:00Z'),
      notifier,
    };

    await runExport(provider, ['a'], port, new AbortController().signal, deps);

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.kind).toBe('failure');
    expect(notifier.calls[0]?.title).toBe('AIUSE export failed');
    expect(notifier.calls[0]?.message).toBe('downloads API unavailable');
  });

  it('does not fire any notification when aborted mid-run', async () => {
    const provider = makeProvider({
      a: makeConversation('a', 'Alpha', '2026-04-28T00:00:00Z'),
      b: makeConversation('b', 'Beta', '2026-04-28T01:00:00Z'),
    });
    const port = makeMockPort();
    const harness = makeDownloadsHarness();
    const notifier = makeNotifier();
    const ctrl = new AbortController();
    const deps: RunExportDeps = {
      ...makeDeps(harness, new Date('2026-04-30T00:00:00Z')),
      notifier,
    };

    const originalGet = provider.getConversation;
    provider.getConversation = vi.fn(async (id: string) => {
      const result = await originalGet(id);
      if (id === 'a') ctrl.abort();
      return result;
    });

    await runExport(provider, ['a', 'b'], port, ctrl.signal, deps);

    expect(notifier.calls).toHaveLength(0);
  });
});
