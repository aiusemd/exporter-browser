import type { ConversationSummary, SessionInfo } from '../providers/provider.js';
import type { NormalizedConversation, ProviderName } from '../types.js';

/** Messages the popup sends to the service worker. */
export type PopupRequest =
  | { type: 'GET_SESSION'; provider: ProviderName }
  | { type: 'LIST_CONVERSATIONS'; provider: ProviderName }
  | { type: 'GET_CONVERSATION'; provider: ProviderName; id: string };

/** Responses the service worker sends back to the popup. */
export type SWResponse =
  | { type: 'SESSION_INFO'; info: SessionInfo }
  | { type: 'CONVERSATION_PAGE'; items: ConversationSummary[]; done: boolean }
  | { type: 'CONVERSATION'; conversation: NormalizedConversation }
  | { type: 'ERROR'; message: string };

export type RequestType = PopupRequest['type'];
export type ResponseType = SWResponse['type'];
