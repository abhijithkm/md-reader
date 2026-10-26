import { Suspense, use, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TabsSnapshot } from '../../shared/tabs';
import type { MarkdownDocument, OpenOutcome } from '../../shared/types';
import type { WorkspaceBridge } from '../workspace';
import { useWorkspace } from './useWorkspace';

function doc(name: string): MarkdownDocument {
  return {
    path: `C:\\docs\\${name}`,
    name,
    directory: 'C:\\docs',
    baseUrl: 'file:///C:/docs/',
    content: `# ${name}`,
    sizeBytes: 5,
    modifiedMs: 1,
    encoding: 'utf-8',
  };
}

const opened = (tabId: string, name: string): OpenOutcome => ({
  status: 'opened',
  tabId,
  document: doc(name),
});

const canceled: OpenOutcome = { status: 'canceled' };

/** Two tabs; the first shows `first`, which a link can change. */
const snapshot = (version: number, active: string, first = 'a.md'): TabsSnapshot => ({
  version,
  activeId: active,
  tabs: [
    { id: 'tab-1', path: `C:\\docs\\${first}` },
    { id: 'tab-2', path: 'C:\\docs\\b.md' },
  ],
});

function createBridge(initial: TabsSnapshot = { tabs: [], activeId: undefined, version: 0 }) {
  let documentListener: ((outcome: OpenOutcome) => void) | undefined;
  let tabsListener: ((next: TabsSnapshot) => void) | undefined;
  const stopDocuments = vi.fn();
  const stopTabs = vi.fn();
  const bridge = {
    onDocumentOpened: vi.fn((listener: (outcome: OpenOutcome) => void) => {
      documentListener = listener;
      return stopDocuments;
    }),
    onTabsChanged: vi.fn((listener: (next: TabsSnapshot) => void) => {
      tabsListener = listener;
      return stopTabs;
    }),
    getTabs: vi.fn<() => Promise<TabsSnapshot>>(() => Promise.resolve(initial)),
    notifyReady: vi.fn(() => Promise.resolve()),
    openFileDialog: vi.fn<() => Promise<OpenOutcome[]>>(),
    openDroppedFiles: vi.fn<(files: File[]) => Promise<OpenOutcome[]>>(),
    reopenDocument: vi.fn<WorkspaceBridge['reopenDocument']>(() => Promise.resolve(canceled)),
    openLink: vi.fn<WorkspaceBridge['openLink']>(() => Promise.resolve(canceled)),
    reloadDocument: vi.fn<WorkspaceBridge['reloadDocument']>(() => Promise.resolve(canceled)),
    activateTab: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
    closeTab: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
    moveTab: vi.fn<(id: string, toIndex: number) => Promise<void>>(() => Promise.resolve()),
    loadTab: vi.fn<(id: string) => Promise<OpenOutcome>>(() => Promise.resolve(canceled)),
  } satisfies WorkspaceBridge;
  return {
    bridge,
    stopDocuments,
    stopTabs,
    pushDocument: (outcome: OpenOutcome) => {
      act(() => {
        documentListener?.(outcome);
      });
    },
    pushTabs: (next: TabsSnapshot) => {
      act(() => {
        tabsListener?.(next);
      });
    },
  };
}

/** A hook that has started, been told about two tabs with a document each, and has tab-1 on screen. */
async function readingTwoTabs() {
  const harness = createBridge(snapshot(1, 'tab-1'));
  const rendered = renderHook(() => useWorkspace(harness.bridge, { getScrollTop: () => 0 }));
  await waitFor(() => {
    expect(rendered.result.current.ready).toBe(true);
  });
  harness.pushDocument(opened('tab-1', 'a.md'));
  harness.pushDocument(opened('tab-2', 'b.md'));
  return { ...harness, ...rendered };
}

