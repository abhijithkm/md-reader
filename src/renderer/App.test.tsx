import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MdReaderApi } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import type { MarkdownDocument, OpenOutcome } from '../shared/types';
import { App } from './App';

afterEach(() => {
  document.title = '';
  delete document.documentElement.dataset['theme'];
});

function doc(name: string, content: string): MarkdownDocument {
  return {
    path: `C:\\docs\\${name}`,
    name,
    directory: 'C:\\docs',
    baseUrl: 'file:///C:/docs/',
    content,
    sizeBytes: content.length,
    modifiedMs: 1,
    encoding: 'utf-8',
  };
}

const opened = (name: string, content: string): OpenOutcome => ({
  status: 'opened',
  document: doc(name, content),
});

function createBridge(initial: Settings = { theme: 'light', zoom: 1 }) {
  let listener: ((outcome: OpenOutcome) => void) | undefined;
  const bridge = {
    getAppInfo: vi.fn(() =>
      Promise.resolve({ name: 'MD Reader', version: '1.0.0', platform: 'win32' }),
    ),
    getSettings: vi.fn(() => Promise.resolve(initial)),
    updateSettings: vi.fn((patch: Partial<Settings>) => Promise.resolve({ ...initial, ...patch })),
    notifyReady: vi.fn(() => Promise.resolve()),
    openFileDialog: vi.fn<MdReaderApi['openFileDialog']>(() =>
      Promise.resolve({ status: 'canceled' }),
    ),
    openDroppedFile: vi.fn<MdReaderApi['openDroppedFile']>(),
    reopenDocument: vi.fn<MdReaderApi['reopenDocument']>(),
    openLink: vi.fn<MdReaderApi['openLink']>(),
    reloadDocument: vi.fn<MdReaderApi['reloadDocument']>(),
    onDocumentOpened: vi.fn((callback: (outcome: OpenOutcome) => void) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    }),
    openExternal: vi.fn<MdReaderApi['openExternal']>(() => Promise.resolve(true)),
    openDefaultAppsSettings: vi.fn(() => Promise.resolve()),
    closeWindow: vi.fn(() => Promise.resolve()),
  } satisfies MdReaderApi;

  return {
    bridge,
    push(outcome: OpenOutcome) {
      act(() => {
        listener?.(outcome);
      });
    },
  };
}

async function renderApp(initial?: Settings) {
  const harness = createBridge(initial);
  render(<App bridge={harness.bridge} />);
  await screen.findByRole('banner');
  return { ...harness, user: userEvent.setup() };
}

