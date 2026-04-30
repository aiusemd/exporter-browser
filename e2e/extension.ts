import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, type Page, type ServiceWorker, chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = resolve(HERE, '..', 'dist');

export interface ExtensionContext {
  context: BrowserContext;
  serviceWorker: ServiceWorker;
  extensionId: string;
  popup: Page;
  cleanup: () => Promise<void>;
}

/**
 * Launch Chromium with the unpacked extension loaded, wait for the service
 * worker to register, navigate to the popup directly, and return a bundle
 * of handles plus a cleanup function.
 *
 * Chrome generates a per-path extension ID; we extract it from the service
 * worker's URL (`chrome-extension://<id>/service-worker-loader.js`) so tests
 * don't need to know it ahead of time.
 */
export async function launchExtension(): Promise<ExtensionContext> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aiuse-pw-'));
  // Chrome's new headless mode (--headless=new) supports extensions; the
  // old one didn't. Playwright's `headless: true` uses the old mode, so we
  // pass `headless: false` and add the new-headless flag manually.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      '--headless=new',
      '--no-sandbox',
    ],
  });

  const existing = context.serviceWorkers();
  const serviceWorker =
    existing[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));

  const url = new URL(serviceWorker.url());
  const extensionId = url.hostname;

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  return {
    context,
    serviceWorker,
    extensionId,
    popup,
    cleanup: async () => {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Synthetic ChatGPT API mocks. Each test installs only what it needs.
 * Routes match against the network layer so they intercept fetch calls
 * from the service worker too, not just from popup pages.
 */
export interface ChatGPTMocks {
  session?: SessionShape | null;
  pages?: ListPageShape[];
  conversations?: Record<string, unknown>;
}

export interface SessionShape {
  accessToken: string;
  expires: string;
  user?: { name?: string; email?: string };
}

export interface ListPageShape {
  items: Array<{
    id: string;
    title: string;
    create_time: number;
    update_time: number | null;
  }>;
  total: number;
  limit: number;
  offset: number;
}

export async function installChatGPTMocks(
  context: BrowserContext,
  mocks: ChatGPTMocks,
): Promise<void> {
  await context.route('https://chatgpt.com/api/auth/session', async (route) => {
    if (mocks.session === null || mocks.session === undefined) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mocks.session),
    });
  });

  await context.route(
    /^https:\/\/chatgpt\.com\/backend-api\/conversations(\?|$)/,
    async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const page = (mocks.pages ?? []).find((p) => p.offset === offset);
      if (page === undefined) {
        await route.fulfill({ status: 404, body: 'no fixture for offset' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(page),
      });
    },
  );

  await context.route(
    /^https:\/\/chatgpt\.com\/backend-api\/conversation\/([^/?]+)/,
    async (route) => {
      const match = /\/conversation\/([^/?]+)/.exec(route.request().url());
      const id = match?.[1] ?? '';
      const fixture = mocks.conversations?.[id];
      if (fixture === undefined) {
        await route.fulfill({ status: 404, body: 'no fixture for id' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    },
  );
}
