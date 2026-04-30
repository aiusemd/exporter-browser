import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '../../providers/provider.js';
import { groupByMonth } from './months.js';

function summary(id: string, createdISO: string): ConversationSummary {
  const createdAt = new Date(createdISO);
  return { id, title: id, createdAt, updatedAt: createdAt };
}

describe('groupByMonth', () => {
  it('returns an empty array for zero summaries', () => {
    expect(groupByMonth([])).toEqual([]);
  });

  it('groups a single conversation into one bucket', () => {
    const buckets = groupByMonth([summary('a', '2026-04-15T00:00:00Z')]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.key).toBe('2026-04');
    expect(buckets[0]?.label).toBe('April 2026');
    expect(buckets[0]?.conversations).toHaveLength(1);
  });

  it('orders buckets most recent first', () => {
    const buckets = groupByMonth([
      summary('old', '2024-01-15T00:00:00Z'),
      summary('mid', '2025-06-20T00:00:00Z'),
      summary('new', '2026-04-01T00:00:00Z'),
    ]);
    const keys = buckets.map((b) => b.key);
    // Includes empty months between, so check first/last + populated ones.
    expect(keys[0]).toBe('2026-04');
    expect(keys[keys.length - 1]).toBe('2024-01');
    expect(keys.includes('2025-06')).toBe(true);
  });

  it('emits empty buckets for months between with no conversations', () => {
    const buckets = groupByMonth([
      summary('a', '2026-03-15T00:00:00Z'),
      summary('b', '2026-01-01T00:00:00Z'),
    ]);
    expect(buckets.map((b) => b.key)).toEqual(['2026-03', '2026-02', '2026-01']);
    expect(buckets[0]?.conversations).toHaveLength(1); // 2026-03
    expect(buckets[1]?.conversations).toHaveLength(0); // 2026-02 (empty)
    expect(buckets[2]?.conversations).toHaveLength(1); // 2026-01
  });

  it('does NOT prepend empty months newer than the most recent populated month', () => {
    // Even if "today" is far ahead (e.g. 2027-01), the list starts at 2026-04.
    const buckets = groupByMonth([summary('a', '2026-04-15T00:00:00Z')]);
    expect(buckets[0]?.key).toBe('2026-04');
  });

  it('sorts conversations within a month by createdAt descending', () => {
    const buckets = groupByMonth([
      summary('first', '2026-04-01T00:00:00Z'),
      summary('latest', '2026-04-28T00:00:00Z'),
      summary('middle', '2026-04-15T00:00:00Z'),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.conversations.map((c) => c.id)).toEqual(['latest', 'middle', 'first']);
  });

  it('crosses year boundaries correctly', () => {
    const buckets = groupByMonth([
      summary('a', '2026-02-01T00:00:00Z'),
      summary('b', '2025-11-01T00:00:00Z'),
    ]);
    expect(buckets.map((b) => b.key)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });

  it('uses UTC, not local time, for month assignment', () => {
    // 2026-04-30T23:30Z is 2026-04 in UTC even when local clocks read 2026-05.
    const buckets = groupByMonth([summary('edge', '2026-04-30T23:30:00Z')]);
    expect(buckets[0]?.key).toBe('2026-04');
  });

  it('skips conversations with Invalid Date createdAt rather than corrupting the range', () => {
    const valid = summary('valid', '2026-04-15T00:00:00Z');
    const invalid: ConversationSummary = {
      id: 'invalid',
      title: 'invalid',
      createdAt: new Date(Number.NaN),
      updatedAt: new Date(Number.NaN),
    };
    const buckets = groupByMonth([valid, invalid]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.key).toBe('2026-04');
    expect(buckets[0]?.conversations.map((c) => c.id)).toEqual(['valid']);
  });
});
