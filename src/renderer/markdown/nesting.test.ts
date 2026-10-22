import { describe, expect, it } from 'vitest';
import { MAX_CONTAINER_MARKERS, MAX_INDENT_COLUMNS, nestsTooDeeply } from './nesting';

describe('nestsTooDeeply', () => {
  it.each([
    ['plain text', 'Just a paragraph.\n\nAnother one.\n'],
    ['a thematic break made of spaced markers', `${'- '.repeat(40)}\n`],
    ['a Python prompt in a quote', '> >>> print(1)\n'],
    ['quotes ten levels deep', `${'> '.repeat(10)}quoted\n`],
    [
      'lists twenty levels deep',
      `${Array.from({ length: 20 }, (_u, n) => `${'  '.repeat(n)}- item`).join('\n')}\n`,
    ],
    ['an ordered list inside a quote', '> 1. one\n> 2. two\n'],
    ['indented code', `${' '.repeat(200)}wide ASCII art\n`],
    ['a long line of text', `${'word '.repeat(10_000)}\n`],
    ['arrows', '--------->\n'],
  ])('accepts %s', (_label, source) => {
    expect(nestsTooDeeply(source)).toBe(false);
  });

  it('accepts exactly the limit of markers and refuses one more', () => {
    expect(nestsTooDeeply(`${'> '.repeat(MAX_CONTAINER_MARKERS)}x`)).toBe(false);
    expect(nestsTooDeeply(`${'> '.repeat(MAX_CONTAINER_MARKERS + 1)}x`)).toBe(true);
  });

  it.each([
    ['quotes', '> '],
    ['quotes without spaces', '>'],
    ['bullets', '- '],
    ['stars', '* '],
    ['numbers', '1. '],
    ['parenthesis numbers', '1) '],
    ['mixed quotes and bullets', '> - '],
  ])('refuses a line of nested %s', (_label, marker) => {
    expect(nestsTooDeeply(`${marker.repeat(MAX_CONTAINER_MARKERS + 1)}deep\n`)).toBe(true);
  });

  it('finds the deep line wherever it is in the document', () => {
    const source = `# Title\n\n${'text\n\n'.repeat(500)}${'> '.repeat(5000)}deep\n\nmore\n`;
    expect(nestsTooDeeply(source)).toBe(true);
  });

  it('refuses lines that are indented absurdly far, which build nested lists', () => {
    expect(nestsTooDeeply(`${' '.repeat(MAX_INDENT_COLUMNS)}x`)).toBe(false);
    expect(nestsTooDeeply(`${' '.repeat(MAX_INDENT_COLUMNS + 1)}x`)).toBe(true);
    expect(nestsTooDeeply(`${'\t'.repeat(MAX_INDENT_COLUMNS / 4 + 1)}x`)).toBe(true);
  });

  it('works through a very large document in one quick pass', () => {
    const source = 'a normal line of a document\n'.repeat(180_000); // about 5 MB
    const started = performance.now();
    expect(nestsTooDeeply(source)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('copes with Windows line endings and an empty document', () => {
    expect(nestsTooDeeply('')).toBe(false);
    expect(nestsTooDeeply(`> one\r\n${'> '.repeat(MAX_CONTAINER_MARKERS + 1)}two\r\n`)).toBe(true);
  });
});
