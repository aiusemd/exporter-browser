import type { ConversationSummary } from '../../providers/provider.js';

export interface MonthBucket {
  /** Stable key — `YYYY-MM` (UTC of the conversation's createdAt). */
  key: string;
  /** Display label — same `YYYY-MM` form as the key, exposed as a separate field
   *  so callers can render without poking at the structural id. */
  label: string;
  /** Conversations created in this month, sorted createdAt desc. Empty for greyed-out months. */
  conversations: ConversationSummary[];
}

/**
 * Group conversation summaries into month buckets sorted most-recent first.
 *
 * The first bucket is the most recent month that has at least one
 * conversation (so users with no activity in the current month don't see
 * leading empty rows). The last bucket is the oldest month with at least
 * one conversation. Months in between with no conversations are still
 * emitted as empty buckets — they render greyed out as a visual cue that
 * the user just didn't chat that month.
 *
 * Returns `[]` for zero summaries; the caller renders an empty state.
 */
export function groupByMonth(summaries: ConversationSummary[]): MonthBucket[] {
  if (summaries.length === 0) return [];

  const byKey = new Map<string, ConversationSummary[]>();
  for (const s of summaries) {
    // Defensive against Invalid Date sneaking past the SW boundary —
    // an unparseable date would otherwise produce a `NaN-NaN` key and
    // silently corrupt the month-range walk.
    if (Number.isNaN(s.createdAt.getTime())) continue;
    const key = monthKey(s.createdAt);
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [s]);
    else list.push(s);
  }

  const populated = [...byKey.keys()].sort();
  const oldest = populated[0];
  const newest = populated[populated.length - 1];
  if (oldest === undefined || newest === undefined) return [];

  const buckets: MonthBucket[] = [];
  for (const key of monthRange(newest, oldest)) {
    const conversations = (byKey.get(key) ?? []).slice().sort(byCreatedAtDesc);
    buckets.push({ key, label: key, conversations });
  }
  return buckets;
}

function monthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Iterate YYYY-MM keys from `from` (inclusive) backwards to `to` (inclusive). */
function* monthRange(from: string, to: string): Generator<string> {
  const [fy, fm] = parseKey(from);
  const [ty, tm] = parseKey(to);
  let y = fy;
  let m = fm;
  while (y > ty || (y === ty && m >= tm)) {
    yield formatKey(y, m);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
}

function parseKey(key: string): [number, number] {
  const [yStr, mStr] = key.split('-');
  return [Number(yStr), Number(mStr)];
}

function formatKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function byCreatedAtDesc(a: ConversationSummary, b: ConversationSummary): number {
  return b.createdAt.getTime() - a.createdAt.getTime();
}
