import {
  isUpdateVersion,
  releasePageUrl,
  type UpdateState,
  type UpdateUnavailableReason,
} from '../shared/updates';
import { checkUpdateInfo } from './update-info';

/** How long after start the first check waits, so a short visit never touches the network. */
export const FIRST_CHECK_DELAY_MS = 15_000;
/** The time between two background checks while the app stays open. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** After a check or a download that failed, usually for lack of a connection, the next try comes sooner. */
export const RETRY_DELAY_MS = 15 * 60 * 1000;
/**
 * A check the user asks for within this long of one that found nothing newer is answered with that
 * result: nothing can have changed, and a page that asked over and over would send GitHub the same
 * request each time.
 */
export const MIN_CHECK_GAP_MS = 30_000;
/**
 * The same after a check that failed, but for much less time: someone who was offline and has just
 * reconnected must be able to try again, and not be told it failed as though nothing was tried.
 */
export const MIN_RETRY_GAP_MS = 5_000;
/**
 * How long to wait after a download that failed, the first time, the second and every time after:
 * a file that never arrives intact (a proxy that cuts it short, a bad copy at the far end) must not
 * be fetched again every quarter of an hour for as long as the app is open.
 */
const DOWNLOAD_RETRY_DELAYS_MS = [RETRY_DELAY_MS, 60 * 60 * 1000, CHECK_INTERVAL_MS] as const;

/**
 * What the update library tells us. Everything arrives as `unknown`: the values come from a
 * server on the internet, and nothing is believed before it has been checked here.
 */
export interface UpdaterHandlers {
  /** What the server says about the new version, exactly as it arrived. */
  onAvailable(info: unknown): void;
  onNotAvailable(): void;
  onProgress(percent: unknown): void;
  onDownloaded(version: unknown): void;
  onError(error: unknown): void;
}

/** The small part of an update library this app uses, so tests can stand in for it. */
export interface UpdaterPort {
  subscribe(handlers: UpdaterHandlers): void;
  /** Resolves when the check has finished. Nothing is downloaded: a newer version is announced. */
  check(): Promise<void>;
  /**
   * Downloads the version the last check announced, and resolves when that has ended, whether or
   * not it worked: a failure is reported through `onError`.
   */
  download(): Promise<void>;
  /** Stops whatever is under way on the network, a check or a download, so nothing goes on arriving. */
  cancelTransfers(): void;
  configure(options: { installOnQuit: boolean }): void;
  /** Closes the app, runs the installer without showing it, and starts the new version. */
  quitAndInstall(): void;
}

export interface Scheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  /** A clock that only moves forward, in milliseconds. */
  now(): number;
}

export interface UpdateControllerOptions {
  /** Absent when this build never updates (a development build, or updates disabled outside). */
  updater: UpdaterPort | undefined;
  /** Why there is no updater, shown to the page. */
  unavailableReason?: UpdateUnavailableReason;
  /** The portable executable cannot replace itself: it only reports that a newer version exists. */
  notifyOnly?: boolean;
  /** The user's setting. */
  enabled: boolean;
  /** How long after start the first check waits. Tests shorten it; nothing else changes it. */
  firstCheckDelayMs?: number;
  onState: (state: UpdateState) => void;
  scheduler?: Scheduler;
  log?: (message: string, error?: unknown) => void;
}

