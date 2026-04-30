import { downloadZip } from 'client-zip';
import { type RenderOptions, renderConversation } from '../format/aiuse.js';
import { makeConversationFilename, monthFolder, randomSuffix } from '../format/filename.js';
import type { NormalizedConversation } from '../types.js';

export interface ConversationPackage {
  conversation: NormalizedConversation;
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
 * Pack a list of normalized conversations into a single ZIP Blob shaped per
 * the AIUSE spec:
 *
 *   aiuse/
 *     YYYY-MM/
 *       YYYY-MM-DD--topic--rand.md
 *
 * Attachments are referenced by filename in the markdown but not packaged
 * as separate files — exports are markdown-only by design, so the ZIP stays
 * small and the format module emits `<attachment:filename>` markers as
 * informational hints.
 */
export async function buildZip(
  packages: ReadonlyArray<ConversationPackage>,
  options: BuildZipOptions = {},
): Promise<Blob> {
  const files: ZipFileEntry[] = [];

  for (const pkg of packages) {
    const { conversation } = pkg;
    const date = conversation.createdAt;
    const folder = `aiuse/${monthFolder(date)}`;
    const rand = randomSuffix();
    const convFilename = makeConversationFilename(date, conversation.title, rand);

    const { markdown } = renderConversation(conversation, options.render);
    files.push({ name: `${folder}/${convFilename}`, input: markdown, lastModified: date });
  }

  // client-zip's downloadZip yields a Response whose body is the ZIP stream.
  // Consume to a Blob so callers can hand it to chrome.downloads.download.
  const response = downloadZip(files);
  return await response.blob();
}
