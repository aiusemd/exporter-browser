import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import type { ChatGPTConversation } from '../src/providers/chatgpt.js';
import {
  type ExtensionContext,
  installChatGPTMocks,
  installDownloadsCapture,
  launchExtension,
  readCapturedDownload,
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

test('saves a custom redact pattern and applies it to the next export', async () => {
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

  // Navigate into the settings page.
  await ext.popup.getByRole('button', { name: 'Settings' }).click();
  await expect(ext.popup.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // Custom pattern that matches the fixture's user message ("Hello, how are you?").
  await ext.popup.getByLabel(/Extra redact patterns/).fill('[Hh]ello');
  await ext.popup.getByRole('button', { name: 'Save' }).click();

  // Settings save returns the user to the month list.
  await expect(ext.popup.getByRole('heading', { name: 'Conversations' })).toBeVisible();

  // Run a real export and capture the ZIP.
  const created = new Date(fixture.create_time * 1000);
  const monthLabel = `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, '0')}`;
  await ext.popup.getByRole('button', { name: new RegExp(`Open ${monthLabel}`) }).click();
  await ext.popup.getByLabel(`Select ${fixture.title}`).check();
  await installDownloadsCapture(ext.serviceWorker);
  await ext.popup.getByRole('button', { name: 'Export 1' }).click();
  await expect(ext.popup.getByRole('button', { name: 'Done' })).toBeVisible();

  const captured = await readCapturedDownload(ext.serviceWorker);
  expect(captured).not.toBeNull();
  if (captured === null) return;

  const entries = unzipSync(captured.bytes);
  const mdName = Object.keys(entries).find((n) => n.endsWith('.md')) ?? '';
  const md = new TextDecoder().decode(entries[mdName]);

  // The user pattern matched "Hello" and replaced it with `<redacted>`.
  // Assistant content ("I'm doing well…") doesn't match and is preserved.
  expect(md).toContain('<redacted>');
  expect(md).not.toMatch(/[Hh]ello/);
  expect(md).toContain("I'm doing well");
});

test('persists settings across popup reloads', async () => {
  // Same provider plumbing — the test only cares about the settings UI
  // surviving a reload, but the popup needs a session to render the
  // settings entry point.
  await installChatGPTMocks(ext.context, {
    session: { accessToken: 'tok-test', expires: '2030-01-01T00:00:00.000Z' },
    pages: [{ items: [], total: 0, limit: 100, offset: 0 }],
    conversations: {},
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();
  await ext.popup.getByRole('button', { name: 'Settings' }).click();

  await ext.popup.getByLabel(/Per-message character limit/).fill('1500');
  await ext.popup.getByLabel(/Extra redact patterns/).fill('foo-\\d+\nbar-[a-z]+');
  await ext.popup.getByRole('button', { name: 'Save' }).click();

  // Reload and walk back to the settings page; the inputs should be hydrated.
  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: 'Settings' }).click();

  await expect(ext.popup.getByLabel(/Per-message character limit/)).toHaveValue('1500');
  await expect(ext.popup.getByLabel(/Extra redact patterns/)).toHaveValue('foo-\\d+\nbar-[a-z]+');
});

test('rejects an out-of-range truncate value with an inline error', async () => {
  await installChatGPTMocks(ext.context, {
    session: { accessToken: 'tok-test', expires: '2030-01-01T00:00:00.000Z' },
    pages: [{ items: [], total: 0, limit: 100, offset: 0 }],
    conversations: {},
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();
  await ext.popup.getByRole('button', { name: 'Settings' }).click();

  await ext.popup.getByLabel(/Per-message character limit/).fill('5');
  await ext.popup.getByRole('button', { name: 'Save' }).click();

  await expect(ext.popup.getByText(/Per-message limit must be between/)).toBeVisible();
  // Stays on settings page — save was rejected.
  await expect(ext.popup.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('rejects a malformed regex with a line-numbered error', async () => {
  await installChatGPTMocks(ext.context, {
    session: { accessToken: 'tok-test', expires: '2030-01-01T00:00:00.000Z' },
    pages: [{ items: [], total: 0, limit: 100, offset: 0 }],
    conversations: {},
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();
  await ext.popup.getByRole('button', { name: 'Settings' }).click();

  await ext.popup.getByLabel(/Extra redact patterns/).fill('valid-\\d+\n[');
  await ext.popup.getByRole('button', { name: 'Save' }).click();

  await expect(ext.popup.getByText(/Pattern on line 2 is invalid/)).toBeVisible();
  await expect(ext.popup.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
