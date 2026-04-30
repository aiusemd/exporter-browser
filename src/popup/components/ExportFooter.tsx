import { Badge } from './Badge.js';

export interface ExportFooterProps {
  selectedCount: number;
  onExport: () => void;
}

export function ExportFooter({ selectedCount, onExport }: ExportFooterProps) {
  const hasSelection = selectedCount > 0;
  return (
    <footer class="sticky bottom-0 flex items-center justify-between border-t border-gh-border-default bg-gh-canvas-default px-4 py-3">
      {hasSelection ? (
        <Badge variant="accent" ariaLabel={`${selectedCount} selected`}>
          {selectedCount} selected
        </Badge>
      ) : (
        <span class="text-sm text-gh-fg-muted">Select conversations to export</span>
      )}
      <button
        type="button"
        onClick={onExport}
        disabled={!hasSelection}
        class="rounded-md bg-gh-success-emphasis px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#1c8139] disabled:cursor-not-allowed disabled:bg-gh-border-default disabled:text-gh-fg-muted"
      >
        {hasSelection ? `Export ${selectedCount}` : 'Export'}
      </button>
    </footer>
  );
}
