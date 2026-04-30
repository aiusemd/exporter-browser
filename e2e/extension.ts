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
  // --no-sandbox: Chrome's user-namespace sandbox is unavailable in most
  // CI runners and dev containers; without this, Chromium fails to launch.
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

/**
 * Override `chrome.downloads.download` inside the service worker with a stub
 * that captures the bytes of the data URL passed to it instead of actually
 * downloading. Lets tests pull the produced ZIP without depending on Chrome's
 * real download UI. Stashes a `{filename, base64}` on
 * `globalThis.__capturedDownload`.
 *
 * Note: re-run this helper if there's a chance the SW shut down between
 * install and the next export — assignments don't survive SW restarts.
 */
export async function installDownloadsCapture(serviceWorker: ServiceWorker): Promise<void> {
  await serviceWorker.evaluate(() => {
    const g = globalThis as unknown as {
      __capturedDownload?: { filename: string; base64: string };
    };
    g.__capturedDownload = undefined;
    chrome.downloads.download = (async (opts: chrome.downloads.DownloadOptions) => {
      const url = opts.url ?? '';
      const filename = opts.filename ?? '';
      const prefix = 'data:application/zip;base64,';
      const base64 = url.startsWith(prefix)
        ? url.slice(prefix.length)
        : await fetch(url)
            .then((r) => r.arrayBuffer())
            .then((buf) => {
              const bytes = new Uint8Array(buf);
              let bin = '';
              for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
              return btoa(bin);
            });
      g.__capturedDownload = { filename, base64 };
      return 1;
    }) as typeof chrome.downloads.download;
  });
}

export async function readCapturedDownload(
  serviceWorker: ServiceWorker,
): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const captured = await serviceWorker.evaluate(() => {
    const g = globalThis as unknown as {
      __capturedDownload?: { filename: string; base64: string };
    };
    return g.__capturedDownload ?? null;
  });
  if (captured === null) return null;
  const bin = Buffer.from(captured.base64, 'base64');
  return { filename: captured.filename, bytes: new Uint8Array(bin) };
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
