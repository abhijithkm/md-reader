import { describe, expect, it } from 'vitest';
import { resolveUpdateEnvironment } from './update-environment';

const FEED = 'http://127.0.0.1:8123/';

describe('resolveUpdateEnvironment', () => {
  describe('in an installed or unpacked build', () => {
    it('updates normally', () => {
      expect(resolveUpdateEnvironment({ isPackaged: true, env: {} })).toEqual({
        kind: 'active',
        notifyOnly: false,
      });
    });

    it('only reports updates when it is the portable executable, which cannot replace itself', () => {
      expect(
        resolveUpdateEnvironment({
          isPackaged: true,
          env: { PORTABLE_EXECUTABLE_FILE: 'C:\\Tools\\MDReader-Portable-1.1.0.exe' },
        }),
      ).toEqual({ kind: 'active', notifyOnly: true });
    });

    it('does not take an empty portable variable for the portable executable', () => {
      expect(
        resolveUpdateEnvironment({ isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: '' } }),
      ).toEqual({ kind: 'active', notifyOnly: false });
    });

    it('can be switched off from outside, which the tests of the packaged app rely on', () => {
      expect(
        resolveUpdateEnvironment({ isPackaged: true, env: { MDREADER_UPDATES: 'off' } }),
      ).toEqual({ kind: 'unavailable', reason: 'disabled' });
    });

    it('never lets the environment choose where updates come from', () => {
      const result = resolveUpdateEnvironment({
        isPackaged: true,
        env: { MDREADER_UPDATE_FEED: FEED },
      });

      expect(result).toEqual({ kind: 'active', notifyOnly: false });
      expect(JSON.stringify(result)).not.toContain('127.0.0.1');
    });
  });

  describe('the wait before the first check', () => {
    it.each([
      ['an installed build', true, {}],
      ['a development build with a feed on this computer', false, { MDREADER_UPDATE_FEED: FEED }],
    ])(
      'can be set from outside in %s, which only moves a check that was coming anyway',
      (_label, isPackaged, extra) => {
        const result = resolveUpdateEnvironment({
          isPackaged,
          env: { ...extra, MDREADER_UPDATE_FIRST_CHECK_MS: '2500' },
        });

        expect(result).toMatchObject({ kind: 'active', firstCheckDelayMs: 2500 });
      },
    );

    it.each([
      ['no wait at all', '0', 0],
      ['a whole day', '86400000', 86_400_000],
    ])('accepts %s', (_label, value, expected) => {
      const result = resolveUpdateEnvironment({
        isPackaged: true,
        env: { MDREADER_UPDATE_FIRST_CHECK_MS: value },
      });

      expect(result).toMatchObject({ firstCheckDelayMs: expected });
    });

    it.each([
      ['an empty value', ''],
      ['text', 'soon'],
      ['a negative number', '-1'],
      ['a fraction', '1.5'],
      ['a number in exponent form', '1e3'],
      ['a number with spaces', ' 5'],
      ['more than a day', '86400001'],
      ['a number far too large', '99999999999'],
    ])('leaves the usual wait when given %s', (_label, value) => {
      const result = resolveUpdateEnvironment({
        isPackaged: true,
        env: { MDREADER_UPDATE_FIRST_CHECK_MS: value },
      });

      expect(result).toEqual({ kind: 'active', notifyOnly: false });
    });

    it('does not turn updates on where they are off', () => {
      expect(
        resolveUpdateEnvironment({
          isPackaged: false,
          env: { MDREADER_UPDATE_FIRST_CHECK_MS: '100' },
        }),
      ).toEqual({ kind: 'unavailable', reason: 'development' });
      expect(
        resolveUpdateEnvironment({
          isPackaged: true,
          env: { MDREADER_UPDATES: 'off', MDREADER_UPDATE_FIRST_CHECK_MS: '100' },
        }),
      ).toEqual({ kind: 'unavailable', reason: 'disabled' });
    });
  });

  describe('how long a request may stay silent', () => {
    it('can be shortened in a development build with a feed on this computer, so that a test need not wait a minute', () => {
      const result = resolveUpdateEnvironment({
        isPackaged: false,
        env: { MDREADER_UPDATE_FEED: FEED, MDREADER_UPDATE_REQUEST_TIMEOUT_MS: '2000' },
      });

      expect(result).toMatchObject({ kind: 'active', requestTimeoutMs: 2000 });
    });

    it('is left as the library intends in an installed build, whatever the environment says', () => {
      const result = resolveUpdateEnvironment({
        isPackaged: true,
        env: { MDREADER_UPDATE_REQUEST_TIMEOUT_MS: '2000' },
      });

      expect(result).toEqual({ kind: 'active', notifyOnly: false });
    });

    it.each([
      ['an empty value', ''],
      ['text', 'soon'],
      ['a negative number', '-1'],
      ['a fraction', '1.5'],
      ['a number in exponent form', '1e3'],
      ['less than a tenth of a second', '99'],
      ['more than ten minutes', '600001'],
    ])('ignores %s', (_label, value) => {
      const result = resolveUpdateEnvironment({
        isPackaged: false,
        env: { MDREADER_UPDATE_FEED: FEED, MDREADER_UPDATE_REQUEST_TIMEOUT_MS: value },
      });

      expect(result).toEqual({ kind: 'active', notifyOnly: false, testFeedUrl: FEED });
    });
  });

  describe('in a development build', () => {
    it('has no updates', () => {
      expect(resolveUpdateEnvironment({ isPackaged: false, env: {} })).toEqual({
        kind: 'unavailable',
        reason: 'development',
      });
    });

    it('uses a feed on this computer when a test names one', () => {
      expect(
        resolveUpdateEnvironment({ isPackaged: false, env: { MDREADER_UPDATE_FEED: FEED } }),
      ).toEqual({ kind: 'active', notifyOnly: false, testFeedUrl: FEED });
    });

    it.each([
      ['localhost', 'http://localhost:9000/feed', 'http://localhost:9000/feed/'],
      ['an IPv6 loopback address', 'http://[::1]:8080/', 'http://[::1]:8080/'],
      [
        'a feed with a query and a fragment',
        'http://127.0.0.1:81/a?x=1#y',
        'http://127.0.0.1:81/a/',
      ],
    ])('accepts %s', (_label, value, normalized) => {
      expect(
        resolveUpdateEnvironment({ isPackaged: false, env: { MDREADER_UPDATE_FEED: value } }),
      ).toEqual({ kind: 'active', notifyOnly: false, testFeedUrl: normalized });
    });

    it.each([
      ['another computer', 'http://example.com:8123/'],
      ['a private network address', 'http://192.168.1.10:8123/'],
      ['a feed over https', 'https://127.0.0.1:8123/'],
      ['a feed without a port', 'http://127.0.0.1/'],
      ['a feed with credentials', 'http://user:secret@127.0.0.1:8123/'],
      ['a file address', 'file:///C:/feed/'],
      ['something that is not an address', 'not a url'],
      ['an empty value', ''],
    ])('refuses %s', (_label, value) => {
      expect(
        resolveUpdateEnvironment({ isPackaged: false, env: { MDREADER_UPDATE_FEED: value } }),
      ).toEqual({ kind: 'unavailable', reason: 'development' });
    });

    it('can still be switched off, even with a feed', () => {
      expect(
        resolveUpdateEnvironment({
          isPackaged: false,
          env: { MDREADER_UPDATES: 'off', MDREADER_UPDATE_FEED: FEED },
        }),
      ).toEqual({ kind: 'unavailable', reason: 'disabled' });
    });
  });
});
