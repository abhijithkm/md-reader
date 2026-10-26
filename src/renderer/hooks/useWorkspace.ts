import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LinkWish, TabInfo } from '../../shared/tabs';
import type { MarkdownDocument } from '../../shared/types';
import {
  activeView,
  Workspace,
  type Notice,
  type ScrollRequest,
  type WorkspaceBridge,
} from '../workspace';

export interface WorkspaceController {
  /** False until the main process has said which tabs there are. */
  ready: boolean;
  tabs: readonly TabInfo[];
  activeId: string | undefined;
  /** The tab on screen. */
  activeTab: TabInfo | undefined;
  /** What the tab on screen shows, once it has been read. */
  document: MarkdownDocument | undefined;
  /** Why the tab on screen has nothing to show, when its file could not be read. */
  problem: string | undefined;
  notice: Notice | undefined;
  scrollRequest: ScrollRequest;
  /** True while the main process is being waited for. */
  loading: boolean;
  canGoBack: boolean;
  openFile: () => Promise<void>;
  /** Opens files the user dropped on the window. */
  openDropped: (files: File[]) => Promise<void>;
  /** Follows a link in the tab that is on screen, or opens it in a tab of its own. */
  openLink: (fileUrl: string, wish?: LinkWish) => Promise<void>;
  /** Reads the document on screen from disk again. */
  reload: () => Promise<void>;
  /** Goes back, in the tab on screen, to the document a link was followed from. */
  goBack: () => Promise<void>;
  /** Tries again to read the tab on screen, when its file could not be read. */
  retry: () => void;
  /** Tells the workspace where the reader has scrolled to in the document on screen. */
  noteScrolled: (top: number) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  moveTab: (id: string, toIndex: number) => void;
  nextTab: () => void;
  previousTab: () => void;
  moveActiveTab: (by: -1 | 1) => void;
  dismissNotice: () => void;
  /** Shows a problem the app found itself, such as a link that cannot be opened. */
  report: (message: string) => void;
}

/**
 * The tabs and what they show, for the page. The logic is in `Workspace`; this lets React follow it.
 * Each change is shown as a transition, so that a large document that takes a moment to render does not
 * hold up the page: what is on screen stays in place and stays usable until the new page is ready.
 *
 * "The tab on screen" is the one the page has drawn, which is what the reader is looking at when they
 * click a link, press Back or reload. The workspace may already know of another (the main process
 * moved on, and the page has not caught up), so those calls name the tab they are for.
 */
export function useWorkspace(
  bridge: WorkspaceBridge,
  options: { getScrollTop: () => number },
): WorkspaceController {
  const [workspace] = useState(() => new Workspace(bridge, options.getScrollTop));
  const [state, setState] = useState(workspace.getState);

  // The function that reads the page's scroll position may change between renders.
  useEffect(() => {
    workspace.readScrollWith(options.getScrollTop);
  });

  useEffect(() => {
    const unsubscribe = workspace.subscribe(() => {
      startTransition(() => {
        setState(workspace.getState());
      });
    });
    const stop = workspace.start();
    return () => {
      stop();
      unsubscribe();
    };
  }, [workspace]);

  // Set as soon as a drawing is on the page, before the reader can do anything in it.
  const drawn = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    drawn.current = state.activeId;
  });

  const openLink = useCallback(
    (fileUrl: string, wish?: LinkWish) => workspace.openLink(drawn.current, fileUrl, wish),
    [workspace],
  );
  const reload = useCallback(() => workspace.reload(drawn.current), [workspace]);
  const goBack = useCallback(() => workspace.goBack(drawn.current), [workspace]);
  const retry = useCallback(() => {
    workspace.retry(drawn.current);
  }, [workspace]);

  // Not from `drawn`: this is what was drawn for the scroll that is being reported, by construction.
  const { activeId, scrollRequest } = state;
  const noteScrolled = useCallback(
    (top: number) => {
      workspace.noteScrolled(activeId, scrollRequest.token, top);
    },
    [workspace, activeId, scrollRequest.token],
  );

  const view = activeView(state);
  return {
    ready: state.ready,
    tabs: state.tabs,
    activeId: state.activeId,
    activeTab: state.tabs.find((tab) => tab.id === state.activeId),
    document: view?.document,
    problem: view?.problem,
    notice: state.notice,
    scrollRequest: state.scrollRequest,
    loading: state.pending > 0,
    canGoBack: (view?.history.length ?? 0) > 0,
    openFile: workspace.openFile,
    openDropped: workspace.openDropped,
    openLink,
    reload,
    goBack,
    retry,
    noteScrolled,
    activateTab: workspace.activate,
    closeTab: workspace.close,
    moveTab: workspace.move,
    nextTab: workspace.next,
    previousTab: workspace.previous,
    moveActiveTab: workspace.moveActive,
    dismissNotice: workspace.dismissNotice,
    report: workspace.report,
  };
}
