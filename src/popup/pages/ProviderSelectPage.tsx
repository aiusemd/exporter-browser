import { useCallback } from 'preact/hooks';
import anthropicLogoUrl from '../../assets/anthropic.svg?url';
import logoUrl from '../../assets/logo.svg?url';
import openaiLogoUrl from '../../assets/openai.svg?url';
import type { ProviderName } from '../../types.js';

export interface ProviderSelectPageProps {
  /** null = unknown/loading, true = authenticated, false = not authenticated. */
  sessionAuthenticated: boolean | null;
  onSelect: (provider: ProviderName) => void;
}

function statusDotClass(authed: boolean | null): string {
  if (authed === true) return 'bg-gh-success-emphasis';
  if (authed === false) return 'bg-[#bf8700]';
  return 'bg-gh-border-default';
}

function statusLabel(authed: boolean | null): string {
  if (authed === true) return 'Logged in';
  if (authed === false) return 'Not logged in';
  return 'Status unknown';
}

export function ProviderSelectPage(props: ProviderSelectPageProps) {
  const { sessionAuthenticated, onSelect } = props;

  const handleSelectChatGPT = useCallback(() => {
    onSelect('chatgpt');
  }, [onSelect]);

  return (
    <main class="flex h-full flex-col gap-4 p-6">
      <header class="flex items-center gap-3">
        <img src={logoUrl} alt="" class="h-10 w-10 shrink-0" />
        <div>
          <h1 class="text-lg font-semibold text-gh-fg-default">Choose a provider</h1>
          <p class="text-sm text-gh-fg-muted">Pick which AI service to export from.</p>
        </div>
      </header>

      <div class="flex flex-col gap-3">
        <button
          type="button"
          onClick={handleSelectChatGPT}
          class="flex items-center gap-4 rounded-lg border border-gh-border-default bg-gh-canvas-default p-4 text-left shadow-sm transition hover:border-gh-neutral-emphasis hover:shadow"
        >
          <img src={openaiLogoUrl} alt="" class="h-8 w-8 shrink-0" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-base font-medium text-gh-fg-default">OpenAI</span>
            <span class="text-xs text-gh-fg-muted">ChatGPT</span>
          </div>
          <span
            aria-label={statusLabel(sessionAuthenticated)}
            title={statusLabel(sessionAuthenticated)}
            class={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(sessionAuthenticated)}`}
          />
        </button>

        <div
          aria-disabled="true"
          class="flex cursor-not-allowed items-center gap-4 rounded-lg border border-gh-border-default bg-gh-canvas-subtle p-4 opacity-60"
        >
          <img src={anthropicLogoUrl} alt="" class="h-8 w-8 shrink-0" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-base font-medium text-gh-fg-default">Anthropic</span>
            <span class="text-xs text-gh-fg-muted">Claude</span>
          </div>
          <span class="shrink-0 rounded-full bg-gh-canvas-default px-2 py-0.5 text-xs font-medium text-gh-fg-muted ring-1 ring-inset ring-gh-border-default">
            Coming soon
          </span>
        </div>
      </div>
    </main>
  );
}
