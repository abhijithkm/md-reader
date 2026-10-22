import path from 'node:path';
import { assessLocalPath } from './local-path-policy';

const win32 = path.win32;

/** Windows follows up to 63 links in a path; this is generous and still stops a loop quickly. */
const MAX_LINK_HOPS = 40;

/** What is needed to look at a path without following links: neither call touches the target. */
export interface SymlinkFileSystem {
  lstat(filePath: string): Promise<{ isSymbolicLink(): boolean }>;
  readlink(filePath: string): Promise<string>;
}

export type SafePathResult =
  { ok: true; path: string } | { ok: false; reason: 'blocked' | 'too-many-links' };

/**
 * Works out where a file really is, one step at a time, and refuses to go anywhere the path
 * policy forbids.
 *
 * `assessLocalPath` only reads the text of a path. But a symbolic link (or junction) inside a
 * cloned repository or an unpacked archive can point anywhere, including `\\attacker\share`, and
 * merely opening such a file makes Windows send the reader's credentials to that server. So each
 * part of the path is examined without following links (`lstat`), and when one is a link its
 * target is checked with the path policy before anything beyond the link is touched.
 *
 * Returns the path with every link resolved, ready to be read.
 */
export async function resolveSymlinksSafely(
  fs: SymlinkFileSystem,
  filePath: string,
  currentDocumentPath: string | undefined,
): Promise<SafePathResult> {
  let pending = win32.normalize(filePath);

  for (let hop = 0; hop <= MAX_LINK_HOPS; hop += 1) {
    const link = await firstLinkIn(fs, pending);
    if (link === undefined) return { ok: true, path: pending };

    let target: string;
    try {
      // A relative target is relative to the folder that holds the link.
      target = win32.resolve(win32.dirname(link), await fs.readlink(link));
    } catch {
      return { ok: false, reason: 'blocked' };
    }
    const verdict = assessLocalPath(
      win32.join(target, pending.slice(link.length)),
      currentDocumentPath,
    );
    if (!verdict.ok) return { ok: false, reason: 'blocked' };
    pending = verdict.path;
  }
  return { ok: false, reason: 'too-many-links' };
}

/** The first part of the path (from the root down) that is a link, or undefined if none is. */
async function firstLinkIn(fs: SymlinkFileSystem, fullPath: string): Promise<string | undefined> {
  const { root } = win32.parse(fullPath);
  let current = root;

  for (const part of fullPath.slice(root.length).split('\\')) {
    if (part === '') continue;
    current = win32.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) return current;
    } catch {
      // This part does not exist (or cannot be examined), so there is nothing below it to follow.
      return undefined;
    }
  }
  return undefined;
}
