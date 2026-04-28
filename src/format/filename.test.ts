import { describe, expect, it } from 'vitest';
import {
  formatDate,
  makeAttachmentFilename,
  makeConversationFilename,
  monthFolder,
  randomSuffix,
  slugifyAttachmentName,
  slugifyTopic,
} from './filename.js';

describe('formatDate', () => {
  it('formats UTC date as YYYY-MM-DD', () => {
    expect(formatDate(new Date('2026-04-28T15:30:00Z'))).toBe('2026-04-28');
  });

  it('zero-pads single-digit month and day', () => {
    expect(formatDate(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
  });

  it('uses UTC, not local time', () => {
    // 2026-04-28T23:30Z is still 2026-04-28 in UTC even if local is 2026-04-29.
    expect(formatDate(new Date('2026-04-28T23:30:00Z'))).toBe('2026-04-28');
  });
});

describe('monthFolder', () => {
  it('returns YYYY-MM', () => {
    expect(monthFolder(new Date('2026-04-28T00:00:00Z'))).toBe('2026-04');
  });
});

describe('slugifyTopic', () => {
  it('slugifies a plain ASCII title', () => {
    expect(slugifyTopic('Drafting the spec')).toBe('drafting-the-spec');
  });

  it('falls back to "untitled" for empty input', () => {
    expect(slugifyTopic('')).toBe('untitled');
  });

  it('falls back to "untitled" for emoji-only input', () => {
    expect(slugifyTopic('🎉🎉')).toBe('untitled');
  });

  it('falls back to "untitled" for whitespace-only input', () => {
    expect(slugifyTopic('   ')).toBe('untitled');
  });

  it('falls back to "untitled" or transliterates CJK', () => {
    // @sindresorhus/slugify v2 does not bundle CJK transliteration; it strips
    // CJK characters. Either an "untitled" fallback or a non-empty
    // transliterated slug is acceptable per AIUSE spec — we just need a valid
    // [a-z0-9-] string.
    const result = slugifyTopic('你好世界');
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });

  it('truncates long titles to 40 chars and trims trailing dashes', () => {
    const longTitle = 'a'.repeat(60);
    const slug = slugifyTopic(longTitle);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('collapses consecutive separators into a single dash', () => {
    expect(slugifyTopic('foo --- bar___baz')).toBe('foo-bar-baz');
  });

  it('strips leading and trailing dashes', () => {
    expect(slugifyTopic('---hello---')).toBe('hello');
  });

  it('produces only [a-z0-9-] characters', () => {
    expect(slugifyTopic('Hello, World! 2026')).toMatch(/^[a-z0-9-]+$/);
  });

  it('never produces consecutive dashes', () => {
    const slug = slugifyTopic('a--b---c----d');
    expect(slug).not.toMatch(/--/);
  });
});

describe('slugifyAttachmentName', () => {
  it('splits stem and lowercases extension', () => {
    expect(slugifyAttachmentName('IMG_1234.HEIC')).toEqual({
      stem: 'img-1234',
      ext: 'heic',
    });
  });

  it('handles multiple dots, using only the last as extension separator', () => {
    expect(slugifyAttachmentName('analysis.PYTHON.txt')).toEqual({
      stem: 'analysis-python',
      ext: 'txt',
    });
  });

  it('returns empty extension when no dot is present', () => {
    expect(slugifyAttachmentName('README')).toEqual({
      stem: 'readme',
      ext: '',
    });
  });

  it('treats a dotfile name with no extension as stem-only', () => {
    expect(slugifyAttachmentName('.gitignore')).toEqual({
      stem: 'gitignore',
      ext: '',
    });
  });

  it('treats trailing-dot names as no extension', () => {
    expect(slugifyAttachmentName('file.')).toEqual({
      stem: 'file',
      ext: '',
    });
  });

  it('falls back to "untitled" for empty input', () => {
    expect(slugifyAttachmentName('')).toEqual({
      stem: 'untitled',
      ext: '',
    });
  });
});

describe('randomSuffix', () => {
  it('returns a 4-char string in [a-z0-9]', () => {
    const r = randomSuffix();
    expect(r).toHaveLength(4);
    expect(r).toMatch(/^[a-z0-9]{4}$/);
  });

  it('produces different values across calls (collision-resistant)', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 100; i++) samples.add(randomSuffix());
    // 100 samples with 36^4 space — overwhelmingly distinct.
    expect(samples.size).toBeGreaterThan(95);
  });
});

describe('makeConversationFilename', () => {
  it('composes date, topic, rand, and .md extension', () => {
    const filename = makeConversationFilename(
      new Date('2026-04-28T00:00:00Z'),
      'Drafting the spec',
      'k3f9',
    );
    expect(filename).toBe('2026-04-28--drafting-the-spec--k3f9.md');
  });

  it('uses "untitled" for empty title', () => {
    const filename = makeConversationFilename(new Date('2026-04-28T00:00:00Z'), '', 'abcd');
    expect(filename).toBe('2026-04-28--untitled--abcd.md');
  });
});

describe('makeAttachmentFilename', () => {
  it('composes date, topic, rand, attachment stem, and extension', () => {
    const filename = makeAttachmentFilename(
      new Date('2026-04-28T00:00:00Z'),
      'Logo design',
      'a2xz',
      'input.JPG',
    );
    expect(filename).toBe('2026-04-28--logo-design--a2xz--input.jpg');
  });

  it('omits the dot when attachment has no extension', () => {
    const filename = makeAttachmentFilename(
      new Date('2026-04-28T00:00:00Z'),
      'Notes',
      'a2xz',
      'README',
    );
    expect(filename).toBe('2026-04-28--notes--a2xz--readme');
  });
});
