import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IpcChannel, type MdReaderApi } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import type { AppInfo, OpenOutcome } from '../shared/types';
import type { UpdateState } from '../shared/updates';

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
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
  openFileDialog: () => invoke<OpenOutcome>(IpcChannel.openDialog),
  openDroppedFile: (file) => {
    // Only a File that was really dropped has a path on disk; the page cannot make one up, so the
    // path that reaches the main process comes from the user, not from page script.
    let filePath = '';
    try {
      filePath = webUtils.getPathForFile(file);
    } catch {
      // Not a File at all.
    }
    return filePath === ''
      ? Promise.resolve(DROPPED_ITEM_UNREADABLE)
      : invoke<OpenOutcome>(IpcChannel.openDropped, filePath);
  },
  reopenDocument: (filePath) => invoke<OpenOutcome>(IpcChannel.reopenDocument, filePath),
  openLink: (fileUrl) => invoke<OpenOutcome>(IpcChannel.openLink, fileUrl),
  reloadDocument: () => invoke<OpenOutcome>(IpcChannel.reloadDocument),
  onDocumentOpened: (listener) => {
    const handler = (_event: IpcRendererEvent, outcome: OpenOutcome): void => {
      listener(outcome);
    };
    ipcRenderer.on(IpcChannel.documentOpened, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannel.documentOpened, handler);
    };
  },
  openExternal: (url) => invoke<boolean>(IpcChannel.openExternal, url),
  openDefaultAppsSettings: () => invoke<void>(IpcChannel.openDefaultAppsSettings),
  closeWindow: () => invoke<void>(IpcChannel.closeWindow),
  getUpdateState: () => invoke<UpdateState>(IpcChannel.getUpdateState),
  checkForUpdates: () => invoke<UpdateState>(IpcChannel.checkForUpdates),
  restartToUpdate: () => invoke<void>(IpcChannel.restartToUpdate),
  onUpdateState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: UpdateState): void => {
      listener(state);
    };
    ipcRenderer.on(IpcChannel.updateState, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannel.updateState, handler);
    };
  },
};

contextBridge.exposeInMainWorld('mdReader', api);
