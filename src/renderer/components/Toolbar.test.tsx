import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Toolbar, type ToolbarProps } from './Toolbar';

function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
  const props: ToolbarProps = {
    fileName: 'README.md',
    filePath: 'C:\\docs\\README.md',
    zoom: 1,
    theme: 'light',
    canGoBack: false,
    canReload: true,
    onOpen: vi.fn(),
    onBack: vi.fn(),
    onReload: vi.fn(),
    onToggleTheme: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onResetZoom: vi.fn(),
    restoreTabs: true,
    onSetRestoreTabs: vi.fn(),
    ...overrides,
  };
  render(<Toolbar {...props} />);
  return { props, user: userEvent.setup() };
}

describe('Toolbar', () => {
  it('shows the name of the open document, with its full path on hover', () => {
    renderToolbar();
    const name = screen.getByText('README.md');
    expect(name).toHaveAttribute('title', 'C:\\docs\\README.md');
  });

  it('shows the app name when no document is open', () => {
    renderToolbar({ fileName: undefined, filePath: undefined });
    expect(screen.getByText('MD Reader')).toBeInTheDocument();
  });

  // Documents often share a name (README.md), and the folder is what tells them apart.
  it('names the folder that holds the document next to its name', () => {
    renderToolbar({ filePath: 'C:\\projects\\md-reader\\README.md' });
    expect(screen.getByText('md-reader')).toHaveAttribute(
      'title',
      'C:\\projects\\md-reader\\README.md',
    );
  });

  it('finds the folder whichever way the path is written', () => {
    renderToolbar({ filePath: 'C:/projects/notes/README.md' });
    expect(screen.getByText('notes')).toBeInTheDocument();
  });

  it('names no folder when no document is open', () => {
    renderToolbar({ fileName: undefined, filePath: undefined });
    expect(document.querySelector('.toolbar-folder')).toBeNull();
  });

  it('opens a file', async () => {
    const { props, user } = renderToolbar();
    await user.click(screen.getByRole('button', { name: 'Open file' }));
    expect(props.onOpen).toHaveBeenCalledOnce();
  });

  it('reloads the document', async () => {
    const { props, user } = renderToolbar();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(props.onReload).toHaveBeenCalledOnce();
  });

  it('cannot reload when nothing is open', () => {
    renderToolbar({ canReload: false });
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
  });

  it('goes back only when there is somewhere to go back to', async () => {
    const first = renderToolbar({ canGoBack: false });
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    document.body.innerHTML = '';

    const second = renderToolbar({ canGoBack: true });
    await second.user.click(screen.getByRole('button', { name: 'Back' }));
    expect(second.props.onBack).toHaveBeenCalledOnce();
    expect(first.props.onBack).not.toHaveBeenCalled();
  });

  describe('zoom', () => {
    it('shows the current zoom as a percentage', () => {
      renderToolbar({ zoom: 1.25 });
      expect(screen.getByRole('status')).toHaveTextContent('125%');
    });

    it('zooms in, zooms out and resets', async () => {
      const { props, user } = renderToolbar({ zoom: 1.5 });

      await user.click(screen.getByRole('button', { name: 'Zoom in' }));
      await user.click(screen.getByRole('button', { name: 'Zoom out' }));
      await user.click(screen.getByRole('button', { name: 'Reset zoom' }));

      expect(props.onZoomIn).toHaveBeenCalledOnce();
      expect(props.onZoomOut).toHaveBeenCalledOnce();
      expect(props.onResetZoom).toHaveBeenCalledOnce();
    });

    it('stops zooming out at the smallest size and in at the largest', () => {
      renderToolbar({ zoom: 0.5 });
      expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    });

    it('stops zooming in at the largest size', () => {
      renderToolbar({ zoom: 3 });
      expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    });

    it('has nothing to reset at 100%', () => {
      renderToolbar({ zoom: 1 });
      expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeDisabled();
    });
  });

  describe('theme', () => {
    it('offers the dark theme while the light one is shown', async () => {
      const { props, user } = renderToolbar({ theme: 'light' });
      await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
      expect(props.onToggleTheme).toHaveBeenCalledOnce();
    });

    it('offers the light theme while the dark one is shown', () => {
      renderToolbar({ theme: 'dark' });
      expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    });
  });

  describe('settings', () => {
    it('has a gear that opens the settings menu', () => {
      renderToolbar();
      expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    });

    it('passes on the choice to stop reopening the tabs', async () => {
      const { props, user } = renderToolbar({ restoreTabs: true });

      // A menu that is closed is out of reach of assistive technology, so the query asks for it.
      await user.click(screen.getByRole('switch', { hidden: true }));

      expect(props.onSetRestoreTabs).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('shows that the tabs are not reopened when that is switched off', () => {
      renderToolbar({ restoreTabs: false });
      expect(screen.getByRole('switch', { hidden: true })).not.toBeChecked();
    });
  });

  it('lists the keyboard shortcut in each tooltip', () => {
    renderToolbar({ canGoBack: true });
    expect(screen.getByRole('button', { name: 'Open file' })).toHaveAttribute(
      'title',
      'Open file (Ctrl+O)',
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveAttribute('title', 'Reload (F5)');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveAttribute(
      'title',
      'Zoom in (Ctrl+Plus)',
    );
    expect(screen.getByRole('button', { name: 'Zoom out' })).toHaveAttribute(
      'title',
      'Zoom out (Ctrl+Minus)',
    );
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveAttribute(
      'title',
      'Reset zoom (Ctrl+0)',
    );
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute(
      'title',
      'Back (Alt+Left)',
    );
  });
});
