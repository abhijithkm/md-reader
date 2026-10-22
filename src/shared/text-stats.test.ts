import { describe, expect, it } from 'vitest';
import { computeTextStats, countLines } from './text-stats';

describe('computeTextStats', () => {
  it('counts words separated by whitespace', () => {
    expect(computeTextStats('The quick brown fox').words).toBe(4);
  });

  it('ignores punctuation, symbols and emoji', () => {
    expect(computeTextStats('Hello, world! — \u{1F600} …').words).toBe(2);
  });

  it('counts words in scripts that do not use spaces', () => {
    expect(computeTextStats('こんにちは世界').words).toBeGreaterThanOrEqual(2);
  });

  it('keeps contractions as a single word', () => {
    expect(computeTextStats("don't stop").words).toBe(2);
  });

  it.each([
    [1, 1],
    [200, 1],
    [201, 2],
    [400, 2],
    [401, 3],
  ])('estimates %s words as %s minute(s) at 200 words per minute', (words, minutes) => {
    expect(computeTextStats('word '.repeat(words)).readingMinutes).toBe(minutes);
  });

  it('reports no words and no reading time for empty or blank text', () => {
    expect(computeTextStats('')).toEqual({ words: 0, readingMinutes: 0 });
    expect(computeTextStats('   \n\t ')).toEqual({ words: 0, readingMinutes: 0 });
  });
});

describe('countLines', () => {
  it.each([
    ['', 0],
    ['a', 1],
    ['a\n', 1],
    ['a\nb', 2],
    ['a\r\nb\r\n', 2],
    ['\n', 1],
    ['a\n\nb', 3],
  ])('%j -> %s', (source, expected) => {
    expect(countLines(source)).toBe(expected);
  });
});
