import { expect, test } from '@playwright/test';
import { type ExtensionContext, installChatGPTMocks, launchExtension } from './extension.js';

let ext: ExtensionContext;

test.beforeEach(async () => {
  ext = await launchExtension();
});

test.afterEach(async () => {
  await ext.cleanup();
});

test('routes to the auth prompt when /api/auth/session is empty', async () => {
  await installChatGPTMocks(ext.context, { session: null });

  // Reload the popup so the mocks intercept the very first session check.
  // The first popup load happens during launchExtension before mocks are set.
  await ext.popup.reload();

  const card = ext.popup.getByRole('button', { name: /chatgpt/i });
  await card.click();

  await expect(ext.popup.getByRole('heading', { name: /log in to chatgpt/i })).toBeVisible();
  await expect(ext.popup.getByRole('button', { name: /open chatgpt\.com/i })).toBeVisible();
});
