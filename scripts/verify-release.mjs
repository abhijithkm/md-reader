#!/usr/bin/env node
// Inspects the output of `npm run dist` (or `npm run pack`) before it is published, and exits
// with 1 when anything is off. It checks files and settings only; it does not start the app
// (the end-to-end tests and scripts/installer-test.ps1 do that).
//
//   node scripts/verify-release.mjs [release directory] [--unpacked-only]
//
// --unpacked-only skips the installer, the portable executable and the update files, for use after
// `npm run pack`.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { extractFile, listPackage } from '@electron/asar';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { parse } from 'yaml';
import { checkAsarEntries } from './lib/asar-policy.mjs';
import { checkAppUpdateConfig, checkUpdateFile } from './lib/update-metadata.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const unpackedOnly = args.includes('--unpacked-only');
const releaseDirectory = path.resolve(
  args.find((arg) => !arg.startsWith('--')) ?? path.join(root, 'release'),
);

const manifestOfProject = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = manifestOfProject.version;
const unpacked = path.join(releaseDirectory, 'win-unpacked');
const executable = path.join(unpacked, 'MDReader.exe');
const archive = path.join(unpacked, 'resources', 'app.asar');
const appUpdateFile = path.join(unpacked, 'resources', 'app-update.yml');
const installer = path.join(releaseDirectory, `MDReader-Setup-${version}.exe`);
const portable = path.join(releaseDirectory, `MDReader-Portable-${version}.exe`);
const updateFile = path.join(releaseDirectory, 'latest.yml');

// A truncated or empty download is far smaller than any real build of the app.
const MINIMUM_PACKAGE_BYTES = 20 * 1024 * 1024;

// The hardening listed under `electronFuses` in electron-builder.yml, as found in the binary.
const EXPECTED_FUSES = {
  RunAsNode: 'DISABLE',
  EnableCookieEncryption: 'ENABLE',
  EnableNodeOptionsEnvironmentVariable: 'DISABLE',
  EnableNodeCliInspectArguments: 'DISABLE',
  EnableEmbeddedAsarIntegrityValidation: 'ENABLE',
  OnlyLoadAppFromAsar: 'ENABLE',
  GrantFileProtocolExtraPrivileges: 'DISABLE',
};

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function powershell(script) {
  // Windows PowerShell cannot load its own modules when it inherits the module path of a
  // PowerShell 7 parent, so start it with its defaults.
  const env = { ...process.env };
  delete env.PSModulePath;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env,
  }).trim();
}

const quote = (value) => `'${value.replaceAll("'", "''")}'`;

function checkPackageFile(file) {
  const { size } = statSync(file);
  if (size < MINIMUM_PACKAGE_BYTES) {
    throw new Error(`${path.basename(file)} is only ${megabytes(size)}; the build looks truncated`);
  }
  return `${path.basename(file)} (${megabytes(size)})`;
}

// The manifest of an NSIS executable sits in its first few hundred kilobytes.
function requestedExecutionLevel(file) {
  const handle = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    const length = readSync(handle, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, length).toString('latin1');
    return /requestedExecutionLevel level="(\w+)"/.exec(text)?.[1];
  } finally {
    closeSync(handle);
  }
}

function authenticodeStatus(file) {
  return powershell(`(Get-AuthenticodeSignature -LiteralPath ${quote(file)}).Status.ToString()`);
}

async function sha512Base64(file) {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return hash.digest('base64');
}

/** A YAML file as parsed, or undefined when there is no such file. */
function readYaml(file) {
  return existsSync(file) ? parse(readFileSync(file, 'utf8')) : undefined;
}

/** Where updates must come from: the repository named in package.json. */
function updateSource() {
  const url = String(manifestOfProject.repository?.url ?? '');
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (match === null)
    throw new Error(`package.json has no GitHub repository (repository.url is "${url}")`);
  return { owner: match[1], repo: match[2] };
}

const checks = [];
const check = (name, run) => checks.push({ name, run });

if (!unpackedOnly) {
  check('installer', () => checkPackageFile(installer));
  check('portable executable', () => checkPackageFile(portable));
  check('installer and portable executable need no administrator rights', () => {
    for (const file of [installer, portable]) {
      const level = requestedExecutionLevel(file);
      if (level !== 'asInvoker') {
        throw new Error(
          `${path.basename(file)} requests "${level ?? 'nothing'}", expected asInvoker`,
        );
      }
    }
    return 'both run as the current user (asInvoker)';
  });
}

