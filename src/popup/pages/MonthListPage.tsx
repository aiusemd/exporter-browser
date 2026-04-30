import { useCallback } from 'preact/hooks';
import { Badge } from '../components/Badge.js';
import { ExportFooter } from '../components/ExportFooter.js';
import { ChevronRightIcon } from '../components/Icons.js';
import type { MonthBucket } from '../state/months.js';

export interface MonthListPageProps {
  buckets: MonthBucket[];
  selectedIds: ReadonlySet<string>;
  onOpenMonth: (key: string) => void;
  onExport: () => void;
}

export function MonthListPage({ buckets, selectedIds, onOpenMonth, onExport }: MonthListPageProps) {
  return (
    <main class="flex h-full flex-col">
      <header class="sticky top-0 z-10 border-b border-zinc-200 bg-white px-4 py-3">
        <h1 class="text-base font-semibold">Conversations</h1>
      </header>

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
    'flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-3 text-left text-sm';
  const interactiveClasses = isEmpty
    ? 'cursor-not-allowed text-zinc-400'
    : 'text-zinc-800 hover:bg-zinc-50';

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
        {!isEmpty && <ChevronRightIcon class="h-4 w-4 shrink-0 text-zinc-400" />}
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
