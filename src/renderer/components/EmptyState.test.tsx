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

  it('lists the main keyboard shortcuts', () => {
    render(<EmptyState onOpen={vi.fn()} />);
    expect(screen.getByText('Ctrl+O')).toBeInTheDocument();
    expect(screen.getByText('F5')).toBeInTheDocument();
  });
});
