import { describe, expect, it } from 'vitest';
import { buildLocalImageUrl, parseLocalImageUrl } from './local-image-url';

describe('buildLocalImageUrl', () => {
  it('wraps a file URL in the local image scheme', () => {
    expect(buildLocalImageUrl('file:///C:/a%20b/c.png')).toBe(
      'mdreader-local://image/?u=file%3A%2F%2F%2FC%3A%2Fa%2520b%2Fc.png',
    );
  });
});

describe('parseLocalImageUrl', () => {
  it('extracts the original file URL', () => {
    expect(
      parseLocalImageUrl('mdreader-local://image/?u=file%3A%2F%2F%2FC%3A%2Fa%2520b%2Fc.png'),
    ).toBe('file:///C:/a%20b/c.png');
  });

  it.each([
    'file:///C:/a%20b/%23hash%3Fquery%26amp/%E6%97%A5%E6%9C%AC.png',
    'file://server/share/pic.png',
  ])('round-trips %s', (fileUrl) => {
    expect(parseLocalImageUrl(buildLocalImageUrl(fileUrl))).toBe(fileUrl);
  });

  it.each([
    ['another scheme', 'https://image/?u=file%3A%2F%2F%2FC%3A%2Fa.png'],
    ['another host', 'mdreader-local://other/?u=file%3A%2F%2F%2FC%3A%2Fa.png'],
    ['no u parameter', 'mdreader-local://image/'],
    ['an empty u parameter', 'mdreader-local://image/?u='],
    ['a non-file target', 'mdreader-local://image/?u=https%3A%2F%2Fevil.example%2Fa.png'],
    ['a javascript target', 'mdreader-local://image/?u=javascript%3Aalert(1)'],
    ['garbage', 'not a url'],
  ])('returns null for %s', (_label, url) => {
    expect(parseLocalImageUrl(url)).toBeNull();
  });
});
