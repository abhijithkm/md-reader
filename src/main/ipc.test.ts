import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../shared/settings';
import { IpcChannel, type InvokeChannel } from '../shared/ipc';
import type { OpenOutcome } from '../shared/types';
import type { UpdateState } from '../shared/updates';
import { createIpcHandlers, DEFAULT_APPS_SETTINGS_URL, type IpcHandlerDeps } from './ipc';

const TRUSTED = 'app://md-reader/index.html';
const UNTRUSTED = 'https://evil.example/page';
const canceled: OpenOutcome = { status: 'canceled' };

const invokeChannels = Object.values(IpcChannel).filter(
  (channel): channel is InvokeChannel =>
    channel !== IpcChannel.documentOpened && channel !== IpcChannel.updateState,
);

const DEFAULTS: Settings = {
  theme: 'system',
  zoom: 1,
  automaticUpdates: true,
  updateNoticeSeen: false,
};

/** Settings that apply a patch at once, as the real store does, and then report it written. */
function createSettingsFake() {
  let current: Settings = { ...DEFAULTS };
  return {
    get: vi.fn((): Settings => ({ ...current })),
    update: vi.fn((patch: Partial<Settings>): Promise<Settings> => {
      current = { ...current, ...patch };
      return Promise.resolve({ ...current });
    }),
  };
}

function createDeps() {
  return {
    controller: {
      openFromDialog: vi.fn(() => Promise.resolve(canceled)),
      openPath: vi.fn((_input: unknown) => Promise.resolve(canceled)),
      reopen: vi.fn((_input: unknown) => Promise.resolve(canceled)),
      openLink: vi.fn((_href: unknown) => Promise.resolve(canceled)),
      reload: vi.fn(() => Promise.resolve(canceled)),
      rendererReady: vi.fn(),
    },
    settings: createSettingsFake(),
    updates: {
      getState: vi.fn((): UpdateState => ({ status: 'idle' })),
      checkNow: vi.fn((): Promise<UpdateState> => Promise.resolve({ status: 'current' })),
      restart: vi.fn(() => true),
    },
    appInfo: { name: 'MD Reader', version: '1.2.3', platform: 'win32', installsUpdates: true },
    trustedOrigins: ['app://md-reader'],
    openExternalUrl: vi.fn((_url: string) => Promise.resolve()),
    closeWindow: vi.fn(),
    onSettingsChanged: vi.fn((_settings: Settings) => undefined),
  } satisfies IpcHandlerDeps;
}

function everyMock(deps: ReturnType<typeof createDeps>) {
  return [
    ...Object.values(deps.controller),
    ...Object.values(deps.settings),
    ...Object.values(deps.updates),
    deps.openExternalUrl,
    deps.closeWindow,
    deps.onSettingsChanged,
  ];
}

