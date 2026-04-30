import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TRUNCATE_LIMIT,
  MIN_TRUNCATE_LIMIT,
  getSettings,
  setSettings,
  toRenderOptions,
} from './settings.js';

interface ChromeStorageStub {
  storage: { sync: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } };
}

function installStorage(initial: Record<string, unknown> = {}): ChromeStorageStub {
  const data: Record<string, unknown> = { ...initial };
  const stub: ChromeStorageStub = {
    storage: {
      sync: {
        get: vi.fn(async (key: string) => ({ [key]: data[key] })),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          Object.assign(data, entries);
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: ChromeStorageStub }).chrome = stub;
  return stub;
}

describe('settings storage', () => {
  beforeEach(() => {
    (globalThis as unknown as { chrome: undefined }).chrome = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns {} when nothing has been saved', async () => {
    installStorage();
    expect(await getSettings()).toEqual({});
  });

  it('round-trips truncateLimit and extraRedactPatterns', async () => {
    installStorage();
    await setSettings({ truncateLimit: 8000, extraRedactPatterns: ['foo-\\d+', 'bar-[a-z]+'] });
    expect(await getSettings()).toEqual({
      truncateLimit: 8000,
      extraRedactPatterns: ['foo-\\d+', 'bar-[a-z]+'],
    });
  });

  it('clamps truncateLimit to the configured min/max on load', async () => {
    installStorage({ 'aiuse:settings': { truncateLimit: 5 } });
    expect((await getSettings()).truncateLimit).toBe(MIN_TRUNCATE_LIMIT);

    installStorage({ 'aiuse:settings': { truncateLimit: 9_999_999_999 } });
    expect((await getSettings()).truncateLimit).toBe(MAX_TRUNCATE_LIMIT);
  });

  it('drops non-string / empty redact pattern entries', async () => {
    installStorage({
      'aiuse:settings': { extraRedactPatterns: ['valid', '', null, 42, 'also-valid'] },
    });
    expect((await getSettings()).extraRedactPatterns).toEqual(['valid', 'also-valid']);
  });

  it('returns {} for non-object stored values (corrupted data)', async () => {
    installStorage({ 'aiuse:settings': 'corrupted' });
    expect(await getSettings()).toEqual({});
  });

  it('omits extraRedactPatterns key when no valid entries remain', async () => {
    installStorage({ 'aiuse:settings': { extraRedactPatterns: ['', null] } });
    expect(await getSettings()).toEqual({});
  });
});

describe('toRenderOptions', () => {
  it('returns empty options when nothing is set', () => {
    expect(toRenderOptions({})).toEqual({});
  });

  it('forwards truncateLimit', () => {
    expect(toRenderOptions({ truncateLimit: 1234 })).toEqual({ truncateLimit: 1234 });
  });

  it('compiles regex sources into RegExp under redact.extra', () => {
    const opts = toRenderOptions({ extraRedactPatterns: ['secret-\\d+', 'token=[A-Z]+'] });
    expect(opts.redact?.extra).toHaveLength(2);
    expect(opts.redact?.extra?.[0]?.source).toBe('secret-\\d+');
    expect(opts.redact?.extra?.[0]?.flags).toContain('g');
  });

  it('drops invalid regex sources silently', () => {
    const opts = toRenderOptions({ extraRedactPatterns: ['valid-\\d+', '['] });
    expect(opts.redact?.extra).toHaveLength(1);
    expect(opts.redact?.extra?.[0]?.source).toBe('valid-\\d+');
  });

  it('omits redact entirely when all patterns are invalid', () => {
    const opts = toRenderOptions({ extraRedactPatterns: ['['] });
    expect(opts.redact).toBeUndefined();
  });
});
