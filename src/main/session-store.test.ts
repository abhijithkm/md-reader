import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TABS } from '../shared/tabs';
import { parseSession, SessionStore } from './session-store';

let workDir: string;
let file: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-session-'));
  file = path.join(workDir, 'session.json');
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(workDir, { recursive: true, force: true });
});

const A = 'C:\\docs\\a.md';
const B = 'C:\\docs\\b.md';
const C = 'C:\\docs\\c.markdown';

const readJson = async (): Promise<unknown> => JSON.parse(await readFile(file, 'utf8')) as unknown;
const exists = (target: string): Promise<boolean> =>
  stat(target).then(
    () => true,
    () => false,
  );

describe('parseSession', () => {
  it.each([undefined, null, 42, 'tabs', [], true])('has no tabs for %j', (input) => {
    expect(parseSession(input)).toEqual({ paths: [], active: 0 });
  });

  it('keeps the documents in order, and the place of the active one', () => {
    expect(parseSession({ version: 1, tabs: [A, B, C], active: 2 })).toEqual({
      paths: [A, B, C],
      active: 2,
    });
  });

  it('drops whatever is not the path of a Markdown file', () => {
    const parsed = parseSession({
      tabs: [A, 7, null, '', 'relative.md', 'C:\\docs\\notes.txt', 'C:\\bad\0.md', {}, C],
      active: 0,
    });

    expect(parsed.paths).toEqual([A, C]);
  });

  // Reading a file on a network share makes Windows send the user's credentials to its server, so a
  // path that points at one is never kept: it would be read the next time MD Reader starts, on its own.
  it.each([
    ['a network share', '\\\\server\\share\\a.md'],
    ['a network share written as a device path', '\\\\?\\UNC\\server\\share\\a.md'],
    ['a local path written as a device path', '\\\\?\\C:\\docs\\a.md'],
    ['a named pipe', '\\\\.\\pipe\\a.md'],
    ['an alternate data stream', 'C:\\docs\\a.md:stream.md'],
    ['a device name', 'C:\\docs\\CON.md'],
  ])('drops %s', (_label, entry) => {
    expect(parseSession({ tabs: [A, entry, B], active: 0 }).paths).toEqual([A, B]);
  });

  it('keeps a path on a drive that is a share mapped to a letter, which cannot be told from a local one', () => {
    expect(parseSession({ tabs: ['Z:\\team\\docs\\a.md'], active: 0 }).paths).toEqual([
      'Z:\\team\\docs\\a.md',
    ]);
  });

  it('follows the active document when earlier entries were dropped', () => {
    expect(parseSession({ tabs: ['nonsense', A, B], active: 2 })).toEqual({
      paths: [A, B],
      active: 1,
    });
  });

  it('falls back to the first tab when the active one was dropped or is no place at all', () => {
    expect(parseSession({ tabs: ['nonsense', A], active: 0 }).active).toBe(0);
    for (const active of ['1', -1, 1.5, 99, null, undefined]) {
      expect(parseSession({ tabs: [A, B], active }).active).toBe(0);
    }
  });

  it('keeps no more tabs than the limit', () => {
    const many = Array.from({ length: MAX_TABS + 10 }, (_unused, n) => `C:\\docs\\${n}.md`);

    expect(parseSession({ tabs: many, active: 0 }).paths).toHaveLength(MAX_TABS);
  });

  it('is not fooled by a list that is not a list', () => {
    expect(parseSession({ tabs: 'C:\\docs\\a.md', active: 0 })).toEqual({ paths: [], active: 0 });
  });
});

