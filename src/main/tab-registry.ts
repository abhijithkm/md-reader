import path from 'node:path';
import { MAX_TABS, type TabInfo, type TabList } from '../shared/tabs';

/** Windows compares paths without regard to case; elsewhere the text has to match. */
function pathKey(filePath: string): string {
  const normal = path.normalize(filePath);
  return process.platform === 'win32' ? normal.toLowerCase() : normal;
}

/**
 * The tabs of the window: which documents they show, in what order, and which one is on screen.
 *
 * The main process owns this list and the page only asks it to change. Every tab gets an id from
 * here, so the page can refer to a tab but can never add a document of its own naming: a page that a
 * hostile document has taken over still cannot make the app read a file it has not opened itself.
 *
 * Pure bookkeeping with no Electron dependency. Reading files, remembering the tabs between runs and
 * telling the page are the jobs of whoever uses it.
 */
export class TabRegistry {
  private tabs: TabInfo[] = [];
  private activeId: string | undefined;
  private issued = 0;
  private readonly limit: number;

  constructor(limit: number = MAX_TABS) {
    this.limit = limit;
  }

  /** A copy, so that nothing outside can change the list. */
  snapshot(): TabList {
    return { tabs: this.tabs.map((tab) => ({ ...tab })), activeId: this.activeId };
  }

  has(id: string): boolean {
    return this.tabs.some((tab) => tab.id === id);
  }

  pathOf(id: string): string | undefined {
    return this.tabs.find((tab) => tab.id === id)?.path;
  }

  /** The document on screen: what links, local images and a reload are resolved against. */
  currentPath(): string | undefined {
    return this.activeId === undefined ? undefined : this.pathOf(this.activeId);
  }

  /** The tab on screen, if there is one. */
  activeTabId(): string | undefined {
    return this.activeId;
  }

  /** How many more documents can get a tab of their own before the limit is reached. */
  room(): number {
    return Math.max(0, this.limit - this.tabs.length);
  }

  /** The tab that shows this document, if there is one. */
  find(filePath: string): TabInfo | undefined {
    const key = pathKey(filePath);
    const found = this.tabs.find((tab) => pathKey(tab.path) === key);
    return found === undefined ? undefined : { ...found };
  }

  /**
   * Shows a document in a tab: the one that already shows it, or a new one after the others.
   * Returns undefined when a new tab would go beyond the limit. The tab becomes the active one
   * unless `activate` is false (and there is another tab that stays on screen).
   */
  open(
    filePath: string,
    options: { activate?: boolean } = {},
  ): { id: string; created: boolean } | undefined {
    const activate = options.activate ?? true;
    const existing = this.find(filePath);
    if (existing !== undefined) {
      if (activate) this.activeId = existing.id;
      return { id: existing.id, created: false };
    }

    if (this.tabs.length >= this.limit) return undefined;
    const id = this.issue();
    this.tabs.push({ id, path: filePath });
    if (activate || this.activeId === undefined) this.activeId = id;
    return { id, created: true };
  }

  /** The tab now shows another document (a link was followed, or the reader went back). */
  navigate(id: string, filePath: string): boolean {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (tab === undefined) return false;
    tab.path = filePath;
    return true;
  }

  activate(id: string): boolean {
    if (!this.has(id)) return false;
    this.activeId = id;
    return true;
  }

  /** Removes a tab. If it was on screen, the one that followed it is, or else the one before it. */
  close(id: string): boolean {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return false;
    this.tabs.splice(index, 1);
    if (this.activeId === id) this.activeId = (this.tabs[index] ?? this.tabs[index - 1])?.id;
    return true;
  }

  /** Puts a tab at another place in the row (a place beyond either end is the end). */
  move(id: string, toIndex: number): boolean {
    const from = this.tabs.findIndex((tab) => tab.id === id);
    if (from < 0 || !Number.isInteger(toIndex)) return false;
    const to = Math.min(Math.max(toIndex, 0), this.tabs.length - 1);
    const [tab] = this.tabs.splice(from, 1);
    if (tab !== undefined) this.tabs.splice(to, 0, tab);
    return true;
  }

  /**
   * Replaces everything with the tabs of an earlier session. A document counts once, and no more
   * than the limit are taken. The active tab is the one that shows the document at `activeIndex` in
   * the list as it was given; a place that names no document that was kept means the first tab.
   */
  restore(paths: readonly string[], activeIndex: number): void {
    this.tabs = [];
    this.activeId = undefined;
    const seen = new Set<string>();
    for (const filePath of paths) {
      if (this.tabs.length >= this.limit) break;
      const key = pathKey(filePath);
      if (seen.has(key)) continue;
      seen.add(key);
      this.tabs.push({ id: this.issue(), path: filePath });
    }
    const wanted = Number.isInteger(activeIndex) ? paths[activeIndex] : undefined;
    const chosen = wanted === undefined ? undefined : this.find(wanted);
    this.activeId = (chosen ?? this.tabs[0])?.id;
  }

  /** The place of the active tab in the row, for saving the session. */
  activeIndex(): number {
    return Math.max(
      0,
      this.tabs.findIndex((tab) => tab.id === this.activeId),
    );
  }

  private issue(): string {
    this.issued += 1;
    return `tab-${this.issued}`;
  }
}
