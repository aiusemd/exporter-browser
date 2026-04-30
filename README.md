# exporter-browser

Browser extension that exports ChatGPT (and, in v2, Claude.ai) conversations to AIUSE-spec markdown logs. Runs entirely client-side: no backend, no telemetry, no third-party network calls.

Spec: https://github.com/aiusemd/spec

## Status

Pre-alpha. Phase 1 (format module), Phase 2 (extension scaffolding + ChatGPT provider), and Phase 3 (export pipeline + settings + notifications) are landed. Ready for hands-on testing.

## Running locally in Chrome

The extension ships unpacked during development.

```bash
# 1. install
git clone git@github.com:aiusemd/exporter-browser.git
cd exporter-browser
pnpm install --frozen-lockfile

# 2. build the extension into dist/
pnpm build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the `dist/` folder

The AIUSE icon appears in the toolbar. Click it to open the popup.

> [!NOTE]
> The extension reads ChatGPT conversations from your existing chatgpt.com session — log into chatgpt.com first.
> Settings (truncate limit, custom redact patterns) sync via `chrome.storage.sync` if Chrome sync is enabled.

### Iterating on changes

Re-run `pnpm build` after each change, then click the **reload** icon next to the extension card on `chrome://extensions`. The popup picks up the new bundle on its next open. There's no live HMR for MV3 service workers; full rebuild + reload is the loop.

If you're only changing popup UI (no service-worker code), `pnpm dev` runs Vite in watch mode against the popup HTML at http://localhost:5173 — useful for fast iteration on layout. Service-worker logic still requires a `pnpm build` + extension reload to test.

## Prerequisites

- Node.js ≥ 20.10
- pnpm ≥ 9 (the repo pins to `pnpm@9.12.0` via `packageManager`)
- Chrome (or any Chromium-based browser) to load the unpacked extension

## Quality gates

Run before opening a PR; CI runs the same set:

```bash
pnpm typecheck   # tsc --noEmit, strict mode
pnpm lint        # biome check
pnpm test        # vitest run (unit + component)
pnpm build       # vite build → dist/
pnpm e2e         # playwright; drives the unpacked extension
```

`pnpm lint:fix` auto-fixes style issues.

## Project layout

```
src/
  format/        Pure markdown rendering (AIUSE spec compliance)
  providers/     ChatGPT API client + normalizer (Claude in v2)
  zip/           Pure ZIP packaging
  sw/            Service-worker export runner
  popup/         Preact UI (pages, components, state)
  state/         Cross-context message types
  background.ts  Service-worker entrypoint
manifest.json    Chrome MV3 manifest
e2e/             Playwright specs (drives the loaded extension)
test/fixtures/   ChatGPT API fixtures used by unit + e2e tests
```

## License

MIT. See [LICENSE](./LICENSE).
