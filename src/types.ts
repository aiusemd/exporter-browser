/**
 * Provider-agnostic conversation shape. Format module reads only this — it has
 * zero knowledge of ChatGPT, Claude, or any specific upstream API.
 */

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'image'; ref: AttachmentRef }
  | { type: 'tool_output'; output: string };

export interface AttachmentRef {
  /** Stable identifier within an export. Provider-defined. */
  id: string;
  /** Original filename as reported upstream (e.g. "IMG_1234.HEIC"). */
  filename: string;
  /** MIME type if known. */
  mimeType?: string;
}

export interface NormalizedMessage {
  role: Role;
  content: ContentBlock[];
  /** For role='tool' or assistant→tool calls, the tool name (e.g. "python", "dalle.text2im"). */
  toolName?: string;
  attachments?: AttachmentRef[];
}

export interface NormalizedConversation {
  id: string;
  title: string;
  createdAt: Date;
  messages: NormalizedMessage[];
}

export type ProviderName = 'chatgpt' | 'claude';
