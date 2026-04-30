/**
 * User-configurable export settings, persisted via `chrome.storage.sync`
 * so they follow the user across devices when Chrome sync is enabled.
 *
 * Defaults match the format module's defaults — the storage layer is a
 * pure passthrough and never injects values, so the format module remains
 * the single source of truth for what "default" actually means.
 */
import type { RenderOptions } from '../../format/aiuse.js';

const SETTINGS_KEY = 'aiuse:settings';

/** Hard cap so a typo doesn't write a 100MB markdown per conversation. */
export const MAX_TRUNCATE_LIMIT = 1_000_000;
/** Below this, almost every conversation truncates — guard against user error. */
export const MIN_TRUNCATE_LIMIT = 100;

export interface UserSettings {
  /** Per-message char cap. Omitted = format module default. */
  truncateLimit?: number;
  /**
   * Each entry is a JS regex *source* (the part between the slashes). The
   * `g` flag is added at use site by the format module. Bad patterns are
   * dropped at load time so a typo doesn't break every export.
   */
  extraRedactPatterns?: string[];
}

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalize(result[SETTINGS_KEY]);
}

export async function setSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: normalize(settings) });
}

/** Build a RenderOptions value from stored settings, dropping invalid entries. */
export function toRenderOptions(settings: UserSettings): RenderOptions {
  const options: RenderOptions = {};
  if (settings.truncateLimit !== undefined) options.truncateLimit = settings.truncateLimit;
  const compiled = compilePatterns(settings.extraRedactPatterns ?? []);
  if (compiled.length > 0) options.redact = { extra: compiled };
  return options;
}

/** Validate + clamp settings; safe for both load and save paths. */
function normalize(raw: unknown): UserSettings {
  if (raw === null || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: UserSettings = {};

  if (typeof r.truncateLimit === 'number' && Number.isFinite(r.truncateLimit)) {
    out.truncateLimit = clampTruncate(Math.floor(r.truncateLimit));
  }

  if (Array.isArray(r.extraRedactPatterns)) {
    const patterns: string[] = [];
    for (const p of r.extraRedactPatterns) {
      if (typeof p === 'string' && p.length > 0) patterns.push(p);
    }
    if (patterns.length > 0) out.extraRedactPatterns = patterns;
  }

  return out;
}

function clampTruncate(n: number): number {
  if (n < MIN_TRUNCATE_LIMIT) return MIN_TRUNCATE_LIMIT;
  if (n > MAX_TRUNCATE_LIMIT) return MAX_TRUNCATE_LIMIT;
  return n;
}

function compilePatterns(sources: ReadonlyArray<string>): RegExp[] {
  const out: RegExp[] = [];
  for (const src of sources) {
    try {
      out.push(new RegExp(src, 'g'));
    } catch {
      // Drop invalid patterns silently — surfacing them happens at the UI
      // boundary where the user can fix them.
    }
  }
  return out;
}
