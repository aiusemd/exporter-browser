import { expect, test } from '@playwright/test';
import { type ExtensionContext, installChatGPTMocks, launchExtension } from './extension.js';

let ext: ExtensionContext;

test.beforeEach(async () => {
  ext = await launchExtension();
});

test.afterEach(async () => {
  await ext.cleanup();
});

function makeItems(start: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c-${start + i}`,
    title: `Conversation ${start + i}`,
    create_time: 1700000000 + (start + i),
    update_time: 1700000000 + (start + i) + 100,
  }));
}

test('streams pages and shows progressive list rendering up to the final count', async () => {
  await installChatGPTMocks(ext.context, {
    session: {
      accessToken: 'tok-test',
      expires: '2030-01-01T00:00:00.000Z',
      user: { name: 'E2E', email: 'e2e@example.com' },
    },
    pages: [
      { items: makeItems(0, 100), total: 150, limit: 100, offset: 0 },
      { items: makeItems(100, 50), total: 150, limit: 100, offset: 100 },
    ],
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();

  // First batch (50) arrives quickly — the header shows the open-stream "+".
  await expect(ext.popup.getByRole('heading', { name: /Conversations \(\d+\+\)/ })).toBeVisible();

  // Final count arrives after the second page; spinner clears.
  await expect(ext.popup.getByRole('heading', { name: 'Conversations (150)' })).toBeVisible();
  await expect(ext.popup.getByText('Loading more conversations…')).toHaveCount(0);

  // Spot-check a couple of rows.
  await expect(ext.popup.getByText('Conversation 0')).toBeVisible();
  await expect(ext.popup.getByText('Conversation 149')).toBeVisible();
});
