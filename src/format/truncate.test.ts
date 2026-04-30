import { describe, expect, it } from 'vitest';
import { truncate } from './truncate.js';

describe('truncate', () => {
  it('returns content unchanged when within the limit', () => {
    const content = 'short content';
    expect(truncate(content, 4000)).toBe(content);
  });

  it('returns content unchanged at exactly the limit', () => {
    const content = 'a'.repeat(4000);
    expect(truncate(content, 4000)).toBe(content);
  });

  it('cuts at the limit and appends <truncated> for plain prose', () => {
    const content = 'a'.repeat(4500);
    const out = truncate(content, 4000);
    expect(out).toBe(`${'a'.repeat(4000)}<truncated>`);
  });

  it('walks back above the opening fence when the cut lands inside a code block', () => {
    const prose = 'intro line';
    // Build content where a code block opens before the limit and the limit
    // falls inside the block.
    const content = `${prose}\n\`\`\`js\n${'b'.repeat(4500)}\n\`\`\`\n`;
    const out = truncate(content, 4000);
    expect(out).toBe(`${prose}<truncated>`);
  });

  it('does not walk back when the cut lands outside any fence', () => {
    // A closed fence appears before the limit; the cut lands after.
    const block = '```js\nlet x = 1;\n```\n';
    const tail = 'a'.repeat(5000);
    const content = `${block}${tail}`;
    const out = truncate(content, 4000);
    // Should not lose the closed fence — cut inside the tail prose
    expect(out.startsWith('```js')).toBe(true);
    expect(out.endsWith('<truncated>')).toBe(true);
    expect(out.length).toBe(4000 + '<truncated>'.length);
  });

  it('uses the default limit of 4000 when none is provided', () => {
    const content = 'x'.repeat(5000);
    const out = truncate(content);
    expect(out).toBe(`${'x'.repeat(4000)}<truncated>`);
  });

  it('strips trailing whitespace before appending the marker', () => {
    const content = `${'word '.repeat(900)}${'y'.repeat(500)}`;
    const out = truncate(content, 4000);
    // The cut ends inside the y's, no trailing whitespace expected
    expect(out.endsWith('<truncated>')).toBe(true);
    expect(out).not.toMatch(/\s+<truncated>$/);
  });

  it('walks back to the most recent open fence, not earlier closed fences', () => {
    // A closed code block appears before the limit; a second code block opens
    // and the limit falls inside it. The cut should walk back only to the
    // start of the second (still-open) fence, preserving the closed block.
    const closed = '```text\nclosed block\n```';
    const middle = 'middle prose';
    const opener = '```js';
    const longCode = 'x'.repeat(4500);
    const content = `intro\n${closed}\n${middle}\n${opener}\n${longCode}\n\`\`\`\n`;
    const out = truncate(content, 4000);
    expect(out).toBe(`intro\n${closed}\n${middle}<truncated>`);
  });

  it('passes through content that already contains <truncated> when under limit', () => {
    const content = 'preamble<truncated>';
    expect(truncate(content, 4000)).toBe(content);
  });
});
