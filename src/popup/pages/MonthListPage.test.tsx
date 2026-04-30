import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '../../providers/provider.js';
import type { MonthBucket } from '../state/months.js';
import { MonthListPage } from './MonthListPage.js';

function summary(id: string, createdISO: string): ConversationSummary {
  const createdAt = new Date(createdISO);
  return { id, title: id, createdAt, updatedAt: createdAt };
}

function bucket(key: string, label: string, conversations: ConversationSummary[]): MonthBucket {
  return { key, label, conversations };
}

const BUCKETS: MonthBucket[] = [
  bucket('2026-04', 'April 2026', [
    summary('a1', '2026-04-28T00:00:00Z'),
    summary('a2', '2026-04-15T00:00:00Z'),
  ]),
  bucket('2026-03', 'March 2026', []),
  bucket('2026-02', 'February 2026', [summary('b1', '2026-02-10T00:00:00Z')]),
];

describe('MonthListPage', () => {
  it('renders each bucket with its label and total-count badge', () => {
    render(
      <MonthListPage
        buckets={BUCKETS}
        loading={false}
        selectedIds={new Set()}
        onOpenMonth={vi.fn()}
        onExport={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText('April 2026')).toBeTruthy();
    expect(screen.getByText('March 2026')).toBeTruthy();
    expect(screen.getByText('February 2026')).toBeTruthy();
    // April: 2, February: 1; March has no badge (empty).
    expect(screen.getByLabelText('2 total')).toBeTruthy();
    expect(screen.getByLabelText('1 total')).toBeTruthy();
  });

  it('disables empty months and exposes a no-conversations aria label', () => {
    render(
      <MonthListPage
        buckets={BUCKETS}
        loading={false}
        selectedIds={new Set()}
        onOpenMonth={vi.fn()}
        onExport={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const empty = screen.getByRole('button', { name: 'March 2026 (no conversations)' });
    expect((empty as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onOpenMonth when a populated row is clicked', () => {
    const onOpenMonth = vi.fn();
    render(
      <MonthListPage
        buckets={BUCKETS}
        loading={false}
        selectedIds={new Set()}
        onOpenMonth={onOpenMonth}
        onExport={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open April 2026/ }));
    expect(onOpenMonth).toHaveBeenCalledWith('2026-04');
  });

  it('does NOT call onOpenMonth when an empty (greyed) row is clicked', () => {
    const onOpenMonth = vi.fn();
    render(
      <MonthListPage
        buckets={BUCKETS}
        loading={false}
        selectedIds={new Set()}
        onOpenMonth={onOpenMonth}
        onExport={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'March 2026 (no conversations)' }));
    expect(onOpenMonth).not.toHaveBeenCalled();
  });

  it('shows a per-month accent badge with the count selected in that month', () => {
    render(
      <MonthListPage
        buckets={BUCKETS}
        loading={false}
        selectedIds={new Set(['a1'])}
        onOpenMonth={vi.fn()}
        onExport={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('1 selected in April 2026')).toBeTruthy();
    // February has no selections — no accent badge for that row.
    expect(screen.queryByLabelText(/selected in February 2026/)).toBeNull();
  });

  it('renders the footer total-selected badge and Export button only when ≥1 selected', () => {
    const { rerender } = render(
      <MonthListPage
        buckets={BUCKETS}
        loading={false}
        selectedIds={new Set()}
        onOpenMonth={vi.fn()}
        onExport={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: /Export/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <MonthListPage
        buckets={BUCKETS}
        loading={false}
        selectedIds={new Set(['a1', 'b1'])}
        onOpenMonth={vi.fn()}
        onExport={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: 'Export 2' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByLabelText('2 selected')).toBeTruthy();
  });

  it('shows a header spinner while loading and hides it once done', () => {
    const { rerender } = render(
      <MonthListPage
        buckets={BUCKETS}
        loading={true}
        selectedIds={new Set()}
        onOpenMonth={vi.fn()}
        onExport={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    // Spinner has role=status with sr-only "Loading more conversations" text.
    expect(screen.getByText('Loading more conversations')).toBeTruthy();

    rerender(
      <MonthListPage
        buckets={BUCKETS}
        loading={false}
        selectedIds={new Set()}
        onOpenMonth={vi.fn()}
        onExport={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByText('Loading more conversations')).toBeNull();
  });

  it('calls onBack when the "Providers" header button is clicked', () => {
    const onBack = vi.fn();
    render(
      <MonthListPage
        buckets={BUCKETS}
        loading={false}
        selectedIds={new Set()}
        onOpenMonth={vi.fn()}
        onExport={vi.fn()}
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to provider select' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
