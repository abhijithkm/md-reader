import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MdReaderApi } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import type { TabInfo, TabsSnapshot } from '../shared/tabs';
import type { MarkdownDocument, OpenOutcome } from '../shared/types';
import type { UpdateState } from '../shared/updates';
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

const opened = (tabId: string, name: string, content: string): OpenOutcome => ({
  status: 'opened',
  tabId,
  document: doc(name, content),
});

const failed = (message: string): OpenOutcome => ({
  status: 'failed',
  error: { code: 'not-found', message },
});

/** What most tests start from: the explanation of updates was already read, so it stays out of the way. */
const SETTINGS: Settings = {
  theme: 'light',
  zoom: 1,
  automaticUpdates: true,
  updateNoticeSeen: true,
  restoreTabs: true,
};

const NO_UPDATES: UpdateState = { status: 'unavailable', reason: 'disabled' };

/**
 * A stand-in for the main process behind the bridge. It owns the tabs, as the real one does: the page
 * asks for a tab to be brought on screen or closed, and is told how the tabs are afterwards. It hands
 * a document over before it announces the tab that shows it, as the real one does for files that are
 * opened from outside the page.
 */
function createBridge(
  initial: Settings = SETTINGS,
  updateState: UpdateState = NO_UPDATES,
  installsUpdates = true,
) {
  let documentListener: ((outcome: OpenOutcome) => void) | undefined;
  let tabsListener: ((snapshot: TabsSnapshot) => void) | undefined;
  let updateListener: ((state: UpdateState) => void) | undefined;
  const main = {
    tabs: [] as TabInfo[],
    active: undefined as string | undefined,
    version: 0,
    issued: 0,
  };
  const snapshot = (): TabsSnapshot => ({
    tabs: main.tabs.map((tab) => ({ ...tab })),
    activeId: main.active,
    version: main.version,
  });
  const tell = (): void => {
    main.version += 1;
    tabsListener?.(snapshot());
  };
  const makeTab = (name: string): string => {
    main.issued += 1;
    const id = `tab-${main.issued}`;
    main.tabs.push({ id, path: `C:\\docs\\${name}` });
    main.active = id;
    return id;
  };

  const bridge = {
    getAppInfo: vi.fn(() =>
      Promise.resolve({ name: 'MD Reader', version: '1.0.0', platform: 'win32', installsUpdates }),
    ),
    getSettings: vi.fn(() => Promise.resolve(initial)),
    updateSettings: vi.fn((patch: Partial<Settings>) => Promise.resolve({ ...initial, ...patch })),
    notifyReady: vi.fn(() => Promise.resolve()),
    openFileDialog: vi.fn<MdReaderApi['openFileDialog']>(() =>
      Promise.resolve([{ status: 'canceled' }]),
    ),
    openDroppedFiles: vi.fn<MdReaderApi['openDroppedFiles']>(),
    reopenDocument: vi.fn<MdReaderApi['reopenDocument']>(),
    openLink: vi.fn<MdReaderApi['openLink']>(),
    reloadDocument: vi.fn<MdReaderApi['reloadDocument']>(),
    onDocumentOpened: vi.fn((callback: (outcome: OpenOutcome) => void) => {
      documentListener = callback;
      return () => {
        documentListener = undefined;
      };
    }),
    getTabs: vi.fn(() => Promise.resolve(snapshot())),
    onTabsChanged: vi.fn((callback: (next: TabsSnapshot) => void) => {
      tabsListener = callback;
      return () => {
        tabsListener = undefined;
      };
    }),
    activateTab: vi.fn((id: string) => {
      if (main.tabs.some((tab) => tab.id === id) && main.active !== id) {
        main.active = id;
        tell();
      }
      return Promise.resolve();
    }),
    closeTab: vi.fn((id: string) => {
      const index = main.tabs.findIndex((tab) => tab.id === id);
      if (index >= 0) {
        main.tabs.splice(index, 1);
        if (main.active === id) main.active = (main.tabs[index] ?? main.tabs[index - 1])?.id;
        tell();
      }
      return Promise.resolve();
    }),
    moveTab: vi.fn<MdReaderApi['moveTab']>(() => Promise.resolve()),
    loadTab: vi.fn<MdReaderApi['loadTab']>(() => Promise.resolve({ status: 'canceled' })),
    openExternal: vi.fn<MdReaderApi['openExternal']>(() => Promise.resolve(true)),
    openDefaultAppsSettings: vi.fn(() => Promise.resolve()),
    closeWindow: vi.fn(() => Promise.resolve()),
    getUpdateState: vi.fn((): Promise<UpdateState> => Promise.resolve(updateState)),
    checkForUpdates: vi.fn((): Promise<UpdateState> => Promise.resolve({ status: 'current' })),
    restartToUpdate: vi.fn(() => Promise.resolve()),
    onUpdateState: vi.fn((callback: (state: UpdateState) => void) => {
      updateListener = callback;
      return () => {
        updateListener = undefined;
      };
    }),
  } satisfies MdReaderApi;

  return {
    bridge,
    /** The main process opens a file from outside the page (a second launch, say) in a tab of its own. */
    show(name: string, content: string): string {
      let id = '';
      act(() => {
        id = makeTab(name);
        documentListener?.(opened(id, name, content));
        tell();
      });
      return id;
    },
    /**
     * Opens a file in a tab of its own for a request that the page made itself, and returns what the
     * main process answers: for use inside a mock of the bridge.
     */
    createTab(name: string, content: string): OpenOutcome {
      const id = makeTab(name);
      tell();
      return opened(id, name, content);
    },
    /**
     * Takes a tab to another document for a request that the page made itself (a link, Back or a
     * reload), and returns what the main process answers: it announces the tab first, as the real one does.
     */
    navigate(id: string, name: string, content: string): OpenOutcome {
      const tab = main.tabs.find((candidate) => candidate.id === id);
      if (tab !== undefined) {
        tab.path = `C:\\docs\\${name}`;
        tell();
      }
      return opened(id, name, content);
    },
    /** Tabs that were open the last time, which the page has not been given the documents of. */
    restore(names: readonly string[], activeIndex: number): void {
      for (const name of names) makeTab(name);
      main.active = main.tabs[activeIndex]?.id;
    },
    push(outcome: OpenOutcome) {
      act(() => {
        documentListener?.(outcome);
      });
    },
    pushUpdate(state: UpdateState) {
      act(() => {
        updateListener?.(state);
      });
    },
  };
}

