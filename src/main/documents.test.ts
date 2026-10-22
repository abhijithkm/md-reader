import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownDocument, OpenOutcome } from '../shared/types';
import { createDocumentService, type DocumentFileSystem } from './documents';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-docs-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function expectOpened(outcome: OpenOutcome): MarkdownDocument {
  if (outcome.status !== 'opened') {
    throw new Error(`expected the document to open, got ${JSON.stringify(outcome)}`);
  }
  return outcome.document;
}

function expectFailed(outcome: OpenOutcome) {
  if (outcome.status !== 'failed') {
    throw new Error(`expected a failure, got ${JSON.stringify(outcome)}`);
  }
  return outcome.error;
}

function errorWithCode(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function fakeFs(overrides: Partial<DocumentFileSystem> = {}): DocumentFileSystem {
  return {
    stat: () => Promise.resolve({ isFile: () => true, size: 10, mtimeMs: 1_700_000_000_000 }),
    readFile: () => Promise.resolve(Buffer.from('# hi')),
    lstat: () => Promise.resolve({ isSymbolicLink: () => false }),
    readlink: () => Promise.reject(new Error('not a link')),
    ...overrides,
  };
}

describe('createDocumentService', () => {
  describe('opening real files', () => {
    it('opens a file whose path has spaces and non-ASCII characters', async () => {
      const dir = path.join(workDir, 'My Docs 日本語');
      await mkdir(dir);
      const file = path.join(dir, 'résumé notes.md');
      const text = '# Héllo 世界\n';
      await writeFile(file, text);

      const document = expectOpened(await createDocumentService().open(file));

      expect(document).toMatchObject({
        path: file,
        name: 'résumé notes.md',
        directory: dir,
        content: text,
        sizeBytes: Buffer.byteLength(text),
        encoding: 'utf-8',
      });
      expect(document.modifiedMs).toBe((await stat(file)).mtimeMs);
    });

    it('provides a base URL that resolves relative images next to the document', async () => {
      const dir = path.join(workDir, 'with space');
      await mkdir(dir);
      const file = path.join(dir, 'a.md');
      await writeFile(file, 'x');

      const document = expectOpened(await createDocumentService().open(file));

      expect(new URL('pics/a b.png', document.baseUrl).href).toBe(
        pathToFileURL(path.join(dir, 'pics', 'a b.png')).href,
      );
      expect(new URL('../up.png', document.baseUrl).href).toBe(
        pathToFileURL(path.join(workDir, 'up.png')).href,
      );
    });

    it('decodes a UTF-16 file saved with a byte order mark', async () => {
      const file = path.join(workDir, 'wide.md');
      await writeFile(
        file,
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# Hé', 'utf16le')]),
      );

      const document = expectOpened(await createDocumentService().open(file));

      expect(document).toMatchObject({ content: '# Hé', encoding: 'utf-16le' });
    });

    it('normalizes the path it was given', async () => {
      const dir = path.join(workDir, 'notes');
      await mkdir(dir);
      await writeFile(path.join(dir, 'a.md'), 'x');
      const roundabout = `${dir}${path.sep}..${path.sep}notes${path.sep}a.md`;

      const document = expectOpened(await createDocumentService().open(roundabout));

      expect(document.path).toBe(path.join(dir, 'a.md'));
    });

    it('accepts the extension in any case', async () => {
      const file = path.join(workDir, 'NOTES.MD');
      await writeFile(file, 'x');
      expectOpened(await createDocumentService().open(file));
    });
  });

  describe('files that cannot be opened', () => {
    it('reports a missing file by name', async () => {
      const error = expectFailed(await createDocumentService().open(path.join(workDir, 'gone.md')));
      expect(error.code).toBe('not-found');
      expect(error.message).toContain('gone.md');
    });

    it('reports a folder that has a Markdown-looking name', async () => {
      const folder = path.join(workDir, 'folder.md');
      await mkdir(folder);
      expect(expectFailed(await createDocumentService().open(folder)).code).toBe('not-a-file');
    });

    it('refuses other file types even when they exist', async () => {
      const file = path.join(workDir, 'notes.txt');
      await writeFile(file, 'x');
      const error = expectFailed(await createDocumentService().open(file));
      expect(error.code).toBe('unsupported-type');
      expect(error.message).toContain('notes.txt');
    });

    it.each([
      ['an empty string', ''],
      ['a number', 42],
      ['null', null],
      ['undefined', undefined],
      ['an object', {}],
      ['a relative path', 'relative.md'],
      ['a path containing NUL', `${path.join(os.tmpdir(), 'a')}\0.md`],
      ['an overlong path', path.join(os.tmpdir(), `${'a'.repeat(40_000)}.md`)],
    ])('rejects %s as an invalid path', async (_label, input) => {
      expect(expectFailed(await createDocumentService().open(input)).code).toBe('invalid-path');
    });
  });

  describe('file system failures', () => {
    const file = path.join(os.tmpdir(), 'doc.md');

    it.each(['ENOENT', 'ENOTDIR'])(
      'treats %s while checking the file as not found',
      async (code) => {
        const fs = fakeFs({ stat: () => Promise.reject(errorWithCode(code)) });
        expect(expectFailed(await createDocumentService({ fs }).open(file)).code).toBe('not-found');
      },
    );

    it.each(['EACCES', 'EPERM'])('explains a permission problem (%s)', async (code) => {
      const fs = fakeFs({ readFile: () => Promise.reject(errorWithCode(code)) });
      const error = expectFailed(await createDocumentService({ fs }).open(file));
      expect(error.code).toBe('unreadable');
      expect(error.message).toMatch(/permission/i);
    });

    it('explains a file that another program has locked', async () => {
      const fs = fakeFs({ readFile: () => Promise.reject(errorWithCode('EBUSY')) });
      const error = expectFailed(await createDocumentService({ fs }).open(file));
      expect(error.code).toBe('unreadable');
      expect(error.message).toMatch(/in use/i);
    });

    it('still reports an unexpected read error as unreadable', async () => {
      const fs = fakeFs({ readFile: () => Promise.reject(new Error('disk on fire')) });
      expect(expectFailed(await createDocumentService({ fs }).open(file)).code).toBe('unreadable');
    });
  });

  describe('size limit', () => {
    const file = path.join(os.tmpdir(), 'big.md');

    it('refuses an oversized file without reading it', async () => {
      const readFile = vi.fn(() => Promise.resolve(Buffer.from('x')));
      const fs = fakeFs({
        stat: () => Promise.resolve({ isFile: () => true, size: 1001, mtimeMs: 0 }),
        readFile,
      });

      const error = expectFailed(await createDocumentService({ fs, maxBytes: 1000 }).open(file));

      expect(error.code).toBe('too-large');
      expect(error.message).toContain('big.md');
      expect(readFile).not.toHaveBeenCalled();
    });

    it('accepts a file exactly at the limit', async () => {
      const fs = fakeFs({
        stat: () => Promise.resolve({ isFile: () => true, size: 1000, mtimeMs: 0 }),
        readFile: () => Promise.resolve(Buffer.alloc(1000, 0x61)),
      });
      expectOpened(await createDocumentService({ fs, maxBytes: 1000 }).open(file));
    });

    it('catches a file that grew after it was measured', async () => {
      const fs = fakeFs({
        stat: () => Promise.resolve({ isFile: () => true, size: 10, mtimeMs: 0 }),
        readFile: () => Promise.resolve(Buffer.alloc(2000, 0x61)),
      });
      const error = expectFailed(await createDocumentService({ fs, maxBytes: 1000 }).open(file));
      expect(error.code).toBe('too-large');
    });
  });
});

describe.skipIf(process.platform !== 'win32')(
  'a document that a link in another document leads to',
  () => {
    const fromLink = { fromLink: { currentDocumentPath: 'C:\\docs\\index.md' } };

    /** A disk where C:\docs\guide.md is a symbolic link to `target`. */
    function linkedDisk(target: string) {
      const stat = vi.fn((_filePath: string) =>
        Promise.resolve({ isFile: () => true, size: 10, mtimeMs: 1 }),
      );
      const readFile = vi.fn((_filePath: string) => Promise.resolve(Buffer.from('# guide')));
      const fs = fakeFs({
        stat,
        readFile,
        lstat: (filePath) =>
          Promise.resolve({ isSymbolicLink: () => filePath === 'C:\\docs\\guide.md' }),
        readlink: () => Promise.resolve(target),
      });
      return { fs, stat, readFile };
    }

    it('is refused when it is really a link to a network share, without touching it', async () => {
      const { fs, stat, readFile } = linkedDisk('\\\\evil.example\\share\\guide.md');

      const error = expectFailed(
        await createDocumentService({ fs }).open('C:\\docs\\guide.md', fromLink),
      );

      expect(error.code).toBe('blocked-link');
      // Opening it at all would send the reader's credentials to the server.
      expect(stat).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
    });

    it('is refused when it is really a link to a file that is not Markdown', async () => {
      const { fs, readFile } = linkedDisk('C:\\private\\passwords.txt');

      const error = expectFailed(
        await createDocumentService({ fs }).open('C:\\docs\\guide.md', fromLink),
      );

      expect(error.code).toBe('unsupported-type');
      expect(readFile).not.toHaveBeenCalled();
    });

    it('is read from where it really is, and keeps the path the link had', async () => {
      const { fs, readFile } = linkedDisk('D:\\notes\\guide.md');

      const document = expectOpened(
        await createDocumentService({ fs }).open('C:\\docs\\guide.md', fromLink),
      );

      expect(readFile).toHaveBeenCalledExactlyOnceWith('D:\\notes\\guide.md');
      expect(document.path).toBe('C:\\docs\\guide.md');
      expect(document.directory).toBe('C:\\docs');
    });

    it('is not checked this way when the user opened the file directly', async () => {
      const { fs, readFile } = linkedDisk('\\\\fileserver\\share\\guide.md');

      expectOpened(await createDocumentService({ fs }).open('C:\\docs\\guide.md'));

      expect(readFile).toHaveBeenCalledOnce();
    });
  },
);
