import { describe, expect, it } from 'vitest';
import { resolveSymlinksSafely, type SymlinkFileSystem } from './symlink-policy';

/**
 * A pretend disk: `links` maps the path of a symbolic link or junction to its target text, and
 * `existing` lists ordinary files and folders. Every lookup is recorded.
 */
function pretendDisk(links: Record<string, string>, existing: string[]) {
  const looked: string[] = [];
  const fs: SymlinkFileSystem = {
    lstat: (filePath) => {
      looked.push(filePath);
      if (filePath in links) return Promise.resolve({ isSymbolicLink: () => true });
      if (existing.includes(filePath)) return Promise.resolve({ isSymbolicLink: () => false });
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    },
    readlink: (filePath) => {
      const target = links[filePath];
      return target === undefined ? Promise.reject(new Error('EINVAL')) : Promise.resolve(target);
    },
  };
  return { fs, looked };
}

const doc = 'C:\\repo\\README.md';

describe('resolveSymlinksSafely', () => {
  it('returns an ordinary path unchanged', async () => {
    const { fs } = pretendDisk({}, ['C:\\repo', 'C:\\repo\\img', 'C:\\repo\\img\\logo.png']);

    expect(await resolveSymlinksSafely(fs, 'C:\\repo\\img\\logo.png', doc)).toEqual({
      ok: true,
      path: 'C:\\repo\\img\\logo.png',
    });
  });

  it('lets a path through when part of it does not exist; the read will report that', async () => {
    const { fs } = pretendDisk({}, ['C:\\repo']);
    expect(await resolveSymlinksSafely(fs, 'C:\\repo\\gone\\a.png', doc)).toEqual({
      ok: true,
      path: 'C:\\repo\\gone\\a.png',
    });
  });

  it('refuses a file that is a link to a network share', async () => {
    const { fs } = pretendDisk({ 'C:\\repo\\logo.png': '\\\\evil.example\\share\\x.png' }, [
      'C:\\repo',
    ]);
    expect(await resolveSymlinksSafely(fs, 'C:\\repo\\logo.png', doc)).toEqual({
      ok: false,
      reason: 'blocked',
    });
  });

  it('refuses a path inside a folder that is a link to a network share, and never looks beyond the link', async () => {
    const { fs, looked } = pretendDisk({ 'C:\\repo\\docs': '\\\\evil.example\\share' }, [
      'C:\\repo',
    ]);

    const result = await resolveSymlinksSafely(fs, 'C:\\repo\\docs\\img\\a.png', doc);

    expect(result).toEqual({ ok: false, reason: 'blocked' });
    // Looking at anything below the link would already contact the server.
    expect(looked).toEqual(['C:\\repo', 'C:\\repo\\docs']);
  });

  it('follows a link to another local place and returns where the file really is', async () => {
    const { fs } = pretendDisk({ 'C:\\repo\\docs': 'D:\\mirror\\docs' }, [
      'C:\\repo',
      'D:\\mirror',
      'D:\\mirror\\docs',
      'D:\\mirror\\docs\\a.png',
    ]);
    expect(await resolveSymlinksSafely(fs, 'C:\\repo\\docs\\a.png', doc)).toEqual({
      ok: true,
      path: 'D:\\mirror\\docs\\a.png',
    });
  });

  it('reads a relative link target from the folder that holds the link', async () => {
    const { fs } = pretendDisk({ 'C:\\repo\\docs\\logo.png': '..\\assets\\logo.png' }, [
      'C:\\repo',
      'C:\\repo\\docs',
      'C:\\repo\\assets',
      'C:\\repo\\assets\\logo.png',
    ]);
    expect(await resolveSymlinksSafely(fs, 'C:\\repo\\docs\\logo.png', doc)).toEqual({
      ok: true,
      path: 'C:\\repo\\assets\\logo.png',
    });
  });

  it('follows a chain of links, checking every step', async () => {
    const { fs } = pretendDisk(
      { 'C:\\a.png': 'C:\\b.png', 'C:\\b.png': '\\\\evil.example\\share\\c.png' },
      [],
    );
    expect(await resolveSymlinksSafely(fs, 'C:\\a.png', doc)).toEqual({
      ok: false,
      reason: 'blocked',
    });
  });

  it('gives up on links that lead back to themselves', async () => {
    const { fs } = pretendDisk({ 'C:\\a.png': 'C:\\b.png', 'C:\\b.png': 'C:\\a.png' }, []);
    expect(await resolveSymlinksSafely(fs, 'C:\\a.png', doc)).toEqual({
      ok: false,
      reason: 'too-many-links',
    });
  });

  it('allows a link into the share the open document is on, and refuses another share', async () => {
    const shareDoc = '\\\\server\\docs\\guide\\README.md';
    const folders = ['\\\\server\\docs\\guide', '\\\\server\\docs\\shared'];
    const same = pretendDisk(
      { '\\\\server\\docs\\guide\\logo.png': '\\\\server\\docs\\shared\\logo.png' },
      [...folders, '\\\\server\\docs\\shared\\logo.png'],
    );
    expect(
      await resolveSymlinksSafely(same.fs, '\\\\server\\docs\\guide\\logo.png', shareDoc),
    ).toEqual({ ok: true, path: '\\\\server\\docs\\shared\\logo.png' });

    const other = pretendDisk(
      { '\\\\server\\docs\\guide\\logo.png': '\\\\other\\docs\\logo.png' },
      folders,
    );
    expect(
      await resolveSymlinksSafely(other.fs, '\\\\server\\docs\\guide\\logo.png', shareDoc),
    ).toEqual({ ok: false, reason: 'blocked' });
  });

  it.each([
    '\\\\.\\PhysicalDrive0',
    '\\\\?\\C:\\secret.png',
    'C:\\docs\\NUL',
    'C:\\docs\\a.png:stream',
  ])('refuses a link to %s', async (target) => {
    const { fs } = pretendDisk({ 'C:\\repo\\logo.png': target }, ['C:\\repo']);
    expect(await resolveSymlinksSafely(fs, 'C:\\repo\\logo.png', doc)).toEqual({
      ok: false,
      reason: 'blocked',
    });
  });
});
