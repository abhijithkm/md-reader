import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabUnavailable } from './TabUnavailable';

function renderUnavailable() {
  const props = {
    name: 'notes.md',
    message: '"notes.md" could not be found. It may have been moved, renamed or deleted.',
    onRetry: vi.fn(),
    onClose: vi.fn(),
  };
  render(<TabUnavailable {...props} />);
  return { props, user: userEvent.setup() };
}

describe('TabUnavailable', () => {
  it('names the file the tab was for and says why it cannot be shown', () => {
    const { props } = renderUnavailable();

    expect(screen.getByRole('heading', { level: 1, name: 'notes.md' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(props.message);
  });

  it('lets the reader try again', async () => {
    const { props, user } = renderUnavailable();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('lets the reader close the tab', async () => {
    const { props, user } = renderUnavailable();

    await user.click(screen.getByRole('button', { name: 'Close tab' }));

    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onRetry).not.toHaveBeenCalled();
  });

  it('is set like the start page', () => {
    const { container } = render(
      <TabUnavailable name="a.md" message="gone" onRetry={vi.fn()} onClose={vi.fn()} />,
    );

    expect(container.querySelector('.empty-page')).toHaveClass('markdown-body');
  });
});
