import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '../../providers/provider.js';
import { ConversationListPage } from './ConversationListPage.js';

const SUMMARIES: ConversationSummary[] = [
  {
    id: 'first',
    title: 'First conversation',
    createdAt: new Date('2026-04-20T00:00:00Z'),
    updatedAt: new Date('2026-04-28T00:00:00Z'),
  },
  {
    id: 'second',
    title: 'Second conversation',
    createdAt: new Date('2026-04-10T00:00:00Z'),
    updatedAt: new Date('2026-04-22T00:00:00Z'),
  },
];

describe('ConversationListPage', () => {
  it('renders all summaries with a header count when stream is done', () => {
    render(
      <ConversationListPage summaries={SUMMARIES} streamDone={true} onLogFirstSelected={vi.fn()} />,
    );
    expect(screen.getByText('Conversations (2)')).toBeTruthy();
    expect(screen.getByText('First conversation')).toBeTruthy();
    expect(screen.getByText('Second conversation')).toBeTruthy();
  });

  it('shows a "Loading more…" indicator and a + on the count while the stream is open', () => {
    render(
      <ConversationListPage
        summaries={SUMMARIES}
        streamDone={false}
        onLogFirstSelected={vi.fn()}
      />,
    );
    expect(screen.getByText(/Conversations \(2\+\)/)).toBeTruthy();
    expect(screen.getByText('Loading more conversations…')).toBeTruthy();
  });

  it('updates the selected count when a checkbox is toggled', () => {
    render(
      <ConversationListPage summaries={SUMMARIES} streamDone={true} onLogFirstSelected={vi.fn()} />,
    );
    expect(screen.getByText('Selected: 0')).toBeTruthy();

    const firstCheckbox = screen.getByLabelText('Select First conversation');
    fireEvent.click(firstCheckbox);

    expect(screen.getByText('Selected: 1')).toBeTruthy();
  });

  it('disables the action button until at least one row is selected', () => {
    render(
      <ConversationListPage summaries={SUMMARIES} streamDone={true} onLogFirstSelected={vi.fn()} />,
    );
    const button = screen.getByRole('button', { name: /Log first selected/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Select Second conversation'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('invokes onLogFirstSelected with the first selected id (in display order)', () => {
    const onLog = vi.fn();
    render(
      <ConversationListPage summaries={SUMMARIES} streamDone={true} onLogFirstSelected={onLog} />,
    );

    // Toggle second first, then first — display order should still win.
    fireEvent.click(screen.getByLabelText('Select Second conversation'));
    fireEvent.click(screen.getByLabelText('Select First conversation'));

    fireEvent.click(screen.getByRole('button', { name: /Log first selected/ }));

    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith('first');
  });

  it('renders a row with an Invalid Date without throwing', () => {
    const summariesWithBadDate: ConversationSummary[] = [
      {
        id: 'invalid',
        title: 'Conversation with invalid update_time',
        createdAt: new Date('2026-04-20T00:00:00Z'),
        updatedAt: new Date(Number.NaN),
      },
    ];

    expect(() =>
      render(
        <ConversationListPage
          summaries={summariesWithBadDate}
          streamDone={true}
          onLogFirstSelected={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText('Conversation with invalid update_time')).toBeTruthy();
  });
});
