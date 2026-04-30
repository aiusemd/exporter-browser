import { useCallback } from 'preact/hooks';
import logoUrl from '../../assets/logo.svg?url';

const CHATGPT_URL = 'https://chatgpt.com';

export function AuthPromptPage() {
  const handleOpen = useCallback(() => {
    chrome.tabs.create({ url: CHATGPT_URL });
  }, []);

  return (
    <main class="flex h-full flex-col gap-4 p-6">
      <header class="flex items-center gap-2">
        <img src={logoUrl} alt="" class="h-5 w-5" />
        <h1 class="text-lg font-semibold text-gh-fg-default">Log in to ChatGPT to continue</h1>
      </header>

      <p class="text-sm text-gh-fg-muted">
        AIUSE needs you to be logged into chatgpt.com in this browser. Open it, log in, then click
        the AIUSE icon again.
      </p>

      <button
        type="button"
        onClick={handleOpen}
        class="self-start rounded-md bg-gh-success-emphasis px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1c8139]"
      >
        Open chatgpt.com
      </button>
    </main>
  );
}
