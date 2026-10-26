import { describe, expect, it } from 'vitest';
import { checkUpdateInfo } from './update-info';

const SHA512 = `${'q'.repeat(86)}==`;

/** What electron-builder writes into latest.yml for the installer, as the library hands it over. */
function info(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '1.2.0',
    files: [{ url: 'MDReader-Setup-1.2.0.exe', sha512: SHA512, size: 102_891_308 }],
    path: 'MDReader-Setup-1.2.0.exe',
    sha512: SHA512,
    releaseDate: '2026-10-22T17:38:07.395Z',
    ...changes,
  };
}

/** The same, with the one file of the update changed. */
function withFile(changes: Record<string, unknown>): Record<string, unknown> {
  return info({
    files: [{ url: 'MDReader-Setup-1.2.0.exe', sha512: SHA512, size: 102_891_308, ...changes }],
  });
}

const problemOf = (value: unknown): string => {
  const result = checkUpdateInfo(value);
  if (result.ok) throw new Error(`expected a refusal, got the version ${result.version}`);
  return result.problem;
};

describe('checkUpdateInfo', () => {
  describe('accepts', () => {
    it('what electron-builder writes for the installer, and names the version', () => {
      expect(checkUpdateInfo(info())).toEqual({ ok: true, version: '1.2.0' });
    });

    it('a pre-release version, whose file name carries the label', () => {
      const result = checkUpdateInfo(
        info({
          version: '1.2.0-beta.2',
          path: 'MDReader-Setup-1.2.0-beta.2.exe',
          files: [{ url: 'MDReader-Setup-1.2.0-beta.2.exe', sha512: SHA512, size: 1 }],
        }),
      );

      expect(result).toEqual({ ok: true, version: '1.2.0-beta.2' });
    });

    it('an update file with no top-level path, which only older tools wrote', () => {
      const { path: _path, ...withoutPath } = info();

      expect(checkUpdateInfo(withoutPath)).toEqual({ ok: true, version: '1.2.0' });
    });

    it('the tag of the release the update came from, v followed by the version', () => {
      expect(checkUpdateInfo(info({ tag: 'v1.2.0' }))).toEqual({ ok: true, version: '1.2.0' });
      expect(
        checkUpdateInfo(
          info({
            version: '1.2.0-beta.2',
            tag: 'v1.2.0-beta.2',
            files: [{ url: 'MDReader-Setup-1.2.0-beta.2.exe', sha512: SHA512, size: 1 }],
            path: 'MDReader-Setup-1.2.0-beta.2.exe',
          }),
        ),
      ).toEqual({ ok: true, version: '1.2.0-beta.2' });
    });

    it('a file that says it needs no administrator rights', () => {
      expect(checkUpdateInfo(withFile({ isAdminRightsRequired: false })).ok).toBe(true);
    });
  });

  describe('refuses', () => {
    it.each([
      ['nothing', undefined],
      ['null', null],
      ['text', '1.2.0'],
      ['a list', [info()]],
    ])('update information that is %s', (_label, value) => {
      expect(problemOf(value)).toMatch(/not a mapping/);
    });

    it.each([
      ['a version with too few parts', '1.2'],
      ['markup', '<img src=x onerror=alert(1)>'],
      ['a link', 'https://evil.example/app.exe'],
      ['a number', 42],
      ['nothing', undefined],
    ])('%s as the version', (_label, version) => {
      expect(problemOf(info({ version }))).toMatch(/version/);
    });

    it.each([
      ['no files', undefined],
      ['an empty list', []],
      [
        'two files',
        [
          { url: 'a.exe', sha512: SHA512 },
          { url: 'b.exe', sha512: SHA512 },
        ],
      ],
      ['text', 'MDReader-Setup-1.2.0.exe'],
      ['an entry that is not a mapping', ['MDReader-Setup-1.2.0.exe']],
    ])('%s instead of exactly one file', (_label, files) => {
      expect(problemOf(info({ files }))).toMatch(/exactly one file/);
    });

    // The library puts the name after .../releases/download/<tag>/, so only a plain name stays there.
    it.each([
      ['a link to another host', 'https://evil.example/MDReader-Setup-1.2.0.exe'],
      ['a path out of the release', '../../../../evil/repo/releases/download/v1/x.exe'],
      ['a path with a folder', 'sub/MDReader-Setup-1.2.0.exe'],
      ['a path with backslashes', '..\\MDReader-Setup-1.2.0.exe'],
      ['an encoded path', '%2e%2e%2fMDReader-Setup-1.2.0.exe'],
      ['a query', 'MDReader-Setup-1.2.0.exe?x=1'],
      ['a fragment', 'MDReader-Setup-1.2.0.exe#x'],
      ['a name that is not an installer', 'MDReader-Setup-1.2.0.zip'],
      ['a name that starts with a dot', '.MDReader-Setup-1.2.0.exe'],
      ['an empty name', ''],
      ['a number', 12],
      ['nothing', undefined],
    ])('a file whose name is %s', (_label, url) => {
      expect(problemOf(withFile({ url }))).toMatch(/plain installer file name/);
    });

    it('a top-level path that is not the file the update lists', () => {
      expect(problemOf(info({ path: 'MDReader-Portable-1.2.0.exe' }))).toMatch(/path/);
    });

    it.each([
      ['no hash', undefined],
      ['a hash that is too short', 'abc'],
      ['a hash in hexadecimal', 'a'.repeat(128)],
      ['a number', 7],
    ])('a file with %s', (_label, sha512) => {
      expect(problemOf(withFile({ sha512 }))).toMatch(/SHA-512/);
    });

    it('a file that asks for administrator rights, because the installed app runs without them', () => {
      expect(problemOf(withFile({ isAdminRightsRequired: true }))).toMatch(/administrator/);
    });

    // The library builds the download address from the release's tag, and a `tag:` line in
    // latest.yml replaces the real one. Without this a plain file name would not keep the download
    // inside the release it came from.
    it.each([
      ['a path to another repository', '../../../../evil/payload/releases/download/v1.2.0'],
      ['an encoded path', '%2e%2e%2f%2e%2e%2fevil'],
      ['the tag of another version', 'v1.1.0'],
      ['a tag without the v', '1.2.0'],
      ['something that is not text', 12],
    ])('a release tag that is %s instead of v<version>', (_label, tag) => {
      expect(problemOf(info({ tag }))).toMatch(/tag/);
    });

    it('a web installer, which would fetch more packages after the check', () => {
      const problem = problemOf(
        info({ packages: { x64: { file: 'extra.7z', size: 1, sha512: SHA512 } } }),
      );

      expect(problem).toMatch(/web installer/);
    });
  });

  it('accepts an update file that lists no packages at all', () => {
    expect(checkUpdateInfo(info({ packages: null })).ok).toBe(true);
  });
});
