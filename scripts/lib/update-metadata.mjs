// What the update files of a release must say. Every installed copy trusts them: a wrong version,
// size or hash stops all of them from updating, and a wrong source could send them elsewhere. So
// they are checked before anything is published. Pure functions, so tests can feed them any input.

/** The only settings electron-builder writes into resources/app-update.yml for this app. */
const APP_UPDATE_KEYS = new Set(['provider', 'owner', 'repo', 'updaterCacheDirName']);

/**
 * The only settings latest.yml has for this app, and the only ones its entry for the installer has.
 * Anything else changes what an installed copy does with the release (a staged rollout hides it
 * from some, a minimum system version from others, administrator rights or a web installer change
 * how it installs), so a release that carries one is stopped for a person to look at.
 */
const UPDATE_FILE_KEYS = new Set(['version', 'files', 'path', 'sha512', 'releaseDate']);
const UPDATE_FILE_ENTRY_KEYS = new Set(['url', 'sha512', 'size', 'blockMapSize']);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {{
 *   version: string,
 *   installerName: string,
 *   installerSha512: string,
 *   installerSize: number,
 *   blockmapExists: boolean,
 *   metadata: unknown,
 * }} input latest.yml, as parsed, and the facts about the installer it describes
 * @returns {string[]} One message per problem; empty when the update file is right.
 */
export function checkUpdateFile({
  version,
  installerName,
  installerSha512,
  installerSize,
  blockmapExists,
  metadata,
}) {
  const problems = [];

  if (!isRecord(metadata)) {
    problems.push('latest.yml is missing or is not a YAML mapping');
  } else {
    for (const key of Object.keys(metadata)) {
      if (!UPDATE_FILE_KEYS.has(key)) {
        problems.push(`latest.yml has a setting this app does not use: ${key}`);
      }
    }
    if (metadata.version !== version) {
      problems.push(`latest.yml says version ${String(metadata.version)}, expected ${version}`);
    }
    if (metadata.path !== installerName) {
      problems.push(
        `latest.yml says the installer is ${String(metadata.path)}, expected ${installerName}`,
      );
    }
    if (metadata.sha512 !== installerSha512) {
      problems.push("latest.yml has a SHA-512 that is not the installer's");
    }

    const files = Array.isArray(metadata.files) ? metadata.files : [];
    const [file] = files;
    if (files.length !== 1 || !isRecord(file)) {
      problems.push('latest.yml must list exactly one file, the installer');
    } else {
      for (const key of Object.keys(file)) {
        if (!UPDATE_FILE_ENTRY_KEYS.has(key)) {
          problems.push(
            `latest.yml lists the installer with a setting this app does not use: ${key}`,
          );
        }
      }
      if (file.url !== installerName) {
        problems.push(`latest.yml lists ${String(file.url)}, expected ${installerName}`);
      }
      if (file.sha512 !== installerSha512) {
        problems.push("latest.yml lists a SHA-512 that is not the installer's");
      }
      if (file.size !== installerSize) {
        problems.push(
          `latest.yml lists a size of ${String(file.size)} bytes, the installer has ${installerSize}`,
        );
      }
    }

    if (
      typeof metadata.releaseDate !== 'string' ||
      Number.isNaN(Date.parse(metadata.releaseDate))
    ) {
      problems.push('latest.yml has no valid releaseDate');
    }
  }

  if (!blockmapExists) {
    problems.push(
      'the .blockmap file of the installer is missing, so updates could not download only what changed',
    );
  }
  return problems;
}

/**
 * @param {{
 *   appUpdate: unknown,
 *   source: { owner: string, repo: string },
 *   updaterFolder: string,
 * }} input resources/app-update.yml, as parsed, and where updates must come from
 * @returns {string[]} One message per problem; empty when the configuration is right.
 */
export function checkAppUpdateConfig({ appUpdate, source, updaterFolder }) {
  if (!isRecord(appUpdate)) return ['resources/app-update.yml is missing or is not a YAML mapping'];

  const problems = [];
  for (const key of Object.keys(appUpdate)) {
    if (!APP_UPDATE_KEYS.has(key)) {
      problems.push(`app-update.yml has a setting this app does not use: ${key}`);
    }
  }
  if (appUpdate.provider !== 'github') {
    problems.push(
      `app-update.yml uses the provider ${String(appUpdate.provider)}, expected github`,
    );
  }
  if (appUpdate.owner !== source.owner || appUpdate.repo !== source.repo) {
    problems.push(
      `app-update.yml reads updates from ${String(appUpdate.owner)}/${String(appUpdate.repo)}, ` +
        `expected ${source.owner}/${source.repo}`,
    );
  }
  if (appUpdate.updaterCacheDirName !== updaterFolder) {
    problems.push(
      `app-update.yml keeps downloads in ${String(appUpdate.updaterCacheDirName)}, ` +
        `but the installer script removes ${updaterFolder}`,
    );
  }
  return problems;
}
