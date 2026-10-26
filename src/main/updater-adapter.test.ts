import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CancellationToken } from 'electron-updater';
import { parse } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_IDLE_TIMEOUT_MS } from './request-timeout';
import { createUpdaterPort, writeTestFeedConfig, type LibraryUpdater } from './updater-adapter';
import type { UpdaterHandlers } from './updates';

/** Stands in for electron-updater's updater: an event emitter with the members the adapter uses. */
function fakeLibrary() {
  const library = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    disableWebInstaller: false,
    requestHeaders: null as Record<string, string> | null,
    logger: console,
    forceDevUpdateConfig: false,
    updateConfigPath: null as string | null,
    httpExecutor: { addErrorAndTimeoutHandlers: vi.fn(), addRedirectHandlers: vi.fn() },
    checkForUpdates: vi.fn(() => Promise.resolve(null as unknown)),
    downloadUpdate: vi.fn((_cancellation?: CancellationToken) => Promise.resolve([] as string[])),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  });
  return library as unknown as LibraryUpdater & typeof library;
}

function handlers() {
  return {
    onAvailable: vi.fn<UpdaterHandlers['onAvailable']>(),
    onNotAvailable: vi.fn<UpdaterHandlers['onNotAvailable']>(),
    onProgress: vi.fn<UpdaterHandlers['onProgress']>(),
    onDownloaded: vi.fn<UpdaterHandlers['onDownloaded']>(),
    onError: vi.fn<UpdaterHandlers['onError']>(),
  } satisfies UpdaterHandlers;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createUpdaterPort', () => {
  describe('what it settles once, so the library cannot do otherwise', () => {
    it('never lets an update replace the app with an older version', () => {
      const library = fakeLibrary();

      createUpdaterPort(library);

      expect(library.allowDowngrade).toBe(false);
    });

    it('never downloads on its own: the controller looks at what is offered first', () => {
      const library = fakeLibrary();

      createUpdaterPort(library);

      expect(library.autoDownload).toBe(false);
    });

    it('refuses a web installer, which would fetch more files after the check', () => {
      const library = fakeLibrary();

      createUpdaterPort(library);

      expect(library.disableWebInstaller).toBe(true);
    });

    it('sends no identifier of this installation: the library would add a random one to every check', () => {
      const library = fakeLibrary();

      createUpdaterPort(library);

      expect(library.requestHeaders).toEqual({ 'x-user-staging-id': 'unset' });
    });

    it('gives up on a request to a server that never answers, which Electron would not do itself', () => {
      vi.useFakeTimers();
      const library = fakeLibrary();
      const libraryHandlers = library.httpExecutor.addErrorAndTimeoutHandlers;
      createUpdaterPort(library);
      const abort = vi.fn();
      const request = Object.assign(new EventEmitter(), { abort });
      const reject = vi.fn();

      library.httpExecutor.addErrorAndTimeoutHandlers(request, reject);
      vi.advanceTimersByTime(REQUEST_IDLE_TIMEOUT_MS);

      expect(libraryHandlers).toHaveBeenCalledOnce();
      expect(abort).toHaveBeenCalledOnce();
      expect(reject).toHaveBeenCalledOnce();
    });

    it('lets the library write what it does to the log it is given, and leaves its own logger alone otherwise', () => {
      const logged = fakeLibrary();
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      createUpdaterPort(logged, { logger });
      const untouched = fakeLibrary();
      const before = untouched.logger;
      createUpdaterPort(untouched);

      expect(logged.logger).toBe(logger);
      expect(untouched.logger).toBe(before);
    });

    it('uses a shorter limit when a test asks for one', () => {
      vi.useFakeTimers();
      const library = fakeLibrary();
      createUpdaterPort(library, { requestTimeoutMs: 1500 });
      const abort = vi.fn();
      const request = Object.assign(new EventEmitter(), { abort });

      library.httpExecutor.addErrorAndTimeoutHandlers(request, vi.fn());
      vi.advanceTimersByTime(1499);
      expect(abort).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);

      expect(abort).toHaveBeenCalledOnce();
    });

    it('ends a chain of redirects that the library would follow for ever', () => {
      const library = fakeLibrary();
      const libraryHandlers = library.httpExecutor.addRedirectHandlers;
      createUpdaterPort(library);
      const reject = vi.fn();
      const start = (options: object): void => {
        library.httpExecutor.addRedirectHandlers({}, options, reject, 0, start);
      };

      start({});
      // The library calls its handler for every redirect; a stand-in that always redirects again:
      for (let hop = 0; hop < 11; hop += 1) {
        const handler = libraryHandlers.mock.calls.at(-1)?.[4] as (next: object) => void;
        handler({ hop });
      }

      expect(libraryHandlers).toHaveBeenCalledTimes(11);
      expect(reject).toHaveBeenCalledOnce();
    });

    it('copes with a library that has no HTTP executor', () => {
      const library = fakeLibrary();
      (library as unknown as { httpExecutor: unknown }).httpExecutor = null;

      expect(() => createUpdaterPort(library)).not.toThrow();
    });
  });

  it('passes what the library reports on to the handlers, the offer whole', () => {
    const library = fakeLibrary();
    const received = handlers();
    createUpdaterPort(library).subscribe(received);
    const offer = { version: '1.2.0', files: [{ url: 'MDReader-Setup-1.2.0.exe' }] };

    library.emit('update-available', offer);
    library.emit('update-not-available', { version: '1.0.0' });
    library.emit('download-progress', { percent: 42.5 });
    library.emit('update-downloaded', { version: '1.2.0' });
    const failure = new Error('boom');
    library.emit('error', failure);

    expect(received.onAvailable).toHaveBeenCalledWith(offer);
    expect(received.onNotAvailable).toHaveBeenCalledOnce();
    expect(received.onProgress).toHaveBeenCalledWith(42.5);
    expect(received.onDownloaded).toHaveBeenCalledWith('1.2.0');
    expect(received.onError).toHaveBeenCalledWith(failure);
  });

  it('turns installing on quit on and off, and never touches downloading', () => {
    const library = fakeLibrary();
    const port = createUpdaterPort(library);

    port.configure({ installOnQuit: false });
    expect(library.autoInstallOnAppQuit).toBe(false);

    port.configure({ installOnQuit: true });
    expect(library.autoInstallOnAppQuit).toBe(true);
    expect(library.autoDownload).toBe(false);
  });

  it('restarts silently into the new version', () => {
    const library = fakeLibrary();

    createUpdaterPort(library).quitAndInstall();

    expect(library.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
  });

  describe('checking', () => {
    it('asks the library and finishes when it does', async () => {
      const library = fakeLibrary();

      await createUpdaterPort(library).check();

      expect(library.checkForUpdates).toHaveBeenCalledOnce();
    });

    it('passes on a check that fails', async () => {
      const library = fakeLibrary();
      library.checkForUpdates.mockRejectedValue(new Error('offline'));

      await expect(createUpdaterPort(library).check()).rejects.toThrow('offline');
    });
  });

  describe('downloading', () => {
    it('asks the library to download what the last check found', async () => {
      const library = fakeLibrary();

      await createUpdaterPort(library).download();

      expect(library.downloadUpdate).toHaveBeenCalledOnce();
    });

    it('hands the library one cancellation for what it downloads, which stops that download and nothing else', async () => {
      const library = fakeLibrary();
      const received: CancellationToken[] = [];
      let finish: () => void = () => undefined;
      library.downloadUpdate.mockImplementation((token) => {
        if (token !== undefined) received.push(token);
        return new Promise<string[]>((resolve) => {
          finish = () => {
            resolve([]);
          };
        });
      });
      const port = createUpdaterPort(library);

      const running = port.download();
      port.cancelTransfers();
      expect(received[0]?.cancelled).toBe(true);
      finish();
      await running;

      // That one is over: the next download starts afresh, and cancelling when there is none does nothing.
      expect(() => {
        port.cancelTransfers();
      }).not.toThrow();
      library.downloadUpdate.mockImplementation((token) => {
        if (token !== undefined) received.push(token);
        return Promise.resolve([]);
      });
      await port.download();
      expect(received[1]).not.toBe(received[0]);
      expect(received[1]?.cancelled).toBe(false);
    });

    it('does not start a download with a cancellation that was already used', async () => {
      const library = fakeLibrary();
      const received: CancellationToken[] = [];
      library.downloadUpdate.mockImplementation((token) => {
        if (token !== undefined) received.push(token);
        return new Promise<string[]>(() => undefined);
      });
      const port = createUpdaterPort(library);

      void port.download();
      port.cancelTransfers();
      void port.download();

      expect(received).toHaveLength(2);
      expect(received[0]?.cancelled).toBe(true);
      expect(received[1]?.cancelled).toBe(false);
    });

    // The library's cancellation only fails a download's promise: its request goes on and the file
    // goes on arriving. Found with a real server that saw the connection stay open for the whole file.
    it('also stops the requests that are under way, which the cancellation of the library leaves running', () => {
      const library = fakeLibrary();
      const port = createUpdaterPort(library);
      const abort = vi.fn();
      const request = Object.assign(new EventEmitter(), { abort });
      const reject = vi.fn();
      library.httpExecutor.addErrorAndTimeoutHandlers(request, reject);

      port.cancelTransfers();

      expect(abort).toHaveBeenCalledOnce();
      expect(reject).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: 'Updating was turned off.' }),
      );
    });

    it('stops nothing, and fails nothing, when there is nothing under way or no HTTP executor to ask', () => {
      const library = fakeLibrary();
      const port = createUpdaterPort(library);
      const bare = fakeLibrary();
      (bare as unknown as { httpExecutor: unknown }).httpExecutor = null;

      expect(() => {
        port.cancelTransfers();
        createUpdaterPort(bare).cancelTransfers();
      }).not.toThrow();
    });

    it('lets a failed download be reported through the error event only, not as a rejection nobody handles', async () => {
      const library = fakeLibrary();
      library.downloadUpdate.mockRejectedValue(new Error('download failed'));

      await expect(createUpdaterPort(library).download()).resolves.toBeUndefined();
    });
  });

  describe('normal use', () => {
    it('never chooses a feed or a development configuration itself', () => {
      const library = fakeLibrary();

      createUpdaterPort(library);

      expect(library.setFeedURL).not.toHaveBeenCalled();
      expect(library.forceDevUpdateConfig).toBe(false);
    });
  });

  describe('with a test feed on this computer', () => {
    const testFeed = { configPath: 'C:\\profile\\dev-app-update.yml' };

    it('reads its configuration from the file written for the feed, like an installed app does', () => {
      const library = fakeLibrary();

      createUpdaterPort(library, { testFeed });

      expect(library.forceDevUpdateConfig).toBe(true);
      expect(library.updateConfigPath).toBe(testFeed.configPath);
      expect(library.setFeedURL).not.toHaveBeenCalled();
    });

    it('never installs anything, because the file it downloads is not a real installer', () => {
      const library = fakeLibrary();
      const port = createUpdaterPort(library, { testFeed });

      port.configure({ installOnQuit: true });
      port.quitAndInstall();

      expect(library.autoInstallOnAppQuit).toBe(false);
      expect(library.quitAndInstall).not.toHaveBeenCalled();
    });
  });
});

describe('writeTestFeedConfig', () => {
  it('writes the configuration of a feed served by this computer and says where', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdreader-feed-'));
    try {
      const file = writeTestFeedConfig(directory, 'http://127.0.0.1:8123/');

      expect(path.dirname(file)).toBe(directory);
      expect(parse(await readFile(file, 'utf8'))).toEqual({
        provider: 'generic',
        url: 'http://127.0.0.1:8123/',
        updaterCacheDirName: 'md-reader-test-updater',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
