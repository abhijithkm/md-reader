import path from 'node:path';
import { isTabId, MAX_TABS, type OpenLinkOptions, type TabsSnapshot } from '../shared/tabs';
import type { DocumentOutcome, OpenError, OpenErrorCode, OpenOutcome } from '../shared/types';
import { findLaunchFile } from './cli';
import type { DocumentService, OpenOptions } from './documents';
import { resolveLocalMarkdownLink } from './link-resolution';
import { assessLocalPath } from './local-path-policy';
import { OpenRequestQueue } from './open-queue';
import type { SessionData } from './session-store';
import { TabRegistry } from './tab-registry';

export interface WindowPort {
  /** Sends the result of an open request to the page. */
  sendOutcome(outcome: OpenOutcome): void;
  /** Tells the page which tabs there are, in what order, and which one is on screen. */
  sendTabs(snapshot: TabsSnapshot): void;
  /** Restores the window if it is minimized and brings it to the front. */
  reveal(): void;
}

export interface AppControllerDeps {
  documents: DocumentService;
  getWindow(): WindowPort | undefined;
  /** Shows the native open dialog; resolves to the chosen paths, none if it was cancelled. */
  showOpenDialog(): Promise<string[]>;
  isPackaged: boolean;
  /** What is worth remembering for the next run, each time the tabs change. */
  onTabsChanged(session: SessionData): void;
}

export interface LaunchOptions {
  /** Bring the window to the front (a second launch while the app is running). */
  reveal?: boolean;
}

/** How many documents the window remembers having shown, for going back to them. */
const MAX_REMEMBERED_DOCUMENTS = 200;

/**
 * How a tab from an earlier session is read the first time: as a link in a document is, so that a
 * file that has become a link to a network share, or to something that is not Markdown, since the
 * tab was saved is refused. The file was named by a file on disk, not by the user, this time.
 */
const READ_CAREFULLY: OpenOptions = { fromLink: { currentDocumentPath: undefined } };

type Failed = { status: 'failed'; error: OpenError };

/**
 * Decides what the window shows: which documents are open in tabs, and which tab is on screen. It
 * owns the rules that make file opening dependable on Windows:
 *
 * - a file named at launch, by a second launch, or by the operating system is queued until the page
 *   is listening, then opened in a tab of its own (or the tab that already shows it);
 * - when requests overlap, every one of them gets its tab, but the newest that opened something takes
 *   the screen, whatever the order in which they finish;
 * - the tabs are listed here, and the page can only refer to them by the ids issued here, so a page
 *   that hostile Markdown has taken over still cannot make the app read a file it did not open itself;
 * - a link, Back and a reload act on the tab the page names, which is the one the reader was looking
 *   at, and a newer one in the same tab, or the tab being closed, makes an older one give way;
 * - the path of the document on screen is tracked so links and local images can be resolved safely
 *   relative to it;
 * - the paths of the documents shown so far are remembered, so that going back can be limited to them.
 *
 * It has no Electron dependency; the window and the dialog are passed in.
 */
export class AppController {
  private readonly deps: AppControllerDeps;
  private readonly queue: OpenRequestQueue<string>;
  private readonly registry = new TabRegistry();
  private readonly shown = new Set<string>();
  /** The newest link, Back or reload in each tab: an older one that finishes later gives way to it. */
  private readonly navigations = new Map<string, number>();
  /** Tabs from an earlier session that the user has not opened again since, and that have not been read. */
  private readonly restored = new Set<string>();
  /** The reads of the documents of tabs that are under way, so that two of them are one read. */
  private readonly loading = new Map<string, Promise<OpenOutcome>>();
  private latestRequestId = 0;
  /** The newest request that opened something. An older one that finishes later does not take the screen. */
  private newestOpened = 0;
  private lastTold: string | undefined;
  /** Counts the changes of the tabs the page has been told about. */
  private version = 0;
  /** The files asked for from outside the page, opened one after the other, in the order they were asked for. */
  private delivering: Promise<void> = Promise.resolve();

  constructor(deps: AppControllerDeps) {
    this.deps = deps;
    this.queue = new OpenRequestQueue((filePath) => {
      // Read side by side, the files of a burst of requests would get their tabs in the order in which
      // the disk happened to answer. (Nothing in `deliver` throws; the catch keeps the line moving if it ever does.)
      this.delivering = this.delivering.then(() => this.deliver(filePath)).catch(() => undefined);
    });
  }

