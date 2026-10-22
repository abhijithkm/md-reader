import { describe, expect, it } from 'vitest';
import { assessLocalPath } from './local-path-policy';

// The rules encode Windows path semantics (drive letters, UNC shares, devices).
const onWindows = process.platform === 'win32';

describe.skipIf(!onWindows)('assessLocalPath', () => {
  it.each([
    ['C:\\docs\\a.png', 'C:\\docs\\a.png'],
    ['C:\\docs\\..\\a.png', 'C:\\a.png'],
    ['c:/docs/a.png', 'c:\\docs\\a.png'],
    ['C:\\My Docs\\日本語 #1.png', 'C:\\My Docs\\日本語 #1.png'],
    ['C:\\docs\\console.png', 'C:\\docs\\console.png'],
  ])('accepts and normalizes %s', (input, expected) => {
    expect(assessLocalPath(input, undefined)).toEqual({ ok: true, path: expected });
  });

  it.each(['', 'docs\\a.png', 'C:a.png', 'C:\\a\0.png', `C:\\${'a'.repeat(40_000)}.png`])(
    'rejects the unusable path %j',
    (input) => {
      expect(assessLocalPath(input, undefined)).toEqual({ ok: false, reason: 'invalid' });
    },
  );

  it.each([
    '\\\\?\\C:\\a.png',
    '\\\\.\\PhysicalDrive0',
    // The Windows NT form of the same prefixes.
    '\\??\\C:\\a.png',
    '\\??\\UNC\\evil.example\\share\\a.png',
    'C:\\docs\\CON.png',
    'C:\\docs\\nul',
    'C:\\docs\\com1.txt',
    'C:\\docs\\LPT9\\a.png',
  ])('rejects the device path %s', (input) => {
    expect(assessLocalPath(input, undefined)).toEqual({ ok: false, reason: 'device-path' });
  });

  it.each(['C:\\docs\\a.png:stream', 'C:\\docs\\a.png::$DATA', 'C:\\docs\\a.md:Zone.Identifier'])(
    'rejects the alternate data stream %s',
    (input) => {
      expect(assessLocalPath(input, undefined)).toEqual({ ok: false, reason: 'stream' });
    },
  );

  describe('network shares', () => {
    const unc = '\\\\server\\share\\pics\\a.png';

    it('rejects a share when the current document is on a local drive', () => {
      expect(assessLocalPath(unc, 'C:\\docs\\a.md')).toEqual({ ok: false, reason: 'network-path' });
    });

    it('rejects a share when no document is open', () => {
      expect(assessLocalPath(unc, undefined)).toEqual({ ok: false, reason: 'network-path' });
    });

    it('accepts a share that the current document lives on', () => {
      expect(assessLocalPath(unc, '\\\\server\\share\\docs\\a.md')).toEqual({
        ok: true,
        path: unc,
      });
    });

    it('compares the share case-insensitively', () => {
      expect(assessLocalPath('\\\\SERVER\\Share\\a.png', '\\\\server\\share\\x.md')).toEqual({
        ok: true,
        path: '\\\\SERVER\\Share\\a.png',
      });
    });

    it('rejects a different share on the same server', () => {
      expect(assessLocalPath('\\\\server\\other\\a.png', '\\\\server\\share\\x.md')).toEqual({
        ok: false,
        reason: 'network-path',
      });
    });

    it('sees through forward slashes', () => {
      expect(assessLocalPath('//evil.example/share/a.png', 'C:\\docs\\a.md')).toEqual({
        ok: false,
        reason: 'network-path',
      });
    });
  });
});
