import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatReadingTime } from './format';

describe('formatBytes', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [999, '999 bytes'],
    [1023, '1,023 bytes'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [10240, '10 KB'],
    [1048576, '1 MB'],
    [5767168, '5.5 MB'],
  ])('%s -> %s', (bytes, expected) => {
    expect(formatBytes(bytes, 'en-US')).toBe(expected);
  });

  it("follows the reader's number formatting", () => {
    expect(formatBytes(1536, 'de-DE')).toBe('1,5 KB');
  });
});

describe('formatCount', () => {
  it('groups thousands for the given locale', () => {
    expect(formatCount(1234567, 'en-US')).toBe('1,234,567');
    expect(formatCount(1234567, 'de-DE')).toBe('1.234.567');
  });
});

describe('formatReadingTime', () => {
  it.each([
    [1, '1 min read'],
    [6, '6 min read'],
    [120, '120 min read'],
  ])('%s -> %s', (minutes, expected) => {
    expect(formatReadingTime(minutes)).toBe(expected);
  });
});
