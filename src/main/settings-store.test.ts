import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from './settings-store';

let workDir: string;
let file: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-settings-'));
  file = path.join(workDir, 'settings.json');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function readJson(target: string): Promise<unknown> {
  return JSON.parse(await readFile(target, 'utf8')) as unknown;
}

const DEFAULTS = { theme: 'system', zoom: 1, automaticUpdates: true, updateNoticeSeen: false };

describe('SettingsStore', () => {
  it('starts with the defaults when no file exists yet', () => {
    expect(new SettingsStore(file).load()).toEqual(DEFAULTS);
  });

  it('remembers theme and zoom for the next run', async () => {
    const first = new SettingsStore(file);
    first.load();
    await first.update({ theme: 'dark' });
    await first.update({ zoom: 1.25 });

    expect(new SettingsStore(file).load()).toEqual({ ...DEFAULTS, theme: 'dark', zoom: 1.25 });
  });

  it('remembers the choices about automatic updates for the next run', async () => {
    const first = new SettingsStore(file);
    first.load();
    await first.update({ automaticUpdates: false, updateNoticeSeen: true });

    expect(new SettingsStore(file).load()).toEqual({
      ...DEFAULTS,
      automaticUpdates: false,
      updateNoticeSeen: true,
    });
  });

  it('reads a file written by version 1.0.0, which only knew theme and zoom, with updates on', async () => {
    await writeFile(file, JSON.stringify({ theme: 'dark', zoom: 1.5 }));

    expect(new SettingsStore(file).load()).toEqual({
      theme: 'dark',
      zoom: 1.5,
      automaticUpdates: true,
      updateNoticeSeen: false,
    });
  });

  it('merges an update into the existing values', async () => {
    const store = new SettingsStore(file);
    store.load();
    await store.update({ zoom: 1.5 });

    const result = await store.update({ theme: 'light' });

    expect(result).toEqual({ ...DEFAULTS, theme: 'light', zoom: 1.5 });
    expect(store.get()).toEqual({ ...DEFAULTS, theme: 'light', zoom: 1.5 });
  });

  it('falls back to defaults when the file is not valid JSON', async () => {
    await writeFile(file, '{ this is not json');
    const onError = vi.fn();

    expect(new SettingsStore(file, { onError }).load()).toEqual(DEFAULTS);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('repairs invalid values read from disk', async () => {
    await writeFile(
      file,
      JSON.stringify({ theme: 'neon', zoom: 99, automaticUpdates: 'yes', junk: true }),
    );
    expect(new SettingsStore(file).load()).toEqual({ ...DEFAULTS, zoom: 3 });
  });

  it('clamps an out-of-range zoom before storing it', async () => {
    const store = new SettingsStore(file);
    store.load();

    expect(await store.update({ zoom: 99 })).toEqual({ ...DEFAULTS, zoom: 3 });
    expect(await readJson(file)).toEqual({ ...DEFAULTS, zoom: 3 });
  });

  it('writes only the known settings as JSON', async () => {
    const store = new SettingsStore(file);
    store.load();
    await store.update({ theme: 'dark' });

    expect(await readJson(file)).toEqual({ ...DEFAULTS, theme: 'dark' });
  });

  it('creates the settings folder when it does not exist', async () => {
    const nested = path.join(workDir, 'a', 'b', 'settings.json');
    const store = new SettingsStore(nested);
    store.load();
    await store.update({ theme: 'light' });

    expect(await readJson(nested)).toEqual({ ...DEFAULTS, theme: 'light' });
  });

  it('leaves no temporary file behind', async () => {
    const store = new SettingsStore(file);
    store.load();
    await store.update({ theme: 'dark' });
    await store.update({ theme: 'light' });

    expect(await readdir(workDir)).toEqual(['settings.json']);
  });

  it('keeps the last value when updates overlap', async () => {
    const store = new SettingsStore(file);
    store.load();
    const zooms = [0.5, 0.6, 0.7, 0.8, 0.9, 1.1, 1.25, 1.5, 1.75, 2];

    await Promise.all(zooms.map((zoom) => store.update({ zoom })));

    expect(store.get().zoom).toBe(2);
    expect(await readJson(file)).toEqual({ ...DEFAULTS, zoom: 2 });
  });

  // The updater is told of a change the moment it is made, and reads the setting back: the new value
  // has to be there while the write is still on its way, not only once the file has been written.
  it('shows a change at once, before it has been written to disk', async () => {
    const store = new SettingsStore(file);
    store.load();

    const written = store.update({ automaticUpdates: false });

    expect(store.get().automaticUpdates).toBe(false);
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await written;
    expect(await readJson(file)).toEqual({ ...DEFAULTS, automaticUpdates: false });
  });

  it('lets the app wait for pending writes before it quits', async () => {
    const store = new SettingsStore(file);
    store.load();
    void store.update({ theme: 'dark' }); // deliberately not awaited

    await store.flush();

    expect(await readJson(file)).toEqual({ ...DEFAULTS, theme: 'dark' });
  });

  it('keeps working in memory and reports the problem when the disk cannot be written', async () => {
    const blocker = path.join(workDir, 'blocker');
    await writeFile(blocker, 'a file where a folder is needed');
    const onError = vi.fn();
    const store = new SettingsStore(path.join(blocker, 'settings.json'), { onError });
    store.load();

    const result = await store.update({ theme: 'dark' });

    expect(result).toEqual({ ...DEFAULTS, theme: 'dark' });
    expect(store.get().theme).toBe('dark');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
