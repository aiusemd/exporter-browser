import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary, SessionInfo } from '../providers/provider.js';
import type { PopupRequest, SWResponse, StreamMessage } from '../state/messages.js';
import type { NormalizedConversation } from '../types.js';
import { dispatch, streamConversations } from './dispatch.js';

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
      for (const l of messageListeners) l(msg);
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
  const sendMessage = vi.fn(async (req: PopupRequest) => handler(req));
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

  it('getSession sends GET_SESSION and resolves the SessionInfo', async () => {
    const info: SessionInfo = { authenticated: true, user: { name: 'Ada' } };
    const sendMessage = installChromeMock(() => ({ type: 'SESSION_INFO', info }));

    const result = await dispatch.getSession('chatgpt');

    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_SESSION', provider: 'chatgpt' });
    expect(result).toEqual(info);
  });

  it('getConversation sends GET_CONVERSATION with id and resolves the conversation', async () => {
    const conversation: NormalizedConversation = {
      id: 'cid',
      title: 'Hi',
      createdAt: new Date('2024-01-01'),
      messages: [],
    };
    const sendMessage = installChromeMock(() => ({ type: 'CONVERSATION', conversation }));

    const result = await dispatch.getConversation('chatgpt', 'cid');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'GET_CONVERSATION',
      provider: 'chatgpt',
      id: 'cid',
    });
    expect(result).toEqual(conversation);
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
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    };
  }

  function installPortMock(): { port: MockPort; connect: (info: { name: string }) => MockPort } {
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
    // Force connection to provision the port for the caller's onPage etc.
    return {
      get port() {
        if (port === null) throw new Error('connect not called yet');
        return port;
      },
      connect,
    } as unknown as { port: MockPort; connect: (info: { name: string }) => MockPort };
  }

  it('connects with the provider-namespaced port name and forwards PAGE/DONE', () => {
    const ctx = installPortMock();
    const onPage = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    streamConversations('chatgpt', { onPage, onDone, onError });

    expect(ctx.port.name).toBe('list-conversations:chatgpt');

    const items = [makeSummary('a'), makeSummary('b')];
    ctx.port.emitMessage({ type: 'PAGE', items });
    expect(onPage).toHaveBeenCalledWith(items);

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
