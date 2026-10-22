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

describe('SettingsStore', () => {
  it('starts with the defaults when no file exists yet', () => {
    expect(new SettingsStore(file).load()).toEqual({ theme: 'system', zoom: 1 });
  });

  it('remembers theme and zoom for the next run', async () => {
    const first = new SettingsStore(file);
    first.load();
    await first.update({ theme: 'dark' });
    await first.update({ zoom: 1.25 });

    expect(new SettingsStore(file).load()).toEqual({ theme: 'dark', zoom: 1.25 });
  });

  it('merges an update into the existing values', async () => {
    const store = new SettingsStore(file);
    store.load();
    await store.update({ zoom: 1.5 });

    const result = await store.update({ theme: 'light' });

    expect(result).toEqual({ theme: 'light', zoom: 1.5 });
    expect(store.get()).toEqual({ theme: 'light', zoom: 1.5 });
  });

  it('falls back to defaults when the file is not valid JSON', async () => {
    await writeFile(file, '{ this is not json');
    const onError = vi.fn();

    expect(new SettingsStore(file, { onError }).load()).toEqual({ theme: 'system', zoom: 1 });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('repairs invalid values read from disk', async () => {
    await writeFile(file, JSON.stringify({ theme: 'neon', zoom: 99, junk: true }));
    expect(new SettingsStore(file).load()).toEqual({ theme: 'system', zoom: 3 });
  });

  it('clamps an out-of-range zoom before storing it', async () => {
    const store = new SettingsStore(file);
    store.load();

    expect(await store.update({ zoom: 99 })).toEqual({ theme: 'system', zoom: 3 });
    expect(await readJson(file)).toEqual({ theme: 'system', zoom: 3 });
  });

  it('writes only the known settings as JSON', async () => {
    const store = new SettingsStore(file);
    store.load();
    await store.update({ theme: 'dark' });

    expect(await readJson(file)).toEqual({ theme: 'dark', zoom: 1 });
  });

  it('creates the settings folder when it does not exist', async () => {
    const nested = path.join(workDir, 'a', 'b', 'settings.json');
    const store = new SettingsStore(nested);
    store.load();
    await store.update({ theme: 'light' });

    expect(await readJson(nested)).toEqual({ theme: 'light', zoom: 1 });
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
    expect(await readJson(file)).toEqual({ theme: 'system', zoom: 2 });
  });

  it('lets the app wait for pending writes before it quits', async () => {
    const store = new SettingsStore(file);
    store.load();
    void store.update({ theme: 'dark' }); // deliberately not awaited

    await store.flush();

    expect(await readJson(file)).toEqual({ theme: 'dark', zoom: 1 });
  });

  it('keeps working in memory and reports the problem when the disk cannot be written', async () => {
    const blocker = path.join(workDir, 'blocker');
    await writeFile(blocker, 'a file where a folder is needed');
    const onError = vi.fn();
    const store = new SettingsStore(path.join(blocker, 'settings.json'), { onError });
    store.load();

    const result = await store.update({ theme: 'dark' });

    expect(result).toEqual({ theme: 'dark', zoom: 1 });
    expect(store.get().theme).toBe('dark');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
