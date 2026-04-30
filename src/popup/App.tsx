import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { renderConversation } from '../format/aiuse.js';
import type { ConversationSummary } from '../providers/provider.js';
import type { ProviderName } from '../types.js';
import { dispatch, streamConversations } from './dispatch.js';
import { AuthPromptPage } from './pages/AuthPromptPage.js';
import { EmptyConversationsPage } from './pages/EmptyConversationsPage.js';
import { MonthDetailPage } from './pages/MonthDetailPage.js';
import { MonthListPage } from './pages/MonthListPage.js';
import { ProviderSelectPage } from './pages/ProviderSelectPage.js';
import { groupByMonth } from './state/months.js';
import { getLastProvider, setLastProvider } from './state/storage.js';

type View =
  | { kind: 'select'; sessionAuthenticated: boolean | null }
  | { kind: 'loading' }
  | { kind: 'auth-prompt' }
  | { kind: 'list'; provider: ProviderName; summaries: ConversationSummary[]; streamDone: boolean }
  | { kind: 'error'; message: string };

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
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
              return { kind: 'list', provider, summaries: items, streamDone: false };
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
            // zero conversations — still resolve to a (empty) list so the UI
            // can render the empty state instead of sitting on Loading…
            if (prev.kind === 'loading') {
              return { kind: 'list', provider, summaries: [], streamDone: true };
            }
            if (prev.kind === 'list') return { ...prev, streamDone: true };
            return prev;
          });
        },
        onError: (message) => setView({ kind: 'error', message }),
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

  const handleToggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleOpenMonth = useCallback((key: string) => setOpenMonth(key), []);
  const handleBack = useCallback(() => setOpenMonth(null), []);

  const handleExport = useCallback(async () => {
    if (view.kind !== 'list') return;
    if (selectedIds.size === 0) return;
    // Phase 3 wires this to a real ZIP export via the SW. For now we render
    // each selected conversation client-side and console.info the markdown
    // so the e2e tests have something concrete to assert on.
    for (const id of selectedIds) {
      try {
        const conversation = await dispatch.getConversation(view.provider, id);
        const { markdown } = renderConversation(conversation);
        console.info('[aiuse] rendered:', markdown);
      } catch (err) {
        console.error('[aiuse] render failed:', errorMessage(err));
      }
    }
  }, [view, selectedIds]);

  if (view.kind === 'loading') return <LoadingView />;
  if (view.kind === 'error') return <ErrorView message={view.message} />;
  if (view.kind === 'auth-prompt') return <AuthPromptPage />;
  if (view.kind === 'list') {
    return (
      <ListShell
        summaries={view.summaries}
        streamDone={view.streamDone}
        openMonth={openMonth}
        selectedIds={selectedIds}
        onOpenMonth={handleOpenMonth}
        onBack={handleBack}
        onToggle={handleToggleSelected}
        onExport={handleExport}
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

interface ListShellProps {
  summaries: ConversationSummary[];
  streamDone: boolean;
  openMonth: string | null;
  selectedIds: Set<string>;
  onOpenMonth: (key: string) => void;
  onBack: () => void;
  onToggle: (id: string) => void;
  onExport: () => void;
}

function ListShell({
  summaries,
  streamDone,
  openMonth,
  selectedIds,
  onOpenMonth,
  onBack,
  onToggle,
  onExport,
}: ListShellProps) {
  const buckets = useMemo(() => groupByMonth(summaries), [summaries]);

  if (streamDone && buckets.length === 0) {
    return <EmptyConversationsPage />;
  }

  if (openMonth !== null) {
    const bucket = buckets.find((b) => b.key === openMonth);
    if (bucket !== undefined && bucket.conversations.length > 0) {
      return (
        <MonthDetailPage
          bucket={bucket}
          loading={!streamDone}
          selectedIds={selectedIds}
          onBack={onBack}
          onToggle={onToggle}
          onExport={onExport}
        />
      );
    }
    // The opened month no longer exists or emptied out — fall through to
    // the root list rather than rendering a stale empty detail page.
  }

  return (
    <MonthListPage
      buckets={buckets}
      loading={!streamDone}
      selectedIds={selectedIds}
      onOpenMonth={onOpenMonth}
      onExport={onExport}
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
