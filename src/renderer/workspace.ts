import type { MdReaderApi } from '../shared/ipc';
import { samePath, type LinkWish, type TabInfo, type TabsSnapshot } from '../shared/tabs';
import type { MarkdownDocument, OpenOutcome } from '../shared/types';

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

export interface HistoryEntry {
  path: string;
  scrollTop: number;
}

/** What one tab has to show. */
export interface TabView {
  /** The document the tab shows; undefined until it has been read. */
  document: MarkdownDocument | undefined;
  /** The documents the reader came from by following links, the latest last, for Back. */
  history: readonly HistoryEntry[];
  /** Why the document could not be read, for a tab that has nothing else to show. */
  problem: string | undefined;
}

export interface WorkspaceState {
  /** False until the main process has said which tabs there are. */
  ready: boolean;
  tabs: readonly TabInfo[];
  /** The tab on screen. The main process decides it; the page only follows. */
  activeId: string | undefined;
  /** What each tab shows. May hold a document whose tab has not been announced yet. */
  views: ReadonlyMap<string, TabView>;
  notice: Notice | undefined;
  scrollRequest: ScrollRequest;
  /** How many requests to the main process are waiting for an answer. */
  pending: number;
}

export type WorkspaceBridge = Pick<
  MdReaderApi,
  | 'onDocumentOpened'
  | 'onTabsChanged'
  | 'getTabs'
  | 'notifyReady'
  | 'openFileDialog'
  | 'openDroppedFiles'
  | 'reopenDocument'
  | 'openLink'
  | 'reloadDocument'
  | 'activateTab'
  | 'closeTab'
  | 'moveTab'
  | 'loadTab'
>;

/** Where the reader is in a tab: a distance from the top, or the heading the document was opened at. */
type Place = Omit<ScrollRequest, 'token'>;

interface PresentOptions {
  /** Where to put the reader. Without it: at the top. */
  scrollTop?: number;
  /** Changes the Back stack of the tab that shows the document. */
  history?: (earlier: readonly HistoryEntry[]) => readonly HistoryEntry[];
  /** Only fill a tab that shows nothing yet: what was read for it must not replace what came meanwhile. */
  onlyIfEmpty?: boolean;
  /** Put the reader at `scrollTop` also when the document is the one that is shown: Back to the same page. */
  scrollEvenIfSame?: boolean;
}

const REQUEST_FAILED = 'MD Reader could not complete that request. Please try again.';
const EMPTY_VIEW: TabView = { document: undefined, history: [], problem: undefined };
const NO_TABS: TabsSnapshot = { tabs: [], activeId: undefined, version: 0 };
const TOP: Place = { top: 0 };

function requestFailed(): OpenOutcome {
  return { status: 'failed', error: { code: 'unreadable', message: REQUEST_FAILED } };
}

/** What the tab on screen has to show, if there is one. */
export function activeView(state: WorkspaceState): TabView | undefined {
  return state.activeId === undefined ? undefined : state.views.get(state.activeId);
}

function withView(
  views: ReadonlyMap<string, TabView>,
  id: string,
  patch: Partial<TabView>,
): ReadonlyMap<string, TabView> {
  return new Map(views).set(id, { ...(views.get(id) ?? EMPTY_VIEW), ...patch });
}

function sameDocument(a: MarkdownDocument, b: MarkdownDocument): boolean {
  return (
    a.path === b.path &&
    a.modifiedMs === b.modifiedMs &&
    a.sizeBytes === b.sizeBytes &&
    a.content === b.content
  );
}

/**
 * The tabs of the window and what each of them shows, as the page sees them. It is plain logic with
 * no React in it: the main process owns the list of tabs and decides which one is on screen, and
 * this follows what it is told, keeps the documents the page has been given, and asks for the ones it
 * lacks.
 *
 * - A tab is shown with the document it was last given. A tab that comes on screen without one is
 *   read (a tab from an earlier session starts like that), unless an answer to a request of the
 *   page's own is still on its way that will fill it.
 * - Where the reader is in a tab is kept as they scroll (the document view reports it), and given
 *   back when they return to the tab.
 * - A link, Back and a reload are each for a tab the page names: the one the reader was looking at,
 *   which the main process may have moved on from by the time it hears of it.
 * - Following a link goes into the tab's own history, so Back is a matter of each tab.
 * - A failed open never replaces what is on screen; it shows a notice instead.
 * - A tab never keeps showing a document that is not the one the main process says it has.
 */
