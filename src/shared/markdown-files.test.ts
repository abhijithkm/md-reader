import { describe, expect, it } from 'vitest';
import { isMarkdownFileName } from './markdown-files';

describe('isMarkdownFileName', () => {
  it.each([
    ['README.md', true],
    ['notes.markdown', true],
    ['UPPER.MD', true],
    ['Mixed.MarkDown', true],
    ['C:\\Docs\\My Notes\\todo.md', true],
    ['日本語のメモ.md', true],
    ['archive.md.txt', false],
    ['image.png', false],
    ['md', false],
    ['.md', false],
    ['folder\\.md', false],
    ['notes.mdx', false],
    ['', false],
  ])('%j -> %s', (name, expected) => {
    expect(isMarkdownFileName(name)).toBe(expected);
  });
});