describe('useWorkspace', () => {
  it('is not ready until the main process has said which tabs there are', async () => {
    const { bridge } = createBridge();
    const { result } = renderHook(() => useWorkspace(bridge, { getScrollTop: () => 0 }));
    expect(result.current.ready).toBe(false);

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTab).toBeUndefined();
    expect(result.current.document).toBeUndefined();
  });

  it('follows the tabs, and shows the document of the tab on screen', async () => {
    const { result, pushTabs } = await readingTwoTabs();
    expect(result.current.document?.name).toBe('a.md');
    expect(result.current.activeTab).toEqual({ id: 'tab-1', path: 'C:\\docs\\a.md' });

    pushTabs(snapshot(2, 'tab-2'));

    expect(result.current.document?.name).toBe('b.md');
    expect(result.current.activeId).toBe('tab-2');
  });

  it('says why a tab has nothing to show when its file could not be read', async () => {
    const { bridge } = createBridge(snapshot(1, 'tab-1'));
    bridge.loadTab.mockResolvedValue({
      status: 'failed',
      error: { code: 'not-found', message: '"a.md" could not be found.' },
    });

    const { result } = renderHook(() => useWorkspace(bridge, { getScrollTop: () => 0 }));

    await waitFor(() => {
      expect(result.current.problem).toBe('"a.md" could not be found.');
    });
    expect(result.current.document).toBeUndefined();
  });

  it('offers Back only for the tab that has somewhere to go back to', async () => {
    const { bridge, result, pushTabs } = await readingTwoTabs();
    bridge.openLink.mockImplementation(() => {
      pushTabs(snapshot(2, 'tab-1', 'guide.md'));
      return Promise.resolve(opened('tab-1', 'guide.md'));
    });
    expect(result.current.canGoBack).toBe(false);

    await act(() => result.current.openLink('file:///C:/docs/guide.md'));
    expect(result.current.canGoBack).toBe(true);

    pushTabs(snapshot(3, 'tab-2', 'guide.md'));
    expect(result.current.canGoBack).toBe(false);
  });

  it('says that it is waiting while a request to the main process is on its way', async () => {
    const { bridge } = createBridge(snapshot(1, 'tab-1'));
    let answer: (outcomes: OpenOutcome[]) => void = () => undefined;
    bridge.openFileDialog.mockReturnValue(
      new Promise<OpenOutcome[]>((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = renderHook(() => useWorkspace(bridge, { getScrollTop: () => 0 }));
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = result.current.openFile();
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await act(async () => {
      answer([opened('tab-1', 'a.md')]);
      await opening;
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  describe('a link, Back, a reload and a retry', () => {
    it('follow the tab that is on screen, whichever it is', async () => {
      const { bridge, result, pushTabs } = await readingTwoTabs();

      await act(() => result.current.openLink('file:///C:/docs/x.md'));
      pushTabs(snapshot(2, 'tab-2'));
      await act(() => result.current.openLink('file:///C:/docs/y.md'));
      await act(() => result.current.openLink('file:///C:/docs/z.md', { newTab: true }));

      expect(bridge.openLink.mock.calls).toEqual([
        ['file:///C:/docs/x.md', { tabId: 'tab-1' }],
        ['file:///C:/docs/y.md', { tabId: 'tab-2' }],
        ['file:///C:/docs/z.md', { tabId: 'tab-2', newTab: true }],
      ]);
    });

    it('reload the document of the tab on screen', async () => {
      const { bridge, result, pushTabs } = await readingTwoTabs();

      await act(() => result.current.reload());
      pushTabs(snapshot(2, 'tab-2'));
      await act(() => result.current.reload());

      expect(bridge.reloadDocument.mock.calls).toEqual([['tab-1'], ['tab-2']]);
    });

    it('go back in the tab on screen', async () => {
      const { bridge, result, pushTabs } = await readingTwoTabs();
      bridge.openLink.mockImplementation(() => {
        pushTabs(snapshot(2, 'tab-1', 'guide.md'));
        return Promise.resolve(opened('tab-1', 'guide.md'));
      });
      await act(() => result.current.openLink('file:///C:/docs/guide.md'));

      await act(() => result.current.goBack());

      expect(bridge.reopenDocument).toHaveBeenCalledExactlyOnceWith('tab-1', 'C:\\docs\\a.md');
    });

    it('read the tab on screen again when its file could not be read', async () => {
      const { bridge } = createBridge(snapshot(1, 'tab-1'));
      bridge.loadTab.mockResolvedValueOnce({
        status: 'failed',
        error: { code: 'not-found', message: '"a.md" could not be found.' },
      });
      const { result } = renderHook(() => useWorkspace(bridge, { getScrollTop: () => 0 }));
      await waitFor(() => {
        expect(result.current.problem).toBeDefined();
      });
      bridge.loadTab.mockResolvedValue(opened('tab-1', 'a.md'));

      act(() => {
        result.current.retry();
      });

      await waitFor(() => {
        expect(result.current.document?.name).toBe('a.md');
      });
      expect(bridge.loadTab.mock.calls).toEqual([['tab-1'], ['tab-1']]);
    });

    it('keep the scroll position the page reported with the latest function it was given', async () => {
      const harness = createBridge(snapshot(1, 'tab-1'));
      const { result, rerender } = renderHook(
        ({ getScrollTop }) => useWorkspace(harness.bridge, { getScrollTop }),
        { initialProps: { getScrollTop: () => 0 } },
      );
      await waitFor(() => {
        expect(result.current.ready).toBe(true);
      });
      harness.pushDocument(opened('tab-1', 'a.md'));
      rerender({ getScrollTop: () => 420 });
      harness.bridge.openLink.mockImplementation(() => {
        harness.pushTabs(snapshot(2, 'tab-1', 'guide.md'));
        return Promise.resolve(opened('tab-1', 'guide.md'));
      });
      await act(() => result.current.openLink('file:///C:/docs/guide.md'));
      harness.bridge.reopenDocument.mockImplementation(() => {
        harness.pushTabs(snapshot(3, 'tab-1'));
        return Promise.resolve(opened('tab-1', 'a.md'));
      });

      await act(() => result.current.goBack());

      expect(result.current.scrollRequest).toMatchObject({ top: 420 });
    });

    // The reader is looking at the tab that was last drawn. The workspace may know of another by
    // now, because the page takes its time to draw: a click in the old one is a click in the old one.
    it('are for the tab that is drawn, and not for the one the workspace has moved on to', async () => {
      const harness = createBridge(snapshot(1, 'tab-1'));
      let slow = false;
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Suspense fallback={null}>{children}</Suspense>
      );
      const { result } = renderHook(
        () => {
          const workspace = useWorkspace(harness.bridge, { getScrollTop: () => 0 });
          // The page cannot draw the second tab until it is released.
          if (slow && workspace.activeId === 'tab-2') use(held);
          return workspace;
        },
        { wrapper },
      );
      await waitFor(() => {
        expect(result.current.ready).toBe(true);
      });
      harness.pushDocument(opened('tab-1', 'a.md'));
      harness.pushDocument(opened('tab-2', 'b.md'));
      harness.bridge.openLink.mockImplementationOnce(() => {
        harness.pushTabs(snapshot(2, 'tab-1', 'guide.md'));
        return Promise.resolve(opened('tab-1', 'guide.md'));
      });
      await act(() => result.current.openLink('file:///C:/docs/guide.md'));
      harness.bridge.openLink.mockClear();
      slow = true;

      await act(async () => {
        harness.bridge.onTabsChanged.mock.calls[0]?.[0](snapshot(3, 'tab-2', 'guide.md'));
        await Promise.resolve();
      });
      expect(result.current.activeId).toBe('tab-1');
      await act(() => result.current.openLink('file:///C:/docs/x.md'));
      await act(() => result.current.reload());

      expect(harness.bridge.openLink).toHaveBeenCalledExactlyOnceWith('file:///C:/docs/x.md', {
        tabId: 'tab-1',
      });
      expect(harness.bridge.reloadDocument).toHaveBeenCalledExactlyOnceWith('tab-1');
      await act(() => result.current.goBack());
      expect(harness.bridge.reopenDocument).toHaveBeenCalledExactlyOnceWith(
        'tab-1',
        'C:\\docs\\a.md',
      );

      slow = false;
      await act(async () => {
        release();
        await held;
      });
      await waitFor(() => {
        expect(result.current.activeId).toBe('tab-2');
      });
    });
  });

  describe('noteScrolled', () => {
    it('gives the reader back the place they had scrolled to in each tab', async () => {
      const { result, pushTabs } = await readingTwoTabs();

      act(() => {
        result.current.noteScrolled(240);
      });
      pushTabs(snapshot(2, 'tab-2'));
      act(() => {
        result.current.noteScrolled(500);
      });
      pushTabs(snapshot(3, 'tab-1'));
      expect(result.current.scrollRequest).toMatchObject({ top: 240 });
      pushTabs(snapshot(4, 'tab-2'));
      expect(result.current.scrollRequest).toMatchObject({ top: 500 });
    });

    it('is about the tab and the drawing it was handed out for', async () => {
      const { result, pushTabs } = await readingTwoTabs();
      const forFirstTab = result.current.noteScrolled;
      pushTabs(snapshot(2, 'tab-2'));

      // The first tab's view, still wired up to a scroll event that arrives late.
      act(() => {
        forFirstTab(900);
      });
      pushTabs(snapshot(3, 'tab-1'));
      expect(result.current.scrollRequest).toMatchObject({ top: 0 });

      // Nor is it taken for the tab that is on screen by then.
      pushTabs(snapshot(4, 'tab-2'));
      expect(result.current.scrollRequest).toMatchObject({ top: 0 });
    });
  });

  it('stops listening to the main process when the page goes away', async () => {
    const { bridge, stopDocuments, stopTabs } = createBridge();
    const { result, unmount } = renderHook(() => useWorkspace(bridge, { getScrollTop: () => 0 }));
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    unmount();

    expect(stopDocuments).toHaveBeenCalledOnce();
    expect(stopTabs).toHaveBeenCalledOnce();
  });

  it('hands out the same functions every time, so that components that depend on them are not redrawn for nothing', async () => {
    const { result, pushTabs } = await readingTwoTabs();
    const before = result.current;

    pushTabs(snapshot(2, 'tab-2'));

    expect(result.current.activateTab).toBe(before.activateTab);
    expect(result.current.openFile).toBe(before.openFile);
    expect(result.current.openLink).toBe(before.openLink);
    expect(result.current.reload).toBe(before.reload);
    expect(result.current.goBack).toBe(before.goBack);
    expect(result.current.retry).toBe(before.retry);
    expect(result.current.report).toBe(before.report);
  });
});
