import { downloadZip } from 'client-zip';
import { type RenderOptions, renderConversation } from '../format/aiuse.js';
import {
  makeAttachmentFilename,
  makeConversationFilename,
  monthFolder,
  randomSuffix,
} from '../format/filename.js';
import type { AttachmentRef, NormalizedConversation, NormalizedMessage } from '../types.js';

export interface ConversationPackage {
  conversation: NormalizedConversation;
  /**
   * Map from `AttachmentRef.id` to the file's bytes. Refs absent from this
   * map are emitted as bare `<attachment>` markers (no filename) per spec —
   * the renderer's contract for `included: false`.
   */
  attachmentBlobs?: ReadonlyMap<string, Blob>;
}

export interface BuildZipOptions {
  /** Forwarded to `renderConversation` for redact patterns / truncate limit. */
  render?: RenderOptions;
}

interface ZipFileEntry {
  name: string;
  lastModified?: Date;
  input: string | Blob;
}

/**
 * Pack a list of normalized conversations (and any provided attachment
 * blobs) into a single ZIP Blob shaped per the AIUSE spec:
 *
 *   aiuse/
 *     YYYY-MM/
 *       YYYY-MM-DD--topic--rand.md
 *       YYYY-MM-DD--topic--rand--filename.ext   (if blob provided)
 *
 * The function is pure — no network, no chrome.* — so it tests in Node.
 * Phase 3 PR-B wires this into the service worker's export runner.
 */
export async function buildZip(
  packages: ReadonlyArray<ConversationPackage>,
  options: BuildZipOptions = {},
): Promise<Blob> {
  const files: ZipFileEntry[] = [];

  for (const pkg of packages) {
    const { conversation } = pkg;
    const blobs: ReadonlyMap<string, Blob> = pkg.attachmentBlobs ?? new Map();
    const date = conversation.createdAt;
    const folder = `aiuse/${monthFolder(date)}`;
    const rand = randomSuffix();
    const convFilename = makeConversationFilename(date, conversation.title, rand);

    const resolved = withResolvedAttachments(conversation, rand, blobs);
    const { markdown, attachments } = renderConversation(resolved, options.render);

    files.push({ name: `${folder}/${convFilename}`, input: markdown, lastModified: date });

    for (const ref of attachments) {
      if (!ref.included) continue;
      const blob = blobs.get(ref.id);
      if (blob === undefined) continue;
      files.push({ name: `${folder}/${ref.filename}`, input: blob, lastModified: date });
    }
  }

  // client-zip's downloadZip yields a Response whose body is the ZIP stream.
  // Consume to a Blob so callers can hand it to chrome.downloads.download.
  const response = downloadZip(files);
  return await response.blob();
}

/**
 * Returns a clone of `conversation` where every AttachmentRef whose `id` has
 * a blob entry is rewritten with the spec filename and `included: true`.
 * Refs without a blob are left untouched (renderer emits bare `<attachment>`).
 */
function withResolvedAttachments(
  conversation: NormalizedConversation,
  rand: string,
  blobs: ReadonlyMap<string, Blob>,
): NormalizedConversation {
  const resolveRef = (ref: AttachmentRef): AttachmentRef => {
    if (!blobs.has(ref.id)) return ref;
    const filename = makeAttachmentFilename(
      conversation.createdAt,
      conversation.title,
      rand,
      ref.filename,
    );
    return { ...ref, included: true, filename };
  };

  const resolveMessage = (msg: NormalizedMessage): NormalizedMessage => {
    const content = msg.content.map((block) =>
      block.type === 'image' ? { ...block, ref: resolveRef(block.ref) } : block,
    );
    if (msg.attachments === undefined) return { ...msg, content };
    return { ...msg, content, attachments: msg.attachments.map(resolveRef) };
  };

  return { ...conversation, messages: conversation.messages.map(resolveMessage) };
}