export class Workspace {
  private state: WorkspaceState = {
    ready: false,
    tabs: [],
    activeId: undefined,
    views: new Map(),
    notice: undefined,
    scrollRequest: { token: 0 },
    pending: 0,
  };
  private readonly listeners = new Set<() => void>();
  private readonly bridge: WorkspaceBridge;
  private getScrollTop: () => number;
  /** Where the reader is in each tab: what they scrolled to, or what a document was opened at. */
  private readonly places = new Map<string, Place>();
  /** The path of each tab at the time its document was last asked for, so that no answer is asked for twice. */
  private readonly attempted = new Map<string, string>();
  /** Requests of the page's own that are waiting for an answer. */
  private requests = 0;
  /** Of those, the ones whose answer may be the document of a tab that has none yet. */
  private fills = 0;
  /** The number of the newest snapshot of the tabs that has been taken in. */
  private version = 0;
  private scrollToken = 0;
  private noticeId = 0;

  constructor(bridge: WorkspaceBridge, getScrollTop: () => number) {
    this.bridge = bridge;
    this.getScrollTop = getScrollTop;
  }

  readonly getState = (): WorkspaceState => this.state;

  /**
   * Changes how the page is asked where the reader is scrolled to, which is only done at the moment
   * of a click on a link or on Reload, in the tab that click is in.
   */
  readonly readScrollWith = (getScrollTop: () => number): void => {
    this.getScrollTop = getScrollTop;
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Starts listening to the main process, then asks which tabs there are. Returns what stops the
   * listening.
   */
  start(): () => void {
    const stopDocuments = this.bridge.onDocumentOpened((outcome) => {
      this.present(outcome);
    });
    const stopTabs = this.bridge.onTabsChanged((snapshot) => {
      this.accept(snapshot);
    });
    this.bridge.getTabs().then(
      (snapshot) => {
        this.accept(snapshot);
      },
      () => {
        // Without an answer there is nothing to show; a later message can still fill the window.
        if (!this.state.ready) this.accept(NO_TABS);
      },
    );
    // Only now can the main process safely deliver a file that was queued during startup.
    this.bridge.notifyReady().catch(() => undefined);

    return () => {
      stopDocuments();
      stopTabs();
    };
  }

  readonly openFile = (): Promise<void> =>
    this.request(
      () => this.bridge.openFileDialog(),
      [requestFailed()],
      (outcomes) => {
        this.presentAll(outcomes);
      },
      true,
    );

  /** Opens files the user dropped on the window. */
  readonly openDropped = (files: File[]): Promise<void> =>
    this.request(
      () => this.bridge.openDroppedFiles(files),
      [requestFailed()],
      (outcomes) => {
        this.presentAll(outcomes);
      },
      true,
    );

  /**
   * Follows a link to another document, which the reader clicked in the tab named: in that tab, or in
   * a tab of its own.
   */
  readonly openLink = (
    tabId: string | undefined,
    fileUrl: string,
    wish: LinkWish = {},
  ): Promise<void> => {
    if (tabId === undefined) return Promise.resolve();
    const from = this.state.views.get(tabId)?.document;
    const entry: HistoryEntry | undefined =
      from === undefined ? undefined : { path: from.path, scrollTop: this.getScrollTop() };
    const newTab = wish.newTab === true;

    return this.request(
      () => this.bridge.openLink(fileUrl, newTab ? { tabId, newTab: true } : { tabId }),
      requestFailed(),
      (outcome) => {
        if (
          outcome.status === 'opened' &&
          !newTab &&
          entry !== undefined &&
          outcome.tabId === tabId
        ) {
          this.present(outcome, { history: (earlier) => [...earlier, entry] });
        } else {
          this.present(outcome);
        }
      },
      newTab,
    );
  };

  /** Goes back, in the tab named, to the document the reader followed a link from. */
  readonly goBack = (tabId: string | undefined): Promise<void> => {
    const entry = tabId === undefined ? undefined : this.state.views.get(tabId)?.history.at(-1);
    if (tabId === undefined || entry === undefined) return Promise.resolve();

    return this.request(
      () => this.bridge.reopenDocument(tabId, entry.path),
      requestFailed(),
      (outcome) => {
        if (outcome.status === 'opened' && outcome.tabId === tabId) {
          this.present(outcome, {
            scrollTop: entry.scrollTop,
            // Pressing Back twice at once leaves the second answer nothing to take away.
            history: (earlier) => (earlier.at(-1) === entry ? earlier.slice(0, -1) : earlier),
            scrollEvenIfSame: true,
          });
        } else {
          this.present(outcome);
        }
      },
    );
  };

  /** Reads the document of the tab named from disk again, and keeps the reader where they are. */
  readonly reload = (tabId: string | undefined): Promise<void> => {
    if (tabId === undefined) return Promise.resolve();
    const scrollTop = this.getScrollTop();
    return this.request(
      () => this.bridge.reloadDocument(tabId),
      requestFailed(),
      (outcome) => {
        this.present(outcome, { scrollTop });
      },
    );
  };

  /** Tries again to read the document of the tab named, which could not be read. */
  readonly retry = (tabId: string | undefined): void => {
    if (tabId === undefined || !this.state.tabs.some((tab) => tab.id === tabId)) return;
    this.attempted.delete(tabId);
    this.update({ views: withView(this.state.views, tabId, { problem: undefined }) });
  };

  /**
   * Remembers where the reader has scrolled to in a tab. `token` is that of the scroll request the
   * page was last drawn for: a page that is behind what has been asked of it since shows another
   * document than the one this would be taken for, and says nothing that counts.
   */
  readonly noteScrolled = (tabId: string | undefined, token: number, top: number): void => {
    if (tabId === undefined || token !== this.state.scrollRequest.token) return;
    this.places.set(tabId, { top });
  };

  /**
   * Asks for a tab to be brought on screen. Nothing changes here until the main process says so,
   * which is what keeps what is on screen and what the main process resolves links against the same.
   */
  readonly activate = (id: string): void => {
    if (id === this.state.activeId) return;
    this.bridge.activateTab(id).catch(() => undefined);
  };

  readonly close = (id: string): void => {
    this.bridge.closeTab(id).catch(() => undefined);
  };

  readonly move = (id: string, toIndex: number): void => {
    this.bridge.moveTab(id, toIndex).catch(() => undefined);
  };

  /** The tab after the one on screen, or the first after the last. */
  readonly next = (): void => {
    this.step(1);
  };

  readonly previous = (): void => {
    this.step(-1);
  };

  /** Moves the tab on screen one place along the row, unless it is at that end already. */
  readonly moveActive = (by: -1 | 1): void => {
    const index = this.state.tabs.findIndex((tab) => tab.id === this.state.activeId);
    const target = index + by;
    if (index < 0 || target < 0 || target >= this.state.tabs.length) return;
    const id = this.state.tabs[index]?.id;
    if (id !== undefined) this.move(id, target);
  };

  /** Shows a problem the app found itself, such as a link that cannot be opened. */
  readonly report = (message: string): void => {
    this.noticeId += 1;
    this.update({ notice: { id: this.noticeId, kind: 'error', message } });
  };

  readonly dismissNotice = (): void => {
    this.update({ notice: undefined });
  };

  private step(by: 1 | -1): void {
    const { tabs, activeId } = this.state;
    if (tabs.length < 2) return;
    const index = tabs.findIndex((tab) => tab.id === activeId);
    const next = tabs[(index + by + tabs.length) % tabs.length];
    if (next !== undefined) this.activate(next.id);
  }

  /** Takes in what the main process says about the tabs, unless a newer message was taken in already. */
  private accept(next: TabsSnapshot): void {
    if (this.state.ready && next.version < this.version) return;
    this.version = next.version;

    // What belonged to a tab that was closed is let go.
    const known = new Set(next.tabs.map((tab) => tab.id));
    for (const id of [...this.places.keys()]) if (!known.has(id)) this.places.delete(id);
    for (const id of [...this.attempted.keys()]) if (!known.has(id)) this.attempted.delete(id);
    const kept = new Map([...this.state.views].filter(([id]) => known.has(id)));
    // While a request of the page's own is waiting, its answer is what puts a tab right.
    const views = this.requests === 0 ? this.withoutStale(next.tabs, kept) : kept;

    // Only a tab that comes on screen is put at its place. Another message about the tab that is on
    // screen already (it was moved, or another tab was opened) leaves the reader where they are.
    const id = next.activeId;
    const arriving = id === undefined ? undefined : views.get(id)?.document;
    const scrollRequest =
      id !== undefined && id !== this.state.activeId && arriving !== undefined
        ? this.scrollTo(this.places.get(id) ?? TOP)
        : undefined;

    this.update({
      ready: true,
      tabs: next.tabs,
      activeId: id,
      views,
      ...(scrollRequest === undefined ? {} : { scrollRequest }),
    });
  }

  /**
   * Lets go of each document that is not the one its tab has now. The main process moved the tab on
   * (a link, Back), and the answer that was to bring the new document did not, so the tab is read
   * again instead of showing a document that is not the tab's.
   */
  private withoutStale(
    tabs: readonly TabInfo[],
    views: ReadonlyMap<string, TabView>,
  ): ReadonlyMap<string, TabView> {
    const stale = tabs.filter((tab) => {
      const shown = views.get(tab.id)?.document;
      return shown !== undefined && !samePath(shown.path, tab.path);
    });
    if (stale.length === 0) return views;

    const kept = new Map(views);
    for (const { id } of stale) {
      kept.delete(id);
      this.attempted.delete(id);
      this.places.delete(id);
    }
    return kept;
  }

  /** Shows what a request opened: first what was opened, then the first thing that could not be. */
  private presentAll(outcomes: readonly OpenOutcome[]): void {
    for (const outcome of outcomes) if (outcome.status === 'opened') this.present(outcome);
    const failure = outcomes.find((outcome) => outcome.status === 'failed');
    if (failure !== undefined) this.present(failure);
  }

  private present(outcome: OpenOutcome, how: PresentOptions = {}): void {
    if (outcome.status === 'canceled') return;
    if (outcome.status === 'failed') {
      this.report(outcome.error.message);
      return;
    }

    const { tabId, document, anchor } = outcome;
    const view = this.state.views.get(tabId) ?? EMPTY_VIEW;
    if (how.onlyIfEmpty === true && view.document !== undefined) return;

    const history = how.history === undefined ? view.history : how.history(view.history);
    const unchanged =
      view.document !== undefined && sameDocument(view.document, document) && anchor === undefined;
    if (unchanged && how.scrollEvenIfSame !== true) {
      // The same page again, such as a reload of a file that has not changed: nothing to redraw,
      // and the reader stays where they are.
      this.update({
        views: withView(this.state.views, tabId, { history, problem: undefined }),
        notice: undefined,
      });
      return;
    }

    const place: Place = anchor === undefined ? { top: how.scrollTop ?? 0 } : { anchor };
    this.places.set(tabId, place);
    this.update({
      views: withView(this.state.views, tabId, { document, history, problem: undefined }),
      notice: undefined,
      // A tab that is not on screen is put at its place when it is brought there.
      ...(tabId === this.state.activeId ? { scrollRequest: this.scrollTo(place) } : {}),
    });
  }

  private scrollTo(place: Place): ScrollRequest {
    this.scrollToken += 1;
    return place.anchor === undefined
      ? { token: this.scrollToken, top: place.top ?? 0 }
      : { token: this.scrollToken, anchor: place.anchor };
  }

  /**
   * Asks the main process for something the reader did, and counts it while it is waiting. The
   * answer is dealt with before the request stops counting: that is what keeps a tab that the answer
   * fills from being read a second time. `fills` says that the answer may be the document of a tab
   * that has none yet, which is what makes the page wait for it instead of reading that tab itself.
   */
  private async request<T>(
    call: () => Promise<T>,
    fallback: T,
    handle: (answer: T) => void,
    fills = false,
  ): Promise<void> {
    this.requests += 1;
    if (fills) this.fills += 1;
    this.update({ pending: this.state.pending + 1 });
    try {
      let answer: T;
      try {
        answer = await call();
      } catch {
        answer = fallback;
      }
      handle(answer);
    } finally {
      this.requests -= 1;
      if (fills) this.fills -= 1;
      const views =
        this.requests === 0
          ? this.withoutStale(this.state.tabs, this.state.views)
          : this.state.views;
      this.update({
        pending: this.state.pending - 1,
        ...(views === this.state.views ? {} : { views }),
      });
    }
  }

  /**
   * Reads the document of the tab on screen when it has none. It waits while a request of the page's
   * own is on its way that may open one, because the answer to that is most likely the document, and
   * it asks only once for each document a tab shows, so a tab the main process does not have any more
   * cannot make it ask for ever.
   */
  private fillMissing(): void {
    const { ready, activeId, tabs, views } = this.state;
    if (!ready || activeId === undefined || this.fills > 0) return;
    const tab = tabs.find((candidate) => candidate.id === activeId);
    if (tab === undefined) return;

    const view = views.get(activeId);
    if (view?.document !== undefined || view?.problem !== undefined) return;
    if (this.attempted.get(activeId) === tab.path) return;
    this.attempted.set(activeId, tab.path);
    void this.read(activeId);
  }

  private async read(id: string): Promise<void> {
    this.update({ pending: this.state.pending + 1 });
    let outcome: OpenOutcome;
    try {
      outcome = await this.bridge.loadTab(id);
    } catch {
      outcome = requestFailed();
    } finally {
      this.update({ pending: this.state.pending - 1 });
    }

    if (outcome.status === 'failed') {
      if (this.state.tabs.some((tab) => tab.id === id)) {
        this.update({ views: withView(this.state.views, id, { problem: outcome.error.message }) });
      }
      return;
    }
    this.present(outcome, { onlyIfEmpty: true });
  }

  private update(patch: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
    this.fillMissing();
  }
}
