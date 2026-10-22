import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface Job {
  'runs-on': string;
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
      'test:e2e',
      'portable-smoke.ps1',
      'installer-test.ps1',
      'checksums',
    ]) {
      expect(stepIndex(build, fragment), fragment).toBeGreaterThan(dist);
    }
    const e2e = build.steps.find((step) => (step.run ?? '').includes('test:e2e'));
    expect(e2e?.env?.['MDREADER_EXE']).toContain('win-unpacked');
  });

  it('hands the installer, the portable executable and the checksums to the publish job', () => {
    const upload = build.steps.find((step) => step.uses?.startsWith('actions/upload-artifact'));
    const paths = upload?.with?.['path'];
    expect(paths).toEqual(expect.stringContaining('release/MDReader-Setup-*.exe'));
    expect(paths).toEqual(expect.stringContaining('release/MDReader-Portable-*.exe'));
    expect(paths).toEqual(expect.stringContaining('release/SHA256SUMS.txt'));
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
    const e2e = job.steps.find((step) => (step.run ?? '').includes('test:e2e'));
    expect(e2e?.env?.['MDREADER_EXE']).toContain('win-unpacked');
  });
});
