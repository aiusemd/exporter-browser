import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { renderConversation } from '../src/format/aiuse.js';
import { type ChatGPTConversation, normalize } from '../src/providers/chatgpt.js';
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

interface FixtureCase {
  /** Filename in test/fixtures/ */
  file: string;
  /** Brief description of what the rendering exercises. */
  exercises: string;
}

/**
 * Each fixture is driven through the popup → SW → mocked ChatGPT → normalize
 * → buildZip → chrome.downloads.download pipeline. We capture the ZIP bytes
 * in the SW (via a download stub), unzip them, and assert that the .md entry
 * inside matches `renderConversation(normalize(fixture)).markdown`. Any
 * divergence between the popup output and the in-process pipeline is a real
 * integration regression — not a difference in expectations.
 */
const FIXTURES: FixtureCase[] = [
  { file: 'chatgpt-simple.json', exercises: 'plain Q&A' },
  { file: 'chatgpt-code-interpreter.json', exercises: '### Tool with python + execution_output' },
  { file: 'chatgpt-dalle.json', exercises: '### Tool with json args + image attachment' },
  { file: 'chatgpt-multimodal.json', exercises: 'user message with image attachment' },
];

for (const { file, exercises } of FIXTURES) {
  test(`exports ${file} (${exercises}) end-to-end with exact-match markdown inside the ZIP`, async () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, file), 'utf-8'),
    ) as ChatGPTConversation;

    const expectedMarkdown = renderConversation(normalize(fixture)).markdown;

    await installChatGPTMocks(ext.context, {
      session: {
        accessToken: 'tok-test',
        expires: '2030-01-01T00:00:00.000Z',
      },
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
      conversations: {
        [fixture.conversation_id]: fixture,
      },
    });
    await ext.popup.reload();
    await ext.popup.getByRole('button', { name: /chatgpt/i }).click();

    const created = new Date(fixture.create_time * 1000);
    const monthLabel = `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, '0')}`;
    await ext.popup.getByRole('button', { name: new RegExp(`Open ${monthLabel}`) }).click();
    await ext.popup.getByLabel(`Select ${fixture.title}`).check();
    // Install the download capture stub immediately before the click so the
    // override survives any SW idle-shutdown that may have happened during
    // the listing / drill-in steps.
    await installDownloadsCapture(ext.serviceWorker);
    await ext.popup.getByRole('button', { name: 'Export 1' }).click();

    // Wait for the progress page to reach `complete` — surfaces the Done button.
    await expect(ext.popup.getByRole('button', { name: 'Done' })).toBeVisible();

    const captured = await readCapturedDownload(ext.serviceWorker);
    expect(captured).not.toBeNull();
    if (captured === null) return;
    expect(captured.filename).toMatch(/^aiuse-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/);

    const entries = unzipSync(captured.bytes);
    const mdEntries = Object.entries(entries).filter(([n]) => n.endsWith('.md'));
    expect(mdEntries).toHaveLength(1);
    const [, mdBytes] = mdEntries[0] ?? ['', new Uint8Array()];
    const md = new TextDecoder().decode(mdBytes);
    expect(md).toBe(expectedMarkdown);
  });
}
