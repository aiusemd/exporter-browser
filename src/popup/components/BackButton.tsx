import type { ComponentChildren } from 'preact';
import { ChevronLeftIcon } from './Icons.js';

export interface BackButtonProps {
  /** Visible label next to the chevron. */
  label: ComponentChildren;
  /**
   * Accessibility label for screen readers, defaults to `label` when it's a
   * plain string. Override when the visible label is an icon or when the
   * destination needs more context (e.g. "Back without saving").
   */
  ariaLabel?: string;
  onClick: () => void;
}

/**
 * Chevron-left navigation button used in detail-style page headers.
 * Rendered inside `PageHeader`'s `leading` slot.
 */
export function BackButton({ label, ariaLabel, onClick }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      class="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gh-fg-muted hover:bg-gh-canvas-subtle hover:text-gh-fg-default"
    >
      <ChevronLeftIcon class="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}
