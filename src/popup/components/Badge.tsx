import type { ComponentChildren } from 'preact';

export type BadgeVariant = 'neutral' | 'accent';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ComponentChildren;
  /** Override label for screen readers, e.g. "12 conversations". Defaults to the visible text. */
  ariaLabel?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-200',
  accent: 'bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-200',
};

export function Badge({ variant = 'neutral', children, ariaLabel }: BadgeProps) {
  const classes = `inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums ${VARIANT_CLASSES[variant]}`;
  return (
    <span class={classes} aria-label={ariaLabel}>
      {children}
    </span>
  );
}
