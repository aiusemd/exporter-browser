import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ProviderSelectPage } from './ProviderSelectPage.js';

describe('ProviderSelectPage', () => {
  it('calls onSelect with chatgpt when the ChatGPT card is clicked', () => {
    const onSelect = vi.fn();
    render(<ProviderSelectPage sessionAuthenticated={null} onSelect={onSelect} />);

    const card = screen.getByRole('button', { name: /ChatGPT/ });
    fireEvent.click(card);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('chatgpt');
  });

  it('renders Claude as disabled with "Coming soon" badge', () => {
    const onSelect = vi.fn();
    render(<ProviderSelectPage sessionAuthenticated={null} onSelect={onSelect} />);

    expect(screen.getByText('Coming soon')).toBeTruthy();

    // Claude is rendered as a non-button div — there is no second button to click.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);

    // Sanity: clicking the Claude row text doesn't invoke onSelect.
    const claudeNode = screen.getByText('Claude');
    fireEvent.click(claudeNode);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('reflects the session status via the status dot aria-label', () => {
    const { rerender } = render(
      <ProviderSelectPage sessionAuthenticated={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByLabelText('Status unknown')).toBeTruthy();

    rerender(<ProviderSelectPage sessionAuthenticated={true} onSelect={vi.fn()} />);
    expect(screen.getByLabelText('Logged in')).toBeTruthy();

    rerender(<ProviderSelectPage sessionAuthenticated={false} onSelect={vi.fn()} />);
    expect(screen.getByLabelText('Not logged in')).toBeTruthy();
  });
});
