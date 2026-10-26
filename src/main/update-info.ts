import { isUpdateVersion } from '../shared/updates';

export type UpdateInfoCheck = { ok: true; version: string } | { ok: false; problem: string };

// The library appends the name to .../releases/download/<tag>/ to find the installer, so only a
// plain file name stays in that folder: no host, no folder, no `..`, no query, no encoded escape.
const INSTALLER_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.exe$/;

// A SHA-512 as base64 is 64 bytes: 86 characters and two `=`.
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const refuse = (problem: string): UpdateInfoCheck => ({ ok: false, problem });

/**
 * Checks what the update server said about the new version (the parsed latest.yml) before anything
 * is downloaded. An installed copy accepts exactly what electron-builder writes for this app's
 * installer: one file with a plain name and a SHA-512, a version number, and nothing that would make
 * the library fetch more, ask for administrator rights, or look anywhere else.
 */
export function checkUpdateInfo(info: unknown): UpdateInfoCheck {
  if (!isRecord(info)) return refuse('the update information is not a mapping');
  const version = info['version'];
  if (!isUpdateVersion(version)) return refuse('its version is not a plain version number');

  // The library builds the download address from the release's tag, and a `tag:` line in latest.yml
  // takes the place of the real one. A plain file name alone would not keep the download inside the
  // release it came from; the tag of every release of this app is v followed by its version (the
  // release workflow refuses anything else). A feed with no tag at all is a test feed.
  const tag = info['tag'];
  if (tag !== undefined && tag !== `v${version}`) {
    return refuse('its release tag is not v followed by its version');
  }

  const files = info['files'];
  const file = Array.isArray(files) && files.length === 1 ? (files[0] as unknown) : undefined;
  if (!isRecord(file)) return refuse('it does not list exactly one file');

  const name = file['url'];
  if (typeof name !== 'string' || !INSTALLER_FILE_NAME.test(name)) {
    return refuse('the file does not have a plain installer file name');
  }
  if (info['path'] !== undefined && info['path'] !== name) {
    return refuse('its path is not the file it lists');
  }

  const sha512 = file['sha512'];
  if (typeof sha512 !== 'string' || !SHA512_BASE64.test(sha512)) {
    return refuse('the file has no valid SHA-512');
  }
  if (file['isAdminRightsRequired'] !== undefined && file['isAdminRightsRequired'] !== false) {
    return refuse('the file asks for administrator rights');
  }
  if (info['packages'] !== undefined && info['packages'] !== null) {
    return refuse('it is a web installer, which would fetch more files after this check');
  }
  return { ok: true, version };
}
