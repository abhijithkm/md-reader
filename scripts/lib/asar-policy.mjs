// What a release's app.asar may hold: the compiled app (out/) and its package.json. Everything
// else (sources, tests, dependencies, source maps, environment files) must stay out of it.

const REQUIRED_FILES = [
  'package.json',
  'out/main/index.js',
  'out/preload/index.js',
  'out/renderer/index.html',
];

function normalize(entry) {
  return entry.replaceAll('\\', '/').replace(/^\/+/, '');
}

/**
 * @param {readonly string[]} entries Paths from the archive listing, in any separator style.
 * @returns {string[]} One message per problem; empty when the archive is as expected.
 */
export function checkAsarEntries(entries) {
  const files = entries.map(normalize);
  const problems = [];

  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) problems.push(`missing ${required}`);
  }
  if (!files.some((file) => file.startsWith('out/renderer/assets/') && file.endsWith('.js'))) {
    problems.push('missing the renderer script in out/renderer/assets/');
  }

  for (const file of files) {
    if (file.endsWith('.map')) {
      problems.push(`source map shipped: ${file}`);
    } else if (file.split('/').includes('node_modules')) {
      problems.push(`dependency shipped: ${file}`);
    } else if (file !== 'package.json' && file !== 'out' && !file.startsWith('out/')) {
      problems.push(`unexpected file: ${file}`);
    }
  }
  return problems;
}
