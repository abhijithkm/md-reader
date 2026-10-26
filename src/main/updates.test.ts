import { describe, expect, it, vi } from 'vitest';
import { releasePageUrl, type UpdateState } from '../shared/updates';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  MIN_CHECK_GAP_MS,
  MIN_RETRY_GAP_MS,
  RETRY_DELAY_MS,
  UpdateController,
  type Scheduler,
  type UpdateControllerOptions,
  type UpdaterHandlers,
  type UpdaterPort,
} from './updates';

const SHA512 = `${'q'.repeat(86)}==`;

/** What the update library announces for a new version, as electron-builder writes it. */
function offer(version: string, changes: Record<string, unknown> = {}): Record<string, unknown> {
  const name = `MDReader-Setup-${version}.exe`;
  return {
    version,
    files: [{ url: name, sha512: SHA512, size: 1_000_000 }],
    path: name,
    sha512: SHA512,
    releaseDate: '2026-10-22T17:38:07.395Z',
    ...changes,
  };
}

/** The update library, replaced by something that does what a test tells it to. */
class FakeUpdater implements UpdaterPort {
  handlers: UpdaterHandlers | undefined;
  checks = 0;
  downloads = 0;
  installs = 0;
  cancels = 0;
  readonly configured: { installOnQuit: boolean }[] = [];
  /** What the next check does: usually reports events through `emit`. */
  onCheck: () => Promise<void> | void = () => undefined;
  /** What the next download does. */
  onDownload: () => Promise<void> | void = () => undefined;

  subscribe(handlers: UpdaterHandlers): void {
    this.handlers = handlers;
  }

  check(): Promise<void> {
    this.checks += 1;
    return Promise.resolve(this.onCheck());
  }

  download(): Promise<void> {
    this.downloads += 1;
    return Promise.resolve(this.onDownload());
  }

  cancelTransfers(): void {
    this.cancels += 1;
  }

  configure(options: { installOnQuit: boolean }): void {
    this.configured.push(options);
  }

  quitAndInstall(): void {
    this.installs += 1;
  }

  get emit(): UpdaterHandlers {
    if (this.handlers === undefined) throw new Error('the controller never subscribed');
    return this.handlers;
  }
}

/** Timers that only run when a test says so, and a clock that only moves when a test says so. */
class FakeScheduler implements Scheduler {
  private nextId = 1;
  private readonly timers = new Map<number, { callback: () => void; delayMs: number }>();
  private time = 1_000_000;

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.timers.set(id, { callback, delayMs });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  now(): number {
    return this.time;
  }

  advance(milliseconds: number): void {
    this.time += milliseconds;
  }

  get delays(): number[] {
    return [...this.timers.values()].map((timer) => timer.delayMs);
  }

  /** Runs the oldest timer and lets the check it starts finish. */
  async fire(): Promise<void> {
    const first = this.timers.entries().next();
    if (first.done) throw new Error('no timer is waiting');
    const [id, timer] = first.value;
    this.timers.delete(id);
    timer.callback();
    await settle();
  }
}

