import { describe, expect, it } from 'vitest';
import { toSafeExternalUrl } from './external-links';

describe('toSafeExternalUrl', () => {
  it.each([
    ['https://example.com/docs?a=1#top', 'https://example.com/docs?a=1#top'],
    ['http://example.com', 'http://example.com/'],
    ['HTTPS://EXAMPLE.COM/A', 'https://example.com/A'],
    ['mailto:ada@example.com', 'mailto:ada@example.com'],
    ['mailto:ada@example.com,bob@example.com', 'mailto:ada@example.com,bob@example.com'],
    // The URL parser encodes spaces in the part after "?", which is what makes this one safe.
    [
      'mailto:ada@example.com?subject=Hello there&body=Hi',
      'mailto:ada@example.com?subject=Hello%20there&body=Hi',
    ],
    ['  https://example.com  ', 'https://example.com/'],
  ])('allows %j as %j', (input, expected) => {
    expect(toSafeExternalUrl(input)).toBe(expected);
  });

  it('returns the canonical form of an internationalised address', () => {
    expect(toSafeExternalUrl('https://例え.jp/パス')).toMatch(
      /^https:\/\/xn--[a-z0-9-]+\.jp\/%E3%83%91%E3%82%B9$/,
    );
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///C:/Windows/System32/calc.exe',
    'vbscript:msgbox(1)',
    'ms-settings:defaultapps',
    'ftp://example.com/file',
    'steam://run/1',
    'https://',
    'https://user:secret@example.com/',
    'mailto:',
    // The address part of a mailto: link is kept exactly as typed. These characters could break
    // out of the quoted argument the mail program is started with.
    'mailto:ada@example.com" --flag x',
    'mailto:ada@example.com --flag',
    'mailto:ada@example.com|calc',
    'mailto:ada@example.com^calc',
    'mailto:ada@example.com\\x',
    'mailto:ada@example.com<x>',
    '//example.com',
    'example.com',
    '',
    '   ',
    `https://example.com/${'a'.repeat(9000)}`,
  ])('rejects %j', (input) => {
    expect(toSafeExternalUrl(input)).toBeNull();
  });

  it.each([42, null, undefined, {}, ['https://example.com']])('rejects non-string %j', (input) => {
    expect(toSafeExternalUrl(input)).toBeNull();
  });
});
