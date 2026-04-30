import type { ExportPortRequest, ExportProgressMessage } from '../state/messages.js';
import { exportPortName } from '../state/messages.js';
import type { ProviderName } from '../types.js';

export interface ExportProgress {
  done: number;
  total: number;
  currentTitle?: string;
}

export interface ExportResult {
  filename: string;
  bytes: number;
  failedIds: string[];
}

export interface ExportHandlers {
  onProgress: (p: ExportProgress) => void;
  onComplete: (r: ExportResult) => void;
  onError: (message: string) => void;
}

/**
 * Open a streaming connection to the SW that drives a ZIP export of the
 * given conversation IDs. Returns a `cancel` that disconnects the port —
 * the SW observes the disconnect via its AbortController and stops mid-run.
 *
 * Mirrors the shape of `streamConversations`: settlement is one-shot,
 * disconnect-without-COMPLETE/ERROR is treated as a cancel.
 */
export function runExport(
  provider: ProviderName,
  ids: ReadonlyArray<string>,
  handlers: ExportHandlers,
): () => void {
  const port = chrome.runtime.connect({ name: exportPortName(provider) });
  let settled = false;

  const settle = (fn: () => void): void => {
    if (settled) return;
    settled = true;
    fn();
  };

  port.onMessage.addListener((msg: ExportProgressMessage) => {
    if (settled) return;
    if (msg.type === 'PROGRESS') {
      const progress: ExportProgress =
        msg.currentTitle === undefined
          ? { done: msg.done, total: msg.total }
          : { done: msg.done, total: msg.total, currentTitle: msg.currentTitle };
      handlers.onProgress(progress);
    } else if (msg.type === 'COMPLETE') {
      settle(() =>
        handlers.onComplete({
          filename: msg.filename,
          bytes: msg.bytes,
          failedIds: msg.failedIds,
        }),
      );
    } else if (msg.type === 'ERROR') {
      settle(() => handlers.onError(msg.message));
    }
  });

  port.onDisconnect.addListener(() => {
    // SW disconnected without a terminal envelope. Treat as cancellation;
    // the UI keeps whatever progress state it last received.
    settle(() => {});
  });

  // Send the IDs as the first message after connect — the SW waits for this.
  const startMsg: ExportPortRequest = { type: 'START', ids: [...ids] };
  port.postMessage(startMsg);

  return () => {
    settle(() => {});
    try {
      port.disconnect();
    } catch {
      // already disconnected
    }
  };
}
