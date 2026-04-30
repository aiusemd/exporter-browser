import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ConversationSummary } from '../providers/provider.js';
import type { ProviderName } from '../types.js';
import { GearIcon } from './components/Icons.js';
import { dispatch, streamConversations } from './dispatch.js';
import { AuthPromptPage } from './pages/AuthPromptPage.js';
import { EmptyConversationsPage } from './pages/EmptyConversationsPage.js';
import type { ExportPhase } from './pages/ExportProgressPage.js';
import { ExportProgressPage } from './pages/ExportProgressPage.js';
import { MonthDetailPage } from './pages/MonthDetailPage.js';
import { MonthListPage } from './pages/MonthListPage.js';
import { ProviderSelectPage } from './pages/ProviderSelectPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { runExport } from './runExport.js';
import { groupByMonth } from './state/months.js';
import { type UserSettings, getSettings } from './state/settings.js';
import { getLastProvider, setLastProvider } from './state/storage.js';

type SettingsBaseView =
  | { kind: 'select'; sessionAuthenticated: boolean | null }
  | { kind: 'auth-prompt' }
  | { kind: 'list'; provider: ProviderName; summaries: ConversationSummary[]; streamDone: boolean }
  | {
      kind: 'exporting';
      provider: ProviderName;
      phase: ExportPhase;
      previousList: Extract<SettingsBaseView, { kind: 'list' }>;
    }
  | { kind: 'error'; message: string };

type View =
  | SettingsBaseView
  | { kind: 'loading' }
  // Settings can be opened from any non-loading, non-settings view; the
  // previous view is captured so the gear button is reachable everywhere
  // and we always restore the user to where they came from.
  | { kind: 'settings'; previousView: SettingsBaseView };

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [settings, setSettings] = useState<UserSettings>({});
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const cancelExportRef = useRef<(() => void) | null>(null);

  const cleanupStream = useCallback(() => {
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
  }, []);

  const cleanupExport = useCallback(() => {
    cancelExportRef.current?.();
    cancelExportRef.current = null;
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
        const [last, loaded] = await Promise.all([getLastProvider(), getSettings()]);
        if (cancelled) return;
        setSettings(loaded);
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
      cleanupExport();
    };
  }, [routeAfterSession, cleanupStream, cleanupExport]);

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

  const handleExport = useCallback(() => {
    if (view.kind !== 'list') return;
    if (selectedIds.size === 0) return;
    const previousList = view;
    const ids = [...selectedIds];
    setView({
      kind: 'exporting',
      provider: previousList.provider,
      phase: { kind: 'running', done: 0, total: ids.length },
      previousList,
    });
    cleanupExport();
    cancelExportRef.current = runExport(
      previousList.provider,
      { ids, settings },
      {
        onProgress: (p) =>
          setView((prev) =>
            prev.kind === 'exporting' && prev.phase.kind === 'running'
              ? { ...prev, phase: { kind: 'running', ...p } }
              : prev,
          ),
        onComplete: ({ filename, failedIds }) =>
          setView((prev) =>
            prev.kind === 'exporting'
              ? { ...prev, phase: { kind: 'complete', filename, failedIds } }
              : prev,
          ),
        onError: (message) =>
          setView((prev) =>
            prev.kind === 'exporting' ? { ...prev, phase: { kind: 'error', message } } : prev,
          ),
      },
    );
  }, [view, selectedIds, settings, cleanupExport]);

  const handleExportCancel = useCallback(() => {
    cleanupExport();
    setView((prev) => (prev.kind === 'exporting' ? prev.previousList : prev));
  }, [cleanupExport]);

  const handleExportDismiss = useCallback(() => {
    cleanupExport();
    setView((prev) => (prev.kind === 'exporting' ? prev.previousList : prev));
    setSelectedIds(new Set());
  }, [cleanupExport]);

  const handleOpenSettings = useCallback(() => {
    setView((prev) => {
      // Already on settings, or in the transient loading state where the
      // previous view isn't fully resolved yet — leave the view unchanged.
      if (prev.kind === 'settings' || prev.kind === 'loading') return prev;
      return { kind: 'settings', previousView: prev };
    });
  }, []);

  const handleSettingsClose = useCallback((next: UserSettings) => {
    setSettings(next);
    setView((prev) => (prev.kind === 'settings' ? prev.previousView : prev));
  }, []);

  // Settings is reachable from any non-loading, non-settings view via this
  // floating button. Rendered as a sibling of the page so it overlays sticky
  // headers and centred empty/error layouts alike.
  const settingsButton =
    view.kind === 'loading' || view.kind === 'settings' ? null : (
      <SettingsButton onClick={handleOpenSettings} />
    );

  if (view.kind === 'loading') return <LoadingView />;
  if (view.kind === 'error')
    return (
      <>
        <ErrorView message={view.message} />
        {settingsButton}
      </>
    );
  if (view.kind === 'auth-prompt')
    return (
      <>
        <AuthPromptPage />
        {settingsButton}
      </>
    );
  if (view.kind === 'exporting') {
    return (
      <>
        <ExportProgressPage
          phase={view.phase}
          onCancel={handleExportCancel}
          onDismiss={handleExportDismiss}
        />
        {settingsButton}
      </>
    );
  }
  if (view.kind === 'settings') {
    return <SettingsPage initial={settings} onClose={handleSettingsClose} />;
  }
  if (view.kind === 'list') {
    return (
      <>
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
        {settingsButton}
      </>
    );
  }
  return (
    <>
      <ProviderSelectPage
        sessionAuthenticated={view.sessionAuthenticated}
        onSelect={handleSelectProvider}
      />
      {settingsButton}
    </>
  );
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Settings"
      class="fixed right-2.5 top-2.5 z-20 rounded-md p-1.5 text-gh-fg-muted hover:bg-gh-canvas-subtle hover:text-gh-fg-default focus:outline-none focus:ring-2 focus:ring-gh-accent-emphasis"
    >
      <GearIcon class="h-4 w-4" />
    </button>
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
      <p class="text-sm text-gh-fg-muted">Loading…</p>
    </main>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <main class="flex h-full flex-col gap-2 p-6">
      <h1 class="text-base font-semibold text-gh-danger-fg">Something went wrong</h1>
      <p class="text-sm text-gh-fg-muted">{message}</p>
    </main>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
