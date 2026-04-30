import { Spinner } from '../components/Spinner.js';

export type ExportPhase =
  | { kind: 'running'; done: number; total: number; currentTitle?: string }
  | { kind: 'complete'; filename: string; failedIds: string[] }
  | { kind: 'error'; message: string };

export interface ExportProgressPageProps {
  phase: ExportPhase;
  /** Cancel the in-flight export. Only meaningful while `running`. */
  onCancel: () => void;
  /** Dismiss the page (returns to the list). Used after complete/error. */
  onDismiss: () => void;
}

export function ExportProgressPage({ phase, onCancel, onDismiss }: ExportProgressPageProps) {
  return (
    <main class="flex h-full flex-col">
      {/* pr-12 leaves room for the App-level fixed Settings button. */}
      <header class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gh-border-default bg-gh-canvas-default px-4 py-3 pr-12">
        <h1 class="text-base font-semibold text-gh-fg-default">Export</h1>
      </header>

      <section class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        {phase.kind === 'running' && <RunningView phase={phase} />}
        {phase.kind === 'complete' && <CompleteView phase={phase} />}
        {phase.kind === 'error' && <ErrorView phase={phase} />}
      </section>

      <footer class="sticky bottom-0 flex items-center justify-end border-t border-gh-border-default bg-gh-canvas-default px-4 py-3">
        {phase.kind === 'running' ? (
          <button
            type="button"
            onClick={onCancel}
            class="rounded-md border border-gh-border-default bg-gh-canvas-default px-3 py-1.5 text-sm font-medium text-gh-fg-default hover:bg-gh-canvas-subtle"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={onDismiss}
            class="rounded-md bg-gh-success-emphasis px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1c8139]"
          >
            Done
          </button>
        )}
      </footer>
    </main>
  );
}

function RunningView({ phase }: { phase: Extract<ExportPhase, { kind: 'running' }> }) {
  return (
    <>
      <Spinner ariaLabel="Packaging conversations" />
      <p class="text-sm text-gh-fg-default">
        Packaging {phase.done} of {phase.total} conversation{phase.total === 1 ? '' : 's'}
      </p>
      {phase.currentTitle !== undefined && (
        <p class="max-w-full truncate text-xs text-gh-fg-muted" title={phase.currentTitle}>
          {phase.currentTitle}
        </p>
      )}
    </>
  );
}

function CompleteView({ phase }: { phase: Extract<ExportPhase, { kind: 'complete' }> }) {
  const failed = phase.failedIds.length;
  return (
    <>
      <h2 class="text-base font-semibold text-gh-fg-default">Export complete</h2>
      <p class="text-sm text-gh-fg-muted">Saved as {phase.filename}</p>
      {failed > 0 && (
        <p class="text-xs text-gh-danger-fg">
          {failed} conversation{failed === 1 ? '' : 's'} could not be packaged.
        </p>
      )}
    </>
  );
}

function ErrorView({ phase }: { phase: Extract<ExportPhase, { kind: 'error' }> }) {
  return (
    <>
      <h2 class="text-base font-semibold text-gh-danger-fg">Export failed</h2>
      <p class="text-sm text-gh-fg-muted">{phase.message}</p>
    </>
  );
}
