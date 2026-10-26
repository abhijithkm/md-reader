import { describe, expect, it } from 'vitest';
import {
  checkAppUpdateConfig,
  checkUpdateFile,
  type AppUpdateConfigInput,
  type UpdateFileInput,
} from '../scripts/lib/update-metadata.mjs';

const SHA512 = `${'q'.repeat(86)}==`;
const OTHER_SHA512 = `${'z'.repeat(86)}==`;

function validFile(): UpdateFileInput {
  return {
    version: '1.1.0',
    installerName: 'MDReader-Setup-1.1.0.exe',
    installerSha512: SHA512,
    installerSize: 102_891_308,
    blockmapExists: true,
    metadata: {
      version: '1.1.0',
      files: [{ url: 'MDReader-Setup-1.1.0.exe', sha512: SHA512, size: 102_891_308 }],
      path: 'MDReader-Setup-1.1.0.exe',
      sha512: SHA512,
      releaseDate: '2026-10-22T17:38:07.395Z',
    },
  };
}

/** The update file with one setting replaced. */
function fileWith(changes: Record<string, unknown>): UpdateFileInput {
  const input = validFile();
  return { ...input, metadata: { ...(input.metadata as object), ...changes } };
}

describe('checkUpdateFile', () => {
  it('accepts the update file electron-builder writes for the installer', () => {
    expect(checkUpdateFile(validFile())).toEqual([]);
  });

  it.each([
    ['nothing', undefined],
    ['a list', ['version: 1.1.0']],
    ['text', 'version: 1.1.0'],
    ['null', null],
  ])('reports an update file that holds %s', (_label, metadata) => {
    expect(checkUpdateFile({ ...validFile(), metadata })).toEqual([
      'latest.yml is missing or is not a YAML mapping',
    ]);
  });

  it('reports a version that is not the one being released, because installed copies would never update', () => {
    expect(checkUpdateFile(fileWith({ version: '1.0.0' }))).toEqual([
      'latest.yml says version 1.0.0, expected 1.1.0',
    ]);
  });

  it('reports a file name that is not the installer', () => {
    const problems = checkUpdateFile(
      fileWith({
        path: 'MDReader-Portable-1.1.0.exe',
        files: [{ url: 'MDReader-Portable-1.1.0.exe', sha512: SHA512, size: 102_891_308 }],
      }),
    );

    expect(problems).toEqual([
      'latest.yml says the installer is MDReader-Portable-1.1.0.exe, expected MDReader-Setup-1.1.0.exe',
      'latest.yml lists MDReader-Portable-1.1.0.exe, expected MDReader-Setup-1.1.0.exe',
    ]);
  });

  it("reports a hash that is not the installer's, which would make every download fail its check", () => {
    const problems = checkUpdateFile(
      fileWith({
        sha512: OTHER_SHA512,
        files: [{ url: 'MDReader-Setup-1.1.0.exe', sha512: OTHER_SHA512, size: 102_891_308 }],
      }),
    );

    expect(problems).toEqual([
      "latest.yml has a SHA-512 that is not the installer's",
      "latest.yml lists a SHA-512 that is not the installer's",
    ]);
  });

  it("reports a size that is not the installer's", () => {
    const problems = checkUpdateFile(
      fileWith({ files: [{ url: 'MDReader-Setup-1.1.0.exe', sha512: SHA512, size: 1000 }] }),
    );

    expect(problems).toEqual([
      'latest.yml lists a size of 1000 bytes, the installer has 102891308',
    ]);
  });

  it.each([
    ['no files', []],
    ['two files', [{ url: 'a.exe' }, { url: 'b.exe' }]],
    ['no list', undefined],
    ['an entry that is not a mapping', ['MDReader-Setup-1.1.0.exe']],
  ])('reports an update file that lists %s instead of exactly the installer', (_label, files) => {
    expect(checkUpdateFile(fileWith({ files }))).toContain(
      'latest.yml must list exactly one file, the installer',
    );
  });

  it.each([
    ['no date', undefined],
    ['text that is not a date', 'yesterday'],
    ['a number', 20261022],
  ])('reports an update file with %s as its release date', (_label, releaseDate) => {
    expect(checkUpdateFile(fileWith({ releaseDate }))).toEqual([
      'latest.yml has no valid releaseDate',
    ]);
  });

  it.each([
    ['a staged rollout, which would keep the update from some copies', { stagingPercentage: 10 }],
    ['a minimum system version', { minimumSystemVersion: '10.0.19045' }],
    ['administrator rights', { isAdminRightsRequired: true }],
    ['a web installer', { packages: { x64: { file: 'extra.7z' } } }],
    ['release notes', { releaseNotes: 'Fixed some things' }],
  ])('reports %s, which this app does not use', (_label, extra) => {
    const key = Object.keys(extra)[0];

    expect(checkUpdateFile(fileWith(extra))).toEqual([
      `latest.yml has a setting this app does not use: ${key}`,
    ]);
  });

  it('reports a setting on the installer entry that this app does not use', () => {
    const problems = checkUpdateFile(
      fileWith({
        files: [
          {
            url: 'MDReader-Setup-1.1.0.exe',
            sha512: SHA512,
            size: 102_891_308,
            isAdminRightsRequired: true,
          },
        ],
      }),
    );

    expect(problems).toEqual([
      'latest.yml lists the installer with a setting this app does not use: isAdminRightsRequired',
    ]);
  });

  it('accepts the block map size that electron-builder can add to the installer entry', () => {
    const problems = checkUpdateFile(
      fileWith({
        files: [
          {
            url: 'MDReader-Setup-1.1.0.exe',
            sha512: SHA512,
            size: 102_891_308,
            blockMapSize: 107_778,
          },
        ],
      }),
    );

    expect(problems).toEqual([]);
  });

  it('reports a missing blockmap, because every update would then download the whole installer', () => {
    expect(checkUpdateFile({ ...validFile(), blockmapExists: false })).toEqual([
      'the .blockmap file of the installer is missing, so updates could not download only what changed',
    ]);
  });

  it('reports every problem at once', () => {
    const problems = checkUpdateFile({
      ...fileWith({ version: '0.0.1', releaseDate: undefined }),
      blockmapExists: false,
    });

    expect(problems).toHaveLength(3);
  });
});