describe('App', () => {
  describe('starting up', () => {
    it('shows nothing until the saved settings are known, so the theme never flashes', async () => {
      const { bridge } = createBridge();
      const { container } = render(<App bridge={bridge} />);
      expect(container).toBeEmptyDOMElement();

      expect(await screen.findByRole('banner')).toBeInTheDocument();
    });

    it('starts with an invitation to open a file', async () => {
      await renderApp();
      expect(screen.getByRole('heading', { name: 'Open a Markdown file' })).toBeInTheDocument();
      expect(screen.getByText('No document open')).toBeInTheDocument();
      expect(document.title).toBe('MD Reader');
    });
  });

  describe('reading a document', () => {
    it('shows a document opened from outside and names it everywhere', async () => {
      const { push } = await renderApp();

      push(opened('Release notes.md', '# Release notes\n\nFixed three bugs.'));

      expect(
        await screen.findByRole('heading', { name: 'Release notes', level: 1 }),
      ).toBeInTheDocument();
      const toolbar = screen.getByRole('banner');
      expect(within(toolbar).getByText('Release notes.md')).toBeInTheDocument();
      // The word count is worked out just after the first paint.
      expect(await screen.findByText(/\d+ words?/)).toBeInTheDocument();
      expect(document.title).toBe('Release notes.md — MD Reader');
    });

    it('opens the file dialog from the button and from Ctrl+O', async () => {
      const { bridge, user } = await renderApp();

      // The toolbar button, the button on the empty page, and the keyboard shortcut.
      const [toolbarButton, emptyStateButton] = screen.getAllByRole('button', {
        name: 'Open file',
      });
      await user.click(toolbarButton as HTMLElement);
      await user.click(emptyStateButton as HTMLElement);
      fireEvent.keyDown(window, { key: 'o', ctrlKey: true });

      expect(bridge.openFileDialog).toHaveBeenCalledTimes(3);
    });

    it('reloads the document from disk with F5', async () => {
      const { bridge, push } = await renderApp();
      push(opened('live.md', '# Before'));
      await screen.findByRole('heading', { name: 'Before' });
      bridge.reloadDocument.mockResolvedValue(opened('live.md', '# After'));

      fireEvent.keyDown(window, { key: 'F5' });

      expect(await screen.findByRole('heading', { name: 'After' })).toBeInTheDocument();
    });

    it('does not try to reload when nothing is open', async () => {
      const { bridge } = await renderApp();
      fireEvent.keyDown(window, { key: 'F5' });
      expect(bridge.reloadDocument).not.toHaveBeenCalled();
    });

    it('explains a failed open and keeps the document that was open', async () => {
      const { push } = await renderApp();
      push(opened('keep.md', '# Keep me'));
      await screen.findByRole('heading', { name: 'Keep me' });

      push({
        status: 'failed',
        error: { code: 'not-found', message: '"gone.md" could not be found.' },
      });

      expect(await screen.findByRole('alert')).toHaveTextContent('"gone.md" could not be found.');
      expect(screen.getByRole('heading', { name: 'Keep me' })).toBeInTheDocument();
    });
  });

  describe('theme and zoom', () => {
    it('toggles the theme and remembers it', async () => {
      const { bridge, user } = await renderApp({ theme: 'light', zoom: 1 });
      expect(document.documentElement.dataset['theme']).toBe('light');

      await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));

      expect(document.documentElement.dataset['theme']).toBe('dark');
      expect(bridge.updateSettings).toHaveBeenCalledWith({ theme: 'dark' });
    });

    it('zooms with Ctrl+Plus, Ctrl+Minus and Ctrl+0 and remembers it', async () => {
      const { bridge } = await renderApp();

      fireEvent.keyDown(window, { key: '=', ctrlKey: true });
      expect(screen.getByRole('status')).toHaveTextContent('110%');

      fireEvent.keyDown(window, { key: '-', ctrlKey: true });
      fireEvent.keyDown(window, { key: '-', ctrlKey: true });
      expect(screen.getByRole('status')).toHaveTextContent('90%');

      fireEvent.keyDown(window, { key: '0', ctrlKey: true });
      expect(screen.getByRole('status')).toHaveTextContent('100%');

      expect(bridge.updateSettings.mock.calls.map(([patch]) => patch)).toEqual([
        { zoom: 1.1 },
        { zoom: 1 },
        { zoom: 0.9 },
        { zoom: 1 },
      ]);
    });

    it('starts at the zoom level saved last time', async () => {
      await renderApp({ theme: 'dark', zoom: 1.5 });
      expect(screen.getByRole('status')).toHaveTextContent('150%');
      expect(document.documentElement.dataset['theme']).toBe('dark');
    });
  });

  describe('links', () => {
    it('opens a web link through the app and reports one that cannot be opened', async () => {
      const { bridge, push, user } = await renderApp();
      push(opened('links.md', '[site](https://example.com/a)'));
      bridge.openExternal.mockResolvedValueOnce(false);

      await user.click(await screen.findByRole('link', { name: 'site' }));

      expect(bridge.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/a');
      expect(await screen.findByRole('alert')).toHaveTextContent('That link could not be opened.');
    });

    it('follows a link to another document and goes back', async () => {
      const { bridge, push, user } = await renderApp();
      push(opened('index.md', '# Index\n\n[guide](guide.md)'));
      bridge.openLink.mockResolvedValue(opened('guide.md', '# Guide'));
      bridge.reopenDocument.mockResolvedValue(opened('index.md', '# Index\n\n[guide](guide.md)'));

      await user.click(await screen.findByRole('link', { name: 'guide' }));
      expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();
      expect(bridge.openLink).toHaveBeenCalledExactlyOnceWith('file:///C:/docs/guide.md');

      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(await screen.findByRole('heading', { name: 'Index' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });

    it('goes back with Alt+Left', async () => {
      const { bridge, push, user } = await renderApp();
      push(opened('index.md', '# Index\n\n[guide](guide.md)'));
      bridge.openLink.mockResolvedValue(opened('guide.md', '# Guide'));
      bridge.reopenDocument.mockResolvedValue(opened('index.md', '# Index'));
      await user.click(await screen.findByRole('link', { name: 'guide' }));
      await screen.findByRole('heading', { name: 'Guide' });

      fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });

      expect(await screen.findByRole('heading', { name: 'Index' })).toBeInTheDocument();
    });
  });

  describe('dropping a file', () => {
    function dropEvent(type: string, file: File): Event {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [file], types: ['Files'], dropEffect: 'none' },
      });
      return event;
    }

    it('shows a hint while dragging and opens the dropped file', async () => {
      const { bridge } = await renderApp();
      bridge.openDroppedFile.mockResolvedValue(opened('file.md', '# Dropped'));
      const file = new File(['# Dropped'], 'file.md');

      act(() => {
        window.dispatchEvent(dropEvent('dragenter', file));
      });
      expect(screen.getByText('Drop a Markdown file to open it')).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(dropEvent('drop', file));
      });

      expect(bridge.openDroppedFile).toHaveBeenCalledExactlyOnceWith(file);
      expect(await screen.findByRole('heading', { name: 'Dropped' })).toBeInTheDocument();
      expect(screen.queryByText('Drop a Markdown file to open it')).toBeNull();
    });

    it('explains when the location of a dropped item cannot be read', async () => {
      const { bridge } = await renderApp();
      bridge.openDroppedFile.mockResolvedValue({
        status: 'failed',
        error: {
          code: 'invalid-path',
          message: 'MD Reader could not read the location of the dropped item.',
        },
      });

      act(() => {
        window.dispatchEvent(dropEvent('drop', new File(['x'], 'x.md')));
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(/could not read the location/i);
    });

    it('explains a drop that the main process could not handle at all', async () => {
      const { bridge } = await renderApp();
      bridge.openDroppedFile.mockRejectedValue(new Error('ipc closed'));

      act(() => {
        window.dispatchEvent(dropEvent('drop', new File(['x'], 'x.md')));
      });

      expect(await screen.findByRole('alert')).toBeInTheDocument();
    });
  });

  describe('windows integration', () => {
    it('closes the window with Ctrl+W', async () => {
      const { bridge } = await renderApp();
      fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
      expect(bridge.closeWindow).toHaveBeenCalledOnce();
    });

    it('opens the Windows Default apps page from the empty state', async () => {
      const { bridge, user } = await renderApp();
      await user.click(screen.getByRole('button', { name: 'Open Default apps settings' }));
      expect(bridge.openDefaultAppsSettings).toHaveBeenCalledOnce();
    });
  });
});
