import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { UPDATE_SOURCE } from '../src/shared/updates';

const scripts = path.join(process.cwd(), 'scripts');
const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};

function run(script: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '', ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** What a script printed, whether or not it succeeded. Several can run at the same time. */
function printedBy(script: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(scripts, script), ...args],
      { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } },
      (_error, stdout) => {
        resolve(stdout);
      },
    );
  });
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-scripts-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('checksums.mjs', () => {
  it('writes a sha256sum-compatible list of every file the release carries, sorted by name', async () => {
    await writeFile(path.join(dir, 'MDReader-Setup-1.0.0.exe'), 'abc');
    await writeFile(path.join(dir, 'MDReader-Portable-1.0.0.exe'), '');
    // Installed copies read these two to update themselves, so they are worth checking too.
    await writeFile(path.join(dir, 'MDReader-Setup-1.0.0.exe.blockmap'), 'abc');
    await writeFile(path.join(dir, 'latest.yml'), '');
    const output = path.join(dir, 'SHA256SUMS.txt');

    const result = run('checksums.mjs', [dir, output]);

    expect(result.code, result.stderr).toBe(0);
    // SHA-256 of "" and of "abc" are standard test vectors.
    expect(await readFile(output, 'utf8')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  MDReader-Portable-1.0.0.exe\n' +
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  MDReader-Setup-1.0.0.exe\n' +
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  MDReader-Setup-1.0.0.exe.blockmap\n' +
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  latest.yml\n',
    );
  });

  it('leaves out files that the release does not carry', async () => {
    await writeFile(path.join(dir, 'MDReader-Setup-1.0.0.exe'), 'abc');
    await writeFile(path.join(dir, 'builder-debug.yml'), 'x');
    await writeFile(path.join(dir, 'SHA256SUMS.txt'), 'an earlier list');
    await writeFile(path.join(dir, 'notes.txt'), 'x');
    await mkdir(path.join(dir, 'win-unpacked'));
    await writeFile(path.join(dir, 'win-unpacked', 'MDReader.exe'), 'x');
    await writeFile(path.join(dir, 'win-unpacked', 'latest.yml'), 'x');
    const output = path.join(dir, 'SHA256SUMS.txt');

    run('checksums.mjs', [dir, output]);

    const lines = (await readFile(output, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ {2}MDReader-Setup-1\.0\.0\.exe$/);
  });

  it('fails loudly instead of publishing an empty checksum list', async () => {
    await writeFile(path.join(dir, 'notes.txt'), 'x');

    const result = run('checksums.mjs', [dir, path.join(dir, 'SHA256SUMS.txt')]);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/no release files/i);
  });
});

describe('verify-release.mjs', () => {
  // The folder holds nothing, so every check that runs fails. The report still names each one,
  // which shows which checks a mode asks for without building a release.
  const reportFor = (...args: string[]): string => run('verify-release.mjs', [dir, ...args]).stdout;

  // `npm run pack` makes only the unpacked app. electron-builder writes the update configuration
  // when it builds the installer, so CI, which stops after the unpacked app, must not ask for it.
  it('asks only for what the unpacked app holds when told to look at nothing else', () => {
    const report = reportFor('--unpacked-only');

    expect(report).toContain('unpacked executable');
    expect(report).not.toContain('the app updates only from this repository');
    expect(report).not.toContain('latest.yml matches the installer and the blockmap is there');
    expect(report).not.toMatch(/^(PASS|FAIL) {2}installer:/m);
  });

  it('asks for the update configuration and the update file of a full release', () => {
    const report = reportFor();

    expect(report).toContain('the app updates only from this repository');
    expect(report).toContain('latest.yml matches the installer and the blockmap is there');
    expect(report).toMatch(/^FAIL {2}installer:/m);
  });

  // The rules about what the update files may say are tested on their own (update-metadata.test.ts).
  // These check that the script hands them the right facts: the hash and size of the installer it
  // finds, whether the block map is there, the repository and the folder named in package.json.
  describe('with the files of a release on disk', () => {
    const installerName = `MDReader-Setup-${pkg.version}.exe`;
    const installerBytes = 'the bytes of the installer';
    const sha512 = (bytes: string): string => createHash('sha512').update(bytes).digest('base64');

    interface Fake {
      blockmap?: boolean;
      /** What the installer holds once latest.yml has been written. */
      installer?: string;
      size?: number;
      appUpdate?: Record<string, string>;
    }

    async function release(name: string, fake: Fake = {}): Promise<string> {
      const folder = path.join(dir, name);
      const resources = path.join(folder, 'win-unpacked', 'resources');
      await mkdir(resources, { recursive: true });
      await writeFile(
        path.join(resources, 'app-update.yml'),
        stringify({
          provider: 'github',
          owner: UPDATE_SOURCE.owner,
          repo: UPDATE_SOURCE.repo,
          updaterCacheDirName: `${pkg.name}-updater`,
          ...fake.appUpdate,
        }),
      );
      const hash = sha512(installerBytes);
      await writeFile(
        path.join(folder, 'latest.yml'),
        stringify({
          version: pkg.version,
          files: [{ url: installerName, sha512: hash, size: fake.size ?? installerBytes.length }],
          path: installerName,
          sha512: hash,
          releaseDate: '2026-10-23T08:00:00.000Z',
        }),
      );
      await writeFile(path.join(folder, installerName), fake.installer ?? installerBytes);
      if (fake.blockmap !== false) {
        await writeFile(path.join(folder, `${installerName}.blockmap`), 'the block map');
      }
      return folder;
    }

    /** The line the report has for one check, such as "PASS  the name: what it found". */
    const lineFor = (output: string, check: string): string =>
      output.split('\n').find((line) => line.includes(` ${check}`)) ?? `no line for "${check}"`;

    const CONFIG = 'the app updates only from this repository';
    const FILES = 'latest.yml matches the installer and the blockmap is there';

    it('passes the update files that belong together, and fails each one that does not', async () => {
      const cases = {
        consistent: {},
        'no blockmap': { blockmap: false },
        'an installer that is not the one latest.yml describes': { installer: 'other bytes' },
        'a size that is not the installer’s': { size: 12 },
        'another repository': { appUpdate: { owner: 'someone-else' } },
        'a folder that the uninstaller does not remove': {
          appUpdate: { updaterCacheDirName: 'other-updater' },
        },
      } satisfies Record<string, Fake>;
      const outputs = Object.fromEntries(
        await Promise.all(
          Object.entries(cases).map(
            async ([name, fake]) =>
              [name, await printedBy('verify-release.mjs', [await release(name, fake)])] as const,
          ),
        ),
      );

      expect(lineFor(outputs['consistent'] ?? '', CONFIG)).toMatch(/^PASS/);
      expect(lineFor(outputs['consistent'] ?? '', FILES)).toMatch(/^PASS/);
      expect(lineFor(outputs['no blockmap'] ?? '', FILES)).toMatch(/^FAIL.*blockmap/);
      expect(
        lineFor(outputs['an installer that is not the one latest.yml describes'] ?? '', FILES),
      ).toMatch(/^FAIL.*SHA-512/);
      expect(lineFor(outputs['a size that is not the installer’s'] ?? '', FILES)).toMatch(
        /^FAIL.*size of 12 bytes/,
      );
      expect(lineFor(outputs['another repository'] ?? '', CONFIG)).toMatch(/^FAIL.*someone-else/);
      expect(
        lineFor(outputs['a folder that the uninstaller does not remove'] ?? '', CONFIG),
      ).toMatch(/^FAIL.*other-updater/);
    });
  });
}, 60_000);

