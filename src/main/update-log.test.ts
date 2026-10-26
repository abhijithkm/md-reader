import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUpdateLog, describeForLog } from './update-log';

let directory: string;
let file: string;

const moment = (seconds: number) => () => new Date(Date.UTC(2026, 9, 23, 8, 0, seconds));

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'mdreader-update-log-'));
  file = path.join(directory, 'update.log');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const lines = async (): Promise<string[]> =>
  (await readFile(file, 'utf8')).split('\n').filter((line) => line !== '');

describe('createUpdateLog', () => {
  it('writes a line for each message, with the time and the level', async () => {
    const log = createUpdateLog(file, { now: moment(1) });

    log.write('info', 'Checking for update');
    log.write('error', 'Cannot check for updates');

    expect(await lines()).toEqual([
      '2026-10-23T08:00:01.000Z info  Checking for update',
      '2026-10-23T08:00:01.000Z error Cannot check for updates',
    ]);
  });

  it('keeps each message on one line, and cuts a very long one short', async () => {
    const log = createUpdateLog(file, { now: moment(2) });

    log.write('warn', 'first\nsecond\r\nthird');
    log.write('info', 'x'.repeat(5000));

    const written = await lines();
    expect(written[0]).toBe('2026-10-23T08:00:02.000Z warn  first | second | third');
    expect(written[1]?.length).toBeLessThan(1100);
    expect(written[1]).toMatch(/x…$/);
  });

  it('gives the update library a logger that writes at its own levels, whatever it passes', async () => {
    const log = createUpdateLog(file, { now: moment(3) });

    log.library.info('Found version 1.2.0');
    log.library.warn(new Error('slow response'));
    log.library.error({ code: 'ERR_UPDATER' });
    log.library.debug('too much detail');

    expect(await lines()).toEqual([
      '2026-10-23T08:00:03.000Z info  Found version 1.2.0',
      '2026-10-23T08:00:03.000Z warn  slow response',
      '2026-10-23T08:00:03.000Z error {"code":"ERR_UPDATER"}',
    ]);
  });

  it('leaves out the random id of the installation, which the library writes about', async () => {
    const log = createUpdateLog(file, { now: moment(3) });

    log.library.info('Generated new staging user ID: 9c4bc2bc-9e97-5451-8966-9e4615981246');
    log.library.info(
      'Staging percentage: 1, percentage: 0.2, user id: 9C4BC2BC-9E97-5451-8966-9E4615981246',
    );

    expect(await lines()).toEqual([
      '2026-10-23T08:00:03.000Z info  Generated new staging user ID: <id>',
      '2026-10-23T08:00:03.000Z info  Staging percentage: 1, percentage: 0.2, user id: <id>',
    ]);
  });

  // Error messages from the library carry whatever a server sent, and a message was once flattened
  // with a pattern whose cost grows with the square of a run of blanks: 40,000 of them took a second.
  // Only the start of a message is looked at, so what comes after a huge run never reaches a pattern.
  it('takes no longer over a huge message than over a long one', async () => {
    const log = createUpdateLog(file, { now: moment(3) });
    const started = performance.now();

    log.write('error', `${' '.repeat(100_000)}the reason`);
    log.write('error', `x${'\r\n'.repeat(100_000)}y`);

    const [blanks, breaks] = await lines();
    expect(blanks).not.toContain('the reason');
    expect(breaks).not.toMatch(/y$/);
    expect(breaks?.length).toBeLessThan(1100);
    // A backstop for a slow computer: the old pattern needed far longer than this on such a message.
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('turns control characters into spaces, so that a server cannot send the terminal or the log commands', async () => {
    const log = createUpdateLog(file, { now: moment(3) });

    log.write('info', 'a\u0000b\u001b[31mc\u007fd\te');

    expect(await lines()).toEqual(['2026-10-23T08:00:03.000Z info  a b [31mc d\te']);
  });

  it('does not cut a character in two when it shortens a message', async () => {
    const log = createUpdateLog(file, { now: moment(3) });

    log.write('info', `${'x'.repeat(999)}😀 and more`);

    const line = (await lines())[0] ?? '';
    expect(line).toMatch(/x…$/);
    expect(line).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('counts bytes, not characters, when it keeps the file small', async () => {
    const log = createUpdateLog(file, { now: moment(5), maxBytes: 3000 });

    for (let number = 1; number <= 60; number += 1)
      log.write('info', `行${number} ${'字'.repeat(100)}`);

    // Each of those lines is about 335 bytes, and a character count of the limit would keep 3,700.
    expect((await stat(file)).size).toBeLessThanOrEqual(3000 + 400);
    expect((await lines()).at(-1)).toContain('行60');
  });

  it('leaves out the library chatter about each redirect, which could fill the file in one download', async () => {
    const log = createUpdateLog(file, { now: moment(3) });

    log.library.info('Redirect to https://objects.example/file');
    log.library.info('Downloading update from MDReader-Setup-1.2.0.exe');

    expect(await lines()).toEqual([
      '2026-10-23T08:00:03.000Z info  Downloading update from MDReader-Setup-1.2.0.exe',
    ]);
  });

  it('describes any value, even one that cannot be examined', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(describeForLog(proxy)).toBe('object');
    expect(describeForLog(undefined)).toBe('undefined');
    expect(describeForLog(new Error('why'))).toBe('why');
    expect(describeForLog({ a: 1 })).toBe('{"a":1}');
  });

  it('creates the folder when it is missing', async () => {
    const nested = path.join(directory, 'profile', 'update.log');

    createUpdateLog(nested, { now: moment(4) }).write('info', 'hello');

    expect(await readFile(nested, 'utf8')).toContain('hello');
  });

  it('stays small: past the limit it drops the oldest lines and says so', async () => {
    const log = createUpdateLog(file, { now: moment(5), maxBytes: 2000 });

    for (let number = 1; number <= 100; number += 1) log.write('info', `line number ${number}`);

    const written = await lines();
    expect((await stat(file)).size).toBeLessThanOrEqual(2100);
    expect(written[0]).toContain('older lines removed');
    // What is kept is the newest lines, each of them whole, in order and without a gap.
    const whole = /^2026-10-23T08:00:05\.000Z info {2}line number (\d+)$/;
    expect(written.slice(1).every((line) => whole.test(line))).toBe(true);
    const kept = written.slice(1).map((line) => Number(whole.exec(line)?.[1]));
    expect(kept.at(-1)).toBe(100);
    expect(kept[0]).toBeGreaterThan(1);
    expect(kept).toEqual(Array.from({ length: kept.length }, (_unused, at) => (kept[0] ?? 0) + at));
  });

  it('keeps about 200 KB when it is not told otherwise', async () => {
    const log = createUpdateLog(file, { now: moment(5) });
    const line = 'x'.repeat(900);

    // About 140 KB: below the limit, so nothing is dropped.
    for (let number = 0; number < 150; number += 1) log.write('info', line);
    expect((await lines())[0]).not.toContain('older lines removed');

    // About 370 KB in all: above it, so the oldest lines go.
    for (let number = 0; number < 250; number += 1) log.write('info', line);
    const size = (await stat(file)).size;
    expect(size).toBeLessThanOrEqual(200 * 1024);
    expect(size).toBeGreaterThan(90 * 1024);
    expect((await lines())[0]).toContain('older lines removed');
  });

  it('adds to what an earlier run wrote', async () => {
    await writeFile(file, 'an earlier line\n');

    createUpdateLog(file, { now: moment(6) }).write('info', 'a new line');

    expect(await lines()).toEqual(['an earlier line', '2026-10-23T08:00:06.000Z info  a new line']);
  });

  it('never gets in the way, even when the file cannot be written', async () => {
    // A file where a folder should be: nothing can be created below it.
    const blocker = path.join(directory, 'blocker');
    await writeFile(blocker, 'not a folder');
    const log = createUpdateLog(path.join(blocker, 'update.log'));

    expect(() => {
      log.write('error', 'this goes nowhere');
      log.library.info('nor does this');
    }).not.toThrow();
  });
});
