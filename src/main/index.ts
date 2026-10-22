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
import { existsSync } from 'node:fs';
import { lstat, readFile, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { LOCAL_IMAGE_SCHEME } from '../shared/local-image-url';
import type { Settings } from '../shared/settings';
import { resolveTheme, WINDOW_BACKGROUND } from '../shared/theme';
import { AppController } from './app-controller';
import { APP_SCHEME, handleAppRequest } from './app-protocol';
import { declineClientCertificates } from './certificates';
import { createDocumentService } from './documents';
import { createIpcHandlers, registerIpcHandlers } from './ipc';
import { handleLocalImageRequest } from './local-image-protocol';
import { resolveRendererLocation } from './renderer-location';
import { SettingsStore } from './settings-store';
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

  const { url: rendererUrl, trustedOrigins } = resolveRendererLocation({
    isPackaged: app.isPackaged,
    env: process.env,
  });
  const rendererRoot = path.join(__dirname, '../renderer');

  let mainWindow: BrowserWindow | undefined;
  const windowPort = createWindowPort(() => mainWindow);

  const controller: AppController = new AppController({
    documents: createDocumentService(),
    getWindow: () =>
      mainWindow !== undefined && !mainWindow.isDestroyed() ? windowPort : undefined,
    showOpenDialog: async (): Promise<string | undefined> => {
      const currentPath = controller.getCurrentDocumentPath();
      const options = {
        title: 'Open Markdown file',
        ...(currentPath === undefined ? {} : { defaultPath: path.dirname(currentPath) }),
        properties: ['openFile' as const],
        filters: [{ name: 'Markdown files', extensions: ['md', 'markdown'] }],
      };
      const result =
        mainWindow === undefined
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(mainWindow, options);
      return result.canceled ? undefined : result.filePaths[0];
    },
    isPackaged: app.isPackaged,
  });

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
      appInfo: { name: app.getName(), version: app.getVersion(), platform: process.platform },
      trustedOrigins,
      openExternalUrl: (url) => shell.openExternal(url),
      closeWindow: () => {
        mainWindow?.close();
      },
      onSettingsChanged: (settings) => {
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

  // Let a pending settings write finish before the process exits.
  let flushedSettings = false;
  app.on('before-quit', (event) => {
    if (flushedSettings) return;
    event.preventDefault();
    flushedSettings = true;
    void settingsStore.flush().finally(() => {
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
  });
}
