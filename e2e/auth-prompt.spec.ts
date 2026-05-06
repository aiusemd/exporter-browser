import { expect, test } from '@playwright/test';
import { type ExtensionContext, installChatGPTMocks, launchExtension } from './extension.js';

let ext: ExtensionContext;

test.beforeEach(async () => {
  ext = await launchExtension();
});

test.afterEach(async () => {
  await ext.cleanup();
});

test('shows "Login needed" badge and opens chatgpt.com when the unauthenticated ChatGPT tile is clicked', async () => {
  await installChatGPTMocks(ext.context, { session: null });

  // Reload the popup so the mocks intercept the very first session check.
  // The first popup load happens during launchExtension before mocks are set.
  await ext.popup.reload();

  // Once the boot-path probe resolves, the badge reflects "Login needed"
  // (replacing the old AuthPromptPage detour).
  await expect(ext.popup.getByLabel('Login needed')).toBeVisible();

  // Stub chrome.tabs.create in the popup so we can assert the URL the click
  // would have opened without actually launching a new tab. Mirrors the
  // pattern used by ProviderSelectPage's unit tests.
  await ext.popup.evaluate(() => {
    const w = window as unknown as {
      __aiuseOpenedUrl?: string;
      chrome: { tabs: { create: (info: { url: string }) => Promise<unknown> } };
    };
    w.__aiuseOpenedUrl = undefined;
    w.chrome.tabs.create = async ({ url }: { url: string }) => {
      w.__aiuseOpenedUrl = url;
      return { id: 1 };
    };
  });

  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();

  const opened = await ext.popup.evaluate(() => {
    const w = window as unknown as { __aiuseOpenedUrl?: string };
    return w.__aiuseOpenedUrl;
  });
  expect(opened).toBe('https://chatgpt.com');

  // Popup stays on the provider-select view — no AuthPromptPage detour.
  await expect(ext.popup.getByRole('heading', { name: /choose a provider/i })).toBeVisible();
});
