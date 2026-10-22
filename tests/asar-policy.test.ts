import { describe, expect, it } from 'vitest';
import { checkAsarEntries } from '../scripts/lib/asar-policy.mjs';

/** What `npm run build` plus electron-builder put in app.asar. */
const shipped = [
  'out',
  'out/main',
  'out/main/index.js',
  'out/preload',
  'out/preload/index.js',
  'out/renderer',
  'out/renderer/assets',
  'out/renderer/assets/index-QdjuXZCQ.js',
  'out/renderer/assets/index-pIOPtZdm.css',
  'out/renderer/index.html',
  'package.json',
];

describe('checkAsarEntries', () => {
  it('accepts exactly what the build produces', () => {
    expect(checkAsarEntries(shipped)).toEqual([]);
  });

  it('reads the Windows listing, which uses backslashes and a leading separator', () => {
    const windows = shipped.map((entry) => `\\${entry.replaceAll('/', '\\')}`);
    expect(checkAsarEntries(windows)).toEqual([]);
  });

  it.each(['package.json', 'out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html'])(
    'reports %s when it is missing',
    (missing) => {
      const problems = checkAsarEntries(shipped.filter((entry) => entry !== missing));
      expect(problems).toEqual([expect.stringContaining(missing)]);
    },
  );

  it('reports a renderer that has no script', () => {
    const problems = checkAsarEntries(shipped.filter((entry) => !/assets\/.*\.js$/.test(entry)));
    expect(problems).toEqual([expect.stringContaining('out/renderer/assets')]);
  });

  it.each([
    ['source code', 'src/main/index.ts'],
    ['test files', 'tests/setup/renderer.ts'],
    ['build scripts', 'scripts/installer-test.ps1'],
    ['environment files', '.env'],
    ['dependencies', 'node_modules/react/index.js'],
    ['dependencies inside out', 'out/node_modules/react/index.js'],
  ])('refuses %s', (_label, entry) => {
    expect(checkAsarEntries([...shipped, entry])).toEqual([expect.stringContaining(entry)]);
  });

  it('refuses source maps, which would publish the original source', () => {
    const problems = checkAsarEntries([...shipped, 'out/renderer/assets/index-QdjuXZCQ.js.map']);
    expect(problems).toEqual([expect.stringMatching(/source map.*index-QdjuXZCQ\.js\.map/i)]);
  });
});
