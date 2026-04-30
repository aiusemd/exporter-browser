import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5174,
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