check('unpacked executable', () => {
  const { size } = statSync(executable);
  return `${path.basename(executable)} (${megabytes(size)})`;
});

check('app.asar holds only the compiled app', () => {
  const entries = listPackage(archive);
  const problems = checkAsarEntries(entries);
  if (problems.length > 0) throw new Error(problems.join('; '));
  return `${entries.length} entries`;
});

check('packaged package.json', () => {
  const manifest = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  if (manifest.name !== 'md-reader') throw new Error(`name is "${manifest.name}"`);
  if (manifest.version !== version) {
    throw new Error(`version is "${manifest.version}", package.json says ${version}`);
  }
  const main = path.posix.normalize(String(manifest.main));
  const entries = listPackage(archive).map((entry) =>
    entry.replaceAll('\\', '/').replace(/^\/+/, ''),
  );
  if (!entries.includes(main)) throw new Error(`main "${manifest.main}" is not in the archive`);
  return `${manifest.name} ${manifest.version}, main ${main}`;
});

// electron-builder writes the update configuration and the update files while it builds the
// installer, so a build of the unpacked app alone (`npm run pack`) has neither.
if (!unpackedOnly) {
  check('the app updates only from this repository', () => {
    const source = updateSource();
    const problems = checkAppUpdateConfig({
      appUpdate: readYaml(appUpdateFile),
      source,
      updaterFolder: `${manifestOfProject.name}-updater`,
    });
    if (problems.length > 0) throw new Error(problems.join('; '));
    return `github.com/${source.owner}/${source.repo}`;
  });

  check('latest.yml matches the installer and the blockmap is there', async () => {
    const problems = checkUpdateFile({
      version,
      installerName: path.basename(installer),
      installerSha512: await sha512Base64(installer),
      installerSize: statSync(installer).size,
      blockmapExists: existsSync(`${installer}.blockmap`),
      metadata: readYaml(updateFile),
    });
    if (problems.length > 0) throw new Error(problems.join('; '));
    return `${path.basename(updateFile)} names ${path.basename(installer)}, with its size and SHA-512`;
  });
}

check('Electron fuses', async () => {
  const wire = await getCurrentFuseWire(executable);
  const wrong = Object.entries(EXPECTED_FUSES)
    .map(([name, expected]) => ({ name, expected, actual: FuseState[wire[FuseV1Options[name]]] }))
    .filter(({ expected, actual }) => actual !== expected);
  if (wrong.length > 0) {
    throw new Error(
      wrong.map((f) => `${f.name} is ${f.actual}, expected ${f.expected}`).join('; '),
    );
  }
  return `${Object.keys(EXPECTED_FUSES).length} fuses as configured`;
});

if (process.platform === 'win32') {
  check('executable version information', () => {
    const info = JSON.parse(
      powershell(
        `[System.Diagnostics.FileVersionInfo]::GetVersionInfo(${quote(executable)}) | ` +
          'Select-Object ProductName, FileVersion | ConvertTo-Json -Compress',
      ),
    );
    if (info.ProductName !== 'MD Reader') throw new Error(`ProductName is "${info.ProductName}"`);
    const numeric = version.split('-')[0];
    if (!String(info.FileVersion).startsWith(numeric)) {
      throw new Error(`FileVersion is "${info.FileVersion}", expected ${numeric}`);
    }
    return `${info.ProductName} ${info.FileVersion}`;
  });

  check('code signing status', () => {
    const files = unpackedOnly ? [executable] : [installer, portable, executable];
    const statuses = files.map((file) => ({ file, status: authenticodeStatus(file) }));
    const broken = statuses.filter(({ status }) => status !== 'NotSigned' && status !== 'Valid');
    if (broken.length > 0) {
      throw new Error(
        broken.map(({ file, status }) => `${path.basename(file)}: ${status}`).join('; '),
      );
    }
    return statuses.every(({ status }) => status === 'NotSigned')
      ? 'not signed (no certificate is configured); Windows SmartScreen will warn on first run'
      : statuses.map(({ file, status }) => `${path.basename(file)}: ${status}`).join(', ');
  });
}

let failed = 0;
for (const { name, run } of checks) {
  try {
    const detail = await run();
    process.stdout.write(`PASS  ${name}${detail ? `: ${detail}` : ''}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(
      `FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

process.stdout.write(
  failed === 0
    ? `\nAll ${checks.length} release checks passed for version ${version}.\n`
    : `\n${failed} of ${checks.length} release checks failed.\n`,
);
process.exitCode = failed === 0 ? 0 : 1;
