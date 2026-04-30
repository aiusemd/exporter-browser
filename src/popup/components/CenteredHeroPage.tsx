import type { ComponentChildren } from 'preact';

export interface CenteredHeroPageProps {
  children: ComponentChildren;
}

/**
 * Full-canvas centred layout for stateless / one-shot pages: loading
 * placeholders, empty states, and any future "nothing to show here yet"
 * surfaces. The shared layout keeps these states visually consistent and
 * pulls one-off `flex h-full items-center justify-center` markup out of
 * each call site.
 */
export function CenteredHeroPage({ children }: CenteredHeroPageProps) {
  return (
    <main class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      {children}
    </main>
  );
}
