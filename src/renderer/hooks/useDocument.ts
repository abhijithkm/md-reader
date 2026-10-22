import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { MdReaderApi } from '../../shared/ipc';
import type { MarkdownDocument, OpenOutcome } from '../../shared/types';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  message: string;
}

/** Tells the document view where to scroll after new content is shown. */
export interface ScrollRequest {
  /** Changes with every request so the view reacts even to identical positions. */
  token: number;
  top?: number;
  anchor?: string;
}

export interface DocumentController {
  document: MarkdownDocument | undefined;
  notice: Notice | undefined;
  scrollRequest: ScrollRequest;
  loading: boolean;
  canGoBack: boolean;
  openFile: () => Promise<void>;
  /** Opens a file the user dropped on the window. */
  openDropped: (file: File) => Promise<void>;
  openLink: (fileUrl: string) => Promise<void>;
  reload: () => Promise<void>;
  goBack: () => Promise<void>;
  dismissNotice: () => void;
  /** Shows a problem the app found itself, such as a link that cannot be opened. */
  report: (message: string) => void;
}

export type DocumentBridge = Pick<
  MdReaderApi,
  | 'onDocumentOpened'
  | 'notifyReady'
  | 'openFileDialog'
  | 'openDroppedFile'
  | 'reopenDocument'
  | 'openLink'
  | 'reloadDocument'
>;

interface HistoryEntry {
  path: string;
  scrollTop: number;
}

const REQUEST_FAILED = 'MD Reader could not complete that request. Please try again.';

/**
 * The document on screen and everything that changes it: files chosen in the
 * dialog, dropped on the window, opened from Explorer (pushed by the main
 * process), followed from a link, or reloaded.
 *
 * - A failed open never replaces the document; it shows a notice instead.
 * - Only the newest request counts, so a slow earlier one cannot overwrite it.
 * - Links add to a back stack; deliberately opening a file starts over.
 */
export function useDocument(
  bridge: DocumentBridge,
  options: { getScrollTop: () => number },
): DocumentController {
  const [document, setDocument] = useState<MarkdownDocument | undefined>(undefined);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest>({ token: 0 });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pending, setPending] = useState(0);

  const latestDocument = useRef(document);
  const latestHistory = useRef(history);
  const latestGetScrollTop = useRef(options.getScrollTop);
  useEffect(() => {
    latestDocument.current = document;
    latestHistory.current = history;
    latestGetScrollTop.current = options.getScrollTop;
  });

  const requestId = useRef(0);
  const scrollToken = useRef(0);
  const noticeId = useRef(0);

  const report = useCallback((message: string): void => {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, kind: 'error', message });
  }, []);

  /** Shows the result of an open request. `scrollTop` is where to put the reader afterwards. */
  const present = useCallback(
    (outcome: OpenOutcome, how: { clearHistory?: boolean; scrollTop?: number } = {}): void => {
      if (outcome.status === 'canceled') return;
      if (outcome.status === 'failed') {
        report(outcome.error.message);
        return;
      }

      scrollToken.current += 1;
      const request: ScrollRequest =
        outcome.anchor === undefined
          ? { token: scrollToken.current, top: how.scrollTop ?? 0 }
          : { token: scrollToken.current, anchor: outcome.anchor };

      setNotice(undefined);
      if (how.clearHistory === true) setHistory([]);
      // A large document can take a moment to render; keep the interface responsive meanwhile.
      startTransition(() => {
        setDocument(outcome.document);
        setScrollRequest(request);
      });
    },
    [report],
  );

  /** Runs a request to the main process; resolves to undefined if a newer request replaced it. */
  const run = useCallback(
    async (request: () => Promise<OpenOutcome>): Promise<OpenOutcome | undefined> => {
      requestId.current += 1;
      const myId = requestId.current;
      setPending((count) => count + 1);
      try {
        const outcome = await request().catch((): OpenOutcome => ({
          status: 'failed',
          error: { code: 'unreadable', message: REQUEST_FAILED },
        }));
        return myId === requestId.current ? outcome : undefined;
      } finally {
        setPending((count) => count - 1);
      }
    },
    [],
  );

  useEffect(() => {
    const unsubscribe = bridge.onDocumentOpened((outcome) => {
      requestId.current += 1; // whatever the page was waiting for is now out of date
      present(outcome, { clearHistory: outcome.status === 'opened' });
    });
    // Only now can the main process safely deliver a file that was queued during startup.
    bridge.notifyReady().catch(() => undefined);
    return unsubscribe;
  }, [bridge, present]);

  const openChosen = useCallback(
    async (request: () => Promise<OpenOutcome>): Promise<void> => {
      const outcome = await run(request);
      if (outcome !== undefined) present(outcome, { clearHistory: outcome.status === 'opened' });
    },
    [run, present],
  );

  const openFile = useCallback(
    () => openChosen(() => bridge.openFileDialog()),
    [bridge, openChosen],
  );

  const openDropped = useCallback(
    (file: File) => openChosen(() => bridge.openDroppedFile(file)),
    [bridge, openChosen],
  );

  const openLink = useCallback(
    async (fileUrl: string): Promise<void> => {
      const from = latestDocument.current;
      const entry: HistoryEntry | undefined =
        from === undefined
          ? undefined
          : { path: from.path, scrollTop: latestGetScrollTop.current() };

      const outcome = await run(() => bridge.openLink(fileUrl));
      if (outcome === undefined) return;
      if (outcome.status === 'opened' && entry !== undefined) {
        setHistory((stack) => [...stack, entry]);
      }
      present(outcome);
    },
    [bridge, run, present],
  );

  const goBack = useCallback(async (): Promise<void> => {
    const entry = latestHistory.current.at(-1);
    if (entry === undefined) return;

    const outcome = await run(() => bridge.reopenDocument(entry.path));
    if (outcome === undefined) return;
    if (outcome.status === 'opened') setHistory((stack) => stack.slice(0, -1));
    present(outcome, { scrollTop: entry.scrollTop });
  }, [bridge, run, present]);

  const reload = useCallback(async (): Promise<void> => {
    const scrollTop = latestGetScrollTop.current();
    const outcome = await run(() => bridge.reloadDocument());
    if (outcome !== undefined) present(outcome, { scrollTop });
  }, [bridge, run, present]);

  const dismissNotice = useCallback((): void => {
    setNotice(undefined);
  }, []);

  return {
    document,
    notice,
    scrollRequest,
    loading: pending > 0,
    canGoBack: history.length > 0,
    openFile,
    openDropped,
    openLink,
    reload,
    goBack,
    dismissNotice,
    report,
  };
}
