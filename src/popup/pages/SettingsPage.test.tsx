import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage.js';

interface ChromeStorageStub {
  storage: {
    sync: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  };
}

function installStorage(): ChromeStorageStub {
  const data: Record<string, unknown> = {};
  const stub: ChromeStorageStub = {
    storage: {
      sync: {
        get: vi.fn(async (key: string) => ({ [key]: data[key] })),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          Object.assign(data, entries);
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: ChromeStorageStub }).chrome = stub;
  return stub;
}

describe('SettingsPage', () => {
  let storage: ChromeStorageStub;

  beforeEach(() => {
    storage = installStorage();
  });

  afterEach(() => {
    (globalThis as unknown as { chrome: undefined }).chrome = undefined;
    vi.restoreAllMocks();
  });

  it('hydrates inputs from the initial settings', () => {
    render(
      <SettingsPage
        initial={{ truncateLimit: 8000, extraRedactPatterns: ['secret-\\d+'] }}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(/Per-message character limit/) as HTMLInputElement).value).toBe(
      '8000',
    );
    expect((screen.getByLabelText(/Extra redact patterns/) as HTMLTextAreaElement).value).toBe(
      'secret-\\d+',
    );
  });

  it('persists valid input via chrome.storage.sync and calls onClose with the saved shape', async () => {
    const onClose = vi.fn();
    render(<SettingsPage initial={{}} onClose={onClose} />);

    fireEvent.input(screen.getByLabelText(/Per-message character limit/), {
      target: { value: '12000' },
    });
    fireEvent.input(screen.getByLabelText(/Extra redact patterns/), {
      target: { value: 'foo-\\d+\nbar-[a-z]+' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalledWith({
      truncateLimit: 12000,
      extraRedactPatterns: ['foo-\\d+', 'bar-[a-z]+'],
    });
    expect(storage.storage.sync.set).toHaveBeenCalledWith({
      'aiuse:settings': {
        truncateLimit: 12000,
        extraRedactPatterns: ['foo-\\d+', 'bar-[a-z]+'],
      },
    });
  });

  it('rejects out-of-range truncate limit and surfaces an error without persisting', () => {
    const onClose = vi.fn();
    render(<SettingsPage initial={{}} onClose={onClose} />);

    fireEvent.input(screen.getByLabelText(/Per-message character limit/), {
      target: { value: '5' }, // below MIN
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/Per-message limit must be between/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(storage.storage.sync.set).not.toHaveBeenCalled();
  });

  it('rejects malformed regex with a line-numbered error', () => {
    const onClose = vi.fn();
    render(<SettingsPage initial={{}} onClose={onClose} />);

    fireEvent.input(screen.getByLabelText(/Extra redact patterns/), {
      target: { value: 'valid-\\d+\n[' }, // line 2 unclosed bracket
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/Pattern on line 2 is invalid/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel returns the initial settings without writing', () => {
    const onClose = vi.fn();
    render(<SettingsPage initial={{ truncateLimit: 9000 }} onClose={onClose} />);

    fireEvent.input(screen.getByLabelText(/Per-message character limit/), {
      target: { value: '12345' }, // user typed but didn't save
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith({ truncateLimit: 9000 });
    expect(storage.storage.sync.set).not.toHaveBeenCalled();
  });

  it('saving with both fields blank persists empty settings (use defaults)', async () => {
    const onClose = vi.fn();
    render(<SettingsPage initial={{}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith({});
    });
  });
});
