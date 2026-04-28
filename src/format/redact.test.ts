import { describe, expect, it } from 'vitest';
import { redact } from './redact.js';

describe('redact (default patterns)', () => {
  it('replaces an OpenAI-style key', () => {
    const input = 'My key is sk-abcdefghijklmnopqrstuvwxyz0123456789 right?';
    expect(redact(input)).toBe('My key is <redacted> right?');
  });

  it('replaces a Slack bot token', () => {
    const input = 'token=xoxb-1234567890-abcdefghij-ABCDEFGHIJabcdefghij1234';
    expect(redact(input)).toBe('token=<redacted>');
  });

  it('replaces a GitHub personal access token', () => {
    const input = 'use ghp_abcdefghijklmnopqrstuvwxyz0123456789 in CI';
    expect(redact(input)).toBe('use <redacted> in CI');
  });

  it('replaces an AWS access key ID', () => {
    const input = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
    expect(redact(input)).toBe('AWS_ACCESS_KEY_ID=<redacted>');
  });

  it('replaces a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redact(`Bearer ${jwt}`)).toBe('Bearer <redacted>');
  });

  it('passes through content with no matches unchanged', () => {
    const input = 'just a regular sentence with no secrets';
    expect(redact(input)).toBe(input);
  });

  it('replaces multiple matches in one string', () => {
    const input = 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa and sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect(redact(input)).toBe('<redacted> and <redacted>');
  });
});

describe('redact (custom patterns)', () => {
  it('merges extra patterns with the defaults', () => {
    const input = 'INTERNAL-TOKEN-XYZ123 and sk-abcdefghijklmnopqrstuvwxyz';
    const out = redact(input, { extra: [/INTERNAL-TOKEN-[A-Z0-9]+/g] });
    expect(out).toBe('<redacted> and <redacted>');
  });

  it('replaces defaults entirely when replaceDefaults is set', () => {
    const input = 'sk-abcdefghijklmnopqrstuvwxyz0123 and PROJECT-42';
    const out = redact(input, {
      extra: [/PROJECT-\d+/g],
      replaceDefaults: true,
    });
    // OpenAI default no longer applied
    expect(out).toBe('sk-abcdefghijklmnopqrstuvwxyz0123 and <redacted>');
  });

  it('promotes a non-global pattern to global so all matches are replaced', () => {
    const input = 'foo-1 foo-2 foo-3';
    const out = redact(input, {
      extra: [/foo-\d/], // not global
      replaceDefaults: true,
    });
    expect(out).toBe('<redacted> <redacted> <redacted>');
  });
});
