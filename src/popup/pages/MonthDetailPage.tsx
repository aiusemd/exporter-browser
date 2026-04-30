import { useCallback } from 'preact/hooks';
import { ExportFooter } from '../components/ExportFooter.js';
import { ChevronLeftIcon } from '../components/Icons.js';
import type { MonthBucket } from '../state/months.js';

export interface MonthDetailPageProps {
  bucket: MonthBucket;
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
  selectedIds,
  onBack,
  onToggle,
  onExport,
}: MonthDetailPageProps) {
  return (
    <main class="flex h-full flex-col">
      <header class="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-200 bg-white px-2 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to all months"
          class="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100"
        >
          <ChevronLeftIcon class="h-4 w-4" />
          <span>All months</span>
        </button>
        <h1 class="ml-1 text-base font-semibold">{bucket.label}</h1>
      </header>

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
    <li class="flex items-center gap-3 border-b border-zinc-100 px-4 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        aria-label={`Select ${title}`}
        class="h-4 w-4 shrink-0 rounded border-zinc-300"
      />
      <span class="flex-1 truncate text-sm text-zinc-800" title={title}>
        {title}
      </span>
      <span class="shrink-0 text-xs text-zinc-500">{formatDate(createdAt)}</span>
    </li>
  );
}
