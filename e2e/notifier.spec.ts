import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { ChatGPTConversation } from '../src/providers/chatgpt.js';
import {
  type ExtensionContext,
  installChatGPTMocks,
  installDownloadsCapture,
  installNotificationsCapture,
  launchExtension,
  readCapturedNotifications,
} from './extension.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, '..', 'test', 'fixtures');

let ext: ExtensionContext;

test.beforeEach(async () => {
  ext = await launchExtension();
});

test.afterEach(async () => {
  await ext.cleanup();
});

test('fires a success notification with filename in the body after a normal export', async () => {
  const fixture = JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'chatgpt-simple.json'), 'utf-8'),
  ) as ChatGPTConversation;

  await installChatGPTMocks(ext.context, {
    session: { accessToken: 'tok-test', expires: '2030-01-01T00:00:00.000Z' },
    pages: [
      {
        items: [
          {
            id: fixture.conversation_id,
            title: fixture.title,
            create_time: fixture.create_time,
            update_time: fixture.update_time ?? null,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      },
    ],
    conversations: { [fixture.conversation_id]: fixture },
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();
  const created = new Date(fixture.create_time * 1000);
  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(created);
  await ext.popup.getByRole('button', { name: new RegExp(`Open ${monthLabel}`) }).click();
  await ext.popup.getByLabel(`Select ${fixture.title}`).check();

  // Both stubs need to be installed right before the click — they don't
  // survive a potential SW idle restart between drill-in and Export.
  await installDownloadsCapture(ext.serviceWorker);
  await installNotificationsCapture(ext.serviceWorker);

  await ext.popup.getByRole('button', { name: 'Export 1' }).click();
  await expect(ext.popup.getByRole('button', { name: 'Done' })).toBeVisible();

  const notes = await readCapturedNotifications(ext.serviceWorker);
  expect(notes).toHaveLength(1);
  expect(notes[0]?.title).toBe('AIUSE export complete');
  expect(notes[0]?.message).toMatch(/^Saved 1 conversation to aiuse-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/);
  expect(notes[0]?.type).toBe('basic');
  expect(notes[0]?.priority).toBe(0);
});

test('reports failed-conversation count in the success notification when one fetch fails', async () => {
  const fixture = JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'chatgpt-simple.json'), 'utf-8'),
  ) as ChatGPTConversation;

  // Two list items, but only one has a matching conversation fixture — the
  // other returns 404 from the route handler, which surfaces as a per-id
  // failure inside `runExport` and lands in `failedIds`.
  await installChatGPTMocks(ext.context, {
    session: { accessToken: 'tok-test', expires: '2030-01-01T00:00:00.000Z' },
    pages: [
      {
        items: [
          {
            id: fixture.conversation_id,
            title: fixture.title,
            create_time: fixture.create_time,
            update_time: fixture.update_time ?? null,
          },
          {
            id: 'missing-id',
            title: 'Missing fixture',
            create_time: fixture.create_time,
            update_time: fixture.update_time ?? null,
          },
        ],
        total: 2,
        limit: 100,
        offset: 0,
      },
    ],
    conversations: { [fixture.conversation_id]: fixture },
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();
  const created = new Date(fixture.create_time * 1000);
  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(created);
  await ext.popup.getByRole('button', { name: new RegExp(`Open ${monthLabel}`) }).click();
  await ext.popup.getByLabel(`Select ${fixture.title}`).check();
  await ext.popup.getByLabel('Select Missing fixture').check();

  await installDownloadsCapture(ext.serviceWorker);
  await installNotificationsCapture(ext.serviceWorker);

  await ext.popup.getByRole('button', { name: 'Export 2' }).click();
  await expect(ext.popup.getByRole('button', { name: 'Done' })).toBeVisible();

  const notes = await readCapturedNotifications(ext.serviceWorker);
  expect(notes).toHaveLength(1);
  expect(notes[0]?.title).toBe('AIUSE export complete');
  expect(notes[0]?.message).toMatch(
    /^Saved 1 conversation to aiuse-.+\.zip \(1 could not be packaged\)$/,
  );
});
