import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '../../providers/provider.js';
import type { MonthBucket } from '../state/months.js';
import { MonthDetailPage } from './MonthDetailPage.js';

function summary(id: string, title: string, createdISO: string): ConversationSummary {
  const createdAt = new Date(createdISO);
  return { id, title, createdAt, updatedAt: createdAt };
}

const BUCKET: MonthBucket = {
  key: '2026-04',
  label: 'April 2026',
  conversations: [
    summary('latest', 'Latest chat', '2026-04-28T00:00:00Z'),
    summary('mid', 'Middle chat', '2026-04-15T00:00:00Z'),
  ],
};

describe('MonthDetailPage', () => {
  it('renders the bucket label and conversation rows', () => {
    render(
      <MonthDetailPage
        bucket={BUCKET}
        loading={false}
        selectedIds={new Set()}
        onBack={vi.fn()}
        onToggle={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'April 2026' })).toBeTruthy();
    expect(screen.getByText('Latest chat')).toBeTruthy();
    expect(screen.getByText('Middle chat')).toBeTruthy();
  });

  it('calls onBack when the back button is clicked', () => {
    const onBack = vi.fn();
    render(
      <MonthDetailPage
        bucket={BUCKET}
        loading={false}
        selectedIds={new Set()}
        onBack={onBack}
        onToggle={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /back to all months/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('calls onToggle with the conversation id when a checkbox is clicked', () => {
    const onToggle = vi.fn();
    render(
      <MonthDetailPage
        bucket={BUCKET}
        loading={false}
        selectedIds={new Set()}
        onBack={vi.fn()}
        onToggle={onToggle}
        onExport={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Select Middle chat'));
    expect(onToggle).toHaveBeenCalledWith('mid');
  });

  it('reflects checked state from selectedIds', () => {
    render(
      <MonthDetailPage
        bucket={BUCKET}
        loading={false}
        selectedIds={new Set(['latest'])}
        onBack={vi.fn()}
        onToggle={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('Select Latest chat') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Select Middle chat') as HTMLInputElement).checked).toBe(false);
  });

  it('shows a header spinner while loading and hides it once done', () => {
    const { rerender } = render(
      <MonthDetailPage
        bucket={BUCKET}
        loading={true}
        selectedIds={new Set()}
        onBack={vi.fn()}
        onToggle={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading more conversations')).toBeTruthy();

    rerender(
      <MonthDetailPage
        bucket={BUCKET}
        loading={false}
        selectedIds={new Set()}
        onBack={vi.fn()}
        onToggle={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    expect(screen.queryByText('Loading more conversations')).toBeNull();
  });
});
