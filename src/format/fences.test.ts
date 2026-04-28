import { describe, expect, it } from 'vitest';
import { pickFence, wrap } from './fences.js';

describe('pickFence', () => {
  it('returns 3 backticks when content has none', () => {
    expect(pickFence('hello world')).toBe('```');
  });

  it('returns 4 when content contains a 3-backtick run', () => {
    expect(pickFence('a ``` b')).toBe('````');
  });

  it('returns 5 when content contains a 4-backtick run', () => {
    expect(pickFence('a ```` b')).toBe('`````');
  });

  it('returns 8 when content contains a 7-backtick run', () => {
    expect(pickFence('a ``````` b')).toBe('````````');
  });

  it('escalates above the longest of mixed backtick runs', () => {
    const content = 'one ` two ````` three ```';
    expect(pickFence(content)).toBe('``````');
  });

  it('ignores tilde fences', () => {
    expect(pickFence('~~~~~~ no backticks here')).toBe('```');
  });
});

describe('wrap', () => {
  it('wraps plain content with 3-backtick fence and no language', () => {
    expect(wrap('hello')).toBe('```\nhello\n```');
  });

  it('wraps with a language tag', () => {
    expect(wrap('hello', 'js')).toBe('```js\nhello\n```');
  });

  it('trims trailing newlines from content before wrapping', () => {
    expect(wrap('hello\n\n')).toBe('```\nhello\n```');
  });

  it('preserves internal blank lines', () => {
    expect(wrap('a\n\nb')).toBe('```\na\n\nb\n```');
  });

  it('escalates the fence when content contains a triple-backtick run', () => {
    expect(wrap('a ``` b', 'md')).toBe('````md\na ``` b\n````');
  });

  it('uses 3-backtick fence with empty language', () => {
    expect(wrap('hello', '')).toBe('```\nhello\n```');
  });
});
