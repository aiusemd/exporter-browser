import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      // GitHub Primer light palette tokens. Sourced from the published Primer
      // primitives — light mode only, since we ship a single theme.
      colors: {
        gh: {
          'canvas-default': '#ffffff',
          'canvas-subtle': '#f6f8fa',
          'canvas-inset': '#f6f8fa',
          'fg-default': '#1f2328',
          'fg-muted': '#59636e',
          'fg-subtle': '#6e7781',
          'border-default': '#d1d9e0',
          'border-muted': '#d1d9e0e6',
          'accent-fg': '#0969da',
          'accent-emphasis': '#0969da',
          'accent-subtle': '#ddf4ff',
          'success-fg': '#1a7f37',
          'success-emphasis': '#1f883d',
          'success-subtle': '#dafbe1',
          'danger-fg': '#d1242f',
          'danger-emphasis': '#cf222e',
          'neutral-emphasis': '#59636e',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"Noto Sans"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
