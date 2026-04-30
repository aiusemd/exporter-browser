import { defineConfig } from '@playwright/test';

/**
 * Playwright runs the built extension (`dist/`) in a real Chromium with
 * `--load-extension`. Tests live in `e2e/` and use helpers in
 * `e2e/extension.ts` to launch a persistent context per test.
 *
 * Note: Chrome extensions can't be loaded by parallel workers reliably
 * (each worker would need its own user data dir, and the extension ID
 * varies by path). We run serially with one worker and rely on the
 * tests being short.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['github']],
  use: {
    actionTimeout: 5_000,
    trace: 'retain-on-failure',
  },
});
