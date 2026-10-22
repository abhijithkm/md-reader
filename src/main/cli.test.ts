import { describe, expect, it } from 'vitest';
import { findLaunchFile } from './cli';

// Paths are Windows paths because that is the only platform the app targets.
const onWindows = process.platform === 'win32';

const exe = 'C:\\Users\\Ada\\AppData\\Local\\Programs\\md-reader\\MDReader.exe';
const packaged = { cwd: 'C:\\Users\\Ada', isPackaged: true };
const development = { cwd: 'C:\\src\\md-reader', isPackaged: false };

describe.skipIf(!onWindows)('findLaunchFile', () => {
  it('returns the file passed to the packaged app', () => {
    expect(findLaunchFile([exe, 'C:\\Docs\\README.md'], packaged)).toBe('C:\\Docs\\README.md');
  });

  it('skips the app path that follows the executable when running unpackaged', () => {
    const argv = ['C:\\electron\\electron.exe', 'C:\\src\\md-reader\\out\\main\\index.js'];
    expect(findLaunchFile([...argv, 'C:\\Docs\\a.md'], development)).toBe('C:\\Docs\\a.md');
    expect(findLaunchFile(argv, development)).toBeUndefined();
  });

  it('returns undefined when no document was requested', () => {
    expect(findLaunchFile([exe], packaged)).toBeUndefined();
    expect(findLaunchFile([exe, '--flag'], packaged)).toBeUndefined();
  });

  it('keeps spaces, unicode and shell-special characters in the path', () => {
    const file = 'C:\\My Docs\\Ünï cödé & [draft] #1 (copy) 日本語.md';
    expect(findLaunchFile([exe, file], packaged)).toBe(file);
  });

  it('ignores Chromium and Electron switches wherever they appear', () => {
    const argv = [
      exe,
      '--allow-file-access-from-files',
      '--remote-debugging-port=9222',
      '--user-data-dir=C:\\Temp\\profile dir',
      'C:\\a.md',
      '-x',
    ];
    expect(findLaunchFile(argv, packaged)).toBe('C:\\a.md');
  });

  it('resolves relative paths against the working directory', () => {
    const context = { cwd: 'C:\\Work\\notes', isPackaged: true };
    expect(findLaunchFile([exe, 'todo.md'], context)).toBe('C:\\Work\\notes\\todo.md');
    expect(findLaunchFile([exe, '..\\other\\x.markdown'], context)).toBe(
      'C:\\Work\\other\\x.markdown',
    );
  });

  it('accepts file: URLs', () => {
    expect(findLaunchFile([exe, 'file:///C:/Docs/My%20File.md'], packaged)).toBe(
      'C:\\Docs\\My File.md',
    );
  });

  it('skips a malformed file: URL instead of throwing', () => {
    expect(findLaunchFile([exe, 'file://%zz', 'C:\\a.md'], packaged)).toBe('C:\\a.md');
  });

  it('prefers a Markdown file over other arguments', () => {
    expect(findLaunchFile([exe, 'C:\\notes.txt', 'C:\\b.md'], packaged)).toBe('C:\\b.md');
  });

  it('still reports an unsupported file so the user is told why it was not opened', () => {
    expect(findLaunchFile([exe, 'C:\\notes.txt'], packaged)).toBe('C:\\notes.txt');
  });

  it('treats everything after -- as a file name', () => {
    const context = { cwd: 'C:\\w', isPackaged: true };
    expect(findLaunchFile([exe, '--', '-odd.md'], context)).toBe('C:\\w\\-odd.md');
  });

  it('ignores empty arguments', () => {
    expect(findLaunchFile([exe, '', 'C:\\a.md'], packaged)).toBe('C:\\a.md');
  });

  it('recognises the extension regardless of case', () => {
    expect(findLaunchFile([exe, 'C:\\x.txt', 'C:\\README.MD'], packaged)).toBe('C:\\README.MD');
  });
});
