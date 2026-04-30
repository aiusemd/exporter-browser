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

test('exports a DALL-E conversation with the attachment bytes packaged into the ZIP', async () => {
  const fixture = JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'chatgpt-dalle.json'), 'utf-8'),
  ) as ChatGPTConversation;
  const samplePng = readFileSync(join(FIXTURES_DIR, 'attachments', 'sample.png'));

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
    attachments: {
      // The DALL-E fixture's image_asset_pointer is "file-service://file-DALLE0001".
      'file-DALLE0001': new Uint8Array(samplePng),
    },
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
  await installDownloadsCapture(ext.serviceWorker);
  await ext.popup.getByRole('button', { name: 'Export 1' }).click();

  await expect(ext.popup.getByRole('button', { name: 'Done' })).toBeVisible();

  const captured = await readCapturedDownload(ext.serviceWorker);
  expect(captured).not.toBeNull();
  if (captured === null) return;

  const entries = unzipSync(captured.bytes);
  const names = Object.keys(entries).sort();
  // Expect 1 .md + 1 PNG attachment.
  expect(names).toHaveLength(2);
  const pngName = names.find((n) => n.endsWith('.png'));
  expect(pngName).toBeDefined();
  if (pngName === undefined) return;

  // Bytes must round-trip exactly — proves the SW pulled from the signed CDN.
  const pngBytes = entries[pngName];
  expect(pngBytes).toEqual(new Uint8Array(samplePng));

  // Markdown should reference the resolved filename, not bare <attachment>.
  const mdName = names.find((n) => n.endsWith('.md')) ?? '';
  const md = new TextDecoder().decode(entries[mdName]);
  const expectedMarker = pngName.split('/').pop();
  expect(md).toContain(`<attachment:${expectedMarker}>`);
  expect(md).not.toContain('<attachment>\n'); // bare marker would indicate fallback
});

test('continues the export when an attachment download fails (bare <attachment> in md)', async () => {
  const fixture = JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'chatgpt-dalle.json'), 'utf-8'),
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
    attachments: {}, // none — the file-download endpoint will 404 for every id
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
  await installDownloadsCapture(ext.serviceWorker);
  await ext.popup.getByRole('button', { name: 'Export 1' }).click();

  // Run still completes — Done button surfaces.
  await expect(ext.popup.getByRole('button', { name: 'Done' })).toBeVisible();

  const captured = await readCapturedDownload(ext.serviceWorker);
  expect(captured).not.toBeNull();
  if (captured === null) return;

  const entries = unzipSync(captured.bytes);
  const names = Object.keys(entries);
  // Just the .md — no attachment file packaged.
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/\.md$/);

  const md = new TextDecoder().decode(entries[names[0] ?? '']);
  // Bare marker — the renderer's `included: false` fallback.
  expect(md).toContain('<attachment>');
  expect(md).not.toContain('<attachment:');
});
