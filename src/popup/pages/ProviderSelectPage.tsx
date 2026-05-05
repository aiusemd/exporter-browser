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

const CHATGPT_URL = 'https://chatgpt.com';

export function ProviderSelectPage(props: ProviderSelectPageProps) {
  const { sessionAuthenticated, onSelect } = props;

  const handleSelectChatGPT = useCallback(() => {
    // Unauthenticated: opening the provider's site in a new tab is the
    // most direct path to login. The popup will close as it loses focus;
    // when the user reopens it after logging in, the boot-time session
    // check will surface the now-authed state.
    if (sessionAuthenticated === false) {
      chrome.tabs.create({ url: CHATGPT_URL });
      return;
    }
    onSelect('chatgpt');
  }, [sessionAuthenticated, onSelect]);

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
            <span class="text-base font-medium text-gh-fg-default">ChatGPT</span>
            <span class="text-xs text-gh-fg-muted">OpenAI</span>
          </div>
          <StatusBadge authed={sessionAuthenticated} />
        </button>

        <div
          aria-disabled="true"
          class="flex cursor-not-allowed items-center gap-4 rounded-lg border border-gh-border-default bg-gh-canvas-subtle p-4 opacity-60"
        >
          <img src={anthropicLogoUrl} alt="" class="h-8 w-8 shrink-0" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-base font-medium text-gh-fg-default">Claude</span>
            <span class="text-xs text-gh-fg-muted">Anthropic</span>
          </div>
          <span class="shrink-0 rounded-full bg-gh-canvas-default px-2 py-0.5 text-xs font-medium text-gh-fg-muted ring-1 ring-inset ring-gh-border-default">
            Coming soon
          </span>
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ authed }: { authed: boolean | null }) {
  // While the auth check is in flight, render nothing rather than flashing
  // a "Login needed" badge that resolves to "Available" a moment later.
  if (authed === null) return null;

  const isAuthed = authed === true;
  const label = isAuthed ? 'Available' : 'Login needed';
  const palette = isAuthed
    ? 'bg-gh-success-subtle text-gh-success-fg ring-gh-success-emphasis'
    : 'bg-gh-canvas-subtle text-gh-fg-muted ring-gh-border-default';
  return (
    <span
      aria-label={label}
      class={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${palette}`}
    >
      {label}
    </span>
  );
}
