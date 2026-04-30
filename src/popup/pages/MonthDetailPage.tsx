import { useCallback } from 'preact/hooks';
import { ExportFooter } from '../components/ExportFooter.js';
import { ChevronLeftIcon } from '../components/Icons.js';
import { PageHeader } from '../components/PageHeader.js';
import { Spinner } from '../components/Spinner.js';
import type { MonthBucket } from '../state/months.js';

export interface MonthDetailPageProps {
  bucket: MonthBucket;
  /** False while the SW is still streaming pages — drives the header spinner. */
  loading: boolean;
  selectedIds: ReadonlySet<string>;
  onBack: () => void;
  onToggle: (id: string) => void;
  onExport: () => void;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return DATE_FORMATTER.format(date);
}

export function MonthDetailPage({
  bucket,
  loading,
  selectedIds,
  onBack,
  onToggle,
  onExport,
}: MonthDetailPageProps) {
  return (
    <main class="flex h-full flex-col bg-gh-canvas-default">
      <PageHeader
        leading={
          <>
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to all months"
              class="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gh-fg-muted hover:bg-gh-canvas-subtle hover:text-gh-fg-default"
            >
              <ChevronLeftIcon class="h-4 w-4" />
              <span>All months</span>
            </button>
            <h1 class="ml-1 flex-1 truncate text-base font-semibold text-gh-fg-default">
              {bucket.label}
            </h1>
          </>
        }
        trailing={loading ? <Spinner ariaLabel="Loading more conversations" /> : undefined}
      />

      <ul class="flex-1 overflow-y-auto">
        {bucket.conversations.map((c) => (
          <ConversationRow
            key={c.id}
            id={c.id}
            title={c.title}
            createdAt={c.createdAt}
            checked={selectedIds.has(c.id)}
            onToggle={onToggle}
          />
        ))}
      </ul>

      <ExportFooter selectedCount={selectedIds.size} onExport={onExport} />
    </main>
  );
}

interface ConversationRowProps {
  id: string;
  title: string;
  createdAt: Date;
  checked: boolean;
  onToggle: (id: string) => void;
}

function ConversationRow({ id, title, createdAt, checked, onToggle }: ConversationRowProps) {
  const handleChange = useCallback(() => {
    onToggle(id);
  }, [id, onToggle]);

  return (
    <li class="flex items-center gap-3 border-b border-gh-border-default px-4 py-2.5 hover:bg-gh-canvas-subtle">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        aria-label={`Select ${title}`}
        class="h-4 w-4 shrink-0 rounded border-gh-border-default accent-gh-accent-emphasis"
      />
      <span class="flex-1 truncate text-sm text-gh-fg-default" title={title}>
        {title}
      </span>
      <span class="shrink-0 text-xs text-gh-fg-muted">{formatDate(createdAt)}</span>
    </li>
  );
}
