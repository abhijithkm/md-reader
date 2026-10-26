import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CancellationToken, type AppUpdater } from 'electron-updater';
import { addRedirectLimit, type RedirectExecutor } from './redirect-limit';
import { addRequestTimeout, type RequestExecutor, type RequestWatch } from './request-timeout';
import type { LibraryLogger } from './update-log';
import type { UpdaterPort } from './updates';

/** The members of electron-updater's updater that this app touches. */
export type LibraryUpdater = Pick<
  AppUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'allowDowngrade'
  | 'disableWebInstaller'
  | 'requestHeaders'
  | 'logger'
  | 'forceDevUpdateConfig'
  | 'updateConfigPath'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
  | 'setFeedURL'
  | 'on'
> & {
  /** Present at run time, though the library's type leaves it out. */
  httpExecutor?: (RequestExecutor & RedirectExecutor) | null;
};

export interface UpdaterPortOptions {
  /**
   * A feed served from this computer. Only the tests of a development build pass one; the library
   * then reads this file in place of the `app-update.yml` of an installed app.
   */
  testFeed?: { configPath: string };
  /** How long a request may stay silent before it is given up on. Only tests make it shorter. */
  requestTimeoutMs?: number;
  /** Where the library writes what it does. Without one it writes to the console. */
  logger?: LibraryLogger;
}

/**
 * Writes what an installed app would find in `app-update.yml`, for a feed served from this
 * computer, and returns the path of the file.
 */
export function writeTestFeedConfig(directory: string, feedUrl: string): string {
  const file = path.join(directory, 'dev-app-update.yml');
  writeFileSync(
    file,
    `provider: generic\nurl: ${feedUrl}\nupdaterCacheDirName: md-reader-test-updater\n`,
    'utf8',
  );
  return file;
}

/**
 * Wraps electron-updater in the small interface the controller uses. Where updates come from is
 * never chosen here: an installed build reads `app-update.yml`, which electron-builder wrote into
 * the package. The one exception is a test feed in a development build, which can download a
 * file but is never allowed to run one.
 *
 * What the library would otherwise decide for itself is settled here, once:
 * - it never downloads on its own, so the controller can look at the offer first;
 * - it never takes a web installer, which would fetch more files after the check;
 * - it sends no identifier of this installation (see `requestHeaders` below);
 * - a request that hears nothing for a minute fails instead of waiting for ever.
 */
export function createUpdaterPort(
  library: LibraryUpdater,
  options: UpdaterPortOptions = {},
): UpdaterPort {
  const testing = options.testFeed !== undefined;

  // An update must never replace the app with an older version.
  library.allowDowngrade = false;
  library.autoDownload = false;
  library.disableWebInstaller = true;
  // With every check the library sends `x-user-staging-id`, a random id it keeps on this computer
  // so that a publisher could roll a release out to a share of its users. This app does not roll
  // out in shares, so the id is replaced by a fixed word and no request tells one installation from
  // another.
  library.requestHeaders = { 'x-user-staging-id': 'unset' };
  if (options.logger !== undefined) library.logger = options.logger;
  const executor = library.httpExecutor;
  let requests: RequestWatch | undefined;
  if (executor !== undefined && executor !== null) {
    requests = addRequestTimeout(executor, options.requestTimeoutMs);
    addRedirectLimit(executor);
  }

  if (options.testFeed !== undefined) {
    library.forceDevUpdateConfig = true;
    library.updateConfigPath = options.testFeed.configPath;
  }

  /** What stops the download that is under way, if one is. */
  let downloading: CancellationToken | undefined;

  return {
    subscribe(handlers) {
      library.on('update-available', (info) => {
        handlers.onAvailable(info);
      });
      library.on('update-not-available', () => {
        handlers.onNotAvailable();
      });
      library.on('download-progress', (progress) => {
        handlers.onProgress(progress.percent);
      });
      library.on('update-downloaded', (event) => {
        handlers.onDownloaded(event.version);
      });
      library.on('error', (error) => {
        handlers.onError(error);
      });
    },

    async check() {
      await library.checkForUpdates();
    },

    async download() {
      // Asked again while one is under way, the library goes on with that one: so does this.
      const cancellation =
        downloading !== undefined && !downloading.cancelled ? downloading : new CancellationToken();
      downloading = cancellation;
      try {
        await library.downloadUpdate(cancellation);
      } catch {
        // The library reports a failed download through its error event before it rejects; this
        // keeps the same failure from also surfacing as a rejection that nothing handles. A download
        // that was cancelled ends here too, and is not an error.
      } finally {
        if (downloading === cancellation) downloading = undefined;
      }
    },

    cancelTransfers() {
      // Cancelling fails the promise of the download and nothing more: the library never aborts the
      // request behind it, so the file would go on arriving. The requests are stopped here, and
      // cancelling first means the library takes the failure for a cancellation, not an error.
      downloading?.cancel();
      requests?.abortAll('Updating was turned off.');
    },

    configure({ installOnQuit }) {
      library.autoInstallOnAppQuit = installOnQuit && !testing;
    },

    quitAndInstall() {
      if (!testing) library.quitAndInstall(true, true);
    },
  };
}
