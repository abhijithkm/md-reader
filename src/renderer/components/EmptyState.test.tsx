import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('tells the reader what to do', () => {
    render(<EmptyState onOpen={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Open a Markdown file' })).toBeInTheDocument();
    expect(screen.getByText(/drag a \.md or \.markdown file/i)).toBeInTheDocument();
  });

  it('opens a file from the button', async () => {
    const onOpen = vi.fn();
    render(<EmptyState onOpen={onOpen} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Open file' }));

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('explains how to make MD Reader the default app and opens the right settings page', async () => {
    const onOpenDefaultApps = vi.fn();
    render(<EmptyState onOpen={vi.fn()} onOpenDefaultApps={onOpenDefaultApps} />);

    expect(screen.getByText(/default app for Markdown/i)).toBeInTheDocument();
    expect(screen.getByText(/Apps/)).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Open Default apps settings' }));

    expect(onOpenDefaultApps).toHaveBeenCalledOnce();
  });

  it('does not offer the Windows settings button where it cannot work', () => {
    render(<EmptyState onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Open file' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Default apps settings' })).toBeNull();
  });

  it('shows the Updates section only when the app can update', () => {
    const { rerender } = render(<EmptyState onOpen={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Updates' })).toBeNull();

    rerender(
      <EmptyState
        onOpen={vi.fn()}
        updates={{
          state: { status: 'idle' },
          version: '1.1.0',
          installs: true,
          onCheck: vi.fn(),
          onSetEnabled: vi.fn(),
          onRestart: vi.fn(),
          onOpenPage: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument();
    expect(screen.getByText('Version 1.1.0')).toBeInTheDocument();
  });

  it('lists the main keyboard shortcuts', () => {
    render(<EmptyState onOpen={vi.fn()} />);
    expect(screen.getByText('Ctrl+O')).toBeInTheDocument();
    expect(screen.getByText('F5')).toBeInTheDocument();
  });

  // The start screen is set like a document: its headings carry the marks in the margin, and the
  // sections are named, so that a screen reader can move through it by heading.
  it('is laid out as a document, with the shortcuts under a heading of their own', () => {
    const { container } = render(<EmptyState onOpen={vi.fn()} onOpenDefaultApps={vi.fn()} />);

    expect(container.querySelector('.empty-page')).toHaveClass('markdown-body');
    expect(
      screen.getAllByRole('heading').map((heading) => [heading.tagName, heading.textContent]),
    ).toEqual([
      ['H1', 'Open a Markdown file'],
      ['H2', 'Keyboard'],
      ['H2', 'Make MD Reader the default app for Markdown'],
    ]);
    expect(screen.getByRole('region', { name: 'Keyboard' })).toContainElement(
      screen.getByText('Ctrl+O'),
    );
  });
});