/** Lets promise callbacks that are already queued run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

function setup(options: Partial<UpdateControllerOptions> & { withUpdater?: boolean } = {}) {
  const { withUpdater = true, ...rest } = options;
  const updater = new FakeUpdater();
  const scheduler = new FakeScheduler();
  const states: UpdateState[] = [];
  const log = vi.fn<(message: string, error?: unknown) => void>();
  const controller = new UpdateController({
    updater: withUpdater ? updater : undefined,
    unavailableReason: 'development',
    enabled: true,
    onState: (state) => {
      states.push(state);
    },
    scheduler,
    log,
    ...rest,
  });
  return { controller, updater, scheduler, states, log };
}

describe('UpdateController', () => {
  describe('in a build that cannot update', () => {
    it('says why and never schedules a check, runs one or installs anything', async () => {
      const { controller, scheduler, states } = setup({
        withUpdater: false,
        unavailableReason: 'disabled',
      });

      expect(controller.getState()).toEqual({ status: 'unavailable', reason: 'disabled' });
      controller.start();
      expect(scheduler.delays).toEqual([]);
      expect(await controller.checkNow()).toEqual({ status: 'unavailable', reason: 'disabled' });
      expect(controller.restartToInstall()).toBe(false);
      controller.setEnabled(false);
      controller.setEnabled(true);
      expect(states).toEqual([]);
    });
  });

  describe('when the user switched automatic updates off', () => {
    it('stays off: no check is scheduled and nothing is installed when the app closes', async () => {
      const { controller, updater, scheduler } = setup({ enabled: false });

      expect(controller.getState()).toEqual({ status: 'off' });
      expect(updater.configured).toEqual([{ installOnQuit: false }]);
      controller.start();
      expect(scheduler.delays).toEqual([]);
      await controller.checkNow();
      expect(updater.checks).toBe(0);
    });

    it('starts looking again when the user switches it on', () => {
      const { controller, updater, scheduler, states } = setup({ enabled: false });
      controller.start();

      controller.setEnabled(true);

      expect(states).toEqual([{ status: 'idle' }]);
      expect(updater.configured.at(-1)).toEqual({ installOnQuit: true });
      expect(scheduler.delays).toEqual([FIRST_CHECK_DELAY_MS]);
    });

    it('stops at once when the user switches it off, including installing on quit', () => {
      const { controller, updater, scheduler, states } = setup();
      controller.start();

      controller.setEnabled(false);

      expect(states).toEqual([{ status: 'off' }]);
      expect(updater.configured.at(-1)).toEqual({ installOnQuit: false });
      expect(scheduler.delays).toEqual([]);
    });

    it('stops what is under way on the network when the user switches updates off, and cancels nothing when they switch them on', () => {
      const { controller, updater } = setup();
      updater.onDownload = () => new Promise<void>(() => undefined);
      updater.emit.onAvailable(offer('1.2.0'));

      controller.setEnabled(false);
      expect(updater.cancels).toBe(1);

      controller.setEnabled(true);
      expect(updater.cancels).toBe(1);
    });

    // A check that was asked for and then outlived the user's change of mind used to end in the
    // error state, where the page offers only to check again or to turn updating off.
    it('ignores a failure that arrives after the user switched updates off, and leaves the switch as it is', async () => {
      const { controller, updater, states } = setup();
      let failTheCheck: (error: Error) => void = () => undefined;
      updater.onCheck = () =>
        new Promise<void>((_resolve, reject) => {
          failTheCheck = reject;
        });
      const asked = controller.checkNow();
      controller.setEnabled(false);

      failTheCheck(new Error('offline'));
      await asked;

      expect(states).toEqual([{ status: 'checking' }, { status: 'off' }]);
      expect(controller.getState()).toEqual({ status: 'off' });
    });

    it('ignores what a download that was already running reports afterwards', () => {
      const { controller, updater, states } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
      };
      void controller.checkNow();
      controller.setEnabled(false);
      states.length = 0;

      updater.emit.onProgress(80);
      updater.emit.onDownloaded('1.2.0');

      expect(states).toEqual([]);
      expect(controller.getState()).toEqual({ status: 'off' });
    });
  });

  describe('scheduling', () => {
    // The README, the changelog and the architecture notes promise these numbers, and the tests
    // below use the constants: a change to one has to be a decision, so the values are written out.
    it('uses the times the documentation names: 15 seconds, 6 hours and 15 minutes', () => {
      expect(FIRST_CHECK_DELAY_MS).toBe(15 * 1000);
      expect(CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
      expect(RETRY_DELAY_MS).toBe(15 * 60 * 1000);
    });

    it('checks shortly after start, then every six hours', async () => {
      const { controller, updater, scheduler } = setup();
      controller.start();
      expect(scheduler.delays).toEqual([FIRST_CHECK_DELAY_MS]);
      expect(updater.checks).toBe(0);

      await scheduler.fire();
      expect(updater.checks).toBe(1);
      expect(scheduler.delays).toEqual([CHECK_INTERVAL_MS]);

      await scheduler.fire();
      expect(updater.checks).toBe(2);
      expect(scheduler.delays).toEqual([CHECK_INTERVAL_MS]);
    });

    it('waits as long as it is told before the first check, and again after being switched on', () => {
      const { controller, scheduler } = setup({ firstCheckDelayMs: 500, enabled: false });
      controller.start();
      expect(scheduler.delays).toEqual([]);

      controller.setEnabled(true);

      expect(scheduler.delays).toEqual([500]);
    });

    it('does not schedule twice when started twice, and stops when told to', () => {
      const { controller, scheduler } = setup();
      controller.start();
      controller.start();
      expect(scheduler.delays).toEqual([FIRST_CHECK_DELAY_MS]);

      controller.stop();
      expect(scheduler.delays).toEqual([]);
    });

    it('keeps going after a check failed, and tries again sooner than usual', async () => {
      const { controller, updater, scheduler } = setup();
      updater.onCheck = () => Promise.reject(new Error('offline'));
      controller.start();

      await scheduler.fire();
      expect(scheduler.delays).toEqual([RETRY_DELAY_MS]);

      updater.onCheck = () => undefined;
      await scheduler.fire();
      expect(scheduler.delays).toEqual([CHECK_INTERVAL_MS]);
    });

    it('tries again sooner when a download failed, since the check itself went well', async () => {
      const { controller, updater, scheduler } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
      };
      updater.onDownload = () => new Promise<void>(() => undefined);
      controller.start();
      await scheduler.fire();
      expect(scheduler.delays).toEqual([CHECK_INTERVAL_MS]);

      updater.emit.onError(new Error('connection reset'));

      expect(scheduler.delays).toEqual([RETRY_DELAY_MS]);
    });

    // A file that never arrives intact (a proxy that cuts it short, a bad copy at the far end) would
    // otherwise be fetched again every quarter of an hour for as long as the app is open.
    it('waits longer after each failed download: 15 minutes, an hour, then six hours', async () => {
      const { controller, updater, scheduler } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
      };
      updater.onDownload = () => new Promise<void>(() => undefined);
      controller.start();

      const waits: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await scheduler.fire();
        updater.emit.onError(new Error('checksum mismatch'));
        waits.push(...scheduler.delays);
      }

      expect(waits).toEqual([
        RETRY_DELAY_MS,
        60 * 60 * 1000,
        CHECK_INTERVAL_MS,
        CHECK_INTERVAL_MS,
        CHECK_INTERVAL_MS,
      ]);
    });

    it('starts over at 15 minutes once a download has arrived, and for a check that fails', async () => {
      const { controller, updater, scheduler } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
      };
      updater.onDownload = () => new Promise<void>(() => undefined);
      controller.start();
      await scheduler.fire();
      updater.emit.onError(new Error('checksum mismatch'));
      await scheduler.fire();
      updater.emit.onError(new Error('checksum mismatch'));
      expect(scheduler.delays).toEqual([60 * 60 * 1000]);
      await scheduler.fire();
      updater.emit.onDownloaded('1.2.0');

      // A new version later: the failures before the success no longer count.
      controller.setEnabled(false);
      controller.setEnabled(true);
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.3.0'));
      };
      await scheduler.fire();
      updater.emit.onError(new Error('checksum mismatch'));
      expect(scheduler.delays).toEqual([RETRY_DELAY_MS]);

      // And a check that fails (no connection) is tried again in 15 minutes whatever came before.
      await scheduler.fire();
      updater.emit.onError(new Error('checksum mismatch'));
      await scheduler.fire();
      updater.emit.onError(new Error('checksum mismatch'));
      updater.onCheck = () => Promise.reject(new Error('offline'));
      await scheduler.fire();
      expect(scheduler.delays).toEqual([RETRY_DELAY_MS]);
    });

    it('does not schedule a retry after it was stopped', async () => {
      const { controller, updater, scheduler } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
      };
      updater.onDownload = () => new Promise<void>(() => undefined);
      controller.start();
      await scheduler.fire();
      controller.stop();

      updater.emit.onError(new Error('connection reset'));

      expect(scheduler.delays).toEqual([]);
    });
  });

  describe('in an installed build', () => {
    it('downloads a newer version and tells the page when it is ready', async () => {
      const { controller, updater, scheduler, states } = setup();
      expect(updater.configured).toEqual([{ installOnQuit: true }]);
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
        updater.emit.onProgress(10);
        updater.emit.onProgress(10.4);
        updater.emit.onProgress(55.9);
        updater.emit.onDownloaded('1.2.0');
      };
      controller.start();

      await scheduler.fire();

      expect(updater.downloads).toBe(1);
      expect(states).toEqual([
        { status: 'downloading', version: '1.2.0', percent: 0 },
        { status: 'downloading', version: '1.2.0', percent: 10 },
        { status: 'downloading', version: '1.2.0', percent: 55 },
        { status: 'ready', version: '1.2.0' },
      ]);
    });

    it('keeps silent about a background check that finds nothing', async () => {
      const { controller, updater, scheduler, states } = setup();
      updater.onCheck = () => {
        updater.emit.onNotAvailable();
      };
      controller.start();

      await scheduler.fire();

      expect(states).toEqual([]);
      expect(controller.getState()).toEqual({ status: 'idle' });
      expect(updater.downloads).toBe(0);
    });

    it('keeps silent about a background check that fails, because offline is normal', async () => {
      const { controller, updater, scheduler, states, log } = setup();
      updater.onCheck = () => {
        const error = new Error('getaddrinfo ENOTFOUND github.com');
        updater.emit.onError(error);
        throw error;
      };
      controller.start();

      await scheduler.fire();

      expect(states).toEqual([]);
      expect(controller.getState()).toEqual({ status: 'idle' });
      expect(log).toHaveBeenCalled();
    });

    it('goes back to idle when a download fails, so the next check tries again', async () => {
      const { controller, updater, scheduler, states } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
        updater.emit.onError(new Error('connection reset'));
      };
      controller.start();

      await scheduler.fire();

      expect(states).toEqual([
        { status: 'downloading', version: '1.2.0', percent: 0 },
        { status: 'idle' },
      ]);
    });

    it('does not wait for ever on a download that ends without delivering anything', async () => {
      const { controller, updater, scheduler, states, log } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
      };
      controller.start();

      await scheduler.fire();

      expect(states).toEqual([
        { status: 'downloading', version: '1.2.0', percent: 0 },
        { status: 'idle' },
      ]);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/ended without/i), undefined);
    });

    it('reports a download that fails without the library saying why, to a user who watched it start', async () => {
      const { controller, updater } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
      };
      updater.onDownload = () => Promise.reject(new Error('boom'));

      await controller.checkNow();
      await settle();

      expect(controller.getState()).toEqual({ status: 'error' });
    });

    it('keeps progress between 0 and 100 and ignores values that are not numbers', () => {
      const { controller, updater, states } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
      };
      updater.onDownload = () => new Promise<void>(() => undefined);
      void controller.checkNow();
      states.length = 0;

      updater.emit.onProgress(-5);
      updater.emit.onProgress(250);
      updater.emit.onProgress(Number.NaN);
      updater.emit.onProgress('50');
      updater.emit.onProgress(undefined);

      expect(states).toEqual([{ status: 'downloading', version: '1.2.0', percent: 100 }]);
    });

    it('does not look again while an update is downloading or waiting to be installed', async () => {
      const { controller, updater, scheduler } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
        updater.emit.onDownloaded('1.2.0');
      };
      controller.start();
      await scheduler.fire();
      expect(updater.checks).toBe(1);

      await scheduler.fire();
      await controller.checkNow();

      expect(updater.checks).toBe(1);
      expect(controller.getState()).toEqual({ status: 'ready', version: '1.2.0' });
    });

    it('lets an earlier error go when a later background check finds nothing', async () => {
      const { controller, updater, scheduler } = setup();
      updater.onCheck = () => {
        throw new Error('offline');
      };
      await controller.checkNow();
      expect(controller.getState()).toEqual({ status: 'error' });

      updater.onCheck = () => {
        updater.emit.onNotAvailable();
      };
      controller.start();
      await scheduler.fire();

      expect(controller.getState()).toEqual({ status: 'idle' });
    });
  });

  describe('restarting into an update', () => {
    it('restarts only when an update has been downloaded', () => {
      const { controller, updater } = setup();
      updater.onDownload = () => new Promise<void>(() => undefined);
      expect(controller.restartToInstall()).toBe(false);

      updater.emit.onAvailable(offer('1.2.0'));
      expect(controller.restartToInstall()).toBe(false);

      updater.emit.onDownloaded('1.2.0');
      expect(controller.restartToInstall()).toBe(true);
      expect(updater.installs).toBe(1);
    });

    it('starts the installer once, however many times it is asked', () => {
      const { controller, updater } = setup();
      updater.onDownload = () => new Promise<void>(() => undefined);
      updater.emit.onAvailable(offer('1.2.0'));
      updater.emit.onDownloaded('1.2.0');

      expect(controller.restartToInstall()).toBe(true);
      expect(controller.restartToInstall()).toBe(false);
      expect(controller.restartToInstall()).toBe(false);

      expect(updater.installs).toBe(1);
    });

    it('can try again when the installer could not be started', () => {
      const { controller, updater } = setup();
      updater.onDownload = () => new Promise<void>(() => undefined);
      updater.emit.onAvailable(offer('1.2.0'));
      updater.emit.onDownloaded('1.2.0');
      controller.restartToInstall();

      updater.emit.onError(new Error('spawn EACCES'));

      expect(controller.getState()).toEqual({ status: 'ready', version: '1.2.0' });
      expect(controller.restartToInstall()).toBe(true);
      expect(updater.installs).toBe(2);
    });
  });

  describe('when the user asks to check', () => {
    it('shows that it is checking, then that the app is up to date', async () => {
      const { controller, updater, states } = setup();
      updater.onCheck = () => {
        updater.emit.onNotAvailable();
      };

      const result = await controller.checkNow();

      expect(states).toEqual([{ status: 'checking' }, { status: 'current' }]);
      expect(result).toEqual({ status: 'current' });
    });

    it('goes on to download when there is a newer version', async () => {
      const { controller, updater, states } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
      };
      updater.onDownload = () => new Promise<void>(() => undefined);

      const result = await controller.checkNow();

      expect(states).toEqual([
        { status: 'checking' },
        { status: 'downloading', version: '1.2.0', percent: 0 },
      ]);
      expect(result).toEqual({ status: 'downloading', version: '1.2.0', percent: 0 });
      expect(updater.downloads).toBe(1);
    });

    it('reports a download that fails after the user asked for the check, because the user saw it start', async () => {
      const { controller, updater, states } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
      };
      updater.onDownload = () => new Promise<void>(() => undefined);
      await controller.checkNow();

      updater.emit.onError(new Error('sha512 checksum mismatch'));

      expect(states.at(-1)).toEqual({ status: 'error' });
      expect(controller.getState()).toEqual({ status: 'error' });
    });

    it('reports an error, unlike a background check', async () => {
      const { controller, updater, states } = setup();
      updater.onCheck = () => {
        throw new Error('offline');
      };

      const result = await controller.checkNow();

      expect(states).toEqual([{ status: 'checking' }, { status: 'error' }]);
      expect(result).toEqual({ status: 'error' });
    });

    it('can be tried again after an error, once enough time has passed', async () => {
      const { controller, updater, scheduler } = setup();
      updater.onCheck = () => {
        throw new Error('offline');
      };
      await controller.checkNow();

      updater.onCheck = () => {
        updater.emit.onNotAvailable();
      };
      scheduler.advance(MIN_RETRY_GAP_MS);

      expect(await controller.checkNow()).toEqual({ status: 'current' });
    });

    it('does not start a second check while one is running, and shows the result of that one', async () => {
      const { controller, updater, scheduler, states } = setup();
      let finish: () => void = () => undefined;
      updater.onCheck = () =>
        new Promise<void>((resolve) => {
          finish = () => {
            updater.emit.onNotAvailable();
            resolve();
          };
        });
      controller.start();
      const background = scheduler.fire();
      await settle();
      expect(states).toEqual([]);

      const asked = controller.checkNow();
      await settle();
      expect(states).toEqual([{ status: 'checking' }]);
      finish();
      await background;

      expect(await asked).toEqual({ status: 'current' });
      expect(updater.checks).toBe(1);
    });

    it('goes back to idle when a check ends without saying anything', async () => {
      const { controller } = setup();

      expect(await controller.checkNow()).toEqual({ status: 'idle' });
    });

    describe('again soon after a check, which nothing can have changed', () => {
      it('shows what the last check found, without asking the server again', async () => {
        const { controller, updater, scheduler } = setup();
        updater.onCheck = () => {
          updater.emit.onNotAvailable();
        };
        await controller.checkNow();

        scheduler.advance(5_000);
        const again = await controller.checkNow();

        expect(again).toEqual({ status: 'current' });
        expect(updater.checks).toBe(1);
      });

      it('shows a failure again just the same, since it was a moment ago', async () => {
        const { controller, updater, scheduler } = setup();
        updater.onCheck = () => {
          throw new Error('offline');
        };
        await controller.checkNow();

        scheduler.advance(MIN_RETRY_GAP_MS - 1);

        expect(await controller.checkNow()).toEqual({ status: 'error' });
        expect(updater.checks).toBe(1);
      });

      // Someone who was offline and has just reconnected must not be told it failed again, as
      // though nothing had been tried: a failure is held for seconds, an answer for much longer.
      it('lets the reader try again a few seconds after a failure, but not after an answer', async () => {
        const failing = setup();
        failing.updater.onCheck = () => {
          throw new Error('offline');
        };
        await failing.controller.checkNow();
        failing.scheduler.advance(MIN_RETRY_GAP_MS);
        await failing.controller.checkNow();
        expect(failing.updater.checks).toBe(2);

        const answered = setup();
        answered.updater.onCheck = () => {
          answered.updater.emit.onNotAvailable();
        };
        await answered.controller.checkNow();
        answered.scheduler.advance(MIN_RETRY_GAP_MS);
        await answered.controller.checkNow();
        expect(answered.updater.checks).toBe(1);
      });

      it('counts a background check too, and tells a user who asks that the app is up to date', async () => {
        const { controller, updater, scheduler } = setup();
        updater.onCheck = () => {
          updater.emit.onNotAvailable();
        };
        controller.start();
        await scheduler.fire();
        expect(controller.getState()).toEqual({ status: 'idle' });

        expect(await controller.checkNow()).toEqual({ status: 'current' });
        expect(updater.checks).toBe(1);
      });

      it('asks the server again once enough time has passed', async () => {
        const { controller, updater, scheduler } = setup();
        updater.onCheck = () => {
          updater.emit.onNotAvailable();
        };
        await controller.checkNow();

        scheduler.advance(MIN_CHECK_GAP_MS);
        await controller.checkNow();

        expect(updater.checks).toBe(2);
      });

      it('never holds back a first request', async () => {
        const { controller, updater } = setup();
        updater.onCheck = () => {
          updater.emit.onNotAvailable();
        };

        await controller.checkNow();

        expect(updater.checks).toBe(1);
      });
    });
  });

  describe('in the portable executable, which cannot replace itself', () => {
    it('only tells the user that a newer version exists, with a link to its page', async () => {
      const { controller, updater, scheduler, states } = setup({ notifyOnly: true });
      expect(updater.configured).toEqual([{ installOnQuit: false }]);
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
        updater.emit.onProgress(50);
        updater.emit.onDownloaded('1.2.0');
      };
      controller.start();

      await scheduler.fire();

      expect(states).toEqual([
        { status: 'available', version: '1.2.0', releaseUrl: releasePageUrl('1.2.0') },
      ]);
      expect(updater.downloads).toBe(0);
      expect(controller.restartToInstall()).toBe(false);
    });

    it('keeps its setting when updates are switched on and off', () => {
      const { controller, updater } = setup({ notifyOnly: true });

      controller.setEnabled(false);
      controller.setEnabled(true);

      expect(updater.configured.at(-1)).toEqual({ installOnQuit: false });
    });
  });

  describe('what a server may claim', () => {
    it.each([
      ['a version with too few parts', offer('1.2', { version: '1.2' })],
      ['markup as the version', offer('1.2.0', { version: '<img src=x onerror=alert(1)>' })],
      ['a link as the version', offer('1.2.0', { version: 'https://evil.example/app.exe' })],
      ['a path as the version', offer('1.2.0', { version: '..\\..\\x' })],
      ['a number as the version', offer('1.2.0', { version: 42 })],
      ['no version', offer('1.2.0', { version: undefined })],
      ['nothing at all', undefined],
      ['text instead of a mapping', '1.2.0'],
      [
        'an installer on another host',
        offer('1.2.0', {
          files: [{ url: 'https://evil.example/x.exe', sha512: SHA512, size: 1 }],
          path: 'https://evil.example/x.exe',
        }),
      ],
      [
        'an installer outside the release',
        offer('1.2.0', {
          files: [{ url: '../../../evil/x/releases/download/v1/x.exe', sha512: SHA512, size: 1 }],
        }),
      ],
      [
        'two installers',
        offer('1.2.0', {
          files: [
            { url: 'MDReader-Setup-1.2.0.exe', sha512: SHA512, size: 1 },
            { url: 'Other-1.2.0.exe', sha512: SHA512, size: 1 },
          ],
        }),
      ],
      [
        'an installer that needs administrator rights',
        offer('1.2.0', {
          files: [
            {
              url: 'MDReader-Setup-1.2.0.exe',
              sha512: SHA512,
              size: 1,
              isAdminRightsRequired: true,
            },
          ],
        }),
      ],
      ['a web installer', offer('1.2.0', { packages: { x64: { file: 'a.7z', sha512: SHA512 } } })],
    ])('does not accept %s, and downloads nothing', async (_label, claimed) => {
      const { controller, updater, states } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(claimed);
      };

      const result = await controller.checkNow();

      expect(result).toEqual({ status: 'error' });
      expect(updater.downloads).toBe(0);
      expect(JSON.stringify(states)).not.toContain('evil');
      expect(JSON.stringify(states)).not.toContain('onerror');
      expect(controller.restartToInstall()).toBe(false);
    });

    it('says nothing about a refused offer in a background check, but writes it to the log', async () => {
      const { controller, updater, scheduler, states, log } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0', { packages: { x64: {} } }));
      };
      controller.start();

      await scheduler.fire();

      expect(states).toEqual([]);
      expect(updater.downloads).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/web installer/), undefined);
    });

    it('does not mark an update ready for a version that is not valid, and starts over', () => {
      const { controller, updater } = setup();
      updater.onDownload = () => new Promise<void>(() => undefined);
      updater.emit.onAvailable(offer('1.2.0'));

      updater.emit.onDownloaded('not a version');

      expect(controller.getState()).toEqual({ status: 'idle' });
      expect(controller.restartToInstall()).toBe(false);
    });
  });

  describe('reporting changes', () => {
    it('tells the page only when something changed, and downloads only once', async () => {
      const { controller, updater, states } = setup();
      updater.onCheck = () => {
        updater.emit.onAvailable(offer('1.2.0'));
        updater.emit.onAvailable(offer('1.2.0'));
      };
      updater.onDownload = () => new Promise<void>(() => undefined);

      await controller.checkNow();

      expect(states).toEqual([
        { status: 'checking' },
        { status: 'downloading', version: '1.2.0', percent: 0 },
      ]);
      expect(updater.downloads).toBe(1);
    });

    it('logs failures instead of throwing them', async () => {
      const { controller, updater, log } = setup();
      const failure = new Error('boom');
      updater.onCheck = () => {
        throw failure;
      };

      await expect(controller.checkNow()).resolves.toEqual({ status: 'error' });

      expect(log).toHaveBeenCalledWith(expect.any(String), failure);
    });
  });
});
