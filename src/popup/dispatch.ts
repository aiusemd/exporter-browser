import type { ConversationSummary, SessionInfo } from '../providers/provider.js';
import type { PopupRequest, SWResponse } from '../state/messages.js';
import type { NormalizedConversation, ProviderName } from '../types.js';

/**
 * Round-trips a request to the service worker and resolves with its response.
 * Rejects when the SW returns an `ERROR` envelope or when chrome.runtime
 * itself fails (e.g. SW crashed mid-flight, no listener registered).
 */
async function send<T extends SWResponse>(req: PopupRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(req)) as SWResponse | undefined;
  if (response === undefined) {
    throw new Error(`No response from service worker for ${req.type}`);
  }
  if (response.type === 'ERROR') {
    throw new Error(response.message);
  }
  return response as T;
}

export const dispatch = {
  async getSession(provider: ProviderName): Promise<SessionInfo> {
    const res = await send<Extract<SWResponse, { type: 'SESSION_INFO' }>>({
      type: 'GET_SESSION',
      provider,
    });
    return res.info;
  },
  async listConversations(provider: ProviderName): Promise<ConversationSummary[]> {
    const res = await send<Extract<SWResponse, { type: 'CONVERSATION_PAGE' }>>({
      type: 'LIST_CONVERSATIONS',
      provider,
    });
    return res.items;
  },
  async getConversation(provider: ProviderName, id: string): Promise<NormalizedConversation> {
    const res = await send<Extract<SWResponse, { type: 'CONVERSATION' }>>({
      type: 'GET_CONVERSATION',
      provider,
      id,
    });
    return res.conversation;
  },
};
