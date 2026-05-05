// One-shot script: launch the unpacked extension in headless Chromium with
// mocked ChatGPT responses, screenshot the popup at its native 400×600,
// then composite it onto a 1280×800 canvas for the Chrome Web Store.
//
// Run: `node scripts/screenshot.mjs`. Outputs to `screenshots/`.
//
// Requires `dist/` to be built (`pnpm build`).

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const EXTENSION_DIR = resolve(REPO_ROOT, 'dist');
const OUT_DIR = resolve(REPO_ROOT, 'screenshots');

mkdirSync(OUT_DIR, { recursive: true });

const userDataDir = mkdtempSync(join(tmpdir(), 'aiuse-shot-'));

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    '--headless=new',
    '--no-sandbox',
  ],
});

function unix(year, monthIndex, day) {
  return Math.floor(Date.UTC(year, monthIndex, day) / 1000);
}

await context.route('https://chatgpt.com/api/auth/session', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      accessToken: 'tok-shot',
      expires: '2030-01-01T00:00:00.000Z',
      user: { name: 'Demo', email: 'demo@example.com' },
    }),
  }),
);

const page = {
  items: [
    {
      id: 'a1',
      title: 'Refactoring the auth middleware',
      create_time: unix(2026, 3, 28),
      update_time: null,
    },
    {
      id: 'a2',
      title: 'Tailwind dark-mode tokens',
      create_time: unix(2026, 3, 22),
      update_time: null,
    },
    {
      id: 'a3',
      title: 'Postgres index strategy',
      create_time: unix(2026, 3, 15),
      update_time: null,
    },
    { id: 'a4', title: 'Voice mode export bug', create_time: unix(2026, 3, 10), update_time: null },
    {
      id: 'm1',
      title: 'Pricing page copy review',
      create_time: unix(2026, 2, 24),
      update_time: null,
    },
    {
      id: 'm2',
      title: 'Onboarding email sequence',
      create_time: unix(2026, 2, 12),
      update_time: null,
    },
    { id: 'f1', title: 'Q1 retro notes', create_time: unix(2026, 1, 8), update_time: null },
    { id: 'j1', title: 'Hiring rubric draft', create_time: unix(2026, 0, 18), update_time: null },
  ],
  total: 8,
  limit: 100,
  offset: 0,
};

await context.route(/^https:\/\/chatgpt\.com\/backend-api\/conversations(\?|$)/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(page) }),
);

const existing = context.serviceWorkers();
const sw = existing[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
const extensionId = new URL(sw.url()).hostname;

const popup = await context.newPage();
await popup.setViewportSize({ width: 400, height: 600 });
await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

// Click into ChatGPT to land on the month-list view.
await popup.getByRole('button', { name: /chatgpt/i }).click();
await popup
  .getByRole('button', { name: /^Open / })
  .first()
  .waitFor({ timeout: 5_000 });
// Small settle so any streaming state finishes painting.
await popup.waitForTimeout(300);

const popupPng = await popup.screenshot({ type: 'png' });
const popupOnly = resolve(OUT_DIR, 'popup-400x600.png');
const fs = await import('node:fs');
fs.writeFileSync(popupOnly, popupPng);
console.log(`wrote ${popupOnly} (${popupPng.length} bytes)`);

// Composite onto a 1280×800 hero shot.
const composer = await context.newPage();
await composer.setViewportSize({ width: 1280, height: 800 });
const popupB64 = popupPng.toString('base64');
await composer.setContent(`<!doctype html>
<html><head><style>
  html,body{margin:0;padding:0;height:100%;width:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  body{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0d1117 0%,#1f2937 60%,#0b3a4a 100%);overflow:hidden}
  .stage{display:flex;align-items:center;gap:64px;color:#e6edf3}
  .copy{max-width:520px}
  .copy h1{margin:0 0 16px;font-size:48px;line-height:1.1;letter-spacing:-0.02em;font-weight:600}
  .copy p{margin:0;font-size:20px;line-height:1.5;color:#9aa4b2}
  .frame{width:400px;height:600px;border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55),0 8px 24px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.06)}
  .frame img{display:block;width:100%;height:100%}
</style></head>
<body>
  <div class="stage">
    <div class="copy">
      <h1>Export your AI conversations.</h1>
      <p>One-click ChatGPT export to AIUSE-spec markdown. Runs entirely client-side — your chats never leave the browser.</p>
    </div>
    <div class="frame"><img src="data:image/png;base64,${popupB64}"/></div>
  </div>
</body></html>`);

await composer.waitForLoadState('networkidle');
const heroPng = await composer.screenshot({ type: 'png', fullPage: false });
const hero = resolve(OUT_DIR, 'store-1280x800.png');
fs.writeFileSync(hero, heroPng);
console.log(`wrote ${hero} (${heroPng.length} bytes)`);

await context.close();
rmSync(userDataDir, { recursive: true, force: true });
