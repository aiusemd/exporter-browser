import { ChatGPTProvider } from './providers/chatgpt.js';
import type { ConversationSummary, Provider } from './providers/provider.js';
import type {
  ExportPortRequest,
  ExportProgressMessage,
  PopupRequest,
  SWResponse,
  StreamMessage,
} from './state/messages.js';
import { parseExportPortName, parseListPortName } from './state/messages.js';
import { runExport } from './sw/export.js';
import type { ProviderName } from './types.js';

chrome.runtime.onInstalled.addListener((details) => {
  console.info('[aiuse] installed:', details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  console.info('[aiuse] started');
});

// Claude provider lands later; partial map until then.
const providers: Partial<Record<ProviderName, Provider>> = {
  chatgpt: new ChatGPTProvider(),
};

// Buffer this many summaries before pushing to the popup. Tuned so the popup
// renders the first batch quickly while subsequent re-renders are bounded.
const STREAM_PAGE_SIZE = 50;

chrome.runtime.onMessage.addListener((req: PopupRequest, _sender, sendResponse) => {
  handleRequest(req).then(sendResponse, (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[aiuse] sw handler error:', err);
    const response: SWResponse = { type: 'ERROR', message };
    sendResponse(response);
  });
  // Required: keep the message channel open for the async sendResponse above.
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  const listProvider = parseListPortName(port.name);
  if (listProvider !== null) {
    handleListPort(port, listProvider);
    return;
  }
  const exportProvider = parseExportPortName(port.name);
  if (exportProvider !== null) {
    handleExportPort(port, exportProvider);
    return;
  }
});

function handleListPort(port: chrome.runtime.Port, providerName: ProviderName): void {
  const provider = providers[providerName];
  if (provider === undefined) {
    safePost(port, { type: 'ERROR', message: `Provider not implemented: ${providerName}` });
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  void streamList(provider, controller.signal, port);
}

function handleExportPort(port: chrome.runtime.Port, providerName: ProviderName): void {
  const provider = providers[providerName];
  if (provider === undefined) {
    safeExportPost(port, { type: 'ERROR', message: `Provider not implemented: ${providerName}` });
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  // The popup sends the conversation IDs as the first message after connect.
  // Wait for that envelope, then drive the export. Anything else is ignored.
  port.onMessage.addListener((msg: ExportPortRequest) => {
    if (msg.type !== 'START') return;
    void runExport(provider, msg.ids, port, controller.signal, {
      downloads: chrome.downloads,
      notifier: createNotifier(),
    }).finally(() => {
      try {
        port.disconnect();
      } catch {
        // already disconnected
      }
    });
  });
}

/**
 * Build a Notifier that posts via `chrome.notifications`. Used so a closed
 * popup doesn't silently miss a completion/failure event mid-export. Errors
 * during notification creation are logged but never thrown — a failed
 * notification must not turn a successful export into a perceived failure.
 */
function createNotifier(): {
  notify: (kind: 'success' | 'failure', title: string, message: string) => void;
} {
  return {
    notify: (kind, title, message) => {
      try {
        // Empty string id lets Chrome auto-generate a unique id, matching
        // the auto-id behavior of the no-id overload but in a form the
        // typed overload accepts.
        chrome.notifications.create('', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('src/assets/icons/icon-128.png'),
          title,
          message,
          priority: kind === 'failure' ? 2 : 0,
        });
      } catch (err) {
        console.error('[aiuse] notification failed', err);
      }
    },
  };
}

async function handleRequest(req: PopupRequest): Promise<SWResponse> {
  const provider = providers[req.provider];
  if (provider === undefined) {
    throw new Error(`Provider not implemented: ${req.provider}`);
  }
  switch (req.type) {
    case 'GET_SESSION': {
      const info = await provider.getSession();
      return { type: 'SESSION_INFO', info };
    }
    case 'GET_CONVERSATION': {
      const conversation = await provider.getConversation(req.id);
      return { type: 'CONVERSATION', conversation };
    }
  }
}

async function streamList(
  provider: Provider,
  signal: AbortSignal,
  port: chrome.runtime.Port,
): Promise<void> {
  let buffer: ConversationSummary[] = [];
  try {
    for await (const summary of provider.listConversations({ signal })) {
      buffer.push(summary);
      if (buffer.length >= STREAM_PAGE_SIZE) {
        if (!safePost(port, { type: 'PAGE', items: buffer })) return;
        buffer = [];
      }
    }
    if (buffer.length > 0) {
      if (!safePost(port, { type: 'PAGE', items: buffer })) return;
    }
    safePost(port, { type: 'DONE' });
  } catch (err) {
    if (signal.aborted) return; // popup disconnected; nothing to report.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[aiuse] stream error:', err);
    safePost(port, { type: 'ERROR', message });
  } finally {
    try {
      port.disconnect();
    } catch {
      // already disconnected
    }
  }
}

function safePost(port: chrome.runtime.Port, msg: StreamMessage): boolean {
  try {
    port.postMessage(msg);
    return true;
  } catch {
    // Popup disconnected mid-stream.
    return false;
  }
}

function safeExportPost(port: chrome.runtime.Port, msg: ExportProgressMessage): boolean {
  try {
    port.postMessage(msg);
    return true;
  } catch {
    return false;
  }
}
