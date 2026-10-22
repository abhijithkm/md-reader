import { lstat, mkdir, mkdtemp, readlink, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLocalImageUrl } from '../shared/local-image-url';
import { handleLocalImageRequest, type LocalImageDeps } from './local-image-protocol';

const onWindows = process.platform === 'win32';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-img-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const realFs: LocalImageDeps['fs'] = {
  stat: (filePath) => stat(filePath),
  readFile: async (filePath) => (await import('node:fs/promises')).readFile(filePath),
  lstat: (filePath) => lstat(filePath),
  readlink: (filePath) => readlink(filePath),
};

/** The parts of a disk the checks for symbolic links look at: nothing is a link. */
const noLinks = {
  lstat: () => Promise.resolve({ isSymbolicLink: () => false }),
  readlink: () => Promise.reject(new Error('not a link')),
};

function deps(overrides: Partial<LocalImageDeps> = {}): LocalImageDeps {
  return { fs: realFs, getCurrentDocumentPath: () => undefined, ...overrides };
}

function imageRequest(fileUrl: string, init?: RequestInit): Request {
  return new Request(buildLocalImageUrl(fileUrl), init);
}

function untouchableFs() {
  const fs = {
    stat: vi.fn(() => Promise.reject(new Error('should not be called'))),
    readFile: vi.fn(() => Promise.reject(new Error('should not be called'))),
    lstat: vi.fn(() => Promise.reject(new Error('should not be called'))),
    readlink: vi.fn(() => Promise.reject(new Error('should not be called'))),
  };
  return fs;
}

