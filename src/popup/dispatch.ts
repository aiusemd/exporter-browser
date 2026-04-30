import type { ConversationSummary, SessionInfo } from '../providers/provider.js';
import type { PopupRequest, SWResponse, StreamMessage } from '../state/messages.js';
import { listPortName } from '../state/messages.js';
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
    return reviveSessionInfo(res.info);
  },
  async getConversation(provider: ProviderName, id: string): Promise<NormalizedConversation> {
    const res = await send<Extract<SWResponse, { type: 'CONVERSATION' }>>({
      type: 'GET_CONVERSATION',
      provider,
      id,
    });
    return reviveConversation(res.conversation);
  },
};

export interface ConversationStreamHandlers {
  onPage: (items: ConversationSummary[]) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * Open a streaming connection that pushes pages of conversation summaries
 * as the service worker fetches them. Returns a cancel function that
 * disconnects the port (which propagates to the SW as an AbortSignal).
 */
export function streamConversations(
  provider: ProviderName,
  handlers: ConversationStreamHandlers,
): () => void {
  const port = chrome.runtime.connect({ name: listPortName(provider) });
  let settled = false;

  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
  };

  port.onMessage.addListener((msg: StreamMessage) => {
    if (settled) return;
    if (msg.type === 'PAGE') handlers.onPage(msg.items.map(reviveSummary));
    else if (msg.type === 'DONE') settle(handlers.onDone);
    else if (msg.type === 'ERROR') settle(() => handlers.onError(msg.message));
  });

  port.onDisconnect.addListener(() => {
    // SW disconnected without a DONE/ERROR — treat as completion.
    settle(handlers.onDone);
  });

  return () => {
    settle(() => {});
    try {
      port.disconnect();
    } catch {
      // already disconnected
    }
  };
}

// Chrome runtime serializes message payloads via JSON, not structured clone,
// so Date objects arrive on this side as ISO strings (Date.prototype.toJSON).
// Revive them at the boundary so the rest of the popup keeps the typed
// `Date` contract from the Provider interface.

function reviveSummary(item: ConversationSummary): ConversationSummary {
  return {
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  };
}

function reviveSessionInfo(info: SessionInfo): SessionInfo {
  if (info.expiresAt === undefined) return info;
  return { ...info, expiresAt: toDate(info.expiresAt) };
}

function reviveConversation(conv: NormalizedConversation): NormalizedConversation {
  return {
    ...conv,
    createdAt: toDate(conv.createdAt),
  };
}

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    // Surface bad data with context instead of silently producing an Invalid
    // Date that propagates into formatters. The SW message boundary is one of
    // the few places CLAUDE.md says we should validate.
    console.warn('[aiuse] dispatch: unparseable Date value crossed SW boundary', value);
  }
  return parsed;
}
