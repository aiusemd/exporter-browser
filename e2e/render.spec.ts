import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
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

test('clicking a conversation logs spec-valid AIUSE markdown to the popup console', async () => {
  const simpleFixture = JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'chatgpt-simple.json'), 'utf-8'),
  );

  await installChatGPTMocks(ext.context, {
    session: {
      accessToken: 'tok-test',
      expires: '2030-01-01T00:00:00.000Z',
    },
    pages: [
      {
        items: [
          {
            id: simpleFixture.conversation_id,
            title: simpleFixture.title,
            create_time: simpleFixture.create_time,
            update_time: simpleFixture.update_time,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      },
    ],
    conversations: {
      [simpleFixture.conversation_id]: simpleFixture,
    },
  });

  // Capture popup-side console messages — that's where renderConversation runs
  // and where the [aiuse] rendered: marker fires.
  const renderedMessages: string[] = [];
  ext.popup.on('console', (msg) => {
    if (msg.text().startsWith('[aiuse] rendered:')) {
      renderedMessages.push(msg.text());
    }
  });

  await ext.popup.reload();
  await ext.popup.getByRole('button', { name: /chatgpt/i }).click();
  await expect(ext.popup.getByText(simpleFixture.title)).toBeVisible();

  // Select the row and trigger the render.
  await ext.popup.getByRole('checkbox', { name: `Select ${simpleFixture.title}` }).check();
  await ext.popup.getByRole('button', { name: /log first selected/i }).click();

  // Wait for the console.info to fire.
  await expect.poll(() => renderedMessages.length).toBeGreaterThan(0);

  const output = renderedMessages[0] ?? '';
  expect(output).toContain('### User');
  expect(output).toContain('Hello, how are you?');
  expect(output).toContain('### Assistant');
  expect(output).toContain("I'm doing well, thanks for asking!");
});
