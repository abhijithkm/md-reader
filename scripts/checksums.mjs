#!/usr/bin/env node
// Writes SHA256SUMS.txt for the files of a release in a folder.
//
//   node scripts/checksums.mjs [directory] [output file]
//
// The format is the one `sha256sum -c` reads ("<hash>  <file name>"), so a download can be
// checked on Linux and macOS with that tool, and on Windows with `Get-FileHash` or `certutil`.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

// What a release carries: the installer and the portable executable, which people download, and the
// block map and latest.yml, which installed copies read to update themselves. All four are listed, so
// the publish job can check that none was changed on the way.
const RELEASE_FILE = /^(?:MDReader-.+\.exe(?:\.blockmap)?|latest\.yml)$/;

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function main() {
  const directory = path.resolve(process.argv[2] ?? 'release');
  const output = path.resolve(process.argv[3] ?? path.join(directory, 'SHA256SUMS.txt'));

  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && RELEASE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (names.length === 0) {
    throw new Error(
      `No release files (MDReader-*.exe, their .blockmap files and latest.yml) found in ${directory}`,
    );
  }

  let listing = '';
  for (const name of names) {
    listing += `${await sha256(path.join(directory, name))}  ${name}\n`;
  }
  await writeFile(output, listing);
  process.stdout.write(listing);
}

main().catch((error) => {
  process.stderr.write(`checksums: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
