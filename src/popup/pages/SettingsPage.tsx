import { useCallback, useState } from 'preact/hooks';
import { BackButton } from '../components/BackButton.js';
import { PageHeader } from '../components/PageHeader.js';
import {
  MAX_TRUNCATE_LIMIT,
  MIN_TRUNCATE_LIMIT,
  type UserSettings,
  setSettings as persistSettings,
} from '../state/settings.js';

export interface SettingsPageProps {
  initial: UserSettings;
  /** Called after a successful save with the persisted shape. */
  onClose: (next: UserSettings) => void;
}

const DEFAULT_TRUNCATE_PLACEHOLDER = '4000 (default)';

export function SettingsPage({ initial, onClose }: SettingsPageProps) {
  const [truncateInput, setTruncateInput] = useState<string>(
    initial.truncateLimit !== undefined ? String(initial.truncateLimit) : '',
  );
  const [patternsInput, setPatternsInput] = useState<string>(
    (initial.extraRedactPatterns ?? []).join('\n'),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const handleSave = useCallback(async () => {
    setError(null);
    const parsed = parse(truncateInput, patternsInput);
    if (typeof parsed === 'string') {
      setError(parsed);
      return;
    }
    setSaving(true);
    try {
      await persistSettings(parsed);
      onClose(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [truncateInput, patternsInput, onClose]);

  const handleCancel = useCallback(() => {
    onClose(initial);
  }, [initial, onClose]);

  return (
    <main class="flex h-full flex-col">
      <PageHeader
        leading={
          <>
            <BackButton label="Back" ariaLabel="Back without saving" onClick={handleCancel} />
            <h1 class="ml-1 flex-1 text-base font-semibold text-gh-fg-default">Settings</h1>
          </>
        }
      />

      <section class="flex-1 overflow-y-auto px-4 py-4">
        <div class="flex flex-col gap-5">
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-gh-fg-default">Per-message character limit</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_TRUNCATE_LIMIT}
              max={MAX_TRUNCATE_LIMIT}
              step={100}
              placeholder={DEFAULT_TRUNCATE_PLACEHOLDER}
              value={truncateInput}
              onInput={(e) => setTruncateInput((e.target as HTMLInputElement).value)}
              class="rounded-md border border-gh-border-default bg-gh-canvas-default px-2.5 py-1.5 text-sm text-gh-fg-default focus:outline-none focus:ring-2 focus:ring-gh-accent-emphasis"
            />
            <span class="text-xs text-gh-fg-muted">
              Cap each message body at this many characters. Leave blank to use the default (4000).
              Range: {MIN_TRUNCATE_LIMIT.toLocaleString()}–{MAX_TRUNCATE_LIMIT.toLocaleString()}.
            </span>
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-gh-fg-default">Extra redact patterns</span>
            <textarea
              rows={5}
              spellcheck={false}
              placeholder={'one regex per line\\nfoo-\\d+\\ntoken=[A-Z]+'}
              value={patternsInput}
              onInput={(e) => setPatternsInput((e.target as HTMLTextAreaElement).value)}
              class="rounded-md border border-gh-border-default bg-gh-canvas-default px-2.5 py-1.5 font-mono text-xs text-gh-fg-default focus:outline-none focus:ring-2 focus:ring-gh-accent-emphasis"
            />
            <span class="text-xs text-gh-fg-muted">
              One JS regex source per line (the part between the slashes). Matches are replaced with{' '}
              <code class="rounded bg-gh-canvas-subtle px-1">{'<redacted>'}</code>. The default
              built-in patterns (OpenAI/Anthropic keys, GitHub tokens, AWS keys, JWTs) are always
              applied.
            </span>
          </label>

          {error !== null && <p class="text-sm text-gh-danger-fg">{error}</p>}
        </div>
      </section>

      <footer class="sticky bottom-0 flex items-center justify-end gap-2 border-t border-gh-border-default bg-gh-canvas-default px-4 py-3">
        <button
          type="button"
          onClick={handleCancel}
          disabled={saving}
          class="rounded-md border border-gh-border-default bg-gh-canvas-default px-3 py-1.5 text-sm font-medium text-gh-fg-default hover:bg-gh-canvas-subtle disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          class="rounded-md bg-gh-success-emphasis px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1c8139] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </main>
  );
}

/**
 * Parse and validate the form inputs into a `UserSettings` shape, or return
 * an error string for the UI. Validates regex sources strictly so the user
 * sees the typo here rather than silently dropping their pattern.
 */
function parse(truncateInput: string, patternsInput: string): UserSettings | string {
  const out: UserSettings = {};

  const truncateTrimmed = truncateInput.trim();
  if (truncateTrimmed.length > 0) {
    const n = Number(truncateTrimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return 'Per-message limit must be an integer.';
    }
    if (n < MIN_TRUNCATE_LIMIT || n > MAX_TRUNCATE_LIMIT) {
      return `Per-message limit must be between ${MIN_TRUNCATE_LIMIT.toLocaleString()} and ${MAX_TRUNCATE_LIMIT.toLocaleString()}.`;
    }
    out.truncateLimit = n;
  }

  const patternLines = patternsInput
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (let i = 0; i < patternLines.length; i++) {
    const src = patternLines[i] ?? '';
    try {
      new RegExp(src);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'invalid regex';
      return `Pattern on line ${i + 1} is invalid: ${msg}`;
    }
  }
  if (patternLines.length > 0) out.extraRedactPatterns = patternLines;

  return out;
}