describe('createIpcHandlers', () => {
  it('provides a handler for every channel the page can invoke, and no others', () => {
    const handlers = createIpcHandlers(createDeps());
    expect(Object.keys(handlers).sort()).toEqual([...invokeChannels].sort());
  });

  describe('sender validation', () => {
    it.each(invokeChannels)('refuses %s from a page that is not the app', async (channel) => {
      const deps = createDeps();
      const handlers = createIpcHandlers(deps);

      await expect(handlers[channel](UNTRUSTED, 'anything')).rejects.toThrow(/untrusted/i);

      for (const mock of everyMock(deps)) expect(mock).not.toHaveBeenCalled();
    });

    it.each(invokeChannels)('refuses %s when the sending frame is unknown', async (channel) => {
      const deps = createDeps();
      const handlers = createIpcHandlers(deps);

      await expect(handlers[channel](undefined)).rejects.toThrow(/untrusted/i);

      for (const mock of everyMock(deps)) expect(mock).not.toHaveBeenCalled();
    });
  });

  describe('app info and settings', () => {
    it('reports the app name, version and platform', async () => {
      const handlers = createIpcHandlers(createDeps());
      expect(await handlers[IpcChannel.getAppInfo](TRUSTED)).toEqual({
        name: 'MD Reader',
        version: '1.2.3',
        platform: 'win32',
        installsUpdates: true,
      });
    });

    it('returns the stored settings', async () => {
      const handlers = createIpcHandlers(createDeps());
      expect(await handlers[IpcChannel.getSettings](TRUSTED)).toEqual(DEFAULTS);
    });

    it('applies a valid update, tells the app about it and returns the result', async () => {
      const deps = createDeps();
      const handlers = createIpcHandlers(deps);

      const result = await handlers[IpcChannel.updateSettings](TRUSTED, {
        theme: 'dark',
        zoom: 1.25,
      });

      expect(deps.settings.update).toHaveBeenCalledExactlyOnceWith({ theme: 'dark', zoom: 1.25 });
      expect(result).toEqual({ ...DEFAULTS, theme: 'dark', zoom: 1.25 });
      expect(deps.onSettingsChanged).toHaveBeenCalledExactlyOnceWith({
        ...DEFAULTS,
        theme: 'dark',
        zoom: 1.25,
      });
    });

    it('clamps an out-of-range zoom before it is stored', async () => {
      const deps = createDeps();
      await createIpcHandlers(deps)[IpcChannel.updateSettings](TRUSTED, { zoom: 99 });
      expect(deps.settings.update).toHaveBeenCalledExactlyOnceWith({ zoom: 3 });
    });

    it('lets the page switch automatic updates off, and tells the app so it can stop checking', async () => {
      const deps = createDeps();

      await createIpcHandlers(deps)[IpcChannel.updateSettings](TRUSTED, {
        automaticUpdates: false,
        updateNoticeSeen: true,
      });

      expect(deps.settings.update).toHaveBeenCalledExactlyOnceWith({
        automaticUpdates: false,
        updateNoticeSeen: true,
      });
      expect(deps.onSettingsChanged).toHaveBeenCalledWith(
        expect.objectContaining({ automaticUpdates: false }),
      );
    });

    // Closing the app right after switching updates off must not still install one: the app is told
    // as soon as the choice is in effect, not when the file that keeps it has been written.
    it('tells the app about a change before the file has been written, and answers once it has', async () => {
      const deps = createDeps();
      let current: Settings = { ...DEFAULTS };
      let finishWriting: () => void = () => undefined;
      const settings = {
        get: vi.fn((): Settings => ({ ...current })),
        update: vi.fn((patch: Partial<Settings>) => {
          current = { ...current, ...patch };
          const written = { ...current };
          return new Promise<Settings>((resolve) => {
            finishWriting = () => {
              resolve(written);
            };
          });
        }),
      };
      const handlers = createIpcHandlers({ ...deps, settings });

      const answer = handlers[IpcChannel.updateSettings](TRUSTED, { automaticUpdates: false });

      expect(deps.onSettingsChanged).toHaveBeenCalledExactlyOnceWith({
        ...DEFAULTS,
        automaticUpdates: false,
      });
      finishWriting();
      expect(await answer).toEqual({ ...DEFAULTS, automaticUpdates: false });
    });

    it.each([
      ['an unknown key', { theme: 'dark', isAdmin: true }],
      ['an unknown theme', { theme: 'neon' }],
      ['a text zoom', { zoom: '2' }],
      ['a text instead of the updates switch', { automaticUpdates: 'yes' }],
      ['null', null],
      ['a string', 'dark'],
    ])('rejects an update with %s and changes nothing', async (_label, payload) => {
      const deps = createDeps();
      const handlers = createIpcHandlers(deps);

      await expect(handlers[IpcChannel.updateSettings](TRUSTED, payload)).rejects.toThrow(
        /invalid/i,
      );

      expect(deps.settings.update).not.toHaveBeenCalled();
      expect(deps.onSettingsChanged).not.toHaveBeenCalled();
    });
  });

  describe('documents', () => {
    it('signals readiness to the controller', async () => {
      const deps = createDeps();
      await createIpcHandlers(deps)[IpcChannel.rendererReady](TRUSTED);
      expect(deps.controller.rendererReady).toHaveBeenCalledOnce();
    });

    it('opens the dialog, reloads and follows links through the controller', async () => {
      const deps = createDeps();
      const handlers = createIpcHandlers(deps);

      expect(await handlers[IpcChannel.openDialog](TRUSTED)).toEqual(canceled);
      expect(await handlers[IpcChannel.reloadDocument](TRUSTED)).toEqual(canceled);
      expect(await handlers[IpcChannel.openLink](TRUSTED, 'file:///C:/a.md')).toEqual(canceled);

      expect(deps.controller.openFromDialog).toHaveBeenCalledOnce();
      expect(deps.controller.reload).toHaveBeenCalledOnce();
      expect(deps.controller.openLink).toHaveBeenCalledExactlyOnceWith('file:///C:/a.md');
    });

    it('hands a dropped path to the controller untouched so the document service can validate it', async () => {
      const deps = createDeps();
      await createIpcHandlers(deps)[IpcChannel.openDropped](TRUSTED, 42);
      expect(deps.controller.openPath).toHaveBeenCalledExactlyOnceWith(42);
    });

    it('goes back only through the controller, which knows which documents were shown', async () => {
      const deps = createDeps();
      await createIpcHandlers(deps)[IpcChannel.reopenDocument](TRUSTED, 'C:\\docs\\a.md');
      expect(deps.controller.reopen).toHaveBeenCalledExactlyOnceWith('C:\\docs\\a.md');
      expect(deps.controller.openPath).not.toHaveBeenCalled();
    });
  });

  describe('external links', () => {
    it('opens a web link in the default browser in its canonical form', async () => {
      const deps = createDeps();
      const result = await createIpcHandlers(deps)[IpcChannel.openExternal](
        TRUSTED,
        'HTTPS://Example.com/a b',
      );

      expect(result).toBe(true);
      expect(deps.openExternalUrl).toHaveBeenCalledExactlyOnceWith('https://example.com/a%20b');
    });

    it.each(['javascript:alert(1)', 'file:///C:/Windows/notepad.exe', 'ms-msdt:/id', 42, null])(
      'refuses %j without opening anything',
      async (url) => {
        const deps = createDeps();
        const result = await createIpcHandlers(deps)[IpcChannel.openExternal](TRUSTED, url);

        expect(result).toBe(false);
        expect(deps.openExternalUrl).not.toHaveBeenCalled();
      },
    );

    it('reports failure when the system has no program for the link', async () => {
      const deps = createDeps();
      deps.openExternalUrl.mockRejectedValueOnce(new Error('no handler'));

      expect(
        await createIpcHandlers(deps)[IpcChannel.openExternal](TRUSTED, 'https://example.com'),
      ).toBe(false);
    });
  });

  describe('updates', () => {
    it('reports what updating is doing', async () => {
      const deps = createDeps();
      deps.updates.getState.mockReturnValue({ status: 'ready', version: '1.2.0' });

      expect(await createIpcHandlers(deps)[IpcChannel.getUpdateState](TRUSTED)).toEqual({
        status: 'ready',
        version: '1.2.0',
      });
    });

    it('checks for a newer version when asked and returns the result', async () => {
      const deps = createDeps();

      expect(await createIpcHandlers(deps)[IpcChannel.checkForUpdates](TRUSTED, 'ignored')).toEqual(
        { status: 'current' },
      );
      expect(deps.updates.checkNow).toHaveBeenCalledOnce();
    });

    it('restarts into a downloaded update, whatever the page sends along', async () => {
      const deps = createDeps();

      await createIpcHandlers(deps)[IpcChannel.restartToUpdate](TRUSTED, 'C:\\evil\\setup.exe');

      expect(deps.updates.restart).toHaveBeenCalledExactlyOnceWith();
    });
  });

  describe('system integration', () => {
    it('opens only the fixed Windows Default apps page, whatever the page asks for', async () => {
      const deps = createDeps();
      await createIpcHandlers(deps)[IpcChannel.openDefaultAppsSettings](
        TRUSTED,
        'https://evil.example',
      );
      expect(deps.openExternalUrl).toHaveBeenCalledExactlyOnceWith(DEFAULT_APPS_SETTINGS_URL);
      expect(DEFAULT_APPS_SETTINGS_URL).toBe('ms-settings:defaultapps');
    });

    it('closes the window on request', async () => {
      const deps = createDeps();
      await createIpcHandlers(deps)[IpcChannel.closeWindow](TRUSTED);
      expect(deps.closeWindow).toHaveBeenCalledOnce();
    });
  });
});
