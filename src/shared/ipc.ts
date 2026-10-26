import type { Settings } from './settings';
import type { OpenLinkOptions, TabsSnapshot } from './tabs';
import type { AppInfo, OpenOutcome } from './types';
import type { UpdateState } from './updates';

/** Every channel the page and the main process talk over. Nothing else is exposed. */
export const IpcChannel = {
  getAppInfo: 'app:get-info',
  rendererReady: 'app:renderer-ready',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  openDialog: 'document:open-dialog',
  openDropped: 'document:open-dropped',
  reopenDocument: 'document:reopen',
  openLink: 'document:open-link',
  reloadDocument: 'document:reload',
  getTabs: 'tabs:get',
  activateTab: 'tabs:activate',
  closeTab: 'tabs:close',
  moveTab: 'tabs:move',
  loadTab: 'tabs:load',
  openExternal: 'external:open',
  openDefaultAppsSettings: 'system:open-default-apps',
  closeWindow: 'window:close',
  getUpdateState: 'updates:get-state',
  checkForUpdates: 'updates:check',
  restartToUpdate: 'updates:restart',
  /** Main to page: a document finished opening (or failed to) outside of a page request. */
  documentOpened: 'document:opened',
  /** Main to page: the tabs changed (one opened, closed, moved or switched to). */
  tabsChanged: 'tabs:changed',
  /** Main to page: what updating is doing changed. */
  updateState: 'updates:state',
} as const;

/** Channels the page invokes and the main process answers. */
export type InvokeChannel = Exclude<
  (typeof IpcChannel)[keyof typeof IpcChannel],
  typeof IpcChannel.documentOpened | typeof IpcChannel.tabsChanged | typeof IpcChannel.updateState
>;

/**
 * The only API the preload script exposes to the page, as `window.mdReader`.
 * It is deliberately small: no file system, shell or process access.
 */
export interface MdReaderApi {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  /** Tells the main process the page is listening, so queued open requests can be delivered. */
  notifyReady(): Promise<void>;
  /** Lets the user choose one or more files; each opens in a tab of its own. */
  openFileDialog(): Promise<OpenOutcome[]>;
  /**
   * Opens files the user dropped on the window, each in a tab of its own. The paths are read from
   * the File objects, which only a real drop can supply; a page that names a file in any other way
   * (a link in a document) is held to the rules for links.
   */
  openDroppedFiles(files: File[]): Promise<OpenOutcome[]>;
  /**
   * Shows a document this window already showed, in the tab named, for Back. The main process only
   * accepts paths it has opened itself, and a tab it issued.
   */
  reopenDocument(tabId: string, filePath: string): Promise<OpenOutcome>;
  /**
   * `fileUrl` is a link target already resolved against the document's folder. It opens in the tab
   * the link is in (`options.tabId`; the tab on screen when none is named), or in a tab of its own
   * when `options.newTab` is set. The main process checks the link before it reads anything.
   */
  openLink(fileUrl: string, options?: OpenLinkOptions): Promise<OpenOutcome>;
  /** Reads the document of the tab named from disk again, in that tab. */
  reloadDocument(tabId: string): Promise<OpenOutcome>;
  /** Subscribes to documents opened from outside the page; returns an unsubscribe function. */
  onDocumentOpened(listener: (outcome: OpenOutcome) => void): () => void;
  /** The tabs as they are now. */
  getTabs(): Promise<TabsSnapshot>;
  /** The page may only name a tab by an id it was given in a snapshot; the main process checks. */
  activateTab(id: string): Promise<void>;
  closeTab(id: string): Promise<void>;
  moveTab(id: string, toIndex: number): Promise<void>;
  /** Reads the document of a tab, for one that came from an earlier session and is not read yet. */
  loadTab(id: string): Promise<OpenOutcome>;
  /** Subscribes to changes of the tabs; returns an unsubscribe function. */
  onTabsChanged(listener: (snapshot: TabsSnapshot) => void): () => void;
  /** Opens an http, https or mailto link in the default program. Resolves false if refused. */
  openExternal(url: string): Promise<boolean>;
  openDefaultAppsSettings(): Promise<void>;
  closeWindow(): Promise<void>;
  /** What updating is doing right now. */
  getUpdateState(): Promise<UpdateState>;
  /** Looks for a newer version now; resolves with the state once the check has finished. */
  checkForUpdates(): Promise<UpdateState>;
  /** Restarts into a downloaded update. Does nothing unless one is ready to install. */
  restartToUpdate(): Promise<void>;
  /** Subscribes to changes of the update state; returns an unsubscribe function. */
  onUpdateState(listener: (state: UpdateState) => void): () => void;
}
