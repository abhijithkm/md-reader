/**
 * Problems with the file list of a packaged app.asar. Empty when the archive holds what a
 * release should: the compiled app and its package.json, and nothing else.
 */
export function checkAsarEntries(entries: readonly string[]): string[];
