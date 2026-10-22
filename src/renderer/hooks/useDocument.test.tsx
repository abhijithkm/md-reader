import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MarkdownDocument, OpenOutcome } from '../../shared/types';
import { useDocument } from './useDocument';

function doc(name: string, content = `# ${name}`): MarkdownDocument {
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

const opened = (name: string, anchor?: string): OpenOutcome => ({
  status: 'opened',
  document: doc(name),
  ...(anchor === undefined ? {} : { anchor }),
});

const failed = (message: string): OpenOutcome => ({
  status: 'failed',
  error: { code: 'not-found', message },
});

function createBridge() {
  let listener: ((outcome: OpenOutcome) => void) | undefined;
  const unsubscribe = vi.fn(() => {
    listener = undefined;
  });
  const bridge = {
    onDocumentOpened: vi.fn((callback: (outcome: OpenOutcome) => void) => {
      listener = callback;
      return unsubscribe;
    }),
    notifyReady: vi.fn(() => Promise.resolve()),
    openFileDialog: vi.fn<() => Promise<OpenOutcome>>(),
    openDroppedFile: vi.fn<(file: File) => Promise<OpenOutcome>>(),
    reopenDocument: vi.fn<(path: string) => Promise<OpenOutcome>>(),
    openLink: vi.fn<(url: string) => Promise<OpenOutcome>>(),
    reloadDocument: vi.fn<() => Promise<OpenOutcome>>(),
  };
  return {
    bridge,
    unsubscribe,
    push(outcome: OpenOutcome) {
      act(() => {
        listener?.(outcome);
      });
    },
  };
}

function setup(scrollTop = 0) {
  const harness = createBridge();
  const getScrollTop = vi.fn(() => scrollTop);
  const view = renderHook(() => useDocument(harness.bridge, { getScrollTop }));
  return { ...harness, ...view, getScrollTop };
}

describe('useDocument', () => {
  describe('documents arriving from outside the page', () => {
    it('subscribes first and only then tells the main process the page is ready', () => {
      const { bridge } = setup();

      expect(bridge.onDocumentOpened).toHaveBeenCalledOnce();
      expect(bridge.notifyReady).toHaveBeenCalledOnce();
      expect(bridge.onDocumentOpened.mock.invocationCallOrder[0]).toBeLessThan(
        bridge.notifyReady.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('shows a document that the main process pushes', () => {
      const { result, push } = setup();

      push(opened('first.md'));

      expect(result.current.document?.name).toBe('first.md');
      expect(result.current.notice).toBeUndefined();
    });

    it('explains a failed open but keeps the document that is on screen', () => {
      const { result, push } = setup();
      push(opened('first.md'));

      push(failed('"gone.md" could not be found.'));

      expect(result.current.document?.name).toBe('first.md');
      expect(result.current.notice).toMatchObject({
        kind: 'error',
        message: '"gone.md" could not be found.',
      });
    });

    it('stops listening when the page goes away', () => {
      const { unmount, unsubscribe } = setup();
      unmount();
      expect(unsubscribe).toHaveBeenCalledOnce();
    });
  });

  describe('opening from the page', () => {
    it('opens the file chosen in the dialog', async () => {
      const { result, bridge } = setup();
      bridge.openFileDialog.mockResolvedValue(opened('chosen.md'));

      await act(() => result.current.openFile());

      expect(result.current.document?.name).toBe('chosen.md');
    });

    it('changes nothing when the dialog is cancelled', async () => {
      const { result, bridge, push } = setup();
      push(opened('first.md'));
      bridge.openFileDialog.mockResolvedValue({ status: 'canceled' });

      await act(() => result.current.openFile());

      expect(result.current.document?.name).toBe('first.md');
      expect(result.current.notice).toBeUndefined();
    });

    it('opens a dropped file, handing the File itself to the main process side', async () => {
      const { result, bridge } = setup();
      const file = new File(['# dropped'], 'dropped.md');
      bridge.openDroppedFile.mockResolvedValue(opened('dropped.md'));

      await act(() => result.current.openDropped(file));

      expect(bridge.openDroppedFile).toHaveBeenCalledExactlyOnceWith(file);
      expect(result.current.document?.name).toBe('dropped.md');
    });

    it('clears an earlier error once something opens successfully', async () => {
      const { result, bridge, push } = setup();
      push(failed('nope'));
      expect(result.current.notice).toBeDefined();
      bridge.openDroppedFile.mockResolvedValue(opened('ok.md'));

      await act(() => result.current.openDropped(new File([''], 'ok.md')));

      expect(result.current.notice).toBeUndefined();
    });

    it('shows an error if the request to the main process itself fails', async () => {
      const { result, bridge } = setup();
      bridge.openFileDialog.mockRejectedValue(new Error('ipc closed'));

      await act(() => result.current.openFile());

      expect(result.current.notice).toMatchObject({ kind: 'error' });
    });

    it('lets the app report a problem of its own', () => {
      const { result } = setup();

      act(() => {
        result.current.report('That link could not be opened.');
      });

      expect(result.current.notice).toMatchObject({
        kind: 'error',
        message: 'That link could not be opened.',
      });
    });

    it('lets the user dismiss a notice', () => {
      const { result, push } = setup();
      push(failed('nope'));

      act(() => {
        result.current.dismissNotice();
      });

      expect(result.current.notice).toBeUndefined();
    });

    it('only applies the newest of two overlapping requests', async () => {
      const { result, bridge } = setup();
      let finishSlow: (outcome: OpenOutcome) => void = () => undefined;
      bridge.openFileDialog.mockReturnValue(
        new Promise<OpenOutcome>((resolve) => {
          finishSlow = resolve;
        }),
      );
      bridge.openDroppedFile.mockResolvedValue(opened('fast.md'));

      let slow: Promise<void> = Promise.resolve();
      act(() => {
        slow = result.current.openFile();
      });
      await act(() => result.current.openDropped(new File([''], 'fast.md')));
      await act(async () => {
        finishSlow(opened('slow.md'));
        await slow;
      });

      expect(result.current.document?.name).toBe('fast.md');
    });
  });

  describe('following links and going back', () => {
    it('opens a linked document and remembers where the reader was', async () => {
      const { result, bridge, push } = setup(240);
      push(opened('index.md'));
      bridge.openLink.mockResolvedValue(opened('guide.md'));
      expect(result.current.canGoBack).toBe(false);

      await act(() => result.current.openLink('file:///C:/docs/guide.md'));

      expect(result.current.document?.name).toBe('guide.md');
      expect(result.current.canGoBack).toBe(true);
    });

    it('goes back to the previous document at the previous scroll position', async () => {
      const { result, bridge, push } = setup(240);
      push(opened('index.md'));
      bridge.openLink.mockResolvedValue(opened('guide.md'));
      await act(() => result.current.openLink('file:///C:/docs/guide.md'));
      bridge.reopenDocument.mockResolvedValue(opened('index.md'));

      await act(() => result.current.goBack());

      expect(bridge.reopenDocument).toHaveBeenCalledExactlyOnceWith('C:\\docs\\index.md');
      expect(result.current.document?.name).toBe('index.md');
      expect(result.current.scrollRequest).toMatchObject({ top: 240 });
      expect(result.current.canGoBack).toBe(false);
    });

    it('asks to scroll to the section a link points at', async () => {
      const { result, bridge, push } = setup();
      push(opened('index.md'));
      bridge.openLink.mockResolvedValue(opened('guide.md', 'install'));

      await act(() => result.current.openLink('file:///C:/docs/guide.md#install'));

      expect(result.current.scrollRequest).toMatchObject({ anchor: 'install' });
    });

    it('does not record history for a link that failed to open', async () => {
      const { result, bridge, push } = setup();
      push(opened('index.md'));
      bridge.openLink.mockResolvedValue(failed('blocked'));

      await act(() => result.current.openLink('file:///C:/docs/nope.md'));

      expect(result.current.canGoBack).toBe(false);
      expect(result.current.document?.name).toBe('index.md');
    });

    it('forgets the history when the reader opens something deliberately', async () => {
      const { result, bridge, push } = setup();
      push(opened('index.md'));
      bridge.openLink.mockResolvedValue(opened('guide.md'));
      await act(() => result.current.openLink('file:///C:/docs/guide.md'));
      bridge.openFileDialog.mockResolvedValue(opened('other.md'));

      await act(() => result.current.openFile());

      expect(result.current.canGoBack).toBe(false);
    });

    it('forgets the history when the main process opens a document', async () => {
      const { result, bridge, push } = setup();
      push(opened('index.md'));
      bridge.openLink.mockResolvedValue(opened('guide.md'));
      await act(() => result.current.openLink('file:///C:/docs/guide.md'));

      push(opened('from-explorer.md'));

      expect(result.current.canGoBack).toBe(false);
    });
  });

  describe('reloading', () => {
    it('shows the new content and keeps the scroll position', async () => {
      const { result, bridge, push } = setup(300);
      push(opened('live.md'));
      bridge.reloadDocument.mockResolvedValue({
        status: 'opened',
        document: doc('live.md', '# changed'),
      });

      await act(() => result.current.reload());

      expect(result.current.document?.content).toBe('# changed');
      expect(result.current.scrollRequest).toMatchObject({ top: 300 });
    });

    it('keeps the old content and explains the problem when the file has gone', async () => {
      const { result, bridge, push } = setup();
      push(opened('live.md'));
      bridge.reloadDocument.mockResolvedValue(failed('"live.md" could not be found.'));

      await act(() => result.current.reload());

      expect(result.current.document?.content).toBe('# live.md');
      expect(result.current.notice).toMatchObject({ kind: 'error' });
    });
  });

  it('reports when it is waiting for the main process', async () => {
    const { result, bridge } = setup();
    let finish: (outcome: OpenOutcome) => void = () => undefined;
    bridge.openDroppedFile.mockReturnValue(
      new Promise<OpenOutcome>((resolve) => {
        finish = resolve;
      }),
    );

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.openDropped(new File([''], 'a.md'));
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      finish(opened('a.md'));
      await pending;
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });
});
