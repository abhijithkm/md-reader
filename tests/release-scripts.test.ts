import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scripts = path.join(process.cwd(), 'scripts');

function run(script: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '', ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-scripts-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('checksums.mjs', () => {
  it('writes a sha256sum-compatible list of the release executables, sorted by name', async () => {
    await writeFile(path.join(dir, 'MDReader-Setup-1.0.0.exe'), 'abc');
    await writeFile(path.join(dir, 'MDReader-Portable-1.0.0.exe'), '');
    const output = path.join(dir, 'SHA256SUMS.txt');

    const result = run('checksums.mjs', [dir, output]);

    expect(result.code, result.stderr).toBe(0);
    // SHA-256 of "" and of "abc" are standard test vectors.
    expect(await readFile(output, 'utf8')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  MDReader-Portable-1.0.0.exe\n' +
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  MDReader-Setup-1.0.0.exe\n',
    );
  });

  it('leaves out files that are not release executables', async () => {
    await writeFile(path.join(dir, 'MDReader-Setup-1.0.0.exe'), 'abc');
    await writeFile(path.join(dir, 'MDReader-Setup-1.0.0.exe.blockmap'), 'x');
    await writeFile(path.join(dir, 'latest.yml'), 'x');
    await writeFile(path.join(dir, 'builder-debug.yml'), 'x');
    await mkdir(path.join(dir, 'win-unpacked'));
    await writeFile(path.join(dir, 'win-unpacked', 'MDReader.exe'), 'x');
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
    expect(result.stderr).toMatch(/no release executables/i);
  });
});

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

  it('checks the package version alone when no tag is given', async () => {
    expect(run('check-version.mjs', ['--package', await packageWith('2.0.0')]).code).toBe(0);

    const bad = run('check-version.mjs', ['--package', await packageWith('two')]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/not a valid version/i);
  });
});