  /** Handles the process arguments of the first launch or of a second instance. */
  handleLaunch(argv: readonly string[], cwd: string, options: LaunchOptions = {}): void {
    if (options.reveal === true) this.deps.getWindow()?.reveal();

    const filePath = findLaunchFile(argv, { cwd, isPackaged: this.deps.isPackaged });
    if (filePath !== undefined) this.queue.request(filePath);
  }

  /** Handles a path handed over by the operating system (for example macOS "open-file"). */
  handleOpenRequest(filePath: string, options: LaunchOptions = {}): void {
    if (options.reveal === true) this.deps.getWindow()?.reveal();
    this.queue.request(filePath);
  }

  /** The page has subscribed to document events and can receive queued requests. */
  rendererReady(): void {
    this.queue.setReady(true);
  }

  /** The page is gone or reloading; hold requests until it reports ready again. */
  rendererGone(): void {
    this.queue.setReady(false);
  }

  /** The tabs as they are now. A page that has just started asks for these. */
  getTabs(): TabsSnapshot {
    return { ...this.registry.snapshot(), version: this.version };
  }

  /**
   * Opens the tabs of an earlier run. No file is read here: a tab is read when it comes on screen,
   * so a long list of tabs does not slow the start. Such a tab is read with more care than one the
   * user opened (see `loadTab`), until the user opens that file again themselves.
   */
  restoreSession(session: SessionData): void {
    this.registry.restore(
      session.paths.map((filePath) => path.normalize(filePath)),
      session.active,
    );
    this.navigations.clear();
    this.restored.clear();
    for (const tab of this.registry.snapshot().tabs) this.restored.add(tab.id);
  }

  /** The documents in the tabs and the place of the one on screen, for the next run. */
  sessionData(): SessionData {
    return {
      paths: this.registry.snapshot().tabs.map((tab) => tab.path),
      active: this.registry.activeIndex(),
    };
  }

  async openFromDialog(): Promise<OpenOutcome[]> {
    const chosen = await this.deps.showOpenDialog();
    if (chosen.length === 0) return [{ status: 'canceled' }];
    return this.openPaths(chosen);
  }

  /**
   * Opens each file in a tab of its own and shows the last one that opened. No more files are read
   * than there can be tabs, and one failure stands for the rest of a list that is longer.
   */
  openPaths(input: unknown): Promise<OpenOutcome[]> {
    if (!Array.isArray(input)) {
      return Promise.resolve([failure('invalid-path', 'That is not a usable file path.')]);
    }
    return this.openAll(input as unknown[]);
  }

  /** Opens a file in a tab of its own, or shows the tab that has it, and shows it. */
  async openPath(input: unknown, options?: OpenOptions): Promise<OpenOutcome> {
    const outcomes = await this.openAll([input], options);
    return outcomes[0] ?? tooManyTabs();
  }

  /**
   * Shows a document this window has already shown in the tab the page names, for Back. The page
   * names it by path, but the page is not trusted (a hostile document may have taken it over), so
   * only paths the main process itself opened are accepted. Otherwise this would let the page read
   * any Markdown file.
   */
  reopen(tabId: unknown, input: unknown): Promise<OpenOutcome> {
    if (!isTabId(tabId) || !this.registry.has(tabId)) return Promise.resolve(canceled());
    if (typeof input !== 'string' || !this.shown.has(path.normalize(input))) {
      return Promise.resolve(
        failure('not-found', 'That document is no longer available to go back to.'),
      );
    }
    return this.showInTab(tabId, input);
  }

  async openLink(href: unknown, options: OpenLinkOptions = {}): Promise<OpenOutcome> {
    // The tab the link is in: the one the page names, which must still be there, or else the one on
    // screen. Both are settled now, because by the time the file has been read the reader may be
    // looking at another tab.
    let fromTab = this.registry.activeTabId();
    if (options.tabId !== undefined) {
      if (!isTabId(options.tabId) || !this.registry.has(options.tabId)) return canceled();
      fromTab = options.tabId;
    }
    const fromPath = fromTab === undefined ? undefined : this.registry.pathOf(fromTab);

    const resolved = resolveLocalMarkdownLink(href, fromPath);
    if (!resolved.ok) {
      switch (resolved.reason) {
        case 'unsupported-type':
          return failure(
            'unsupported-type',
            'MD Reader only opens .md and .markdown files from links.',
          );
        case 'blocked':
          return failure('blocked-link', BLOCKED_LINK);
        case 'invalid-url':
          return failure('blocked-link', 'That link cannot be opened by MD Reader.');
      }
    }

    // The file was named by another document, so it is checked more closely than one the user chose.
    const checked: OpenOptions = { fromLink: { currentDocumentPath: fromPath } };
    const outcome =
      options.newTab === true || fromTab === undefined
        ? await this.openPath(resolved.path, checked)
        : await this.showInTab(fromTab, resolved.path, checked);
    if (outcome.status === 'opened' && resolved.anchor !== undefined) {
      return { ...outcome, anchor: resolved.anchor };
    }
    return outcome;
  }