describe('handleLocalImageRequest', () => {
  describe('serving images', () => {
    it('returns the file with its image type', async () => {
      const dir = path.join(workDir, 'My Pics');
      await mkdir(dir);
      const file = path.join(dir, 'cat 猫.png');
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      await writeFile(file, bytes);

      const response = await handleLocalImageRequest(
        imageRequest(pathToFileURL(file).href),
        deps(),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    });

    it('sandboxes SVG so it cannot run script or load anything', async () => {
      const file = path.join(workDir, 'logo.svg');
      await writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg"/>');

      const response = await handleLocalImageRequest(
        imageRequest(pathToFileURL(file).href),
        deps(),
      );

      expect(response.headers.get('content-type')).toBe('image/svg+xml');
      const policy = response.headers.get('content-security-policy') ?? '';
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain('sandbox');
    });

    it.each([
      ['PHOTO.JPG', 'image/jpeg'],
      ['pic.jpeg', 'image/jpeg'],
      ['anim.GIF', 'image/gif'],
      ['modern.webp', 'image/webp'],
      ['icon.ico', 'image/x-icon'],
    ])('serves %s as %s', async (name, type) => {
      const file = path.join(workDir, name);
      await writeFile(file, 'x');
      const response = await handleLocalImageRequest(
        imageRequest(pathToFileURL(file).href),
        deps(),
      );
      expect(response.headers.get('content-type')).toBe(type);
    });
  });

  describe('refusing requests', () => {
    it.each(['notes.txt', 'setup.exe', 'page.html', 'app.js', 'doc.md', 'no-extension'])(
      'refuses %s without touching the disk',
      async (name) => {
        const fs = untouchableFs();
        const url = pathToFileURL(path.join(workDir, name)).href;

        const response = await handleLocalImageRequest(imageRequest(url), deps({ fs }));

        expect(response.status).toBe(415);
        expect(fs.stat).not.toHaveBeenCalled();
        expect(fs.readFile).not.toHaveBeenCalled();
      },
    );

    it('answers 404 for a missing image', async () => {
      const url = pathToFileURL(path.join(workDir, 'missing.png')).href;
      expect((await handleLocalImageRequest(imageRequest(url), deps())).status).toBe(404);
    });

    it('answers 404 for a folder that has an image name', async () => {
      const folder = path.join(workDir, 'folder.png');
      await mkdir(folder);
      const url = pathToFileURL(folder).href;
      expect((await handleLocalImageRequest(imageRequest(url), deps())).status).toBe(404);
    });

    it('answers 413 for an oversized image without reading it', async () => {
      const readFile = vi.fn(() => Promise.resolve(Buffer.from('x')));
      const fs = {
        stat: () => Promise.resolve({ isFile: () => true, size: 101 }),
        readFile,
        ...noLinks,
      };
      const url = pathToFileURL(path.join(workDir, 'big.png')).href;

      const response = await handleLocalImageRequest(
        imageRequest(url),
        deps({ fs, maxBytes: 100 }),
      );

      expect(response.status).toBe(413);
      expect(readFile).not.toHaveBeenCalled();
    });

    it.each([
      ['another scheme', 'https://image/?u=file%3A%2F%2F%2FC%3A%2Fa.png'],
      ['another host', 'mdreader-local://other/?u=file%3A%2F%2F%2FC%3A%2Fa.png'],
      ['a missing target', 'mdreader-local://image/'],
      ['a non-file target', 'mdreader-local://image/?u=https%3A%2F%2Fevil.example%2Fa.png'],
    ])('answers 400 for %s', async (_label, url) => {
      expect((await handleLocalImageRequest(new Request(url), deps())).status).toBe(400);
    });

    it('answers 405 for anything but GET', async () => {
      const url = pathToFileURL(path.join(workDir, 'a.png')).href;
      const response = await handleLocalImageRequest(
        imageRequest(url, { method: 'POST', body: 'x' }),
        deps(),
      );
      expect(response.status).toBe(405);
    });
  });

  describe.skipIf(!onWindows)('Windows path hazards', () => {
    const okFs: LocalImageDeps['fs'] = {
      stat: () => Promise.resolve({ isFile: () => true, size: 3 }),
      readFile: () => Promise.resolve(Buffer.from('abc')),
      ...noLinks,
    };

    /** A disk where the named paths are symbolic links to the given targets. */
    function disk(links: Record<string, string>) {
      const stat = vi.fn(() => Promise.resolve({ isFile: () => true, size: 3 }));
      const readFile = vi.fn((_filePath: string) => Promise.resolve(Buffer.from('abc')));
      const fs: LocalImageDeps['fs'] = {
        stat,
        readFile,
        lstat: (filePath) => Promise.resolve({ isSymbolicLink: () => filePath in links }),
        readlink: (filePath) => Promise.resolve(links[filePath] ?? ''),
      };
      return { fs, stat, readFile };
    }

    it('refuses an image that is really a symbolic link to a network share', async () => {
      const { fs, stat, readFile } = disk({
        'C:\\docs\\logo.png': '\\\\evil.example\\share\\x.png',
      });

      const response = await handleLocalImageRequest(
        imageRequest('file:///C:/docs/logo.png'),
        deps({ fs, getCurrentDocumentPath: () => 'C:\\docs\\a.md' }),
      );

      expect(response.status).toBe(403);
      // Opening it at all would send the reader's credentials to the server.
      expect(stat).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
    });

    it('refuses an image name that is really a link to a file of another kind', async () => {
      const { fs, readFile } = disk({ 'C:\\docs\\logo.png': 'C:\\private\\passwords.txt' });

      const response = await handleLocalImageRequest(
        imageRequest('file:///C:/docs/logo.png'),
        deps({ fs }),
      );

      expect(response.status).toBe(415);
      expect(readFile).not.toHaveBeenCalled();
    });

    it('serves an image that is a link to another place on the computer, from where it really is', async () => {
      const { fs, readFile } = disk({ 'C:\\docs\\logo.png': 'D:\\assets\\logo.png' });

      const response = await handleLocalImageRequest(
        imageRequest('file:///C:/docs/logo.png'),
        deps({ fs }),
      );

      expect(response.status).toBe(200);
      expect(readFile).toHaveBeenCalledExactlyOnceWith('D:\\assets\\logo.png');
    });

    it('refuses a network share when the open document is on a local drive', async () => {
      const response = await handleLocalImageRequest(
        imageRequest('file://evil.example/share/a.png'),
        deps({ fs: okFs, getCurrentDocumentPath: () => 'C:\\docs\\a.md' }),
      );
      expect(response.status).toBe(403);
    });

    it('serves from the share the open document lives on', async () => {
      const response = await handleLocalImageRequest(
        imageRequest('file://server/share/pics/a.png'),
        deps({ fs: okFs, getCurrentDocumentPath: () => '\\\\server\\share\\docs\\a.md' }),
      );
      expect(response.status).toBe(200);
    });

    it.each(['file:///C:/docs/con.png', 'file:///C:/docs/a.png:stream'])(
      'refuses %s',
      async (url) => {
        const response = await handleLocalImageRequest(imageRequest(url), deps({ fs: okFs }));
        expect(response.status).toBe(403);
      },
    );
  });
});
