import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  id?: string; // how later steps name the outputs of this one
  name?: string; // shown in the Actions log
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface Job {
  'runs-on': string;
  outputs?: Record<string, string>;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  steps: Step[];
}

interface Workflow {
  on: {
    push?: { tags?: string[]; branches?: string[] };
    pull_request?: unknown;
    workflow_dispatch?: unknown;
  };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const workflowsDir = path.join(process.cwd(), '.github', 'workflows');
const source = (file: string): string => readFileSync(path.join(workflowsDir, file), 'utf8');
const load = (file: string): Workflow => parse(source(file)) as Workflow;

const release = load('release.yml');
const ci = load('ci.yml');
const workflows = { 'release.yml': release, 'ci.yml': ci };

const needsOf = (job: Job): string[] => [job.needs ?? []].flat();
const stepIndex = (job: Job, fragment: string): number =>
  job.steps.findIndex((step) => (step.run ?? '').includes(fragment));

/**
 * The steps that run the end-to-end tests against a built app. The step that starts the app from the
 * repository, to try updating against a feed on this computer, names no built app.
 */
const packagedE2eSteps = (job: Job): Step[] =>
  job.steps.filter(
    (step) => (step.run ?? '').includes('test:e2e') && step.env?.['MDREADER_EXE'] !== undefined,
  );

/** Only a development build honours a feed on this computer, so that step must not name a built app. */
function expectUpdateTestsBetween(job: Job, after: string, before: string): void {
  const step = job.steps.find((candidate) => (candidate.run ?? '').includes('test:e2e -- updates'));
  expect(step, 'a step that runs the update tests').toBeDefined();
  expect(step?.env?.['MDREADER_EXE']).toBeUndefined();
  const index = stepIndex(job, 'test:e2e -- updates');
  expect(index).toBeGreaterThan(stepIndex(job, after));
  expect(index).toBeLessThan(stepIndex(job, before));
}

describe('release workflow', () => {
  const build = release.jobs['build'] as Job;
  const publish = release.jobs['publish'] as Job;

  it('runs when a version tag is pushed', () => {
    expect(release.on.push?.tags).toEqual(['v*']);
  });

  it('is read-only by default and writes to the repository only in the publish job', () => {
    expect(release.permissions).toEqual({ contents: 'read' });
    const writers = Object.entries(release.jobs)
      .filter(([, job]) => job.permissions?.['contents'] === 'write')
      .map(([name]) => name);
    expect(writers).toEqual(['publish']);
  });

  it('publishes only after the build and validation succeeded, and only for a tag', () => {
    expect(needsOf(publish)).toContain('build');
    expect(publish.if).toContain("startsWith(github.ref, 'refs/tags/v')");
  });

  it('builds on Windows', () => {
    expect(build['runs-on']).toBe('windows-latest');
  });

  it('installs exactly what the lockfile says', () => {
    expect(stepIndex(build, 'npm ci')).toBeGreaterThanOrEqual(0);
    expect(source('release.yml')).not.toMatch(/npm install\b/);
  });

  it('validates before it packages: tag, lint, format, types, tests, build, then the installer', () => {
    const order = [
      'check-version',
      'npm run lint',
      'npm run format:check',
      'npm run typecheck',
      'npm test',
      'npm run build',
      'npm run dist',
    ].map((fragment) => stepIndex(build, fragment));

    expect(
      order.every((index) => index >= 0),
      `all present: ${order.join(', ')}`,
    ).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('checks the packaged app, the portable executable, the installer and the checksums before anything can be published', () => {
    const dist = stepIndex(build, 'npm run dist');
    for (const fragment of [
      'verify:release',
      'portable-smoke.ps1',
      'installer-test.ps1',
      'checksums',
    ]) {
      expect(stepIndex(build, fragment), fragment).toBeGreaterThan(dist);
    }
    // Once against the unpacked app, and once against the installed one.
    const packaged = packagedE2eSteps(build);
    expect(packaged).toHaveLength(2);
    for (const step of packaged) expect(build.steps.indexOf(step)).toBeGreaterThan(dist);
    expect(packaged[0]?.env?.['MDREADER_EXE']).toContain('win-unpacked');
  });

  it('tries the whole update flow against a feed on this computer, after the build and before anything is packaged', () => {
    expectUpdateTestsBetween(build, 'npm run build', 'npm run dist');
  });

  // `--unpacked-only` skips the update configuration, latest.yml and the blockmap, the files that
  // every installed copy relies on. It is for the build that makes no installer.
  it('verifies the installer and the update files of the release, not only the unpacked app', () => {
    const verify = build.steps.find((step) => (step.run ?? '').includes('verify:release'));
    expect(verify, 'a step that verifies the release').toBeDefined();
    expect(verify?.run).not.toContain('--unpacked-only');
  });

  // Without the older installer the run would be a fresh install, which is not how an update goes.
  it('installs the new version over an older one, as an update does', () => {
    const install = build.steps.find((step) => step.id === 'install');
    expect(install, 'the step that installs').toBeDefined();
    expect(install?.run).toContain('-PreviousInstaller');
    expect(install?.run).toContain('release/previous/MDReader-Setup-0.0.1.exe');
    const older = stepIndex(build, '--config.extraMetadata.version=0.0.1');
    expect(older, 'a step that builds the older installer').toBeGreaterThanOrEqual(0);
    expect(older).toBeLessThan(install === undefined ? -1 : build.steps.indexOf(install));
  });

  // If the path were empty the tests would start the development build, which always passes.
  it('runs the end-to-end tests against the app that was installed, as named by the installing step', () => {
    const install = build.steps.find((step) => step.id === 'install');
    const installed = packagedE2eSteps(build)[1];
    expect(installed?.env?.['MDREADER_EXE']).toBe('${{ steps.install.outputs.exe }}');
    expect(build.steps.indexOf(installed as Step)).toBeGreaterThan(
      install === undefined ? Infinity : build.steps.indexOf(install),
    );
    // The step names its output `exe`, the way the script writes it.
    const script = readFileSync(path.join(process.cwd(), 'scripts', 'installer-test.ps1'), 'utf8');
    expect(script).toContain('"exe=$exe" | Out-File -FilePath $env:GITHUB_OUTPUT');
  });

  it('hands the installer, the portable executable, the checksums and the update files to the publish job', () => {
    const upload = build.steps.find((step) => step.uses?.startsWith('actions/upload-artifact'));
    const paths = upload?.with?.['path'];
    expect(paths).toEqual(expect.stringContaining('release/MDReader-Setup-*.exe\n'));
    expect(paths).toEqual(expect.stringContaining('release/MDReader-Portable-*.exe'));
    expect(paths).toEqual(expect.stringContaining('release/SHA256SUMS.txt'));
    // Installed copies read latest.yml and the blockmap to update themselves.
    expect(paths).toEqual(expect.stringContaining('release/MDReader-Setup-*.exe.blockmap'));
    expect(paths).toEqual(expect.stringContaining('release/latest.yml'));
  });

  it('attaches the update files to the release, so the release is complete the moment it is public', () => {
    const create = publish.steps.find((step) => (step.run ?? '').includes('gh release create'));
    const command = create?.run ?? '';
    // The release notes written just above name these files too, so look at the command alone.
    const createCommand = command.slice(command.indexOf('gh release create'));
    expect(createCommand).toContain('latest.yml');
    expect(createCommand).toContain('MDReader-Setup-*.exe.blockmap');
    // `gh release create` publishes only after every file is uploaded; a draft of the release
    // would otherwise show a version without the file that tells copies how to update.
    expect(command).not.toContain('--draft=false');
    expect(command).not.toMatch(/gh release edit/);
  });

  // The library offers a copy of a final release only the release GitHub calls the latest, and that
  // is never a pre-release. A beta created without the flag would become the latest and be offered
  // to everyone, which is the one thing the beta label is there to prevent.
  it('publishes a beta as a pre-release, so that copies of a final release are never offered it', () => {
    expect(build.outputs?.['prerelease']).toBe('${{ steps.version.outputs.prerelease }}');
    const create = publish.steps.find((step) => (step.run ?? '').includes('gh release create'));
    expect(create?.env?.['PRERELEASE']).toBe('${{ needs.build.outputs.prerelease }}');
    const script = create?.run ?? '';
    expect(script).toMatch(
      /if \[ "\$PRERELEASE" = "true" \]; then\s+flags\+=\(--prerelease\)\s+fi/,
    );
    expect(script.slice(script.indexOf('gh release create'))).toContain('"${flags[@]}"');
  });

  it('verifies the downloaded files and creates the release with generated notes', () => {
    const commands = publish.steps.map((step) => step.run ?? '').join('\n');
    expect(commands).toContain('sha256sum');
    expect(commands).toContain('gh release create');
    expect(commands).toContain('--generate-notes');
    expect(commands).toContain('--verify-tag');
  });

  it('uses only the built-in token and never overwrites or deletes existing releases or tags', () => {
    const text = source('release.yml');
    const secrets = [...text.matchAll(/secrets\.(\w+)/g)].map((match) => match[1]);
    expect(secrets.every((name) => name === 'GITHUB_TOKEN')).toBe(true);
    expect(text).not.toMatch(
      /--clobber|release delete|push --force|push -f\b|tag -d\b|tag --delete/,
    );
  });
});

describe.each(Object.entries(workflows))('%s', (file, workflow) => {
  it('pins every action to a full commit SHA, so a moved tag cannot change what runs', () => {
    const uses = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .map((step) => step.uses)
      .filter((value): value is string => value !== undefined);

    expect(uses.length, `${file} uses actions`).toBeGreaterThan(0);
    for (const action of uses) expect(action, action).toMatch(/@[0-9a-f]{40}$/);
  });

  it('hands values to scripts through environment variables, not by pasting expressions into the script text', () => {
    // A tag or branch name is attacker-controlled text; inside a script it would be code.
    const scripts = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .map((step) => step.run)
      .filter((run): run is string => run !== undefined);

    expect(scripts.length, `${file} runs scripts`).toBeGreaterThan(0);
    for (const script of scripts) expect(script).not.toContain('${{');
  });

  it('never exposes credentials to jobs that run on pull requests', () => {
    if (workflow.on.pull_request === undefined) return;
    expect(JSON.stringify(workflow)).not.toMatch(/secrets\./);
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });
});

describe('ci workflow', () => {
  const job = ci.jobs['check'] as Job;

  it('runs for pushes to main and for pull requests', () => {
    expect(ci.on.push?.branches).toEqual(['main']);
    expect(ci.on.pull_request).toBeDefined();
  });

  it('runs the same validation on Windows and exercises the packaged app', () => {
    expect(job['runs-on']).toBe('windows-latest');
    for (const fragment of [
      'npm ci',
      'npm run lint',
      'npm run typecheck',
      'npm test',
      'npm run build',
      'npm run pack',
      'test:e2e',
    ]) {
      expect(stepIndex(job, fragment), fragment).toBeGreaterThanOrEqual(0);
    }
    const packaged = packagedE2eSteps(job);
    expect(packaged).toHaveLength(1);
    expect(packaged[0]?.env?.['MDREADER_EXE']).toContain('win-unpacked');
  });

  it('tries the whole update flow against a feed on this computer, after the build and before anything is packaged', () => {
    expectUpdateTestsBetween(job, 'npm run build', 'npm run pack');
  });

  // The installer and the update files are not built here, so a check that asks for them would fail.
  it('verifies only the unpacked app, which is all it builds', () => {
    const verify = job.steps.find((step) => (step.run ?? '').includes('verify:release'));
    expect(verify?.run).toContain('--unpacked-only');
  });
});
