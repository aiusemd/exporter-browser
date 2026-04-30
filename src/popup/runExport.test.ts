import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportPortRequest, ExportProgressMessage } from '../state/messages.js';
import { runExport } from './runExport.js';

interface MockPort {
  name: string;
  onMessage: { addListener: (l: (msg: ExportProgressMessage) => void) => void };
  onDisconnect: { addListener: (l: () => void) => void };
  postMessage: (msg: unknown) => void;
  disconnect: () => void;
  emitMessage: (msg: ExportProgressMessage) => void;
  emitDisconnect: () => void;
  posted: ExportPortRequest[];
}

function makeMockPort(name: string): MockPort {
  const messageListeners: ((msg: ExportProgressMessage) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  const posted: ExportPortRequest[] = [];
  return {
    name,
    onMessage: { addListener: (l) => messageListeners.push(l) },
    onDisconnect: { addListener: (l) => disconnectListeners.push(l) },
    postMessage: (msg) => {
      posted.push(msg as ExportPortRequest);
    },
    disconnect: vi.fn(),
    emitMessage: (msg) => {
      // Mirror Chrome's JSON serialization at the boundary.
      const wired = JSON.parse(JSON.stringify(msg)) as ExportProgressMessage;
      for (const l of messageListeners) l(wired);
    },
    emitDisconnect: () => {
      for (const l of disconnectListeners) l();
    },
    posted,
  };
}

function setChromeStub(
  stub: { runtime: { connect: (info: { name: string }) => MockPort } } | undefined,
): void {
  (globalThis as unknown as { chrome: unknown }).chrome = stub;
}

describe('runExport', () => {
  let port: MockPort | null;

  beforeEach(() => {
    port = null;
    setChromeStub({
      runtime: {
        connect: (info) => {
          port = makeMockPort(info.name);
          return port;
        },
      },
    });
  });

  afterEach(() => {
    setChromeStub(undefined);
    vi.restoreAllMocks();
  });

  it('opens an `export:<provider>` port and posts START with the ids', () => {
    runExport(
      'chatgpt',
      { ids: ['a', 'b'] },
      {
        onProgress: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
    );

    expect(port).not.toBeNull();
    if (port === null) throw new Error('port not opened');
    expect(port.name).toBe('export:chatgpt');
    expect(port.posted).toEqual([{ type: 'START', ids: ['a', 'b'] }]);
  });

  it('forwards PROGRESS messages to onProgress', () => {
    const onProgress = vi.fn();
    runExport('chatgpt', { ids: ['a'] }, { onProgress, onComplete: vi.fn(), onError: vi.fn() });
    if (port === null) throw new Error('port not opened');

    port.emitMessage({ type: 'PROGRESS', done: 1, total: 2, currentTitle: 'Alpha' });
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 2, currentTitle: 'Alpha' });
  });

  it('settles on COMPLETE and silences subsequent progress', () => {
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    runExport('chatgpt', { ids: ['a'] }, { onProgress, onComplete, onError: vi.fn() });
    if (port === null) throw new Error('port not opened');

    port.emitMessage({
      type: 'COMPLETE',
      filename: 'aiuse-2026-04-30-000000.zip',
      bytes: 100,
      failedIds: [],
    });
    port.emitMessage({ type: 'PROGRESS', done: 99, total: 100 });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      filename: 'aiuse-2026-04-30-000000.zip',
      bytes: 100,
      failedIds: [],
    });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('settles on ERROR', () => {
    const onError = vi.fn();
    runExport('chatgpt', { ids: ['a'] }, { onProgress: vi.fn(), onComplete: vi.fn(), onError });
    if (port === null) throw new Error('port not opened');

    port.emitMessage({ type: 'ERROR', message: 'boom' });
    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('treats a port disconnect without a terminal envelope as silent cancellation', () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    runExport('chatgpt', { ids: ['a'] }, { onProgress: vi.fn(), onComplete, onError });
    if (port === null) throw new Error('port not opened');

    port.emitDisconnect();
    // Cancellation must not surface as either complete or error.
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancel() disconnects the port and silences subsequent messages', () => {
    const onProgress = vi.fn();
    const cancel = runExport(
      'chatgpt',
      { ids: ['a'] },
      {
        onProgress,
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
    );
    if (port === null) throw new Error('port not opened');

    cancel();
    expect(port.disconnect).toHaveBeenCalledTimes(1);

    port.emitMessage({ type: 'PROGRESS', done: 1, total: 1 });
    expect(onProgress).not.toHaveBeenCalled();
  });
});
