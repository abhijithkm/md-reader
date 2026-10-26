import {
  app,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  session,
  shell,
  type BrowserWindow,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync } from 'node:fs';
import { lstat, readFile, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { IpcChannel } from '../shared/ipc';
import { LOCAL_IMAGE_SCHEME } from '../shared/local-image-url';
import type { Settings } from '../shared/settings';
import { resolveTheme, WINDOW_BACKGROUND } from '../shared/theme';
import type { UpdateState } from '../shared/updates';
import { AppController } from './app-controller';
import { APP_SCHEME, handleAppRequest } from './app-protocol';
import { declineClientCertificates } from './certificates';
import { createDocumentService } from './documents';
import { createIpcHandlers, registerIpcHandlers } from './ipc';
import { handleLocalImageRequest } from './local-image-protocol';
import { resolveRendererLocation } from './renderer-location';
import { SessionStore } from './session-store';
import { SettingsStore } from './settings-store';
import { resolveUpdateEnvironment } from './update-environment';
import { createUpdaterPort, writeTestFeedConfig } from './updater-adapter';
import { createUpdateLog, describeForLog } from './update-log';
import { UpdateController } from './updates';
import { createMainWindow, createWindowPort, hardenSession } from './window';

/** Must equal `appId` in electron-builder.yml so Windows groups taskbar entries correctly. */
const APP_USER_MODEL_ID = 'io.github.abhijithkm.mdreader';

// Custom schemes must be declared before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: LOCAL_IMAGE_SCHEME, privileges: { standard: true, secure: true } },
]);

// A server that an image points at may ask for a client certificate; never offer the user's.
declineClientCertificates(app);

// Only one MD Reader runs per user: a second launch (for example double-clicking
// another .md file) hands its arguments to the running window and exits.
if (app.requestSingleInstanceLock()) {
  start();
} else {
  app.quit();
}

