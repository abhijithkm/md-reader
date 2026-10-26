import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UpdateNotice, type UpdateNoticeProps } from './UpdateNotice';

function setup(notice: UpdateNoticeProps['notice']) {
  const handlers = {
    onKeepOn: vi.fn(),
    onTurnOff: vi.fn(),
    onRestart: vi.fn(),
    onOpenPage: vi.fn(),
    onDismiss: vi.fn(),
  };
  render(<UpdateNotice notice={notice} {...handlers} />);
  return { ...handlers, user: userEvent.setup() };
}

describe('UpdateNotice', () => {
  describe('the explanation shown once', () => {
    it('says what the check does and what it sends, for a copy that installs updates', () => {
      setup({ kind: 'intro', installs: true });

      const notice = screen.getByRole('status', { name: 'Update notice' });
      expect(notice).toHaveTextContent(/checks GitHub for new versions/i);
      expect(notice).toHaveTextContent(/installs them when you close the app/i);
      expect(notice).toHaveTextContent(/no information from your documents or settings/i);
    });

    it('does not promise to install anything in a copy that only reports updates', () => {
      setup({ kind: 'intro', installs: false });

      const notice = screen.getByRole('status', { name: 'Update notice' });
      expect(notice).toHaveTextContent(/checks GitHub for new versions/i);
      expect(notice).toHaveTextContent(/tells you when one is available/i);
      expect(notice).not.toHaveTextContent(/install/i);
      expect(notice).toHaveTextContent(/no information from your documents or settings/i);
    });

    it('keeps updates on with OK', async () => {
      const { user, onKeepOn, onTurnOff } = setup({ kind: 'intro', installs: true });

      await user.click(screen.getByRole('button', { name: 'OK' }));

      expect(onKeepOn).toHaveBeenCalledOnce();
      expect(onTurnOff).not.toHaveBeenCalled();
    });

    it('switches updates off with Turn off', async () => {
      const { user, onKeepOn, onTurnOff } = setup({ kind: 'intro', installs: true });

      await user.click(screen.getByRole('button', { name: 'Turn off' }));

      expect(onTurnOff).toHaveBeenCalledOnce();
      expect(onKeepOn).not.toHaveBeenCalled();
    });
  });

  describe('an update that is ready to install', () => {
    it('names the version and says when it installs', () => {
      setup({ kind: 'ready', version: '1.2.0' });

      expect(screen.getByRole('status')).toHaveTextContent(
        'MD Reader 1.2.0 is ready. It installs when you close the app.',
      );
    });

    it('restarts into it on request', async () => {
      const { user, onRestart } = setup({ kind: 'ready', version: '1.2.0' });

      await user.click(screen.getByRole('button', { name: 'Restart now' }));

      expect(onRestart).toHaveBeenCalledOnce();
    });

    it('can be dismissed', async () => {
      const { user, onDismiss } = setup({ kind: 'ready', version: '1.2.0' });

      await user.click(screen.getByRole('button', { name: 'Dismiss' }));

      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });

  describe('a newer version that this copy cannot install itself', () => {
    it('names the version and offers its download page', async () => {
      const { user, onOpenPage } = setup({ kind: 'available', version: '1.2.0' });

      expect(screen.getByRole('status')).toHaveTextContent('MD Reader 1.2.0 is available.');
      await user.click(screen.getByRole('button', { name: 'Open download page' }));

      expect(onOpenPage).toHaveBeenCalledOnce();
    });

    it('can be dismissed', async () => {
      const { user, onDismiss } = setup({ kind: 'available', version: '1.2.0' });

      await user.click(screen.getByRole('button', { name: 'Dismiss' }));

      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });
});
