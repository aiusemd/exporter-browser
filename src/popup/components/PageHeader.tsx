import type { ComponentChildren } from 'preact';

export interface PageHeaderProps {
  /**
   * Slot for the leading element — typically a logo+title combo or a back
   * button. Renders flush-left.
   */
  leading: ComponentChildren;
  /**
   * Slot for trailing right-aligned elements (e.g. a streaming spinner).
   * Rendered to the left of the floating App-level Settings gear, which
   * lives in the popup root and overlays the rightmost ~32px of the bar.
   */
  trailing?: ComponentChildren;
}

/**
 * Sticky toolbar shared by the toolbar-style pages (month list, month detail,
 * export progress, settings). Centred/hero pages don't use this — they're
 * full-canvas layouts with the App-level floating Settings button as their
 * only top-bar affordance.
 *
 * `pr-12` on the right reserves space for the App-level gear so trailing
 * content doesn't slide under it.
 */
export function PageHeader({ leading, trailing }: PageHeaderProps) {
  return (
    <header class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gh-border-default bg-gh-canvas-default px-2 py-3 pr-12">
      <div class="flex min-w-0 flex-1 items-center gap-2">{leading}</div>
      {trailing !== undefined && <div class="flex items-center gap-2">{trailing}</div>}
    </header>
  );
}
