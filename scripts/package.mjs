// One-shot script: package the built extension as a Chrome Web Store
// upload. Reads version from package.json, builds dist/, then writes
// `aiuse-exporter-<version>.zip` to the repo root with manifest.json at
// the zip root (CWS requires that — zip the contents of dist/, not the
// folder itself).
//
// Run: `pnpm package`. Requires no Chrome/zip system binaries.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DIST_DIR = resolve(REPO_ROOT, 'dist');

const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8'));
const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'manifest.json'), 'utf-8'));

if (pkg.version !== manifest.version) {
  console.error(
    `version mismatch: package.json=${pkg.version} manifest.json=${manifest.version}\nbump both before packaging`,
  );
  process.exit(1);
}

console.log(`building dist/ for v${pkg.version}...`);
const build = spawnSync('pnpm', ['build'], { cwd: REPO_ROOT, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

// fflate's zipSync wants a nested object keyed by path → Uint8Array. Walk
// dist/ and collect every file relative to dist/ (so manifest.json lands at
// the zip root, not inside a `dist/` directory).
const files = {};
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else {
      const rel = relative(DIST_DIR, full).split('\\').join('/');
      files[rel] = new Uint8Array(readFileSync(full));
    }
  }
}
walk(DIST_DIR);

const zipped = zipSync(files, { level: 9 });
const outPath = resolve(REPO_ROOT, `aiuse-exporter-${pkg.version}.zip`);
writeFileSync(outPath, zipped);

console.log(`wrote ${relative(REPO_ROOT, outPath)} (${zipped.length.toLocaleString()} bytes)`);
console.log('upload this file in the Chrome Web Store Developer Dashboard.');