  /** Reads the document of the tab the page names from disk again. */
  reload(tabId: unknown): Promise<OpenOutcome> {
    if (!isTabId(tabId)) return Promise.resolve(canceled());
    const current = this.registry.pathOf(tabId);
    if (current === undefined) return Promise.resolve(canceled());
    return this.showInTab(tabId, current);
  }

  /**
   * Reads the document of a tab without bringing the tab on screen: what the page asks for when a
   * tab that came from an earlier session is shown for the first time. Asking again while a read is
   * under way gets that read's answer, and does not read the file a second time.
   */
  loadTab(id: unknown): Promise<OpenOutcome> {
    if (!isTabId(id)) return Promise.resolve(tabGone());
    const running = this.loading.get(id);
    if (running !== undefined) return running;

    const started = this.readTab(id).finally(() => {
      this.loading.delete(id);
    });
    this.loading.set(id, started);
    return started;
  }

  activateTab(id: unknown): void {
    if (isTabId(id) && this.registry.activate(id)) this.tellTabs();
  }

  closeTab(id: unknown): void {
    if (!isTabId(id) || !this.registry.close(id)) return;
    this.navigations.delete(id);
    this.restored.delete(id);
    this.tellTabs();
  }

  moveTab(id: unknown, toIndex: unknown): void {
    if (isTabId(id) && typeof toIndex === 'number' && this.registry.move(id, toIndex)) {
      this.tellTabs();
    }
  }

  /** The document that links, local images and a reload are resolved against. */
  getCurrentDocumentPath(): string | undefined {
    return this.registry.currentPath();
  }

  /**
   * A file asked for from outside the page: it gets a tab and the page is handed what it shows. The
   * document goes first, so that the page already has it when the tab that shows it is announced and
   * has no reason to ask for it again.
   */
  private async deliver(filePath: string): Promise<void> {
    await this.openAll([filePath], undefined, (outcomes) => {
      for (const outcome of outcomes) this.deps.getWindow()?.sendOutcome(outcome);
    });
  }

  /**
   * Opens files in tabs. Every file is read first, one after the other, and only then do they get
   * their tabs, all at once and with nothing awaited in between. A link followed in a tab, or a tab
   * closed, while the later files are being read could otherwise leave an answer that names a tab
   * that has since moved on. A file that cannot get a tab is not read at all.
   */
  private async openAll(
    inputs: readonly unknown[],
    options?: OpenOptions,
    announce?: (outcomes: readonly OpenOutcome[]) => void,
  ): Promise<OpenOutcome[]> {
    const requestId = this.nextRequestId();

    const reads: (DocumentOutcome | undefined)[] = [];
    let fresh = 0;
    for (const input of inputs.slice(0, MAX_TABS)) {
      const known = typeof input === 'string' && this.registry.find(input) !== undefined;
      if (!known && this.registry.room() <= fresh) {
        reads.push(undefined);
        continue;
      }
      const read = await this.read(input, options);
      reads.push(read);
      if (read.status === 'opened' && !known) fresh += 1;
    }

    const outcomes = reads.map((read) => this.place(read, options));
    if (inputs.length > MAX_TABS) outcomes.push(tooManyTabs());
    this.finishRequest(requestId, outcomes, announce);
    return outcomes;
  }

  /** Gives a document that has been read its tab: the one that has it already, or a new one. */
  private place(read: DocumentOutcome | undefined, options?: OpenOptions): OpenOutcome {
    if (read === undefined) return tooManyTabs();
    if (read.status === 'failed') return read;

    // Another request may have filled the last place in the meantime.
    const placed = this.registry.open(read.document.path, { activate: false });
    if (placed === undefined) return tooManyTabs();
    this.remember(read.document.path);
    // A file the user named is theirs from now on, whatever the tab was before.
    if (options?.fromLink === undefined) this.restored.delete(placed.id);
    return { status: 'opened', document: read.document, tabId: placed.id };
  }

