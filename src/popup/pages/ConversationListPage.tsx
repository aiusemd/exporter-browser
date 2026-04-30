import { useCallback, useState } from 'preact/hooks';
import type { ConversationSummary } from '../../providers/provider.js';

export interface ConversationListPageProps {
  summaries: ConversationSummary[];
  onLogFirstSelected: (id: string) => void;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return DATE_FORMATTER.format(date);
}

export function ConversationListPage(props: ConversationListPageProps) {
  const { summaries, onLogFirstSelected } = props;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleLogFirst = useCallback(() => {
    // Iterate the underlying summaries (display order) rather than Set
    // insertion order so "first selected" matches what the user sees.
    const first = summaries.find((s) => selected.has(s.id));
    if (first !== undefined) {
      onLogFirstSelected(first.id);
    }
  }, [summaries, selected, onLogFirstSelected]);

  const selectedCount = selected.size;
  const canLog = selectedCount > 0;

  return (
    <main class="flex h-full flex-col">
      <header class="sticky top-0 z-10 border-b border-zinc-200 bg-white px-4 py-3">
        <h1 class="text-base font-semibold">Conversations ({summaries.length})</h1>
      </header>

      <ul class="flex-1 overflow-y-auto">
        {summaries.map((summary) => (
          <ConversationRow
            key={summary.id}
            summary={summary}
            checked={selected.has(summary.id)}
            onToggle={toggle}
          />
        ))}
      </ul>

      <footer class="sticky bottom-0 flex items-center justify-between border-t border-zinc-200 bg-white px-4 py-3">
        <span class="text-sm text-zinc-600">Selected: {selectedCount}</span>
        <button
          type="button"
          onClick={handleLogFirst}
          disabled={!canLog}
          class="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          Log first selected
        </button>
      </footer>
    </main>
  );
}

interface ConversationRowProps {
  summary: ConversationSummary;
  checked: boolean;
  onToggle: (id: string) => void;
}

function ConversationRow(props: ConversationRowProps) {
  const { summary, checked, onToggle } = props;

  const handleChange = useCallback(() => {
    onToggle(summary.id);
  }, [summary.id, onToggle]);

  return (
    <li class="flex items-center gap-3 border-b border-zinc-100 px-4 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        aria-label={`Select ${summary.title}`}
        class="h-4 w-4 shrink-0 rounded border-zinc-300"
      />
      <span class="flex-1 truncate text-sm text-zinc-800" title={summary.title}>
        {summary.title}
      </span>
      <span class="shrink-0 text-xs text-zinc-500">{formatDate(summary.updatedAt)}</span>
    </li>
  );
}
