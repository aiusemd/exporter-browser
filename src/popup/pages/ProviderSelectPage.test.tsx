import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderSelectPage } from './ProviderSelectPage.js';

interface ChromeTabsStub {
  tabs: { create: (info: { url: string }) => void };
}

function setChromeStub(stub: ChromeTabsStub | undefined): void {
  (globalThis as unknown as { chrome: ChromeTabsStub | undefined }).chrome = stub;
}

describe('ProviderSelectPage', () => {
  afterEach(() => {
    setChromeStub(undefined);
    vi.restoreAllMocks();
  });

  it('calls onSelect with chatgpt when the ChatGPT card is clicked while authenticated', () => {
    setChromeStub({ tabs: { create: vi.fn() } });
    const onSelect = vi.fn();
    render(<ProviderSelectPage sessionAuthenticated={true} onSelect={onSelect} />);

    const card = screen.getByRole('button', { name: /ChatGPT/ });
    fireEvent.click(card);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('chatgpt');
  });

  it('opens chatgpt.com in a new tab and does NOT call onSelect when not authenticated', () => {
    const create = vi.fn();
    setChromeStub({ tabs: { create } });
    const onSelect = vi.fn();
    render(<ProviderSelectPage sessionAuthenticated={false} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /ChatGPT/ }));

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ url: 'https://chatgpt.com' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('falls through to onSelect when the auth state is still unknown (null)', () => {
    setChromeStub({ tabs: { create: vi.fn() } });
    const onSelect = vi.fn();
    render(<ProviderSelectPage sessionAuthenticated={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /ChatGPT/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders Claude as disabled with "Coming soon" badge', () => {
    setChromeStub({ tabs: { create: vi.fn() } });
    render(<ProviderSelectPage sessionAuthenticated={null} onSelect={vi.fn()} />);

    expect(screen.getByText('Coming soon')).toBeTruthy();

    // Claude is rendered as a non-button div — there is no second button to click.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
  });

  it('shows an "Available" badge when authenticated', () => {
    setChromeStub({ tabs: { create: vi.fn() } });
    render(<ProviderSelectPage sessionAuthenticated={true} onSelect={vi.fn()} />);
    expect(screen.getByLabelText('Available')).toBeTruthy();
    expect(screen.queryByLabelText('Login needed')).toBeNull();
  });

  it('shows a "Login needed" badge when not authenticated', () => {
    setChromeStub({ tabs: { create: vi.fn() } });
    render(<ProviderSelectPage sessionAuthenticated={false} onSelect={vi.fn()} />);
    expect(screen.getByLabelText('Login needed')).toBeTruthy();
    expect(screen.queryByLabelText('Available')).toBeNull();
  });

  it('renders no status badge while the auth check is in flight (null)', () => {
    setChromeStub({ tabs: { create: vi.fn() } });
    render(<ProviderSelectPage sessionAuthenticated={null} onSelect={vi.fn()} />);
    expect(screen.queryByLabelText('Available')).toBeNull();
    expect(screen.queryByLabelText('Login needed')).toBeNull();
  });
});
