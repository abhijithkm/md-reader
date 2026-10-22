import type { Settings } from './settings';
import type { AppInfo, OpenOutcome } from './types';

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
  openExternal: 'external:open',
  openDefaultAppsSettings: 'system:open-default-apps',
  closeWindow: 'window:close',
  /** Main to page: a document finished opening (or failed to) outside of a page request. */
  documentOpened: 'document:opened',
} as const;

/** Channels the page invokes and the main process answers. */
export type InvokeChannel = Exclude<
  (typeof IpcChannel)[keyof typeof IpcChannel],
  typeof IpcChannel.documentOpened
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
  openFileDialog(): Promise<OpenOutcome>;
  /**
   * Opens a file the user dropped on the window. The path is read from the File object, which
   * only a real drop can supply; the page never names a path itself.
   */
  openDroppedFile(file: File): Promise<OpenOutcome>;
  /**
   * Shows a document this window already showed, for Back. The main process only accepts paths
   * it has opened itself.
   */
  reopenDocument(filePath: string): Promise<OpenOutcome>;
  /** `fileUrl` is a link target already resolved against the document's folder. */
  openLink(fileUrl: string): Promise<OpenOutcome>;
  reloadDocument(): Promise<OpenOutcome>;
  /** Subscribes to documents opened from outside the page; returns an unsubscribe function. */
  onDocumentOpened(listener: (outcome: OpenOutcome) => void): () => void;
  /** Opens an http, https or mailto link in the default program. Resolves false if refused. */
  openExternal(url: string): Promise<boolean>;
  openDefaultAppsSettings(): Promise<void>;
  closeWindow(): Promise<void>;
}