async function renderApp(initial?: Settings, updateState?: UpdateState, installsUpdates?: boolean) {
  const harness = createBridge(initial, updateState, installsUpdates);
  render(<App bridge={harness.bridge} />);
  await screen.findByRole('banner');
  return { ...harness, user: userEvent.setup() };
}

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });

describe('App', () => {
  describe('starting up', () => {
    it('shows nothing until the saved settings are known, so the theme never flashes', async () => {
      const { bridge } = createBridge();
      const { container } = render(<App bridge={bridge} />);
      expect(container).toBeEmptyDOMElement();

      expect(await screen.findByRole('banner')).toBeInTheDocument();
    });

    it('shows nothing until it knows which tabs there are, so the start page never flashes before them', async () => {
      const { bridge } = createBridge();
      bridge.getTabs.mockReturnValue(new Promise(() => undefined));
      const { container } = render(<App bridge={bridge} />);

      await waitFor(() => {
        expect(bridge.getSettings).toHaveBeenCalled();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(container).toBeEmptyDOMElement();
    });

    it('starts with an invitation to open a file, and no tabs', async () => {
      await renderApp();
      expect(screen.getByRole('heading', { name: 'Open a Markdown file' })).toBeInTheDocument();
      expect(screen.getByText('No document open')).toBeInTheDocument();
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(document.title).toBe('MD Reader');
    });
  });

  describe('reading a document', () => {
    it('shows a document opened from outside and names it everywhere', async () => {
      const { show } = await renderApp();

      show('Release notes.md', '# Release notes\n\nFixed three bugs.');

      expect(
        await screen.findByRole('heading', { name: 'Release notes', level: 1 }),
      ).toBeInTheDocument();
      const toolbar = screen.getByRole('banner');
      expect(within(toolbar).getByText('Release notes.md')).toBeInTheDocument();
      expect(tab('Release notes.md')).toHaveAttribute('aria-selected', 'true');
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
      const { bridge, show } = await renderApp();
      const id = show('live.md', '# Before');
      await screen.findByRole('heading', { name: 'Before' });
      bridge.reloadDocument.mockResolvedValue(opened(id, 'live.md', '# After'));

      fireEvent.keyDown(window, { key: 'F5' });

      expect(await screen.findByRole('heading', { name: 'After' })).toBeInTheDocument();
      expect(bridge.reloadDocument).toHaveBeenCalledExactlyOnceWith(id);
    });

    it('reloads the document from the toolbar, in the tab that is on screen', async () => {
      const { bridge, show, user } = await renderApp();
      const first = show('a.md', '# Alpha before');
      show('b.md', '# Beta');
      await screen.findByRole('heading', { name: 'Beta' });
      await user.click(tab('a.md'));
      await screen.findByRole('heading', { name: 'Alpha before' });
      bridge.reloadDocument.mockResolvedValue(opened(first, 'a.md', '# Alpha after'));

      await user.click(screen.getByRole('button', { name: 'Reload' }));

      expect(await screen.findByRole('heading', { name: 'Alpha after' })).toBeInTheDocument();
      expect(bridge.reloadDocument).toHaveBeenCalledExactlyOnceWith(first);
    });

    it('does not try to reload when nothing is open', async () => {
      const { bridge } = await renderApp();
      fireEvent.keyDown(window, { key: 'F5' });
      expect(bridge.reloadDocument).not.toHaveBeenCalled();
    });

    it('explains a failed open and keeps the document that was open', async () => {
      const { push, show } = await renderApp();
      show('keep.md', '# Keep me');
      await screen.findByRole('heading', { name: 'Keep me' });

      push(failed('"gone.md" could not be found.'));

      expect(await screen.findByRole('alert')).toHaveTextContent('"gone.md" could not be found.');
      expect(screen.getByRole('heading', { name: 'Keep me' })).toBeInTheDocument();
    });
  });

  describe('tabs', () => {
    it('shows a tab for each open document, with the newest on screen', async () => {
      const { show } = await renderApp();

      show('a.md', '# Alpha');
      show('b.md', '# Beta');

      expect(await screen.findByRole('heading', { name: 'Beta' })).toBeInTheDocument();
      expect(screen.getAllByRole('tab').map((element) => element.textContent)).toEqual([
        'a.md',
        'b.md',
      ]);
      expect(tab('a.md')).toHaveAttribute('aria-selected', 'false');
      expect(tab('b.md')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel')).toHaveAccessibleName('b.md');
    });

    it('brings another tab on screen when it is clicked, and names the window after it', async () => {
      const { bridge, show, user } = await renderApp();
      const first = show('a.md', '# Alpha');
      show('b.md', '# Beta');
      await screen.findByRole('heading', { name: 'Beta' });

      await user.click(tab('a.md'));

      expect(bridge.activateTab).toHaveBeenCalledExactlyOnceWith(first);
      expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Beta' })).toBeNull();
      expect(document.title).toBe('a.md — MD Reader');
    });

    it('closes a tab from its cross, and shows the one next to it', async () => {
      const { bridge, show, user } = await renderApp();
      show('a.md', '# Alpha');
      const second = show('b.md', '# Beta');
      await screen.findByRole('heading', { name: 'Beta' });

      await user.click(screen.getByRole('button', { name: 'Close b.md' }));

      expect(bridge.closeTab).toHaveBeenCalledExactlyOnceWith(second);
      expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
      expect(screen.getAllByRole('tab')).toHaveLength(1);
    });

    it('goes back to the start page when the last tab is closed', async () => {
      const { show, user } = await renderApp();
      show('a.md', '# Alpha');
      await screen.findByRole('heading', { name: 'Alpha' });

      await user.click(screen.getByRole('button', { name: 'Close a.md' }));

      expect(
        await screen.findByRole('heading', { name: 'Open a Markdown file' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(document.title).toBe('MD Reader');
    });

    it('steps through the tabs with Ctrl+Tab and Ctrl+Shift+Tab', async () => {
      const { bridge, show } = await renderApp();
      const first = show('a.md', '# Alpha');
      const second = show('b.md', '# Beta');
      await screen.findByRole('heading', { name: 'Beta' });

      fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
      expect(bridge.activateTab).toHaveBeenLastCalledWith(first);
      expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
      expect(bridge.activateTab).toHaveBeenLastCalledWith(second);
      expect(await screen.findByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    });

    it('moves the tab on screen with Ctrl+Shift+Page Up', async () => {
      const { bridge, show } = await renderApp();
      show('a.md', '# Alpha');
      const second = show('b.md', '# Beta');
      await screen.findByRole('heading', { name: 'Beta' });

      fireEvent.keyDown(window, { key: 'PageUp', ctrlKey: true, shiftKey: true });

      expect(bridge.moveTab).toHaveBeenCalledExactlyOnceWith(second, 0);
    });

    it('moves the tab on screen with Ctrl+Shift+Page Down', async () => {
      const { bridge, show, user } = await renderApp();
      const first = show('a.md', '# Alpha');
      show('b.md', '# Beta');
      await screen.findByRole('heading', { name: 'Beta' });
      await user.click(tab('a.md'));
      await screen.findByRole('heading', { name: 'Alpha' });

      fireEvent.keyDown(window, { key: 'PageDown', ctrlKey: true, shiftKey: true });

      expect(bridge.moveTab).toHaveBeenCalledExactlyOnceWith(first, 1);
    });

    it('moves a tab that is dragged to another place in the row', async () => {
      const { bridge, show } = await renderApp();
      const first = show('a.md', '# Alpha');
      show('b.md', '# Beta');
      await screen.findByRole('heading', { name: 'Beta' });
      const data = new Map<string, string>();
      const dataTransfer = {
        setData: (type: string, value: string) => data.set(type, value),
        getData: (type: string) => data.get(type) ?? '',
        get types() {
          return [...data.keys()];
        },
        effectAllowed: 'uninitialized',
        dropEffect: 'none',
      };
      const row = (name: string): HTMLElement => tab(name).parentElement as HTMLElement;

      fireEvent.dragStart(row('a.md'), { dataTransfer });
      fireEvent.drop(row('b.md'), { dataTransfer, clientX: 5 });

      expect(bridge.moveTab).toHaveBeenCalledExactlyOnceWith(first, 1);
    });

    it('opens the files chosen from the plus button, each in a tab of its own', async () => {
      const { bridge, show, createTab, user } = await renderApp();
      show('a.md', '# Alpha');
      await screen.findByRole('heading', { name: 'Alpha' });
      bridge.openFileDialog.mockImplementation(() =>
        Promise.resolve([createTab('chosen.md', '# Chosen')]),
      );

      await user.click(screen.getByRole('button', { name: 'Open files' }));

      expect(await screen.findByRole('heading', { name: 'Chosen' })).toBeInTheDocument();
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      expect(tab('chosen.md')).toHaveAttribute('aria-selected', 'true');
    });

    it('reads a tab from the last run when it comes on screen, and not before', async () => {
      const harness = createBridge();
      harness.restore(['a.md', 'b.md'], 1);
      harness.bridge.loadTab.mockImplementation((id) =>
        Promise.resolve(
          id === 'tab-1' ? opened(id, 'a.md', '# Alpha') : opened(id, 'b.md', '# Beta'),
        ),
      );

      render(<App bridge={harness.bridge} />);

      expect(await screen.findByRole('heading', { name: 'Beta' })).toBeInTheDocument();
      expect(harness.bridge.loadTab.mock.calls).toEqual([['tab-2']]);

      await userEvent.setup().click(tab('a.md'));

      expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
      expect(harness.bridge.loadTab.mock.calls).toEqual([['tab-2'], ['tab-1']]);
    });

    it('shows the tab, and not the start page, while the document of a tab from the last run is being read', async () => {
      const harness = createBridge();
      harness.restore(['a.md'], 0);
      harness.bridge.loadTab.mockReturnValue(new Promise(() => undefined));

      render(<App bridge={harness.bridge} />);

      expect(await screen.findByRole('tab', { name: 'a.md' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Open a Markdown file' })).toBeNull();
      await waitFor(() => {
        expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
      });
    });

    it('puts the reader back where they were in a tab when they return to it', async () => {
      const { show, user } = await renderApp();
      show('a.md', '# Alpha');
      show('b.md', '# Beta');
      await screen.findByRole('heading', { name: 'Beta' });
      await user.click(tab('a.md'));
      await screen.findByRole('heading', { name: 'Alpha' });
      const region = screen.getByRole('region', { name: 'a.md' });
      fireEvent.wheel(region, { deltaY: 120 });
      region.scrollTop = 240;
      fireEvent.scroll(region);

      await user.click(tab('b.md'));
      await screen.findByRole('heading', { name: 'Beta' });
      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'b.md' }).scrollTop).toBe(0);
      });
      await user.click(tab('a.md'));

      await screen.findByRole('heading', { name: 'Alpha' });
      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'a.md' }).scrollTop).toBe(240);
      });
    });

    describe('a tab whose file cannot be read', () => {
      async function renderGone() {
        const harness = createBridge();
        harness.restore(['gone.md'], 0);
        harness.bridge.loadTab.mockResolvedValue(
          failed('"gone.md" could not be found. It may have been moved, renamed or deleted.'),
        );
        render(<App bridge={harness.bridge} />);
        await screen.findByRole('heading', { name: 'gone.md', level: 1 });
        return { ...harness, user: userEvent.setup() };
      }

      it('stays, says which file it was and why it cannot be shown', async () => {
        await renderGone();

        expect(screen.getByRole('alert')).toHaveTextContent(/could not be found/i);
        expect(tab('gone.md')).toHaveAttribute('aria-selected', 'true');
        expect(document.title).toBe('gone.md — MD Reader');
        expect(screen.getByText('gone.md', { selector: '.statusbar-name' })).toBeInTheDocument();
      });

      it('is read again when the reader asks, and shows the document if it is there now', async () => {
        const { bridge, user } = await renderGone();
        bridge.loadTab.mockResolvedValue(opened('tab-1', 'gone.md', '# Back again'));

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('heading', { name: 'Back again' })).toBeInTheDocument();
        expect(bridge.loadTab).toHaveBeenCalledTimes(2);
      });

      it('is tried again with F5', async () => {
        const { bridge } = await renderGone();
        bridge.loadTab.mockResolvedValue(opened('tab-1', 'gone.md', '# Back again'));

        fireEvent.keyDown(window, { key: 'F5' });

        expect(await screen.findByRole('heading', { name: 'Back again' })).toBeInTheDocument();
      });

      it('is tried again from the toolbar, which has nothing else to reload', async () => {
        const { bridge, user } = await renderGone();
        bridge.loadTab.mockResolvedValue(opened('tab-1', 'gone.md', '# Back again'));

        await user.click(screen.getByRole('button', { name: 'Reload' }));

        expect(await screen.findByRole('heading', { name: 'Back again' })).toBeInTheDocument();
        expect(bridge.reloadDocument).not.toHaveBeenCalled();
      });

      it('can be closed from the page that explains it', async () => {
        const { bridge, user } = await renderGone();

        await user.click(screen.getByRole('button', { name: 'Close tab' }));

        expect(bridge.closeTab).toHaveBeenCalledExactlyOnceWith('tab-1');
      });
    });
  });

  describe('theme and zoom', () => {
    it('toggles the theme and remembers it', async () => {
      const { bridge, user } = await renderApp({ ...SETTINGS, theme: 'light' });
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
      await renderApp({ ...SETTINGS, theme: 'dark', zoom: 1.5 });
      expect(screen.getByRole('status')).toHaveTextContent('150%');
      expect(document.documentElement.dataset['theme']).toBe('dark');
    });
  });

  describe('settings', () => {
    it('lets the reader stop the tabs from being reopened, and remembers it', async () => {
      const { bridge, user } = await renderApp();

      // The menu is a popover that is closed until the gear opens it, which jsdom does not do.
      await user.click(screen.getByRole('switch', { hidden: true }));

      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({ restoreTabs: false });
      expect(screen.getByRole('switch', { hidden: true })).not.toBeChecked();
    });

    it('shows that the tabs are reopened when the reader has left that on', async () => {
      await renderApp({ ...SETTINGS, restoreTabs: true });
      expect(screen.getByRole('switch', { hidden: true })).toBeChecked();
    });
  });

  describe('links', () => {
    it('opens a web link through the app and reports one that cannot be opened', async () => {
      const { bridge, show, user } = await renderApp();
      show('links.md', '[site](https://example.com/a)');
      bridge.openExternal.mockResolvedValueOnce(false);

      await user.click(await screen.findByRole('link', { name: 'site' }));

      expect(bridge.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/a');
      expect(await screen.findByRole('alert')).toHaveTextContent('That link could not be opened.');
    });

    it('follows a link to another document and goes back', async () => {
      const { bridge, show, navigate, user } = await renderApp();
      const id = show('index.md', '# Index\n\n[guide](guide.md)');
      bridge.openLink.mockImplementation(() =>
        Promise.resolve(navigate(id, 'guide.md', '# Guide')),
      );
      bridge.reopenDocument.mockImplementation(() =>
        Promise.resolve(navigate(id, 'index.md', '# Index\n\n[guide](guide.md)')),
      );

      await user.click(await screen.findByRole('link', { name: 'guide' }));
      expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();
      expect(bridge.openLink).toHaveBeenCalledExactlyOnceWith('file:///C:/docs/guide.md', {
        tabId: id,
      });

      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(await screen.findByRole('heading', { name: 'Index' })).toBeInTheDocument();
      expect(bridge.reopenDocument).toHaveBeenCalledExactlyOnceWith(id, 'C:\\docs\\index.md');
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });

    it('follows a link in the tab it was clicked in, whichever tab was opened last', async () => {
      const { bridge, show, navigate, user } = await renderApp();
      const first = show('index.md', '# Index\n\n[guide](guide.md)');
      show('other.md', '# Other');
      await screen.findByRole('heading', { name: 'Other' });
      await user.click(tab('index.md'));
      await screen.findByRole('heading', { name: 'Index' });
      bridge.openLink.mockImplementation(() =>
        Promise.resolve(navigate(first, 'guide.md', '# Guide')),
      );

      await user.click(await screen.findByRole('link', { name: 'guide' }));

      expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();
      expect(bridge.openLink).toHaveBeenCalledExactlyOnceWith('file:///C:/docs/guide.md', {
        tabId: first,
      });
      expect(screen.getAllByRole('tab').map((element) => element.textContent)).toEqual([
        'guide.md',
        'other.md',
      ]);
    });

    it('opens a link in a tab of its own when it is clicked with Ctrl held', async () => {
      const { bridge, show, createTab } = await renderApp();
      const first = show('index.md', '# Index\n\n[guide](guide.md)');
      bridge.openLink.mockImplementation(() => Promise.resolve(createTab('guide.md', '# Guide')));

      fireEvent.click(await screen.findByRole('link', { name: 'guide' }), { ctrlKey: true });

      expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();
      expect(bridge.openLink).toHaveBeenCalledExactlyOnceWith('file:///C:/docs/guide.md', {
        tabId: first,
        newTab: true,
      });
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });

    it('goes back with Alt+Left', async () => {
      const { bridge, show, navigate, user } = await renderApp();
      const id = show('index.md', '# Index\n\n[guide](guide.md)');
      bridge.openLink.mockImplementation(() =>
        Promise.resolve(navigate(id, 'guide.md', '# Guide')),
      );
      bridge.reopenDocument.mockImplementation(() =>
        Promise.resolve(navigate(id, 'index.md', '# Index')),
      );
      await user.click(await screen.findByRole('link', { name: 'guide' }));
      await screen.findByRole('heading', { name: 'Guide' });

      fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });

      expect(await screen.findByRole('heading', { name: 'Index' })).toBeInTheDocument();
    });
  });

  describe('dropping files', () => {
    function dropEvent(type: string, files: File[]): Event {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: { files, types: ['Files'], dropEffect: 'none' },
      });
      return event;
    }

    it('shows a hint while dragging and opens the dropped file', async () => {
      const { bridge, createTab } = await renderApp();
      bridge.openDroppedFiles.mockImplementation(() =>
        Promise.resolve([createTab('file.md', '# Dropped')]),
      );
      const file = new File(['# Dropped'], 'file.md');

      act(() => {
        window.dispatchEvent(dropEvent('dragenter', [file]));
      });
      expect(screen.getByText('Drop a Markdown file to open it')).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(dropEvent('drop', [file]));
      });

      expect(bridge.openDroppedFiles).toHaveBeenCalledExactlyOnceWith([file]);
      expect(await screen.findByRole('heading', { name: 'Dropped' })).toBeInTheDocument();
      expect(screen.queryByText('Drop a Markdown file to open it')).toBeNull();
    });

    it('opens every Markdown file that is dropped, each in a tab of its own', async () => {
      const { bridge, createTab } = await renderApp();
      bridge.openDroppedFiles.mockImplementation(() =>
        Promise.resolve([createTab('one.md', '# One'), createTab('two.md', '# Two')]),
      );
      const files = [new File(['# One'], 'one.md'), new File(['# Two'], 'two.md')];

      act(() => {
        window.dispatchEvent(dropEvent('drop', files));
      });

      expect(await screen.findByRole('heading', { name: 'Two' })).toBeInTheDocument();
      expect(bridge.openDroppedFiles).toHaveBeenCalledExactlyOnceWith(files);
      expect(screen.getAllByRole('tab')).toHaveLength(2);
    });

    it('explains when the location of a dropped item cannot be read', async () => {
      const { bridge } = await renderApp();
      bridge.openDroppedFiles.mockResolvedValue([
        failed('MD Reader could not read the location of the dropped item.'),
      ]);

      act(() => {
        window.dispatchEvent(dropEvent('drop', [new File(['x'], 'x.md')]));
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(/could not read the location/i);
    });

    it('explains a drop that the main process could not handle at all', async () => {
      const { bridge } = await renderApp();
      bridge.openDroppedFiles.mockRejectedValue(new Error('ipc closed'));

      act(() => {
        window.dispatchEvent(dropEvent('drop', [new File(['x'], 'x.md')]));
      });

      expect(await screen.findByRole('alert')).toBeInTheDocument();
    });
  });

  describe('updates', () => {
    const idle: UpdateState = { status: 'idle' };

    async function renderWithDocument(settings: Settings, state: UpdateState) {
      const harness = await renderApp(settings, state);
      harness.show('a.md', '# A');
      await screen.findByRole('heading', { name: 'A' });
      return harness;
    }

    it('shows nothing about updates in a build that cannot update', async () => {
      await renderApp({ ...SETTINGS, updateNoticeSeen: false });

      expect(screen.queryByRole('heading', { name: 'Updates' })).toBeNull();
      expect(screen.queryByText(/no information from your documents or settings/i)).toBeNull();
    });

    it('lists the version and an Updates section on the start screen, and checks on request', async () => {
      const { bridge, user } = await renderApp(SETTINGS, idle);
      expect(await screen.findByRole('heading', { name: 'Updates' })).toBeInTheDocument();
      expect(await screen.findByText('Version 1.0.0')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Check for updates' }));

      expect(bridge.checkForUpdates).toHaveBeenCalledOnce();
      expect(await screen.findByText('MD Reader 1.0.0 is up to date.')).toBeInTheDocument();
    });

    it('switches automatic updates off from the start screen and remembers it', async () => {
      const { bridge, user } = await renderApp(SETTINGS, idle);

      await user.click(await screen.findByRole('button', { name: 'Turn off automatic updates' }));

      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({ automaticUpdates: false });
    });

    it('explains automatic updates once and remembers that it was read', async () => {
      const { bridge, user } = await renderApp({ ...SETTINGS, updateNoticeSeen: false }, idle);
      expect(
        await screen.findByText(
          /installs them when you close the app.*no information from your documents or settings/i,
        ),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'OK' }));

      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({ updateNoticeSeen: true });
      expect(screen.queryByText(/no information from your documents or settings/i)).toBeNull();
    });

    it('explains it differently to a copy that only reports a newer version', async () => {
      await renderApp({ ...SETTINGS, updateNoticeSeen: false }, idle, false);

      const notice = await screen.findByRole('status', { name: 'Update notice' });

      expect(notice).toHaveTextContent(/tells you when one is available/i);
      expect(notice).not.toHaveTextContent(/install/i);
      expect(await screen.findByText('Automatic update checks are on.')).toBeInTheDocument();
    });

    it('waits to explain updates until it is known what this copy does with a new version', async () => {
      const harness = createBridge({ ...SETTINGS, updateNoticeSeen: false }, idle);
      harness.bridge.getAppInfo.mockReturnValue(new Promise(() => undefined));
      render(<App bridge={harness.bridge} />);
      await screen.findByRole('banner');

      await screen.findByRole('heading', { name: 'Updates' });

      expect(screen.queryByRole('status', { name: 'Update notice' })).toBeNull();
    });

    it('lets the reader decline from that explanation', async () => {
      const { bridge, user } = await renderApp({ ...SETTINGS, updateNoticeSeen: false }, idle);
      await screen.findByText(/no information from your documents or settings/i);

      await user.click(screen.getByRole('button', { name: 'Turn off' }));

      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({
        automaticUpdates: false,
        updateNoticeSeen: true,
      });
    });

    it('has nothing to explain to a reader who has already switched automatic updates off', async () => {
      await renderApp(
        { ...SETTINGS, automaticUpdates: false, updateNoticeSeen: false },
        { status: 'off' },
      );

      expect(await screen.findByRole('heading', { name: 'Updates' })).toBeInTheDocument();
      expect(screen.getByText('Automatic updates are off.')).toBeInTheDocument();
      expect(screen.queryByRole('status', { name: 'Update notice' })).toBeNull();
    });

    it('asks for an answer to the explanation instead of letting it be dismissed, which would leave it unread', async () => {
      await renderApp({ ...SETTINGS, updateNoticeSeen: false }, idle);
      await screen.findByRole('status', { name: 'Update notice' });

      expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    });

    it('tells the reader that a downloaded update installs on close, and restarts on request', async () => {
      const { bridge, pushUpdate, user } = await renderWithDocument(SETTINGS, idle);

      pushUpdate({ status: 'ready', version: '1.2.0' });

      expect(
        await screen.findByText('MD Reader 1.2.0 is ready. It installs when you close the app.'),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Restart now' }));
      expect(bridge.restartToUpdate).toHaveBeenCalledOnce();
    });

    it('lets the reader dismiss that notice, and shows it again for a newer version', async () => {
      const { pushUpdate, user } = await renderWithDocument(SETTINGS, idle);
      pushUpdate({ status: 'ready', version: '1.2.0' });
      await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByText(/MD Reader 1\.2\.0 is ready/)).toBeNull();

      pushUpdate({ status: 'ready', version: '1.3.0' });

      expect(await screen.findByText(/MD Reader 1\.3\.0 is ready/)).toBeInTheDocument();
    });

    it('offers the download page when this copy cannot install the update itself', async () => {
      const { bridge, pushUpdate, user } = await renderWithDocument(SETTINGS, idle);
      const releaseUrl = 'https://github.com/abhijithkm/md-reader/releases/tag/v1.2.0';

      pushUpdate({ status: 'available', version: '1.2.0', releaseUrl });

      expect(await screen.findByText('MD Reader 1.2.0 is available.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Open download page' }));
      expect(bridge.openExternal).toHaveBeenCalledExactlyOnceWith(releaseUrl);
    });

    it('keeps updates out of the way while a document is being read', async () => {
      await renderWithDocument(SETTINGS, idle);

      expect(screen.queryByRole('heading', { name: 'Updates' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
    });
  });

  describe('windows integration', () => {
    it('closes the window with Ctrl+W when no tab is open', async () => {
      const { bridge } = await renderApp();

      fireEvent.keyDown(window, { key: 'w', ctrlKey: true });

      expect(bridge.closeWindow).toHaveBeenCalledOnce();
      expect(bridge.closeTab).not.toHaveBeenCalled();
    });

    it('closes the tab with Ctrl+W, and the window with it when it was the last', async () => {
      const { bridge, show } = await renderApp();
      const id = show('a.md', '# Alpha');
      await screen.findByRole('heading', { name: 'Alpha' });

      fireEvent.keyDown(window, { key: 'w', ctrlKey: true });

      expect(bridge.closeTab).toHaveBeenCalledExactlyOnceWith(id);
      expect(bridge.closeWindow).toHaveBeenCalledOnce();
    });

    it('closes only the tab with Ctrl+W when there are others', async () => {
      const { bridge, show } = await renderApp();
      show('a.md', '# Alpha');
      const second = show('b.md', '# Beta');
      await screen.findByRole('heading', { name: 'Beta' });

      fireEvent.keyDown(window, { key: 'w', ctrlKey: true });

      expect(bridge.closeTab).toHaveBeenCalledExactlyOnceWith(second);
      expect(bridge.closeWindow).not.toHaveBeenCalled();
    });

    it('closes the window with Ctrl+Shift+W, whatever is open', async () => {
      const { bridge, show } = await renderApp();
      show('a.md', '# Alpha');
      show('b.md', '# Beta');
      await screen.findByRole('heading', { name: 'Beta' });

      fireEvent.keyDown(window, { key: 'w', ctrlKey: true, shiftKey: true });

      expect(bridge.closeWindow).toHaveBeenCalledOnce();
      expect(bridge.closeTab).not.toHaveBeenCalled();
    });

    it('opens the Windows Default apps page from the empty state', async () => {
      const { bridge, user } = await renderApp();
      await user.click(screen.getByRole('button', { name: 'Open Default apps settings' }));
      expect(bridge.openDefaultAppsSettings).toHaveBeenCalledOnce();
    });
  });
});
