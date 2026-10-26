import { describe, expect, it } from 'vitest';
import { isUpdateVersion, releasePageUrl, UPDATE_SOURCE } from './updates';

describe('isUpdateVersion', () => {
  it.each(['1.2.3', '0.0.1', '10.20.30', '1.1.0-beta.1', '2.0.0-rc.2', '1.0.0-alpha'])(
    'accepts %s',
    (version) => {
      expect(isUpdateVersion(version)).toBe(true);
    },
  );

  it.each([
    ['too few parts', '1.2'],
    ['a leading v', 'v1.2.3'],
    ['trailing space', '1.2.3 '],
    ['a trailing newline', '1.2.3\n'],
    ['an empty prerelease', '1.2.3-'],
    ['markup in the prerelease', '1.2.3-<script>'],
    ['a path', '1.2.3/../../x'],
    ['a url', 'https://evil.example/1.2.3'],
    ['a very long prerelease', `1.2.3-${'a'.repeat(100)}`],
    ['four numbers', '1.2.3.4'],
    ['text', 'latest'],
    ['an empty string', ''],
  ])('rejects %s', (_label, version) => {
    expect(isUpdateVersion(version)).toBe(false);
  });

  it.each([undefined, null, 123, {}, [], ['1.2.3']])(
    'rejects %j, which is not a string',
    (value) => {
      expect(isUpdateVersion(value)).toBe(false);
    },
  );
});

describe('releasePageUrl', () => {
  it('points at the release page of this repository', () => {
    expect(releasePageUrl('1.2.3')).toBe(
      'https://github.com/abhijithkm/md-reader/releases/tag/v1.2.3',
    );
    expect(releasePageUrl('1.1.0-beta.1')).toBe(
      'https://github.com/abhijithkm/md-reader/releases/tag/v1.1.0-beta.1',
    );
  });

  it('is built from the one place that names the repository', () => {
    expect(UPDATE_SOURCE).toEqual({ owner: 'abhijithkm', repo: 'md-reader' });
    expect(releasePageUrl('1.0.0').startsWith(`https://github.com/${UPDATE_SOURCE.owner}/`)).toBe(
      true,
    );
  });
});
