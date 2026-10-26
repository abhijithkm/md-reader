import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IpcChannel, type MdReaderApi } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import type { TabsSnapshot } from '../shared/tabs';
import type { AppInfo, OpenOutcome } from '../shared/types';
import type { UpdateState } from '../shared/updates';

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

/** Passes what the main process sends on a channel to `listener`; the result stops that. */
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => {
    listener(value);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

/** What the page is told when something that is not a file on disk is dropped on the window. */
const DROPPED_ITEM_UNREADABLE: OpenOutcome = {
  status: 'failed',
  error: {
    code: 'invalid-path',
    message: 'MD Reader could not read the location of the dropped item.',
  },
};

/**
 * The preload script is the only bridge between the page and the main
 * process. It exposes a fixed set of functions, never `ipcRenderer` itself, so
 * a page that has been compromised by hostile Markdown can do no more than
 * these calls allow (and the main process validates each of them again).
 */
const api: MdReaderApi = {
  getAppInfo: () => invoke<AppInfo>(IpcChannel.getAppInfo),
  getSettings: () => invoke<Settings>(IpcChannel.getSettings),
  updateSettings: (patch) => invoke<Settings>(IpcChannel.updateSettings, patch),
  notifyReady: () => invoke<void>(IpcChannel.rendererReady),
  openFileDialog: () => invoke<OpenOutcome[]>(IpcChannel.openDialog),
  openDroppedFiles: async (files) => {
    // Only a File that was really dropped has a path on disk; the page cannot make one up, so the
    // paths that reach the main process come from the user, not from page script.
    const paths: string[] = [];
    const unreadable: OpenOutcome[] = [];
    for (const file of files) {
      let filePath = '';
      try {
        filePath = webUtils.getPathForFile(file);
      } catch {
        // Not a File at all.
      }
      if (filePath === '') unreadable.push(DROPPED_ITEM_UNREADABLE);
      else paths.push(filePath);
    }
    const opened =
      paths.length === 0 ? [] : await invoke<OpenOutcome[]>(IpcChannel.openDropped, paths);
    return [...opened, ...unreadable];
  },
  reopenDocument: (tabId, filePath) =>
    invoke<OpenOutcome>(IpcChannel.reopenDocument, tabId, filePath),
  openLink: (fileUrl, options) => invoke<OpenOutcome>(IpcChannel.openLink, fileUrl, options),
  reloadDocument: (tabId) => invoke<OpenOutcome>(IpcChannel.reloadDocument, tabId),
  onDocumentOpened: (listener) => subscribe<OpenOutcome>(IpcChannel.documentOpened, listener),
  getTabs: () => invoke<TabsSnapshot>(IpcChannel.getTabs),
  activateTab: (id) => invoke<void>(IpcChannel.activateTab, id),
  closeTab: (id) => invoke<void>(IpcChannel.closeTab, id),
  moveTab: (id, toIndex) => invoke<void>(IpcChannel.moveTab, id, toIndex),
  loadTab: (id) => invoke<OpenOutcome>(IpcChannel.loadTab, id),
  onTabsChanged: (listener) => subscribe<TabsSnapshot>(IpcChannel.tabsChanged, listener),
  openExternal: (url) => invoke<boolean>(IpcChannel.openExternal, url),
  openDefaultAppsSettings: () => invoke<void>(IpcChannel.openDefaultAppsSettings),
  closeWindow: () => invoke<void>(IpcChannel.closeWindow),
  getUpdateState: () => invoke<UpdateState>(IpcChannel.getUpdateState),
  checkForUpdates: () => invoke<UpdateState>(IpcChannel.checkForUpdates),
  restartToUpdate: () => invoke<void>(IpcChannel.restartToUpdate),
  onUpdateState: (listener) => subscribe<UpdateState>(IpcChannel.updateState, listener),
};

contextBridge.exposeInMainWorld('mdReader', api);
