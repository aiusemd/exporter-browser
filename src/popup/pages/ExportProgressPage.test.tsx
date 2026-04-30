import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ExportProgressPage } from './ExportProgressPage.js';

describe('ExportProgressPage', () => {
  it('shows progress count and current title while running', () => {
    render(
      <ExportProgressPage
        phase={{ kind: 'running', done: 3, total: 10, currentTitle: 'Vacation chat' }}
        onCancel={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/Packaging 3 of 10 conversations/)).toBeTruthy();
    expect(screen.getByText('Vacation chat')).toBeTruthy();
    expect(screen.getByText('Packaging conversations')).toBeTruthy(); // sr-only spinner label
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('singular "conversation" when total is 1', () => {
    render(
      <ExportProgressPage
        phase={{ kind: 'running', done: 0, total: 1 }}
        onCancel={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/Packaging 0 of 1 conversation\b/)).toBeTruthy();
  });

  it('clicking Cancel during running invokes onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ExportProgressPage
        phase={{ kind: 'running', done: 1, total: 2 }}
        onCancel={onCancel}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the saved filename and a Done button on complete', () => {
    const onDismiss = vi.fn();
    render(
      <ExportProgressPage
        phase={{ kind: 'complete', filename: 'aiuse-2026-04-30-000000.zip', failedIds: [] }}
        onCancel={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('Export complete')).toBeTruthy();
    expect(screen.getByText(/aiuse-2026-04-30-000000\.zip/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('reports failed-conversation count when partial', () => {
    render(
      <ExportProgressPage
        phase={{
          kind: 'complete',
          filename: 'aiuse.zip',
          failedIds: ['a', 'b'],
        }}
        onCancel={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 conversations could not be packaged/)).toBeTruthy();
  });

  it('shows the message and a Done button on error', () => {
    const onDismiss = vi.fn();
    render(
      <ExportProgressPage
        phase={{ kind: 'error', message: 'boom' }}
        onCancel={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('Export failed')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
