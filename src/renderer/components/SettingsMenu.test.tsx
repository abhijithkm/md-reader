import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsMenu } from './SettingsMenu';

function renderMenu(restoreTabs: boolean) {
  const onSetRestoreTabs = vi.fn();
  render(<SettingsMenu restoreTabs={restoreTabs} onSetRestoreTabs={onSetRestoreTabs} />);
  return { onSetRestoreTabs, user: userEvent.setup() };
}

// The menu is a popover that is closed until the gear opens it, and a closed popover is out of reach
// of assistive technology, in jsdom as in a browser. The tests ask for it all the same.
const optionSwitch = (): HTMLElement => screen.getByRole('switch', { hidden: true });

describe('SettingsMenu', () => {
  it('has a gear that opens the menu, as a native popover', () => {
    renderMenu(true);

    const gear = screen.getByRole('button', { name: 'Settings' });
    const menu = document.getElementById(gear.getAttribute('popovertarget') ?? '');

    expect(menu).not.toBeNull();
    expect(menu).toHaveAttribute('popover');
    expect(menu).toHaveAttribute('aria-label', 'Settings');
  });

  it('offers to reopen the tabs, and says what that remembers', () => {
    renderMenu(true);
    const option = optionSwitch();

    expect(document.getElementById(option.getAttribute('aria-labelledby') ?? '')).toHaveTextContent(
      'Reopen tabs when MD Reader starts',
    );
    expect(
      document.getElementById(option.getAttribute('aria-describedby') ?? ''),
    ).toHaveTextContent('Remembers which files are open, in a small file on this computer.');
  });

  it('shows whether the tabs are reopened', () => {
    const { unmount } = render(<SettingsMenu restoreTabs onSetRestoreTabs={vi.fn()} />);
    expect(optionSwitch()).toBeChecked();
    unmount();

    render(<SettingsMenu restoreTabs={false} onSetRestoreTabs={vi.fn()} />);
    expect(optionSwitch()).not.toBeChecked();
  });

  it('switches reopening off when it is on', async () => {
    const { onSetRestoreTabs, user } = renderMenu(true);

    await user.click(optionSwitch());

    expect(onSetRestoreTabs).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('switches reopening on when it is off', async () => {
    const { onSetRestoreTabs, user } = renderMenu(false);

    await user.click(optionSwitch());

    expect(onSetRestoreTabs).toHaveBeenCalledExactlyOnceWith(true);
  });
});
