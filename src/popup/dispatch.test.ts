import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary, SessionInfo } from '../providers/provider.js';
import type { PopupRequest, SWResponse } from '../state/messages.js';
import type { NormalizedConversation } from '../types.js';
import { dispatch } from './dispatch.js';

interface ChromeStub {
  runtime: {
    sendMessage: (req: PopupRequest) => Promise<SWResponse | undefined>;
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

  it('listConversations sends LIST_CONVERSATIONS and resolves the items array', async () => {
    const items: ConversationSummary[] = [
      {
        id: 'a',
        title: 'A',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      },
    ];
    const sendMessage = installChromeMock(() => ({
      type: 'CONVERSATION_PAGE',
      items,
      done: true,
    }));

    const result = await dispatch.listConversations('chatgpt');

    expect(sendMessage).toHaveBeenCalledWith({ type: 'LIST_CONVERSATIONS', provider: 'chatgpt' });
    expect(result).toEqual(items);
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
