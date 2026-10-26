import type { IpcMain } from 'electron';
import { IpcChannel, type InvokeChannel } from '../shared/ipc';
import { parseSettingsPatch, type Settings } from '../shared/settings';
import type { AppInfo, OpenOutcome } from '../shared/types';
import type { UpdateState } from '../shared/updates';
import { toSafeExternalUrl } from './external-links';
import { isTrustedSender } from './ipc-guard';

/** The Windows Settings page where the user picks default apps. A constant, never page-supplied. */
export const DEFAULT_APPS_SETTINGS_URL = 'ms-settings:defaultapps';

export interface IpcHandlerDeps {
  controller: {
    openFromDialog(): Promise<OpenOutcome>;
    openPath(input: unknown): Promise<OpenOutcome>;
    reopen(input: unknown): Promise<OpenOutcome>;
    openLink(href: unknown): Promise<OpenOutcome>;
    reload(): Promise<OpenOutcome>;
    rendererReady(): void;
  };
  settings: {
    get(): Settings;
    /** Applies the patch at once (`get` returns it from then on) and resolves once it is written. */
    update(patch: Partial<Settings>): Promise<Settings>;
  };
  updates: {
    getState(): UpdateState;
    /** Looks for a newer version now and resolves with the state once the check has finished. */
    checkNow(): Promise<UpdateState>;
    /** Restarts into a downloaded update; does nothing when there is none. */
    restart(): boolean;
  };
  appInfo: AppInfo;
  trustedOrigins: readonly string[];
  /** Hands an already-validated URL to the operating system. */
  openExternalUrl(url: string): Promise<void>;
  closeWindow(): void;
  /** Called after settings changed so the window chrome can follow (theme). */
  onSettingsChanged?(settings: Settings): void;
}

export type IpcHandler = (frameUrl: unknown, ...args: unknown[]) => Promise<unknown>;
export type IpcHandlers = Record<InvokeChannel, IpcHandler>;

/**
 * Builds one handler per channel. Each handler first checks that the message
 * came from the app's own page, then validates the payload before touching
 * anything privileged. The page is treated as a client that may be compromised
 * by hostile Markdown: it can only do what these handlers allow.
 */
export function createIpcHandlers(deps: IpcHandlerDeps): IpcHandlers {
  const fromTrustedPage =
    (handler: (...args: unknown[]) => Promise<unknown>): IpcHandler =>
    (frameUrl, ...args) => {
      if (!isTrustedSender(frameUrl, deps.trustedOrigins)) {
        return Promise.reject(new Error('Untrusted IPC sender'));
      }
      return handler(...args);
    };

  return {
    [IpcChannel.getAppInfo]: fromTrustedPage(() => Promise.resolve(deps.appInfo)),

    [IpcChannel.rendererReady]: fromTrustedPage(() => {
      deps.controller.rendererReady();
      return Promise.resolve();
    }),

    [IpcChannel.getSettings]: fromTrustedPage(() => Promise.resolve(deps.settings.get())),

    // The store applies a change at once and answers when the file has been written. The app is told
    // now, not then: a user who switches updates off and closes the app straight away must not
    // still get an update installed because the write was slow.
    [IpcChannel.updateSettings]: fromTrustedPage(
      (payload) =>
        new Promise<Settings>((resolve) => {
          const patch = parseSettingsPatch(payload);
          if (patch === null) throw new Error('Invalid settings update');
          const written = deps.settings.update(patch);
          deps.onSettingsChanged?.(deps.settings.get());
          resolve(written);
        }),
    ),

    [IpcChannel.openDialog]: fromTrustedPage(() => deps.controller.openFromDialog()),

    // The preload script read this path from a File object the user dropped, which the page
    // cannot forge. The document service validates it; it is passed through untouched.
    [IpcChannel.openDropped]: fromTrustedPage((input) => deps.controller.openPath(input)),

    // Back: the controller only accepts documents it has shown, so the page cannot use this to
    // read other files.
    [IpcChannel.reopenDocument]: fromTrustedPage((input) => deps.controller.reopen(input)),

    [IpcChannel.openLink]: fromTrustedPage((href) => deps.controller.openLink(href)),

    [IpcChannel.reloadDocument]: fromTrustedPage(() => deps.controller.reload()),

    [IpcChannel.openExternal]: fromTrustedPage(async (url) => {
      const safeUrl = toSafeExternalUrl(url);
      if (safeUrl === null) return false;
      try {
        await deps.openExternalUrl(safeUrl);
        return true;
      } catch {
        return false;
      }
    }),

    [IpcChannel.openDefaultAppsSettings]: fromTrustedPage(async () => {
      await deps.openExternalUrl(DEFAULT_APPS_SETTINGS_URL);
    }),

    [IpcChannel.closeWindow]: fromTrustedPage(() => {
      deps.closeWindow();
      return Promise.resolve();
    }),

    // Updating takes no input from the page: which version, from where and when are decided by
    // the main process, so there is nothing for a compromised page to forge.
    [IpcChannel.getUpdateState]: fromTrustedPage(() => Promise.resolve(deps.updates.getState())),

    [IpcChannel.checkForUpdates]: fromTrustedPage(() => deps.updates.checkNow()),

    [IpcChannel.restartToUpdate]: fromTrustedPage(() => {
      deps.updates.restart();
      return Promise.resolve();
    }),
  };
}

export function registerIpcHandlers(ipcMain: Pick<IpcMain, 'handle'>, handlers: IpcHandlers): void {
  for (const channel of Object.keys(handlers) as InvokeChannel[]) {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      handlers[channel](event.senderFrame?.url, ...args),
    );
  }
}
