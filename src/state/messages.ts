import type { ConversationSummary, SessionInfo } from '../providers/provider.js';
import type { NormalizedConversation, ProviderName } from '../types.js';

/** Messages the popup sends to the service worker. */
export type PopupRequest =
  | { type: 'GET_SESSION'; provider: ProviderName }
  | { type: 'GET_CONVERSATION'; provider: ProviderName; id: string };

/** Responses the service worker sends back to the popup. */
export type SWResponse =
  | { type: 'SESSION_INFO'; info: SessionInfo }
  | { type: 'CONVERSATION'; conversation: NormalizedConversation }
  | { type: 'ERROR'; message: string };

export type RequestType = PopupRequest['type'];
export type ResponseType = SWResponse['type'];

/**
 * Messages emitted on the conversation-listing port. Listing is streamed
 * (not request/response) so the popup can render rows as they arrive
 * instead of blocking until the full list is fetched.
 */
export type StreamMessage =
  | { type: 'PAGE'; items: ConversationSummary[] }
  | { type: 'DONE' }
  | { type: 'ERROR'; message: string };

const LIST_PORT_PREFIX = 'list-conversations';

export function listPortName(provider: ProviderName): string {
  return `${LIST_PORT_PREFIX}:${provider}`;
}

export function parseListPortName(name: string): ProviderName | null {
  if (!name.startsWith(`${LIST_PORT_PREFIX}:`)) return null;
  const provider = name.slice(LIST_PORT_PREFIX.length + 1);
  if (provider === 'chatgpt' || provider === 'claude') return provider;
  return null;
}
