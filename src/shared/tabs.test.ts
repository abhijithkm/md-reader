import { describe, expect, it } from 'vitest';
import { fileNameOf, folderNameOf, samePath } from './tabs';

describe('fileNameOf', () => {
  it.each([
    ['C:\\docs\\notes.md', 'notes.md'],
    ['C:/docs/notes.md', 'notes.md'],
    ['/home/ada/notes.md', 'notes.md'],
    ['notes.md', 'notes.md'],
    ['C:\\docs\\folder\\', 'folder'],
  ])('takes %s to be named %s', (filePath, name) => {
    expect(fileNameOf(filePath)).toBe(name);
  });

  it('gives back what it was given when there is no name in it', () => {
    expect(fileNameOf('')).toBe('');
    expect(fileNameOf('\\')).toBe('\\');
  });
});

describe('folderNameOf', () => {
  it.each([
    ['C:\\docs\\notes.md', 'docs'],
    ['C:/projects/web/README.md', 'web'],
    ['/home/ada/notes.md', 'ada'],
  ])('takes the folder of %s to be %s', (filePath, folder) => {
    expect(folderNameOf(filePath)).toBe(folder);
  });

  it('has none for a file that is not in a folder', () => {
    expect(folderNameOf('notes.md')).toBeUndefined();
  });
});

describe('samePath', () => {
  it('knows a path from itself', () => {
    expect(samePath('C:\\docs\\a.md', 'C:\\docs\\a.md')).toBe(true);
  });

  it('does not tell letters from the same letters in another case, as Windows does not', () => {
    expect(samePath('C:\\Docs\\README.md', 'c:\\docs\\readme.MD')).toBe(true);
  });

  it('does not tell a slash from a backslash', () => {
    expect(samePath('C:/docs/a.md', 'C:\\docs\\a.md')).toBe(true);
  });

  it('tells apart paths that are not the same file', () => {
    expect(samePath('C:\\docs\\a.md', 'C:\\docs\\b.md')).toBe(false);
    expect(samePath('C:\\docs\\a.md', 'C:\\other\\a.md')).toBe(false);
    expect(samePath('C:\\docs\\a.md', '')).toBe(false);
  });
});
