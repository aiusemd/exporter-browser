import { Badge } from './Badge.js';

export interface ExportFooterProps {
  selectedCount: number;
  onExport: () => void;
}

export function ExportFooter({ selectedCount, onExport }: ExportFooterProps) {
  const hasSelection = selectedCount > 0;
  return (
    <footer class="sticky bottom-0 flex items-center justify-between border-t border-zinc-200 bg-white px-4 py-3">
      {hasSelection ? (
        <Badge variant="accent" ariaLabel={`${selectedCount} selected`}>
          {selectedCount} selected
        </Badge>
      ) : (
        <span class="text-sm text-zinc-500">Select conversations to export</span>
      )}
      <button
        type="button"
        onClick={onExport}
        disabled={!hasSelection}
        class="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        Export {hasSelection ? selectedCount : ''}
      </button>
    </footer>
  );
}
