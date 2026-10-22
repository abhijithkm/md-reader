import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.join(process.cwd(), 'src', 'main', 'window.ts'), 'utf8');

/** The text of the `webPreferences: { ... }` literal in createMainWindow. */
function webPreferences(): string {
  const start = source.indexOf('webPreferences: {');
  expect(start, 'createMainWindow sets webPreferences').toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('}', start));
}

describe('main window preferences', () => {
  it.each([
    'contextIsolation: true',
    'nodeIntegration: false',
    'sandbox: true',
    'webSecurity: true',
    'allowRunningInsecureContent: false',
    'spellcheck: false',
  ])('sets %s', (setting) => {
    expect(webPreferences()).toContain(setting);
  });

  it('turns developer tools off in packaged builds', () => {
    expect(webPreferences()).toContain('devTools: !options.isPackaged');
  });

  it('keeps rendering at full speed when the window is minimized or covered', () => {
    // A long document is shown piece by piece from timers, and Chromium slows the timers of a
    // hidden window to about one a second.
    expect(webPreferences()).toContain('backgroundThrottling: false');
  });
});
