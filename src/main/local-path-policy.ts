import path from 'node:path';

export type LocalPathVerdict =
  | { ok: true; path: string }
  | { ok: false; reason: 'invalid' | 'device-path' | 'network-path' | 'stream' };

const MAX_PATH_LENGTH = 32_767;
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])$/i;
const win32 = path.win32;

/**
 * Decides whether a path taken from document content (a link or an image) may
 * be touched on disk. Markdown is untrusted, so besides ordinary local paths
 * this refuses the Windows special cases an attacker could abuse:
 *
 * - network shares (reading one makes Windows send the user's credentials to
 *   the server), unless the open document itself lives on that share;
 * - device paths (`\\.\`, `\\?\`, `CON`, `NUL`, `COM1` ...);
 * - NTFS alternate data streams (`file.png:stream`).
 */
export function assessLocalPath(
  rawPath: string,
  currentDocumentPath: string | undefined,
): LocalPathVerdict {
  if (rawPath === '' || rawPath.length > MAX_PATH_LENGTH || rawPath.includes('\0')) {
    return { ok: false, reason: 'invalid' };
  }

  const normalized = win32.normalize(rawPath);
  // `\\?\` and `\\.\` (and `\??\`, the form the kernel uses for them) reach devices and skip the
  // normal path rules.
  if (/^(?:\\\\[?.]\\|\\\?\?\\)/.test(normalized)) return { ok: false, reason: 'device-path' };
  if (!win32.isAbsolute(normalized)) return { ok: false, reason: 'invalid' };

  const { root } = win32.parse(normalized);
  if (root.startsWith('\\\\') && !isOnSameShare(root, currentDocumentPath)) {
    return { ok: false, reason: 'network-path' };
  }

  const rest = normalized.slice(root.length);
  if (rest.includes(':')) return { ok: false, reason: 'stream' };
  if (rest.split('\\').some(isReservedDeviceName)) return { ok: false, reason: 'device-path' };

  return { ok: true, path: normalized };
}

function isOnSameShare(root: string, currentDocumentPath: string | undefined): boolean {
  if (currentDocumentPath === undefined) return false;
  const documentRoot = win32.parse(win32.normalize(currentDocumentPath)).root;
  return documentRoot.startsWith('\\\\') && documentRoot.toLowerCase() === root.toLowerCase();
}

function isReservedDeviceName(segment: string): boolean {
  // Windows ignores trailing dots and spaces and any extension after the name.
  const trimmed = segment.replace(/[. ]+$/, '');
  const base = trimmed.split('.')[0] ?? '';
  return RESERVED_DEVICE_NAME.test(base.trim());
}
