import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { renderConversation } from '../src/format/aiuse.js';
import { type ChatGPTConversation, normalize } from '../src/providers/chatgpt.js';
import { type ExtensionContext, installChatGPTMocks, launchExtension } from './extension.js';

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
 * Each fixture is run end-to-end through the popup → SW → mocked ChatGPT
 * → normalize → renderConversation → console.info pipeline. The expected
 * markdown is computed in-test by running the same `normalize` +
 * `renderConversation` directly on the fixture, so any divergence between
 * the popup output and the in-process pipeline output is a real integration
 * regression — not a difference in expectations.
 */
const FIXTURES: FixtureCase[] = [
  { file: 'chatgpt-simple.json', exercises: 'plain Q&A' },
  { file: 'chatgpt-code-interpreter.json', exercises: '### Tool with python + execution_output' },
  { file: 'chatgpt-dalle.json', exercises: '### Tool with json args + image attachment' },
  { file: 'chatgpt-multimodal.json', exercises: 'user message with image attachment' },
];

for (const { file, exercises } of FIXTURES) {
  test(`renders ${file} (${exercises}) end-to-end with exact-match markdown`, async () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, file), 'utf-8'),
    ) as ChatGPTConversation;

    // Compute the expected markdown by running the fixture through the same
    // normalize + render pipeline the popup will run after the SW responds.
    // If the popup's output diverges, the integration is broken at the
    // boundary — not at the algorithm.
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

    const RENDERED_PREFIX = '[aiuse] rendered: ';
    const renderedMessages: string[] = [];
    ext.popup.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith(RENDERED_PREFIX)) {
        renderedMessages.push(text.slice(RENDERED_PREFIX.length));
      }
    });

    await ext.popup.reload();
    await ext.popup.getByRole('button', { name: /chatgpt/i }).click();

    // The new month-grouped flow: click into the fixture's month, then check
    // the conversation, then click Export.
    const created = new Date(fixture.create_time * 1000);
    const monthLabel = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(created);
    await ext.popup.getByRole('button', { name: new RegExp(`Open ${monthLabel}`) }).click();
    await ext.popup.getByLabel(`Select ${fixture.title}`).check();
    await ext.popup.getByRole('button', { name: 'Export 1' }).click();

    await expect.poll(() => renderedMessages.length).toBeGreaterThan(0);

    expect(renderedMessages[0]).toBe(expectedMarkdown);
  });
}