describe('check-version.mjs', () => {
  async function packageWith(version: string): Promise<string> {
    const file = path.join(dir, 'package.json');
    await writeFile(file, JSON.stringify({ name: 'x', version }));
    return file;
  }

  it('accepts a tag that matches the package version', async () => {
    const result = run('check-version.mjs', ['v1.2.3', '--package', await packageWith('1.2.3')]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('1.2.3');
  });

  it('accepts a full git ref', async () => {
    const result = run('check-version.mjs', [
      'refs/tags/v1.2.3',
      '--package',
      await packageWith('1.2.3'),
    ]);
    expect(result.code, result.stderr).toBe(0);
  });

  it('refuses a tag that disagrees with the package version, naming both', async () => {
    const result = run('check-version.mjs', ['v1.2.4', '--package', await packageWith('1.2.3')]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('v1.2.4');
    expect(result.stderr).toContain('1.2.3');
  });

  it.each(['1.2.3', 'v1.2', 'release-1.2.3', 'v1.2.3.4'])(
    'refuses the malformed tag %s',
    async (tag) => {
      const result = run('check-version.mjs', [tag, '--package', await packageWith('1.2.3')]);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/not a version tag/i);
    },
  );

  // Installed copies move from a pre-release to the final release only when its label is alpha or
  // beta: a copy on 1.2.0-rc.1 follows other rc releases and never sees 1.2.0.
  it.each(['1.2.0-beta.1', '1.2.0-beta.12', '1.2.0-alpha.3'])(
    'accepts the pre-release %s',
    async (version) => {
      const result = run('check-version.mjs', [
        `v${version}`,
        '--package',
        await packageWith(version),
      ]);
      expect(result.code, result.stderr).toBe(0);
    },
  );

  it.each(['1.2.0-rc.1', '1.2.0-beta', '1.2.0-beta.1.2', '1.2.0-next.1', '1.2.0-preview'])(
    'refuses the pre-release %s, which installed copies would not carry on to the final release',
    async (version) => {
      const result = run('check-version.mjs', [
        `v${version}`,
        '--package',
        await packageWith(version),
      ]);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/pre-release/i);
      expect(result.stderr).toContain('-beta.N');
    },
  );

  it('tells the workflow whether the release is a pre-release', async () => {
    const outputFile = path.join(dir, 'github-output.txt');

    const stable = run('check-version.mjs', ['v1.2.3', '--package', await packageWith('1.2.3')], {
      GITHUB_OUTPUT: outputFile,
    });
    expect(stable.code, stable.stderr).toBe(0);
    expect(await readFile(outputFile, 'utf8')).toBe('version=1.2.3\nprerelease=false\n');

    await writeFile(outputFile, '');
    const beta = run(
      'check-version.mjs',
      ['v1.3.0-beta.1', '--package', await packageWith('1.3.0-beta.1')],
      {
        GITHUB_OUTPUT: outputFile,
      },
    );
    expect(beta.code, beta.stderr).toBe(0);
    expect(await readFile(outputFile, 'utf8')).toBe('version=1.3.0-beta.1\nprerelease=true\n');
  });

  // The workflow runs this first thing, but only once a tag has been pushed, and a tag that cannot be
  // released cannot be moved or deleted either. So a version that would fail there must fail here.
  it('accepts the version that this repository has now', () => {
    const result = run('check-version.mjs', []);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(pkg.version);
  });

  it('checks the package version alone when no tag is given', async () => {
    expect(run('check-version.mjs', ['--package', await packageWith('2.0.0')]).code).toBe(0);

    const bad = run('check-version.mjs', ['--package', await packageWith('two')]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/not a valid version/i);
  });
});
