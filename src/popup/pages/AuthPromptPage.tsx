import { useCallback } from 'preact/hooks';

const CHATGPT_URL = 'https://chatgpt.com';

export function AuthPromptPage() {
  const handleOpen = useCallback(() => {
    chrome.tabs.create({ url: CHATGPT_URL });
  }, []);

  return (
    <main class="flex h-full flex-col gap-4 p-6">
      <header>
        <h1 class="text-lg font-semibold">Log in to ChatGPT to continue</h1>
      </header>

      <p class="text-sm text-zinc-600">
        AIUSE needs you to be logged into chatgpt.com in this browser. Open it, log in, then click
        the AIUSE icon again.
      </p>

      <button
        type="button"
        onClick={handleOpen}
        class="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
      >
        Open chatgpt.com
      </button>
    </main>
  );
}
