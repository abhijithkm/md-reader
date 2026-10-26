import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAppTarget } from '../e2e/support/launch';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'mdreader-target-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

// The release workflow runs the end-to-end tests against the installed app by naming it in this
// variable. A step that finds no path leaves it empty, and the development build must not stand in.
describe('which app the end-to-end tests start', () => {
  it('starts the packaged app that MDREADER_EXE names', async () => {
    const executable = path.join(directory, 'MDReader.exe');
    await writeFile(executable, '');
    vi.stubEnv('MDREADER_EXE', executable);

    expect(resolveAppTarget()).toEqual({ executable, baseArgs: [], kind: 'packaged' });
  });

  it('refuses a name that is empty, instead of testing the development build and passing', () => {
    vi.stubEnv('MDREADER_EXE', '');

    expect(() => resolveAppTarget()).toThrow(/set but empty/);
  });

  it('refuses a file that is not there', () => {
    vi.stubEnv('MDREADER_EXE', path.join(directory, 'missing', 'MDReader.exe'));

    expect(() => resolveAppTarget()).toThrow(/does not exist/);
  });
});
