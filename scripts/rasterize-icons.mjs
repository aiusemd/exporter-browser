// One-shot script: rasterize src/assets/logo.svg at 16/48/128 px and write
// PNGs into src/assets/icons/. Uses Playwright's bundled Chromium so we
// don't add a new image-processing dep just for build-time icon work.
//
// Run via `node scripts/rasterize-icons.mjs` whenever the source SVG
// changes. The PNGs are committed; this is not part of `pnpm build`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const SVG_PATH = resolve(HERE, '..', 'src', 'assets', 'logo.svg');
const OUT_DIR = resolve(HERE, '..', 'src', 'assets', 'icons');
const SIZES = [16, 48, 128];

const svg = readFileSync(SVG_PATH, 'utf-8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext();

for (const size of SIZES) {
  const page = await context.newPage();
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><head><style>
       html,body{margin:0;padding:0;background:transparent}
       img{display:block;width:${size}px;height:${size}px;image-rendering:auto}
     </style></head><body><img src="${dataUrl}"/></body></html>`,
    { waitUntil: 'networkidle' },
  );
  // Give the browser a moment to decode the embedded base64 PNG.
  await page.waitForFunction(() => {
    const img = document.querySelector('img');
    return img?.complete && img.naturalWidth > 0;
  });
  const buf = await page.screenshot({ omitBackground: true, type: 'png' });
  const outPath = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(outPath, buf);
  console.log(`wrote ${outPath} (${buf.length} bytes)`);
  await page.close();
}

await browser.close();
