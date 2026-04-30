import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { renderConversation } from '../format/aiuse.js';
import type { ConversationSummary } from '../providers/provider.js';
import type { ProviderName } from '../types.js';
import { dispatch, streamConversations } from './dispatch.js';
import { AuthPromptPage } from './pages/AuthPromptPage.js';
import { ConversationListPage } from './pages/ConversationListPage.js';
import { ProviderSelectPage } from './pages/ProviderSelectPage.js';
import { getLastProvider, setLastProvider } from './state/storage.js';

type View =
  | { kind: 'select'; sessionAuthenticated: boolean | null }
  | { kind: 'loading' }
  | { kind: 'auth-prompt' }
  | { kind: 'list'; summaries: ConversationSummary[]; streamDone: boolean }
  | { kind: 'error'; message: string };

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const cancelStreamRef = useRef<(() => void) | null>(null);

  const cleanupStream = useCallback(() => {
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
  }, []);

  const startStream = useCallback(
    (provider: ProviderName) => {
      cleanupStream();
      cancelStreamRef.current = streamConversations(provider, {
        onPage: (items) => {
          setView((prev) => {
            // First page promotes the loading view to a populated list.
            if (prev.kind === 'loading') {
              return { kind: 'list', summaries: items, streamDone: false };
            }
            if (prev.kind === 'list') {
              return { ...prev, summaries: [...prev.summaries, ...items] };
            }
            return prev;
          });
        },
        onDone: () => {
          setView((prev) => {
            // If the stream finished before any page arrived, the user has
            // zero conversations — still show the list (empty) rather than
            // sitting on Loading… forever.
            if (prev.kind === 'loading') {
              return { kind: 'list', summaries: [], streamDone: true };
            }
            if (prev.kind === 'list') {
              return { ...prev, streamDone: true };
            }
            return prev;
          });
        },
        onError: (message) => {
          setView({ kind: 'error', message });
        },
      });
    },
    [cleanupStream],
  );

  const routeAfterSession = useCallback(
    async (provider: ProviderName) => {
      try {
        const session = await dispatch.getSession(provider);
        if (!session.authenticated) {
          setView({ kind: 'auth-prompt' });
          return;
        }
        startStream(provider);
      } catch (err) {
        setView({ kind: 'error', message: errorMessage(err) });
      }
    },
    [startStream],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const last = await getLastProvider();
        if (cancelled) return;
        if (last === null) {
          setView({ kind: 'select', sessionAuthenticated: null });
          return;
        }
        await routeAfterSession(last);
      } catch (err) {
        if (cancelled) return;
        setView({ kind: 'error', message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
      cleanupStream();
    };
  }, [routeAfterSession, cleanupStream]);

  const handleSelectProvider = useCallback(
    async (provider: ProviderName) => {
      setView({ kind: 'loading' });
      try {
        await setLastProvider(provider);
        await routeAfterSession(provider);
      } catch (err) {
        setView({ kind: 'error', message: errorMessage(err) });
      }
    },
    [routeAfterSession],
  );

  const handleLogFirstSelected = useCallback(async (id: string) => {
    try {
      // ChatGPT is the only enabled provider until Claude lands.
      const conversation = await dispatch.getConversation('chatgpt', id);
      const { markdown } = renderConversation(conversation);
      console.info('[aiuse] rendered:', markdown);
    } catch (err) {
      console.error('[aiuse] render failed:', errorMessage(err));
    }
  }, []);

  if (view.kind === 'loading') {
    return <LoadingView />;
  }
  if (view.kind === 'error') {
    return <ErrorView message={view.message} />;
  }
  if (view.kind === 'auth-prompt') {
    return <AuthPromptPage />;
  }
  if (view.kind === 'list') {
    return (
      <ConversationListPage
        summaries={view.summaries}
        streamDone={view.streamDone}
        onLogFirstSelected={handleLogFirstSelected}
      />
    );
  }
  return (
    <ProviderSelectPage
      sessionAuthenticated={view.sessionAuthenticated}
      onSelect={handleSelectProvider}
    />
  );
}

function LoadingView() {
  return (
    <main class="flex h-full items-center justify-center p-6">
      <p class="text-sm text-zinc-500">Loading…</p>
    </main>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <main class="flex h-full flex-col gap-2 p-6">
      <h1 class="text-base font-semibold text-red-700">Something went wrong</h1>
      <p class="text-sm text-zinc-600">{message}</p>
    </main>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
