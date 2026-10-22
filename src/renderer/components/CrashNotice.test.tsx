import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CrashNotice } from './CrashNotice';

describe('CrashNotice', () => {
  it('explains what happened and what to do', () => {
    render(<CrashNotice onReload={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/ran into a problem/i);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('starts over when the button is pressed', async () => {
    const onReload = vi.fn();
    render(<CrashNotice onReload={onReload} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));

    expect(onReload).toHaveBeenCalledOnce();
  });
});
