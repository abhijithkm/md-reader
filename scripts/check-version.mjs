#!/usr/bin/env node
// Guards a release: the version in package.json must be a valid version, and when a tag is
// given it must be `v` followed by exactly that version. Prevents publishing an installer whose
// file name and embedded version disagree with the tag.
//
//   node scripts/check-version.mjs [tag-or-ref] [--package path/to/package.json]
//
// When $GITHUB_OUTPUT is set, writes `version=` and `prerelease=` for later workflow steps.
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Semantic Versioning 2.0.0 without build metadata.
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

function fail(message) {
  process.stderr.write(`check-version: ${message}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  let tag;
  let packageFile = path.resolve(import.meta.dirname, '..', 'package.json');
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--package') {
      const value = argv[index + 1];
      if (value === undefined) fail('--package needs a path');
      packageFile = path.resolve(value);
      index += 1;
    } else if (tag === undefined) {
      tag = argument;
    } else {
      fail(`unexpected argument: ${argument}`);
    }
  }
  return { tag, packageFile };
}

const { tag, packageFile } = parseArguments(process.argv.slice(2));

const version = JSON.parse(readFileSync(packageFile, 'utf8')).version;
if (typeof version !== 'string' || !VERSION.test(version)) {
  fail(`${packageFile} has "${String(version)}", which is not a valid version`);
}

if (tag !== undefined) {
  const name = tag.replace(/^refs\/tags\//, '');
  const match = /^v(.+)$/.exec(name);
  if (match === null || !VERSION.test(match[1])) {
    fail(`"${name}" is not a version tag; expected v<major>.<minor>.<patch>, such as v1.0.0`);
  }
  if (match[1] !== version) {
    fail(
      `tag ${name} does not match the package version ${version}; update package.json or tag again`,
    );
  }
}

const prerelease = version.includes('-');
process.stdout.write(
  `Version ${version}${prerelease ? ' (pre-release)' : ''}${tag === undefined ? '' : ` matches tag ${tag}`}\n`,
);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nprerelease=${prerelease}\n`);
}