describe('SessionStore', () => {
  it('has nothing to load before anything was saved', () => {
    expect(new SessionStore(file).load()).toEqual({ paths: [], active: 0 });
  });

  it('treats a file too large to be one MD Reader wrote as damaged, and does not read it', async () => {
    // Valid JSON with a usable path, so that only its size can be what is wrong with it.
    await writeFile(
      file,
      JSON.stringify({ version: 1, tabs: [A], active: 0, padding: 'x'.repeat(9 * 1024 * 1024) }),
    );
    const onError = vi.fn();

    expect(new SessionStore(file, { onError }).load()).toEqual({ paths: [], active: 0 });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('writes the tabs as JSON, and the next run loads them', async () => {
    const store = new SessionStore(file, { delayMs: 5 });

    store.save({ paths: [A, B], active: 1 });
    await store.flush();

    expect(await readJson()).toEqual({ version: 1, tabs: [A, B], active: 1 });
    expect(new SessionStore(file).load()).toEqual({ paths: [A, B], active: 1 });
  });

  it('waits a moment, so that a burst of changes is written once, with the last of them', async () => {
    vi.useFakeTimers();
    const store = new SessionStore(file, { delayMs: 300 });

    store.save({ paths: [A], active: 0 });
    vi.advanceTimersByTime(100);
    store.save({ paths: [A, B], active: 1 });
    vi.advanceTimersByTime(150);
    expect(await exists(file)).toBe(false);

    vi.advanceTimersByTime(60);
    vi.useRealTimers();
    await store.flush();

    expect(await readJson()).toEqual({ version: 1, tabs: [A, B], active: 1 });
  });

  it('has written nothing yet when only part of the moment has passed, however long a real write takes', async () => {
    vi.useFakeTimers();
    const store = new SessionStore(file, { delayMs: 300 });

    store.save({ paths: [A], active: 0 });
    store.save({ paths: [A, B], active: 1 });
    vi.advanceTimersByTime(250);
    vi.useRealTimers();
    // A write that had been started would be done by now; the fake clock does not hurry the disk.
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(await exists(file)).toBe(false);
    await store.flush();
    expect(await readJson()).toEqual({ version: 1, tabs: [A, B], active: 1 });
  });

  it('writes at once what is waiting when told to flush, as the app does before it closes', async () => {
    const store = new SessionStore(file, { delayMs: 60_000 });

    store.save({ paths: [C], active: 0 });
    await store.flush();

    expect(await readJson()).toEqual({ version: 1, tabs: [C], active: 0 });
  });

  it('writes an empty list when the last tab was closed, so that it is not reopened', async () => {
    const store = new SessionStore(file, { delayMs: 5 });
    store.save({ paths: [A], active: 0 });
    await store.flush();

    store.save({ paths: [], active: 0 });
    await store.flush();

    expect(new SessionStore(file).load()).toEqual({ paths: [], active: 0 });
  });

  it('leaves no temporary file behind', async () => {
    const store = new SessionStore(file, { delayMs: 5 });

    store.save({ paths: [A], active: 0 });
    await store.flush();
    store.save({ paths: [B], active: 0 });
    await store.flush();

    expect(await readdir(workDir)).toEqual(['session.json']);
  });

  it('creates the folder when it is missing', async () => {
    const nested = path.join(workDir, 'profile', 'session.json');
    const store = new SessionStore(nested, { delayMs: 5 });

    store.save({ paths: [A], active: 0 });
    await store.flush();

    expect(await exists(nested)).toBe(true);
  });

  it('never leaves the file half written: a new version is made beside it and moved into place', async () => {
    const store = new SessionStore(file, { delayMs: 5, onError: vi.fn() });
    store.save({ paths: [A], active: 0 });
    await store.flush();
    // Where the new version would be made there is a folder, so it cannot be.
    await mkdir(`${file}.tmp`);

    store.save({ paths: [B], active: 0 });
    await store.flush();

    expect(await readJson()).toEqual({ version: 1, tabs: [A], active: 0 });
  });

  it('writes again after a write failed', async () => {
    const onError = vi.fn();
    const store = new SessionStore(file, { delayMs: 5, onError });
    await mkdir(`${file}.tmp`);
    store.save({ paths: [A], active: 0 });
    await store.flush();
    expect(onError).toHaveBeenCalled();
    await rm(`${file}.tmp`, { recursive: true });

    store.save({ paths: [B], active: 0 });
    await store.flush();

    expect(await readJson()).toEqual({ version: 1, tabs: [B], active: 0 });
  });

  it('leaves nothing behind when the new version cannot be moved into place', async () => {
    const onError = vi.fn();
    const store = new SessionStore(file, { delayMs: 5, onError });
    // A folder is where the file should go, so the move fails.
    await mkdir(file);

    store.save({ paths: [A], active: 0 });
    await store.flush();

    expect(onError).toHaveBeenCalled();
    expect(await readdir(workDir)).toEqual(['session.json']);
  });

  it('writes one version after another when changes come faster than the disk, without a failure', async () => {
    const onError = vi.fn();
    const store = new SessionStore(file, { delayMs: 1, onError });

    for (let n = 0; n < 25; n += 1) {
      store.save({ paths: [n % 2 === 0 ? A : B], active: 0 });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    store.save({ paths: [C], active: 0 });
    await store.flush();

    expect(onError).not.toHaveBeenCalled();
    expect(await readJson()).toEqual({ version: 1, tabs: [C], active: 0 });
    expect(await readdir(workDir)).toEqual(['session.json']);
  });

  describe('when the reader has switched reopening off', () => {
    it('removes a version that was being made when the file was written the last time', async () => {
      await writeFile(`${file}.tmp`, JSON.stringify({ version: 1, tabs: [A], active: 0 }));
      const store = new SessionStore(file, { delayMs: 5 });

      store.setEnabled(false);
      await store.flush();

      expect(await exists(`${file}.tmp`)).toBe(false);
    });

    it('writes nothing, and removes what an earlier run wrote', async () => {
      await writeFile(file, JSON.stringify({ version: 1, tabs: [A], active: 0 }));
      const store = new SessionStore(file, { delayMs: 5 });

      store.setEnabled(false);
      store.save({ paths: [B], active: 0 });
      await store.flush();

      expect(await exists(file)).toBe(false);
    });

    it('forgets a change that was waiting to be written', async () => {
      const store = new SessionStore(file, { delayMs: 60_000 });
      store.save({ paths: [A], active: 0 });

      store.setEnabled(false);
      await store.flush();

      expect(await exists(file)).toBe(false);
    });

    it('writes again once it is switched back on', async () => {
      const store = new SessionStore(file, { delayMs: 5 });
      store.setEnabled(false);
      store.setEnabled(true);

      store.save({ paths: [A], active: 0 });
      await store.flush();

      expect(await readJson()).toEqual({ version: 1, tabs: [A], active: 0 });
    });
  });

  describe('when something is wrong with the file', () => {
    it('loads no tabs from a damaged file, and says so', async () => {
      await writeFile(file, '{ this is not JSON');
      const onError = vi.fn();

      expect(new SessionStore(file, { onError }).load()).toEqual({ paths: [], active: 0 });
      expect(onError).toHaveBeenCalledOnce();
    });

    it('says nothing about a file that is simply not there yet', () => {
      const onError = vi.fn();

      new SessionStore(file, { onError }).load();

      expect(onError).not.toHaveBeenCalled();
    });

    it('goes on working, and reports the problem, when the disk cannot be written', async () => {
      // A file where the folder should be: nothing can be created below it.
      const blocker = path.join(workDir, 'blocker');
      await writeFile(blocker, 'not a folder');
      const onError = vi.fn();
      const store = new SessionStore(path.join(blocker, 'session.json'), { onError, delayMs: 5 });

      store.save({ paths: [A], active: 0 });
      await store.flush();

      expect(onError).toHaveBeenCalled();
    });
  });
});