function start(): void {
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
  Menu.setApplicationMenu(null);

  const settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), {
    onError: (error) => {
      console.error('[settings]', error);
    },
  });
  const initialSettings = settingsStore.load();
  nativeTheme.themeSource = initialSettings.theme;

  // Which documents were open in tabs, kept in the profile folder so that the next run can open
  // them again. Only the main process writes it, and switching the setting off removes it.
  const sessionStore = new SessionStore(path.join(app.getPath('userData'), 'session.json'), {
    onError: (error) => {
      console.error('[session]', error);
    },
  });
  sessionStore.setEnabled(initialSettings.restoreTabs);
  let rememberingTabs = initialSettings.restoreTabs;

  const { url: rendererUrl, trustedOrigins } = resolveRendererLocation({
    isPackaged: app.isPackaged,
    env: process.env,
  });
  const rendererRoot = path.join(__dirname, '../renderer');

  let mainWindow: BrowserWindow | undefined;
  const windowPort = createWindowPort(() => mainWindow);

  // Updates: the installed app looks for a newer version on GitHub in the background and installs
  // it when the app closes. Whether and how is decided from the build and the environment, never
  // from the page (see update-environment.ts).
  const sendUpdateState = (state: UpdateState): void => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannel.updateState, state);
    }
  };
  const updateEnvironment = resolveUpdateEnvironment({
    isPackaged: app.isPackaged,
    env: process.env,
  });
  // What the updater does is written to a small file in the profile folder, because a packaged app has
  // no console and an update that did not arrive would otherwise leave no trace of why.
  const updateLog = createUpdateLog(path.join(app.getPath('userData'), 'update.log'));
  const updates = new UpdateController({
    updater:
      updateEnvironment.kind === 'active'
        ? createUpdaterPort(autoUpdater, {
            logger: updateLog.library,
            ...(updateEnvironment.requestTimeoutMs === undefined
              ? {}
              : { requestTimeoutMs: updateEnvironment.requestTimeoutMs }),
            ...(updateEnvironment.testFeedUrl === undefined
              ? {}
              : {
                  testFeed: {
                    configPath: writeTestFeedConfig(
                      app.getPath('userData'),
                      updateEnvironment.testFeedUrl,
                    ),
                  },
                }),
          })
        : undefined,
    ...(updateEnvironment.kind === 'unavailable'
      ? { unavailableReason: updateEnvironment.reason }
      : {
          notifyOnly: updateEnvironment.notifyOnly,
          ...(updateEnvironment.firstCheckDelayMs === undefined
            ? {}
            : { firstCheckDelayMs: updateEnvironment.firstCheckDelayMs }),
        }),
    enabled: initialSettings.automaticUpdates,
    onState: sendUpdateState,
    log: (message, error) => {
      console.error('[updates]', message, error);
      updateLog.write(
        'error',
        error === undefined ? message : `${message} ${describeForLog(error)}`,
      );
    },
  });

  const controller: AppController = new AppController({
    documents: createDocumentService(),
    getWindow: () =>
      mainWindow !== undefined && !mainWindow.isDestroyed() ? windowPort : undefined,
    showOpenDialog: async (): Promise<string[]> => {
      const currentPath = controller.getCurrentDocumentPath();
      const options = {
        title: 'Open Markdown files',
        ...(currentPath === undefined ? {} : { defaultPath: path.dirname(currentPath) }),
        properties: ['openFile' as const, 'multiSelections' as const],
        filters: [{ name: 'Markdown files', extensions: ['md', 'markdown'] }],
      };
      const result =
        mainWindow === undefined
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(mainWindow, options);
      return result.canceled ? [] : result.filePaths;
    },
    isPackaged: app.isPackaged,
    onTabsChanged: (session) => {
      sessionStore.save(session);
    },
  });
  // The tabs of the last run, shown without reading them; a file named on the command line is
  // added after them below.
  if (initialSettings.restoreTabs) controller.restoreSession(sessionStore.load());

  const applyTheme = (theme: Settings['theme']): void => {
    nativeTheme.themeSource = theme;
    mainWindow?.setBackgroundColor(
      WINDOW_BACKGROUND[resolveTheme(theme, nativeTheme.shouldUseDarkColors)],
    );
  };

  registerIpcHandlers(
    ipcMain,
    createIpcHandlers({
      controller,
      settings: settingsStore,
      updates: {
        getState: () => updates.getState(),
        checkNow: () => updates.checkNow(),
        restart: () => updates.restartToInstall(),
      },
      appInfo: {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        installsUpdates: updateEnvironment.kind === 'active' && !updateEnvironment.notifyOnly,
      },
      trustedOrigins,
      openExternalUrl: (url) => shell.openExternal(url),
      closeWindow: () => {
        mainWindow?.close();
      },
      onSettingsChanged: (settings) => {
        // First what must not wait or be skipped: someone who turned updating off must not get an
        // update because a change of theme went wrong.
        updates.setEnabled(settings.automaticUpdates);
        // The same for the tabs: switching the remembering off removes what was remembered at
        // once, and switching it on remembers the tabs that are open now.
        if (settings.restoreTabs !== rememberingTabs) {
          rememberingTabs = settings.restoreTabs;
          sessionStore.setEnabled(rememberingTabs);
          if (rememberingTabs) sessionStore.save(controller.sessionData());
        }
        applyTheme(settings.theme);
      },
    }),
  );

  app.on('second-instance', (_event, argv, workingDirectory) => {
    controller.handleLaunch(argv, workingDirectory, { reveal: true });
  });
  // macOS delivers documents this way; Windows uses the command line above.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    controller.handleOpenRequest(filePath, { reveal: true });
  });
  app.on('window-all-closed', () => {
    app.quit();
  });

  // Let pending writes (the settings, the open tabs) finish before the process exits.
  let flushedFiles = false;
  app.on('before-quit', (event) => {
    updates.stop();
    if (flushedFiles) return;
    event.preventDefault();
    flushedFiles = true;
    void Promise.all([settingsStore.flush(), sessionStore.flush()]).finally(() => {
      app.quit();
    });
  });

  // The file passed on the command line is queued until the page is ready.
  controller.handleLaunch(process.argv, process.cwd());

  void app.whenReady().then(() => {
    protocol.handle(APP_SCHEME, (request) =>
      handleAppRequest(request, {
        rootDir: rendererRoot,
        readFile: (filePath) => readFile(filePath),
      }),
    );
    protocol.handle(LOCAL_IMAGE_SCHEME, (request) =>
      handleLocalImageRequest(request, {
        fs: {
          stat: (filePath) => stat(filePath),
          readFile: (filePath) => readFile(filePath),
          lstat: (filePath) => lstat(filePath),
          readlink: (filePath) => readlink(filePath),
        },
        getCurrentDocumentPath: () => controller.getCurrentDocumentPath(),
      }),
    );
    hardenSession(session.defaultSession);

    const iconPath = path.join(app.getAppPath(), 'build', 'icon.png');
    mainWindow = createMainWindow({
      preloadPath: path.join(__dirname, '../preload/index.js'),
      rendererUrl,
      trustedOrigins,
      backgroundColor:
        WINDOW_BACKGROUND[resolveTheme(initialSettings.theme, nativeTheme.shouldUseDarkColors)],
      isPackaged: app.isPackaged,
      ...(!app.isPackaged && existsSync(iconPath) ? { iconPath } : {}),
    });
    // A (re)loading page has not subscribed to documents yet.
    mainWindow.webContents.on('did-start-loading', () => {
      controller.rendererGone();
    });
    mainWindow.on('closed', () => {
      mainWindow = undefined;
    });

    updates.start();
  });
}
