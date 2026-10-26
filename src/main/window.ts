import { BrowserWindow, type Session, type WebContents } from 'electron';
import { IpcChannel } from '../shared/ipc';
import type { WindowPort } from './app-controller';
import { isTrustedSender } from './ipc-guard';

export interface MainWindowOptions {
  preloadPath: string;
  /** Where the page is loaded from: app://md-reader/index.html or the Vite dev server. */
  rendererUrl: string;
  /** Origins that may host the page; anything else is never navigated to. */
  trustedOrigins: readonly string[];
  backgroundColor: string;
  isPackaged: boolean;
  iconPath?: string;
}

const SHOW_FALLBACK_MS = 5000;

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: 'MD Reader',
    backgroundColor: options.backgroundColor,
    autoHideMenuBar: true,
    ...(options.iconPath === undefined ? {} : { icon: options.iconPath }),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      // A long document is shown piece by piece from timers. Chromium slows the timers of a
      // minimized or covered window to about one a second, which would stretch the rendering of
      // a big file from seconds to minutes; keep it running at full speed instead.
      backgroundThrottling: false,
      // Developer tools only in development builds.
      devTools: !options.isPackaged,
    },
  });

  hardenWebContents(window.webContents, options.trustedOrigins);
  if (!options.isPackaged) enableDevToolsShortcut(window.webContents);

  // Show once the first frame is painted; fall back so a failed load is still visible.
  window.once('ready-to-show', () => {
    window.show();
  });
  setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  }, SHOW_FALLBACK_MS).unref();

  void window.loadURL(options.rendererUrl);
  return window;
}

/** Keeps the page on the app: no pop-ups, no navigation elsewhere, no embedded web views. */
export function hardenWebContents(contents: WebContents, trustedOrigins: readonly string[]): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const blockUntrustedNavigation = (event: { preventDefault(): void }, url: string): void => {
    if (!isTrustedSender(url, trustedOrigins)) event.preventDefault();
  };
  contents.on('will-navigate', blockUntrustedNavigation);
  contents.on('will-redirect', blockUntrustedNavigation);
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

/** The app needs no browser permissions (camera, location, notifications...) and never downloads files. */
export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.on('will-download', (event) => {
    event.preventDefault();
  });
}

export function createWindowPort(getWindow: () => BrowserWindow | undefined): WindowPort {
  const usable = (): BrowserWindow | undefined => {
    const window = getWindow();
    return window !== undefined && !window.isDestroyed() ? window : undefined;
  };

  return {
    sendOutcome(outcome) {
      usable()?.webContents.send(IpcChannel.documentOpened, outcome);
    },
    sendTabs(snapshot) {
      usable()?.webContents.send(IpcChannel.tabsChanged, snapshot);
    },
    reveal() {
      const window = usable();
      if (window === undefined) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
  };
}

function enableDevToolsShortcut(contents: WebContents): void {
  contents.on('before-input-event', (_event, input) => {
    const isInspectShortcut =
      input.type === 'keyDown' &&
      (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'));
    if (isInspectShortcut) contents.toggleDevTools();
  });
}
