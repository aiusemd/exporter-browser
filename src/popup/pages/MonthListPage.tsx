import { useCallback } from 'preact/hooks';
import { BackButton } from '../components/BackButton.js';
import { Badge } from '../components/Badge.js';
import { ExportFooter } from '../components/ExportFooter.js';
import { ChevronRightIcon } from '../components/Icons.js';
import { PageHeader } from '../components/PageHeader.js';
import { Spinner } from '../components/Spinner.js';
import type { MonthBucket } from '../state/months.js';

export interface MonthListPageProps {
  buckets: MonthBucket[];
  /** False while the SW is still streaming pages — drives the header spinner. */
  loading: boolean;
  selectedIds: ReadonlySet<string>;
  onOpenMonth: (key: string) => void;
  onExport: () => void;
  /** Returns the user to the provider select page. */
  onBack: () => void;
}

export function MonthListPage({
  buckets,
  loading,
  selectedIds,
  onOpenMonth,
  onExport,
  onBack,
}: MonthListPageProps) {
  return (
    <main class="flex h-full flex-col bg-gh-canvas-default">
      <PageHeader
        leading={
          <>
            <BackButton label="Providers" ariaLabel="Back to provider select" onClick={onBack} />
            <h1 class="ml-1 flex-1 truncate text-base font-semibold text-gh-fg-default">
              Conversations
            </h1>
          </>
        }
        trailing={loading ? <Spinner ariaLabel="Loading more conversations" /> : undefined}
      />

      <ul class="flex-1 overflow-y-auto">
        {buckets.map((bucket) => (
          <MonthRow
            key={bucket.key}
            bucket={bucket}
            selectedInMonth={countSelectedIn(bucket, selectedIds)}
            onOpen={onOpenMonth}
          />
        ))}
      </ul>

      <ExportFooter selectedCount={selectedIds.size} onExport={onExport} />
    </main>
  );
}

interface MonthRowProps {
  bucket: MonthBucket;
  selectedInMonth: number;
  onOpen: (key: string) => void;
}

function MonthRow({ bucket, selectedInMonth, onOpen }: MonthRowProps) {
  const total = bucket.conversations.length;
  const isEmpty = total === 0;

  const handleClick = useCallback(() => {
    if (isEmpty) return;
    onOpen(bucket.key);
  }, [isEmpty, onOpen, bucket.key]);

  const baseClasses =
    'flex w-full items-center gap-3 border-b border-gh-border-default px-4 py-3 text-left text-sm';
  const interactiveClasses = isEmpty
    ? 'cursor-not-allowed text-gh-fg-subtle'
    : 'text-gh-fg-default hover:bg-gh-canvas-subtle';

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        disabled={isEmpty}
        aria-label={
          isEmpty
            ? `${bucket.label} (no conversations)`
            : `Open ${bucket.label}, ${total} conversation${total === 1 ? '' : 's'}`
        }
        class={`${baseClasses} ${interactiveClasses}`}
      >
        <span class="flex-1 truncate font-medium">{bucket.label}</span>
        {selectedInMonth > 0 && (
          <Badge variant="accent" ariaLabel={`${selectedInMonth} selected in ${bucket.label}`}>
            {selectedInMonth}
          </Badge>
        )}
        {total > 0 && <Badge ariaLabel={`${total} total`}>{total}</Badge>}
        {!isEmpty && <ChevronRightIcon class="h-4 w-4 shrink-0 text-gh-fg-subtle" />}
      </button>
    </li>
  );
}

function countSelectedIn(bucket: MonthBucket, selectedIds: ReadonlySet<string>): number {
  let count = 0;
  for (const c of bucket.conversations) {
    if (selectedIds.has(c.id)) count++;
  }
  return count;
}
