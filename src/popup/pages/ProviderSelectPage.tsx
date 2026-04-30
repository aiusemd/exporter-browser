import { useCallback } from 'preact/hooks';
import type { ProviderName } from '../../types.js';

export interface ProviderSelectPageProps {
  /** null = unknown/loading, true = authenticated, false = not authenticated. */
  sessionAuthenticated: boolean | null;
  onSelect: (provider: ProviderName) => void;
}

function statusDotClass(authed: boolean | null): string {
  if (authed === true) return 'bg-emerald-500';
  if (authed === false) return 'bg-amber-500';
  return 'bg-zinc-300';
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
      <header>
        <h1 class="text-lg font-semibold">Choose a provider</h1>
        <p class="text-sm text-zinc-500">Pick which AI service to export from.</p>
      </header>

      <div class="flex flex-col gap-3">
        <button
          type="button"
          onClick={handleSelectChatGPT}
          class="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-400 hover:shadow"
        >
          <div class="flex flex-col">
            <span class="text-base font-medium text-zinc-900">ChatGPT</span>
            <span class="text-xs text-zinc-500">chatgpt.com</span>
          </div>
          <div class="flex items-center gap-2">
            <span
              aria-label={statusLabel(sessionAuthenticated)}
              title={statusLabel(sessionAuthenticated)}
              class={`h-2.5 w-2.5 rounded-full ${statusDotClass(sessionAuthenticated)}`}
            />
          </div>
        </button>

        <div
          aria-disabled="true"
          class="flex cursor-not-allowed items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-4 opacity-60"
        >
          <div class="flex flex-col">
            <span class="text-base font-medium text-zinc-700">Claude</span>
            <span class="text-xs text-zinc-500">claude.ai</span>
          </div>
          <span class="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600">
            Coming in v2
          </span>
        </div>
      </div>
    </main>
  );
}
