import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary, SessionInfo } from '../providers/provider.js';
import type { PopupRequest, SWResponse, StreamMessage } from '../state/messages.js';
import type { NormalizedConversation } from '../types.js';
import { dispatch, streamConversations } from './dispatch.js';

/**
 * Chrome's runtime messaging serializes payloads via JSON, NOT structured
 * clone — Date objects arrive on the other side as ISO strings. Tests must
 * round-trip through JSON to mirror real runtime behavior; otherwise mocks
 * are too friendly and miss serialization-class bugs (see PR #23 fix).
 */
function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface ChromeStub {
  runtime: {
    sendMessage: (req: PopupRequest) => Promise<SWResponse | undefined>;
    connect?: (info: { name: string }) => MockPort;
  };
}

interface MockPort {
  name: string;
  onMessage: { addListener: (l: (msg: StreamMessage) => void) => void };
  onDisconnect: { addListener: (l: () => void) => void };
  postMessage: (msg: unknown) => void;
  disconnect: () => void;
  // Test helpers
  emitMessage: (msg: StreamMessage) => void;
  emitDisconnect: () => void;
}

function makeMockPort(name: string): MockPort {
  const messageListeners: ((msg: StreamMessage) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  return {
    name,
    onMessage: { addListener: (l) => messageListeners.push(l) },
    onDisconnect: { addListener: (l) => disconnectListeners.push(l) },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    emitMessage: (msg) => {
      // Mirror Chrome's JSON serialization at the boundary.
      const wired = jsonRoundTrip(msg);
      for (const l of messageListeners) l(wired);
    },
    emitDisconnect: () => {
      for (const l of disconnectListeners) l();
    },
  };
}

function setChromeStub(stub: ChromeStub | undefined): void {
  (globalThis as unknown as { chrome: ChromeStub | undefined }).chrome = stub;
}

function installChromeMock(handler: (req: PopupRequest) => SWResponse | Promise<SWResponse>) {
  const sendMessage = vi.fn(async (req: PopupRequest) => {
    const res = await handler(req);
    // Mirror Chrome's JSON serialization at the boundary.
    return jsonRoundTrip(res);
  });
  setChromeStub({ runtime: { sendMessage } });
  return sendMessage;
}

describe('dispatch', () => {
  beforeEach(() => {
    setChromeStub(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getSession sends GET_SESSION and revives expiresAt as a Date', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    const info: SessionInfo = { authenticated: true, user: { name: 'Ada' }, expiresAt };
    installChromeMock(() => ({ type: 'SESSION_INFO', info }));

    const result = await dispatch.getSession('chatgpt');

    expect(result.authenticated).toBe(true);
    expect(result.user).toEqual({ name: 'Ada' });
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
  });

  it('getConversation revives createdAt as a Date', async () => {
    const createdAt = new Date('2024-01-01T00:00:00.000Z');
    const conversation: NormalizedConversation = {
      id: 'cid',
      title: 'Hi',
      createdAt,
      messages: [],
    };
    const sendMessage = installChromeMock(() => ({ type: 'CONVERSATION', conversation }));

    const result = await dispatch.getConversation('chatgpt', 'cid');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'GET_CONVERSATION',
      provider: 'chatgpt',
      id: 'cid',
    });
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt.toISOString()).toBe(createdAt.toISOString());
  });

  it('rejects when the SW returns an ERROR envelope', async () => {
    installChromeMock(() => ({ type: 'ERROR', message: 'boom' }));
    await expect(dispatch.getSession('chatgpt')).rejects.toThrow('boom');
  });

  it('rejects when the SW returns nothing', async () => {
    const sendMessage = vi.fn(async () => undefined);
    setChromeStub({ runtime: { sendMessage } });
    await expect(dispatch.getSession('chatgpt')).rejects.toThrow(/No response/);
  });
});

describe('streamConversations', () => {
  beforeEach(() => {
    setChromeStub(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeSummary(id: string): ConversationSummary {
    return {
      id,
      title: id,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    };
  }

  function installPortMock(): { port: MockPort } {
    let port: MockPort | null = null;
    const connect = (info: { name: string }) => {
      port = makeMockPort(info.name);
      return port;
    };
    setChromeStub({
      runtime: {
        sendMessage: vi.fn(async () => undefined),
        connect,
      },
    });
    return {
      get port() {
        if (port === null) throw new Error('connect not called yet');
        return port;
      },
    } as { port: MockPort };
  }

  it('connects with the provider-namespaced port name and revives Dates on PAGE', () => {
    const ctx = installPortMock();
    const onPage = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    streamConversations('chatgpt', { onPage, onDone, onError });

    expect(ctx.port.name).toBe('list-conversations:chatgpt');

    const items = [makeSummary('a'), makeSummary('b')];
    ctx.port.emitMessage({ type: 'PAGE', items });

    expect(onPage).toHaveBeenCalledTimes(1);
    const received = onPage.mock.calls[0]?.[0] as ConversationSummary[];
    expect(received).toHaveLength(2);
    // Dates round-tripped through JSON arrive as strings; dispatch must revive.
    expect(received[0]?.createdAt).toBeInstanceOf(Date);
    expect(received[0]?.updatedAt).toBeInstanceOf(Date);
    expect(received[0]?.updatedAt.toISOString()).toBe(items[0]?.updatedAt.toISOString());

    ctx.port.emitMessage({ type: 'DONE' });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('forwards ERROR messages and stops accepting further pages', () => {
    const ctx = installPortMock();
    const onPage = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    streamConversations('chatgpt', { onPage, onDone, onError });

    ctx.port.emitMessage({ type: 'ERROR', message: 'fetch failed' });
    expect(onError).toHaveBeenCalledWith('fetch failed');

    // Subsequent messages are ignored — settlement is one-shot.
    ctx.port.emitMessage({ type: 'PAGE', items: [makeSummary('a')] });
    expect(onPage).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('treats a port disconnect without DONE/ERROR as completion', () => {
    const ctx = installPortMock();
    const onDone = vi.fn();
    const onError = vi.fn();

    streamConversations('chatgpt', { onPage: vi.fn(), onDone, onError });

    ctx.port.emitDisconnect();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancel() disconnects the port and silences subsequent messages', () => {
    const ctx = installPortMock();
    const onPage = vi.fn();
    const onDone = vi.fn();

    const cancel = streamConversations('chatgpt', {
      onPage,
      onDone,
      onError: vi.fn(),
    });

    cancel();
    expect(ctx.port.disconnect).toHaveBeenCalledTimes(1);

    // Late message after cancel must not invoke handlers.
    ctx.port.emitMessage({ type: 'PAGE', items: [makeSummary('a')] });
    expect(onPage).not.toHaveBeenCalled();
  });
});
