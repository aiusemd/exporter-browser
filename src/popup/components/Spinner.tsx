export interface SpinnerProps {
  /** Tailwind size + color overrides. Defaults to a 14px subtle spinner. */
  class?: string;
  /** Used as the accessible label and as visually-hidden text for screen readers. */
  ariaLabel?: string;
}

export function Spinner({ class: className, ariaLabel = 'Loading' }: SpinnerProps) {
  const baseClasses =
    'inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-gh-border-default border-t-gh-fg-muted';
  const composed = className === undefined ? baseClasses : `${baseClasses} ${className}`;
  return (
    <output class={composed} aria-live="polite">
      <span class="sr-only">{ariaLabel}</span>
    </output>
  );
}
