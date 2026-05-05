import { expect, test } from '@playwright/test';
import { type ExtensionContext, installChatGPTMocks, launchExtension } from './extension.js';

let ext: ExtensionContext;

test.beforeEach(async () => {
  ext = await launchExtension();
});

test.afterEach(async () => {
  await ext.cleanup();
});

function monthLabel(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}
function unix(year: number, monthIndex: number, day: number): number {
  return Math.floor(Date.UTC(year, monthIndex, day) / 1000);
}

test('groups conversations by created month with empty middle months greyed out', async () => {
  await installChatGPTMocks(ext.context, {
    session: { accessToken: 'tok-test', expires: '2030-01-01T00:00:00.000Z' },
    pages: [
      {
        items: [
          // April 2026: 2 conversations
          { id: 'apr-1', title: 'April first', create_time: unix(2026, 3, 28), update_time: null },
          { id: 'apr-2', title: 'April second', create_time: unix(2026, 3, 15), update_time: null },
          // February 2026: 1 conversation (March is empty between)
          {
            id: 'feb-1',
            title: 'February only',
            create_time: unix(2026, 1, 10),
            update_time: null,
          },
        ],
        total: 3,
        limit: 100,
        offset: 0,
      },
    ],
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();

  // Most recent populated month at top.
  await expect(
    ext.popup.getByRole('button', { name: new RegExp(`Open ${monthLabel(2026, 3)}`) }),
  ).toBeVisible();

  // Empty March 2026 row is rendered but disabled.
  const marchBtn = ext.popup.getByRole('button', {
    name: `${monthLabel(2026, 2)} (no conversations)`,
  });
  await expect(marchBtn).toBeVisible();
  await expect(marchBtn).toBeDisabled();

  // February 2026 — populated, clickable.
  await expect(
    ext.popup.getByRole('button', { name: new RegExp(`Open ${monthLabel(2026, 1)}`) }),
  ).toBeVisible();
});

test('drills into a month, checks conversations, back-button preserves selection', async () => {
  await installChatGPTMocks(ext.context, {
    session: { accessToken: 'tok-test', expires: '2030-01-01T00:00:00.000Z' },
    pages: [
      {
        items: [
          { id: 'apr-1', title: 'April first', create_time: unix(2026, 3, 28), update_time: null },
          { id: 'apr-2', title: 'April second', create_time: unix(2026, 3, 15), update_time: null },
          {
            id: 'feb-1',
            title: 'February only',
            create_time: unix(2026, 1, 10),
            update_time: null,
          },
        ],
        total: 3,
        limit: 100,
        offset: 0,
      },
    ],
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();

  // Drill into April.
  await ext.popup.getByRole('button', { name: new RegExp(`Open ${monthLabel(2026, 3)}`) }).click();
  await expect(ext.popup.getByRole('heading', { name: monthLabel(2026, 3) })).toBeVisible();

  // Check one row.
  await ext.popup.getByLabel('Select April first').check();

  // Back to root.
  await ext.popup.getByRole('button', { name: /back to all months/i }).click();
  await expect(ext.popup.getByRole('heading', { name: 'Conversations' })).toBeVisible();

  // Footer reflects 1 selected (text + Export button label both update).
  await expect(ext.popup.getByText('1 selected', { exact: true })).toBeVisible();
  await expect(ext.popup.getByRole('button', { name: 'Export 1' })).toBeVisible();
  // Per-month accent badge shows the count selected within that month.
  await expect(ext.popup.getByLabel(`1 selected in ${monthLabel(2026, 3)}`)).toBeVisible();
  // February has none selected — no per-month accent badge for that row.
  await expect(ext.popup.getByLabel(new RegExp(`selected in ${monthLabel(2026, 1)}`))).toHaveCount(
    0,
  );

  // Drill into February, add another, back out — total now 2 across both months.
  await ext.popup.getByRole('button', { name: new RegExp(`Open ${monthLabel(2026, 1)}`) }).click();
  await ext.popup.getByLabel('Select February only').check();
  await ext.popup.getByRole('button', { name: /back to all months/i }).click();
  await expect(ext.popup.getByRole('button', { name: 'Export 2' })).toBeVisible();
});

test('shows empty state when the user has no conversations', async () => {
  await installChatGPTMocks(ext.context, {
    session: { accessToken: 'tok-test', expires: '2030-01-01T00:00:00.000Z' },
    pages: [{ items: [], total: 0, limit: 100, offset: 0 }],
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();

  await expect(ext.popup.getByRole('heading', { name: /no conversations yet/i })).toBeVisible();
});

test('header back button returns the user to the provider select page', async () => {
  await installChatGPTMocks(ext.context, {
    session: { accessToken: 'tok-test', expires: '2030-01-01T00:00:00.000Z' },
    pages: [
      {
        items: [{ id: 'a1', title: 'Anything', create_time: unix(2026, 3, 1), update_time: null }],
        total: 1,
        limit: 100,
        offset: 0,
      },
    ],
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();
  await expect(ext.popup.getByRole('heading', { name: 'Conversations' })).toBeVisible();

  await ext.popup.getByRole('button', { name: 'Back to provider select' }).click();

  // Provider picker is back; the OpenAI / Anthropic rows are visible.
  await expect(ext.popup.getByRole('heading', { name: /choose a provider/i })).toBeVisible();
  await expect(ext.popup.getByRole('button', { name: /OpenAI/ })).toBeVisible();
});

test('sticky footer remains anchored to the bottom of the popup with a short list', async () => {
  await installChatGPTMocks(ext.context, {
    session: { accessToken: 'tok-test', expires: '2030-01-01T00:00:00.000Z' },
    pages: [
      {
        items: [{ id: 'one', title: 'Only one', create_time: unix(2026, 3, 1), update_time: null }],
        total: 1,
        limit: 100,
        offset: 0,
      },
    ],
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();
  await expect(
    ext.popup.getByRole('button', { name: new RegExp(`Open ${monthLabel(2026, 3)}`) }),
  ).toBeVisible();

  const footer = ext.popup.locator('footer').first();
  const body = ext.popup.locator('body');
  const footerBox = await footer.boundingBox();
  const bodyBox = await body.boundingBox();
  expect(footerBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  if (footerBox === null || bodyBox === null) return;

  const footerBottom = footerBox.y + footerBox.height;
  const bodyBottom = bodyBox.y + bodyBox.height;
  // Footer's bottom edge should sit flush with the popup body's bottom
  // (within 1px to allow for sub-pixel layout).
  expect(Math.abs(footerBottom - bodyBottom)).toBeLessThan(1);
});
