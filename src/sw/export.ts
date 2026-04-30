import type { Provider } from '../providers/provider.js';
import type { ExportProgressMessage } from '../state/messages.js';
import type { ConversationPackage } from '../zip/build.js';
import { buildZip } from '../zip/build.js';

/**
 * Minimal port surface the runner needs. Mirrors `chrome.runtime.Port` for
 * the methods we touch — keeps the runner unit-testable with a fake port.
 */
export interface PortLike {
  postMessage: (msg: ExportProgressMessage) => void;
  disconnect: () => void;
}

/**
 * Subset of `chrome.downloads` the runner uses. Tests provide a stub; the
 * SW passes the real `chrome.downloads`.
 */
export interface DownloadsApi {
  download: (options: chrome.downloads.DownloadOptions) => Promise<number>;
}

export interface RunExportDeps {
  downloads: DownloadsApi;
  /**
   * Convert the produced Blob to a URL that `chrome.downloads.download` can
   * fetch. Defaults to a base64 `data:` URL — MV3 service workers don't
   * expose `URL.createObjectURL`, so blob URLs are not an option here.
   * Tests inject a fake to skip the encoding cost.
   */
  blobToUrl?: (blob: Blob) => Promise<string>;
  /** Override for filename timestamp; tests freeze this. */
  now?: () => Date;
}

/**
 * Drive an export end-to-end:
 * 1. Fetch each conversation by id (continue past per-id failures, report
 *    them in the terminal envelope — CLAUDE.md "never swallow errors silently"
 *    is honored by `console.error` per failure plus the `failedIds` payload).
 * 2. Build a single ZIP via `buildZip`.
 * 3. Hand the Blob to `chrome.downloads.download`, then revoke the object
 *    URL once the browser reports a terminal state.
 *
 * Aborts cleanly when `signal` fires (popup closed) — no further fetches,
 * no `COMPLETE` posted, port left for the caller to disconnect.
 */
export async function runExport(
  provider: Provider,
  ids: ReadonlyArray<string>,
  port: PortLike,
  signal: AbortSignal,
  deps: RunExportDeps,
): Promise<void> {
  const total = ids.length;
  const packages: ConversationPackage[] = [];
  const failedIds: string[] = [];

  // Initial frame so the UI shows "0 of N" instead of nothing.
  if (!safePost(port, { type: 'PROGRESS', done: 0, total })) return;

  for (let i = 0; i < ids.length; i++) {
    if (signal.aborted) return;
    const id = ids[i];
    if (id === undefined) continue;
    try {
      const conversation = await provider.getConversation(id);
      if (signal.aborted) return;
      packages.push({ conversation });
      if (
        !safePost(port, {
          type: 'PROGRESS',
          done: i + 1,
          total,
          currentTitle: conversation.title,
        })
      )
        return;
    } catch (err) {
      console.error('[aiuse] export: failed to fetch conversation', id, err);
      failedIds.push(id);
      if (!safePost(port, { type: 'PROGRESS', done: i + 1, total })) return;
    }
  }

  if (signal.aborted) return;

  try {
    const blob = await buildZip(packages);
    if (signal.aborted) return;
    const filename = exportFilename(deps.now?.() ?? new Date());
    await triggerDownload(blob, filename, deps);
    safePost(port, { type: 'COMPLETE', filename, bytes: blob.size, failedIds });
  } catch (err) {
    if (signal.aborted) return;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[aiuse] export: build/download failed', err);
    safePost(port, { type: 'ERROR', message });
  }
}

function exportFilename(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = pad2(now.getUTCMonth() + 1);
  const dd = pad2(now.getUTCDate());
  const hh = pad2(now.getUTCHours());
  const min = pad2(now.getUTCMinutes());
  const ss = pad2(now.getUTCSeconds());
  return `aiuse-${yyyy}-${mm}-${dd}-${hh}${min}${ss}.zip`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

async function triggerDownload(blob: Blob, filename: string, deps: RunExportDeps): Promise<void> {
  const toUrl = deps.blobToUrl ?? blobToDataUrl;
  const url = await toUrl(blob);
  await deps.downloads.download({ url, filename, saveAs: false });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  // MV3 service workers don't expose URL.createObjectURL, so base64-encode
  // the bytes and embed them in a data URL. The MIME prefix matches what
  // client-zip emits on its Response (`application/zip`), which keeps the
  // browser's Save dialog defaulting to a sensible filename.
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  // Chunk the Latin-1 string build to avoid call-stack blowups on large blobs.
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:application/zip;base64,${btoa(bin)}`;
}

function safePost(port: PortLike, msg: ExportProgressMessage): boolean {
  try {
    port.postMessage(msg);
    return true;
  } catch {
    // Popup disconnected mid-stream.
    return false;
  }
}
