import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../../shared/updates';
import { UpdatesPanel } from './UpdatesPanel';

type Shown = Exclude<UpdateState, { status: 'unavailable' }>;

const handlers = () => ({
  onCheck: vi.fn(),
  onSetEnabled: vi.fn(),
  onRestart: vi.fn(),
  onOpenPage: vi.fn(),
});

/** `version` is what the app reports (null: it has not answered yet); `installs` is false for the portable copy. */
function setup(state: Shown, options: { version?: string | null; installs?: boolean } = {}) {
  const { version = '1.1.0', installs = true } = options;
  const actions = handlers();
  const view = render(
    <UpdatesPanel state={state} version={version ?? undefined} installs={installs} {...actions} />,
  );
  return { ...actions, view, user: userEvent.setup() };
}

const buttons = (): string[] => screen.queryAllByRole('button').map((button) => button.textContent);

describe('UpdatesPanel', () => {
  it('names the version that is running', () => {
    setup({ status: 'idle' });

    expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument();
    expect(screen.getByText('Version 1.1.0')).toBeInTheDocument();
  });

  it('leaves the version out while it is not known', () => {
    setup({ status: 'idle' }, { version: null });

    expect(screen.queryByText(/^Version /)).toBeNull();
  });

  describe('what it says and offers in each state', () => {
    it.each<[string, Shown, string, string[]]>([
      ['off', { status: 'off' }, 'Automatic updates are off.', ['Turn on automatic updates']],
      [
        'idle',
        { status: 'idle' },
        'Automatic updates are on.',
        ['Check for updates', 'Turn off automatic updates'],
      ],
      [
        'checking',
        { status: 'checking' },
        'Checking for updates…',
        ['Check for updates', 'Turn off automatic updates'],
      ],
      [
        'current',
        { status: 'current' },
        'MD Reader 1.1.0 is up to date.',
        ['Check again', 'Turn off automatic updates'],
      ],
      [
        'downloading',
        { status: 'downloading', version: '1.2.0', percent: 42 },
        'Downloading MD Reader 1.2.0…',
        ['Check for updates', 'Turn off automatic updates'],
      ],
      [
        'ready',
        { status: 'ready', version: '1.2.0' },
        'MD Reader 1.2.0 is ready. It installs when you close the app.',
        ['Restart now', 'Turn off automatic updates'],
      ],
      [
        'available',
        {
          status: 'available',
          version: '1.2.0',
          releaseUrl: 'https://github.com/abhijithkm/md-reader/releases/tag/v1.2.0',
        },
        'MD Reader 1.2.0 is available.',
        ['Open download page', 'Turn off automatic updates'],
      ],
      [
        'error',
        { status: 'error' },
        'MD Reader could not check for or download an update. Try again later.',
        ['Check again', 'Turn off automatic updates'],
      ],
    ])('%s', (_label, state, text, offered) => {
      setup(state);

      expect(screen.getByText(text)).toBeInTheDocument();
      expect(buttons()).toEqual(offered);
    });

    it('says "up to date" without a version when it does not know one', () => {
      setup({ status: 'current' }, { version: null });

      expect(screen.getByText('MD Reader is up to date.')).toBeInTheDocument();
    });

    it('says checks rather than updates for a copy that only reports a newer version', () => {
      setup({ status: 'idle' }, { installs: false });

      expect(screen.getByText('Automatic update checks are on.')).toBeInTheDocument();
      expect(screen.queryByText('Automatic updates are on.')).toBeNull();
    });
  });

  describe('the buttons', () => {
    it('check for updates', async () => {
      const { user, onCheck } = setup({ status: 'idle' });
      await user.click(screen.getByRole('button', { name: 'Check for updates' }));
      expect(onCheck).toHaveBeenCalledOnce();
    });

    it.each<[string, Shown]>([
      ['a check is running', { status: 'checking' }],
      ['a download is running', { status: 'downloading', version: '1.2.0', percent: 5 }],
    ])(
      'do not check again while %s, but still let the reader turn updates off',
      async (_label, state) => {
        const { user, onCheck, onSetEnabled } = setup(state);
        const check = screen.getByRole('button', { name: 'Check for updates' });

        expect(check).toHaveAttribute('aria-disabled', 'true');
        await user.click(check);
        expect(onCheck).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Turn off automatic updates' }));
        expect(onSetEnabled).toHaveBeenCalledExactlyOnceWith(false);
      },
    );

    it('turn automatic updates off and on', async () => {
      const off = setup({ status: 'idle' });
      await off.user.click(screen.getByRole('button', { name: 'Turn off automatic updates' }));
      expect(off.onSetEnabled).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('turn automatic updates back on', async () => {
      const { user, onSetEnabled } = setup({ status: 'off' });
      await user.click(screen.getByRole('button', { name: 'Turn on automatic updates' }));
      expect(onSetEnabled).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('restart into a downloaded update', async () => {
      const { user, onRestart } = setup({ status: 'ready', version: '1.2.0' });
      await user.click(screen.getByRole('button', { name: 'Restart now' }));
      expect(onRestart).toHaveBeenCalledOnce();
    });

    it('open the download page of a version this copy cannot install itself', async () => {
      const { user, onOpenPage } = setup({
        status: 'available',
        version: '1.2.0',
        releaseUrl: 'https://github.com/abhijithkm/md-reader/releases/tag/v1.2.0',
      });
      await user.click(screen.getByRole('button', { name: 'Open download page' }));
      expect(onOpenPage).toHaveBeenCalledExactlyOnceWith(
        'https://github.com/abhijithkm/md-reader/releases/tag/v1.2.0',
      );
    });
  });

  describe('for a reader who uses the keyboard', () => {
    it('keeps focus on the check button through a check, a download and the result', () => {
      const actions = handlers();
      const view = render(
        <UpdatesPanel state={{ status: 'idle' }} version="1.1.0" installs {...actions} />,
      );
      const button = screen.getByRole('button', { name: 'Check for updates' });
      button.focus();

      for (const next of [
        { status: 'checking' },
        { status: 'downloading', version: '1.2.0', percent: 3 },
        { status: 'error' },
        { status: 'current' },
      ] satisfies Shown[]) {
        view.rerender(<UpdatesPanel state={next} version="1.1.0" installs {...actions} />);
        expect(document.activeElement, next.status).toBe(button);
        expect(button.isConnected, next.status).toBe(true);
      }
    });

    it('keeps focus on the on/off button when updating is switched off or on, although its words change', () => {
      const actions = handlers();
      const view = render(
        <UpdatesPanel state={{ status: 'idle' }} version="1.1.0" installs {...actions} />,
      );
      const button = screen.getByRole('button', { name: 'Turn off automatic updates' });
      button.focus();

      view.rerender(
        <UpdatesPanel state={{ status: 'off' }} version="1.1.0" installs {...actions} />,
      );
      expect(button).toHaveTextContent('Turn on automatic updates');
      expect(document.activeElement).toBe(button);

      view.rerender(
        <UpdatesPanel state={{ status: 'idle' }} version="1.1.0" installs {...actions} />,
      );
      expect(button).toHaveTextContent('Turn off automatic updates');
      expect(document.activeElement).toBe(button);
    });

    it('announces a change of state politely, without taking focus', () => {
      setup({ status: 'checking' });

      expect(screen.getByText('Checking for updates…')).toHaveAttribute('aria-live', 'polite');
      expect(document.body).toHaveFocus();
    });

    it('shows the progress of a download without announcing every step of it', () => {
      setup({ status: 'downloading', version: '1.2.0', percent: 42 });

      expect(screen.getByText('42%')).toBeInTheDocument();
      expect(screen.getByText('42%').closest('[aria-live]')).toBeNull();
      expect(screen.getByText('Downloading MD Reader 1.2.0…')).toHaveAttribute(
        'aria-live',
        'polite',
      );
    });
  });
});
