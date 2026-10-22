import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NoticeBar } from './NoticeBar';

describe('NoticeBar', () => {
  it('announces an error to assistive technology', () => {
    render(
      <NoticeBar
        notice={{ id: 1, kind: 'error', message: '"a.md" could not be found.' }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('"a.md" could not be found.');
  });

  it('shows information politely', () => {
    render(
      <NoticeBar notice={{ id: 1, kind: 'info', message: 'Link copied.' }} onDismiss={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Link copied.');
  });

  it('can be dismissed', async () => {
    const onDismiss = vi.fn();
    render(<NoticeBar notice={{ id: 1, kind: 'error', message: 'Oops' }} onDismiss={onDismiss} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows nothing when there is no notice', () => {
    const { container } = render(<NoticeBar notice={undefined} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
