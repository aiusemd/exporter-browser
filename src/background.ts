import { ChatGPTProvider } from './providers/chatgpt.js';
import type { ConversationSummary, Provider } from './providers/provider.js';
import type { PopupRequest, SWResponse } from './state/messages.js';
import type { ProviderName } from './types.js';

chrome.runtime.onInstalled.addListener((details) => {
  console.info('[aiuse] installed:', details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  console.info('[aiuse] started');
});

// Claude provider lands in PR #4; partial map until then.
const providers: Partial<Record<ProviderName, Provider>> = {
  chatgpt: new ChatGPTProvider(),
};

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
    case 'LIST_CONVERSATIONS': {
      // chrome.runtime.sendMessage is request/response, so collect into one
      // response. Phase 3 switches to a port-based streaming protocol.
      const items: ConversationSummary[] = [];
      for await (const summary of provider.listConversations()) {
        items.push(summary);
      }
      return { type: 'CONVERSATION_PAGE', items, done: true };
    }
    case 'GET_CONVERSATION': {
      const conversation = await provider.getConversation(req.id);
      return { type: 'CONVERSATION', conversation };
    }
  }
}