const realScheduler: Scheduler = {
  setTimeout(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    handle.unref();
    return handle;
  },
  clearTimeout(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
  now: () => performance.now(),
};

/**
 * Decides when to look for a new version and what the page is told about it. The library does the
 * network work and the installing; this class holds the rules around it:
 *
 * - a check shortly after start and every six hours, never while the user has it switched off;
 * - what the server offers is checked here before anything is downloaded;
 * - an installed build downloads in the background and installs when the app closes, the
 *   portable executable only reports that a newer version exists;
 * - a background check that fails is silent, because being offline is normal, and is tried again
 *   sooner than usual;
 * - a version number is believed only when it is a plain version number.
 */
export class UpdateController {
  private readonly updater: UpdaterPort | undefined;
  private readonly notifyOnly: boolean;
  private readonly firstCheckDelayMs: number;
  private readonly onState: (state: UpdateState) => void;
  private readonly scheduler: Scheduler;
  private readonly log: (message: string, error?: unknown) => void;

  private enabled: boolean;
  private started = false;
  private state: UpdateState;
  private timer: unknown;
  private inFlight: Promise<void> | undefined;
  /** True while a check the user asked for is running, so its outcome is shown. */
  private manualCheck = false;
  /** The download now under way began with a check the user asked for, so they saw it start. */
  private downloadSeenByUser = false;
  private lastPercent = -1;
  /** When the last check or download failed: how long to wait before trying again. */
  private retryAfter: number | undefined;
  /** Downloads that failed in a row, so that each retry waits longer than the one before. */
  private downloadFailures = 0;
  /** The running check heard that there is nothing newer. */
  private foundNothing = false;
  /**
   * What the last check that ended without a newer version told the page, when it ended, and for
   * how long a user who asks again is given that answer instead of a new check.
   */
  private lastOutcome: { state: UpdateState; at: number; holdMs: number } | undefined;
  /** The installer has been started; asking again would start another. */
  private installing = false;

  constructor(options: UpdateControllerOptions) {
    this.updater = options.updater;
    this.notifyOnly = options.notifyOnly ?? false;
    this.firstCheckDelayMs = options.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS;
    this.enabled = options.enabled;
    this.onState = options.onState;
    this.scheduler = options.scheduler ?? realScheduler;
    this.log = options.log ?? (() => undefined);

    if (this.updater === undefined) {
      this.state = { status: 'unavailable', reason: options.unavailableReason ?? 'disabled' };
      return;
    }
    this.state = this.enabled ? { status: 'idle' } : { status: 'off' };
    this.configureUpdater();
    this.updater.subscribe({
      onAvailable: (info) => {
        this.handleAvailable(info);
      },
      onNotAvailable: () => {
        this.handleNotAvailable();
      },
      onProgress: (percent) => {
        this.handleProgress(percent);
      },
      onDownloaded: (version) => {
        this.handleDownloaded(version);
      },
      onError: (error) => {
        this.fail('The update library reported an error.', error);
      },
    });
  }

  getState(): UpdateState {
    return this.state;
  }

  /** Begins the schedule: a first check soon, then one every few hours. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.scheduleNext(this.firstCheckDelayMs);
  }

  stop(): void {
    this.started = false;
    this.clearTimer();
  }

  /** Follows the user's setting. Turning updates off also stops an update from installing on quit. */
  setEnabled(enabled: boolean): void {
    if (this.updater === undefined || enabled === this.enabled) return;
    this.enabled = enabled;
    this.configureUpdater();
    // What an earlier check found says nothing about a check made after the user changed their mind.
    this.lastOutcome = undefined;
    if (enabled) {
      this.setState({ status: 'idle' });
      this.scheduleNext(this.firstCheckDelayMs);
    } else {
      this.clearTimer();
      // Someone who turned updating off does not want a download to carry on, least of all on a
      // metered connection.
      this.updater.cancelTransfers();
      this.setState({ status: 'off' });
    }
  }

  /** A check the user asked for. Resolves with the state once it has finished. */
  async checkNow(): Promise<UpdateState> {
    await this.runCheck(true);
    return this.state;
  }

  /**
   * Restarts into a downloaded update. Returns false when there is nothing to install, or when the
   * installer has already been started: a second one would only get in the way of the first.
   */
  restartToInstall(): boolean {
    if (this.updater === undefined || this.state.status !== 'ready' || this.installing) {
      return false;
    }
    this.installing = true;
    this.updater.quitAndInstall();
    return true;
  }

  private configureUpdater(): void {
    this.updater?.configure({ installOnQuit: this.enabled && !this.notifyOnly });
  }

  private scheduleNext(delayMs: number): void {
    this.clearTimer();
    if (!this.started || this.updater === undefined || !this.enabled) return;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = undefined;
      void this.runCheck(false).then(() => {
        this.scheduleNext(this.retryAfter ?? CHECK_INTERVAL_MS);
      });
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private runCheck(manual: boolean): Promise<void> {
    const updater = this.updater;
    if (updater === undefined || !this.enabled) return Promise.resolve();

    if (this.inFlight !== undefined) {
      // Share the check that is already running, and show the user its result.
      if (manual) {
        this.manualCheck = true;
        this.setState({ status: 'checking' });
      }
      return this.inFlight;
    }
    // An update that is downloading or waiting to be installed needs no new check.
    if (this.state.status === 'downloading' || this.state.status === 'ready') {
      return Promise.resolve();
    }
    // Asked again a moment after a check: nothing can have changed, so say what it found.
    if (
      manual &&
      this.lastOutcome !== undefined &&
      this.scheduler.now() - this.lastOutcome.at < this.lastOutcome.holdMs
    ) {
      this.setState(this.lastOutcome.state);
      return Promise.resolve();
    }

    this.manualCheck = manual;
    this.retryAfter = undefined;
    this.foundNothing = false;
    if (manual) this.setState({ status: 'checking' });
    // A library that throws instead of rejecting must not take the main process down with it.
    let attempt: Promise<void>;
    try {
      attempt = updater.check();
    } catch (error) {
      attempt = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const running = attempt
      .then(
        () => true,
        (error: unknown) => {
          this.fail('Checking for updates failed.', error);
          return false;
        },
      )
      .then((succeeded) => {
        this.inFlight = undefined;
        this.manualCheck = false;
        if (!this.enabled) {
          this.lastOutcome = undefined;
        } else if (!succeeded) {
          this.lastOutcome = {
            state: { status: 'error' },
            at: this.scheduler.now(),
            holdMs: MIN_RETRY_GAP_MS,
          };
        } else if (this.foundNothing) {
          this.lastOutcome = {
            state: { status: 'current' },
            at: this.scheduler.now(),
            holdMs: MIN_CHECK_GAP_MS,
          };
        } else {
          this.lastOutcome = undefined;
        }
        if (this.state.status === 'checking') this.setState({ status: 'idle' });
      });
    this.inFlight = running;
    return running;
  }

  private handleAvailable(info: unknown): void {
    if (!this.enabled) return;
    const checked = checkUpdateInfo(info);
    if (!checked.ok) {
      this.fail(
        `The update server offered something this app does not accept: ${checked.problem}.`,
      );
      return;
    }
    const { version } = checked;
    // The same offer announced again (a second check, or an event repeated) changes nothing.
    if (this.state.status === 'downloading' && this.state.version === version) return;

    this.lastPercent = -1;
    this.downloadSeenByUser = this.manualCheck;
    if (this.notifyOnly) {
      this.setState({ status: 'available', version, releaseUrl: releasePageUrl(version) });
      return;
    }
    this.setState({ status: 'downloading', version, percent: 0 });
    this.startDownload();
  }

  private startDownload(): void {
    const updater = this.updater;
    if (updater === undefined) return;
    const failed = (error: unknown): void => {
      this.fail('Downloading the update failed.', error);
    };
    try {
      void updater.download().then(() => {
        // Whether it worked or not, the library has said so by now. A download that ended with
        // neither would leave the page waiting for ever.
        if (this.state.status === 'downloading') {
          this.fail('The download ended without delivering the update.');
        }
      }, failed);
    } catch (error) {
      failed(error);
    }
  }

  private handleNotAvailable(): void {
    if (!this.enabled) return;
    this.foundNothing = true;
    if (this.manualCheck) {
      this.setState({ status: 'current' });
    } else if (this.state.status === 'error' || this.state.status === 'current') {
      // What the page showed about an earlier attempt is out of date.
      this.setState({ status: 'idle' });
    }
  }

  private handleProgress(percent: unknown): void {
    if (!this.enabled || this.notifyOnly || this.state.status !== 'downloading') return;
    if (typeof percent !== 'number' || !Number.isFinite(percent)) return;
    const whole = Math.min(100, Math.max(0, Math.floor(percent)));
    if (whole === this.lastPercent) return;
    this.lastPercent = whole;
    this.setState({ status: 'downloading', version: this.state.version, percent: whole });
  }

  private handleDownloaded(version: unknown): void {
    if (!this.enabled || this.notifyOnly) return;
    if (!isUpdateVersion(version)) {
      this.fail('The update server announced a downloaded version that is not a version number.');
      return;
    }
    this.downloadFailures = 0;
    this.setState({ status: 'ready', version });
  }

  /**
   * A failed background check says nothing to the user, because being offline is normal. What the
   * user asked for, or watched start, is reported.
   */
  private fail(message: string, error?: unknown): void {
    this.log(message, error);
    // Whatever went wrong, the installer is not running: let the user try again.
    this.installing = false;
    // A user who switched updating off has nothing more to hear about it, and a failure that
    // arrives late must not turn the switch they see into an error.
    if (!this.enabled) return;
    const downloading = this.state.status === 'downloading';
    const userWatched = this.manualCheck || (downloading && this.downloadSeenByUser);
    if (userWatched) {
      this.setState({ status: 'error' });
    } else if (downloading) {
      this.setState({ status: 'idle' });
    }
    if (downloading) {
      this.downloadFailures += 1;
      const step = Math.min(this.downloadFailures, DOWNLOAD_RETRY_DELAYS_MS.length) - 1;
      this.markForRetry(DOWNLOAD_RETRY_DELAYS_MS[step] ?? CHECK_INTERVAL_MS);
    } else if (this.inFlight !== undefined) {
      // No connection costs nothing to find out again, so a failed check is tried again soon.
      this.markForRetry(RETRY_DELAY_MS);
    }
  }

  private markForRetry(delayMs: number): void {
    this.retryAfter = delayMs;
    // A check that is running schedules the next one itself when it ends.
    if (this.inFlight === undefined) this.scheduleNext(delayMs);
  }

  private setState(next: UpdateState): void {
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.onState(next);
  }
}
