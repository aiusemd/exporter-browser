import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthPromptPage } from './AuthPromptPage.js';

interface ChromeTabsStub {
  tabs: { create: (info: { url: string }) => void };
}

function setChromeStub(stub: ChromeTabsStub | undefined): void {
  (globalThis as unknown as { chrome: ChromeTabsStub | undefined }).chrome = stub;
}

describe('AuthPromptPage', () => {
  afterEach(() => {
    setChromeStub(undefined);
    vi.restoreAllMocks();
  });

  it('opens chatgpt.com in a new tab when the button is clicked', () => {
    const create = vi.fn();
    setChromeStub({ tabs: { create } });

    render(<AuthPromptPage />);
    const button = screen.getByRole('button', { name: /Open chatgpt\.com/ });
    fireEvent.click(button);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ url: 'https://chatgpt.com' });
  });

  it('shows the login instructions copy', () => {
    setChromeStub({ tabs: { create: vi.fn() } });
    render(<AuthPromptPage />);
    expect(screen.getByText(/Log in to ChatGPT to continue/)).toBeTruthy();
    expect(screen.getByText(/AIUSE needs you to be logged into chatgpt\.com/)).toBeTruthy();
  });
});
