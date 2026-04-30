import type { AttachmentRef, NormalizedConversation, ProviderName } from '../types.js';

export interface SessionInfo {
  authenticated: boolean;
  user?: { name?: string; email?: string };
  expiresAt?: Date;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListOpts {
  /** Soft cap on the number of summaries to yield. */
  limit?: number;
  /** Abort signal — providers must observe this and stop iterating. */
  signal?: AbortSignal;
}

/**
 * Provider-agnostic interface every upstream (ChatGPT, Claude, …) implements.
 * Format module reads only the normalized output; the popup and service worker
 * only depend on this interface.
 */
export interface Provider {
  readonly name: ProviderName;
  getSession(): Promise<SessionInfo>;
  listConversations(opts?: ListOpts): AsyncIterable<ConversationSummary>;
  getConversation(id: string): Promise<NormalizedConversation>;
  fetchAttachment(ref: AttachmentRef): Promise<Blob>;
}