  /**
   * Makes the tab show another document, or the same one read again. A tab that was closed while
   * the file was read, or in which a newer link or Back was followed, is not touched.
   */
  private async showInTab(
    tabId: string,
    input: unknown,
    options?: OpenOptions,
  ): Promise<OpenOutcome> {
    const sequence = (this.navigations.get(tabId) ?? 0) + 1;
    this.navigations.set(tabId, sequence);

    const read = await this.read(input, options);
    if (read.status === 'failed') return read;
    if (this.navigations.get(tabId) !== sequence) return canceled();

    this.registry.navigate(tabId, read.document.path);
    this.restored.delete(tabId);
    this.remember(read.document.path);
    this.tellTabs();
    return { status: 'opened', document: read.document, tabId };
  }

  private async readTab(id: string): Promise<OpenOutcome> {
    const filePath = this.registry.pathOf(id);
    if (filePath === undefined) return tabGone();

    // A tab from an earlier session is a path in a file in the profile, not something the user
    // chose this time: it is read as a link is, until it has been read once or chosen again.
    const careful = this.restored.has(id);
    if (careful && !assessLocalPath(filePath, undefined).ok) {
      return failure('blocked-link', BLOCKED_LINK);
    }
    const read = await this.read(filePath, careful ? READ_CAREFULLY : undefined);
    if (read.status === 'failed') return read;
    // The tab was closed, or follows another document now, so what was read is not its document.
    if (this.registry.pathOf(id) !== filePath) return canceled();

    this.restored.delete(id);
    this.remember(read.document.path);
    return { status: 'opened', document: read.document, tabId: id };
  }

  /**
   * The newest request that has opened something has the say over what is on screen: it shows the
   * last document it opened, and an older one that finishes after it leaves the screen alone. Then the
   * page is told, once, about everything that changed.
   */
  private finishRequest(
    requestId: number,
    outcomes: readonly OpenOutcome[],
    announce?: (outcomes: readonly OpenOutcome[]) => void,
  ): void {
    let last: string | undefined;
    for (const outcome of outcomes) {
      if (outcome.status === 'opened') last = outcome.tabId;
    }
    if (last !== undefined && requestId >= this.newestOpened) {
      this.newestOpened = requestId;
      this.registry.activate(last);
    }
    announce?.(outcomes);
    this.tellTabs();
  }

  private async read(input: unknown, options?: OpenOptions): Promise<DocumentOutcome> {
    try {
      return await this.deps.documents.open(input, options);
    } catch {
      return failure('unreadable', 'The file could not be opened.');
    }
  }

  /** Passes on the tabs to the page and the session, unless they are as they were last time. */
  private tellTabs(): void {
    const list = this.registry.snapshot();
    const key = JSON.stringify(list);
    if (key === this.lastTold) return;
    this.lastTold = key;
    this.version += 1;
    this.deps.getWindow()?.sendTabs({ ...list, version: this.version });
    this.deps.onTabsChanged(this.sessionData());
  }

  private remember(filePath: string): void {
    // Moving a path to the end keeps the most recent ones when the limit is reached.
    this.shown.delete(filePath);
    this.shown.add(filePath);
    if (this.shown.size > MAX_REMEMBERED_DOCUMENTS) {
      const oldest = this.shown.values().next().value;
      if (oldest !== undefined) this.shown.delete(oldest);
    }
  }

  private nextRequestId(): number {
    this.latestRequestId += 1;
    return this.latestRequestId;
  }
}

const BLOCKED_LINK =
  'MD Reader does not follow links to network locations or special Windows paths.';

function failure(code: OpenErrorCode, message: string): Failed {
  return { status: 'failed', error: { code, message } };
}

/** Nothing to show and nothing to say: what a request that has been overtaken, or whose tab is gone, comes to. */
function canceled(): OpenOutcome {
  return { status: 'canceled' };
}

function tooManyTabs(): Failed {
  return failure(
    'too-many-tabs',
    `MD Reader keeps up to ${MAX_TABS} tabs open. Close a tab to open another document.`,
  );
}

function tabGone(): Failed {
  return failure('not-found', 'That tab is no longer open.');
}