function validConfig(): AppUpdateConfigInput {
  return {
    appUpdate: {
      owner: 'abhijithkm',
      repo: 'md-reader',
      provider: 'github',
      updaterCacheDirName: 'md-reader-updater',
    },
    source: { owner: 'abhijithkm', repo: 'md-reader' },
    updaterFolder: 'md-reader-updater',
  };
}

function configWith(changes: Record<string, unknown>): AppUpdateConfigInput {
  const input = validConfig();
  return { ...input, appUpdate: { ...(input.appUpdate as object), ...changes } };
}

describe('checkAppUpdateConfig', () => {
  it('accepts the configuration electron-builder writes into the package', () => {
    expect(checkAppUpdateConfig(validConfig())).toEqual([]);
  });

  it.each([
    ['nothing', undefined],
    ['text', 'provider: github'],
    ['null', null],
  ])('reports a configuration that holds %s', (_label, appUpdate) => {
    expect(checkAppUpdateConfig({ ...validConfig(), appUpdate })).toEqual([
      'resources/app-update.yml is missing or is not a YAML mapping',
    ]);
  });

  it('reports updates that would come from another repository', () => {
    expect(checkAppUpdateConfig(configWith({ owner: 'someone-else' }))).toEqual([
      'app-update.yml reads updates from someone-else/md-reader, expected abhijithkm/md-reader',
    ]);
    expect(checkAppUpdateConfig(configWith({ repo: 'other' }))).toEqual([
      'app-update.yml reads updates from abhijithkm/other, expected abhijithkm/md-reader',
    ]);
  });

  it('reports updates that would come from somewhere other than GitHub', () => {
    expect(checkAppUpdateConfig(configWith({ provider: 'generic' }))).toEqual([
      'app-update.yml uses the provider generic, expected github',
    ]);
  });

  it.each([
    ['a host that redirects the downloads', { host: 'evil.example' }],
    ['a token', { token: 'ghp_x' }],
    ['a private repository flag', { private: true }],
    ['a channel', { channel: 'beta' }],
    ['a publisher name', { publisherName: ['Someone'] }],
  ])('reports %s, which this app does not use', (_label, extra) => {
    const key = Object.keys(extra)[0];
    expect(checkAppUpdateConfig(configWith(extra))).toEqual([
      `app-update.yml has a setting this app does not use: ${key}`,
    ]);
  });

  it('reports a cache folder that the installer script does not know, so uninstalling would leave it behind', () => {
    expect(checkAppUpdateConfig(configWith({ updaterCacheDirName: 'other-updater' }))).toEqual([
      'app-update.yml keeps downloads in other-updater, but the installer script removes md-reader-updater',
    ]);
  });
});
