import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeWithRetries } from './support/fixtures';
import { launchApp, type RunningApp } from './support/launch';

// A feed served from this computer is honoured by a development build only: an installed or
// portable copy takes its update source from the package, whatever the environment says.
const developmentBuild = process.env['MDREADER_EXE'] === undefined;

const currentVersion = (
  JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

interface Feed {
  url: string;
  /** Every request the app made, such as "GET /latest.yml". */
  requests: string[];
  /** The headers of those requests, in the same order. */
  requestHeaders: IncomingHttpHeaders[];
  /** How many downloads of the installer the other end gave up on before they were complete. */
  readonly interrupted: number;
  close(): Promise<void>;
}

interface FeedOptions {
  version: string;
  /** The file's hash in latest.yml is not the file's own. */
  corrupt?: boolean;
  /** latest.yml says the installer needs administrator rights, which this app never accepts. */
  adminRights?: boolean;
  /** The feed accepts this many requests and never answers them, as a dead connection would. */
  silentRequests?: number;
  /** Every request is answered with a redirect to the same address, as a broken server might. */
  redirectForever?: boolean;
  /** The installer arrives slowly (about six seconds), so that a test can stop it half way. */
  slowInstaller?: boolean;
}

/**
 * Serves what a GitHub release would: latest.yml, and an "installer" of random bytes (never run, and
 * not a real program).
 */
async function startFeed(options: FeedOptions): Promise<Feed> {
  const installer = randomBytes(64 * 1024);
  const sha512 = createHash('sha512')
    .update(options.corrupt === true ? Buffer.from('something else') : installer)
    .digest('base64');
  const name = `MDReader-Setup-${options.version}.exe`;
  const metadata = [
    `version: ${options.version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${installer.length}`,
    ...(options.adminRights === true ? ['    isAdminRightsRequired: true'] : []),
    `path: ${name}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-10-22T00:00:00.000Z'",
    '',
  ].join('\n');

  const requests: string[] = [];
  const requestHeaders: IncomingHttpHeaders[] = [];
  let silentLeft = options.silentRequests ?? 0;
  let interrupted = 0;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    requests.push(`${request.method ?? 'GET'} ${pathname}`);
    requestHeaders.push(request.headers);
    if (silentLeft > 0) {
      silentLeft -= 1;
      return;
    }
    if (options.redirectForever === true) {
      response.writeHead(302, { location: pathname });
      response.end();
      return;
    }
    if (options.slowInstaller === true && pathname === `/${name}` && request.method === 'GET') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': installer.length,
      });
      const piece = 1024;
      let sent = 0;
      const timer = setInterval(() => {
        if (sent >= installer.length) {
          clearInterval(timer);
          response.end();
          return;
        }
        response.write(installer.subarray(sent, sent + piece));
        sent += piece;
      }, 100);
      response.on('close', () => {
        clearInterval(timer);
        if (sent < installer.length) interrupted += 1;
      });
      return;
    }
    if (pathname === '/latest.yml') {
      response.writeHead(200, { 'content-type': 'text/yaml' });
      response.end(metadata);
    } else if (pathname === `/${name}`) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': installer.length,
      });
      response.end(request.method === 'HEAD' ? undefined : installer);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    requestHeaders,
    get interrupted() {
      return interrupted;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

let userDataDir: string;
let cacheDir: string;
let app: RunningApp | undefined;
let feed: Feed | undefined;

const SETTINGS_READ = {
  theme: 'light',
  zoom: 1,
  automaticUpdates: true,
  updateNoticeSeen: true,
};

/** The wait before the first check when a test does not want one: far longer than any test. */
const NO_CHECK_BY_ITSELF = '600000';
/** A short wait, for the tests of the schedule itself. */
const CHECK_SOON = '500';

beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-e2e-profile-'));
  // Where the update library keeps what it downloads, kept away from the real one.
  cacheDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-e2e-cache-'));
  // The one-time explanation of updates would otherwise be in front of what a test looks at.
  await writeFile(path.join(userDataDir, 'settings.json'), JSON.stringify(SETTINGS_READ));
});

afterEach(async () => {
  await app?.kill();
  app = undefined;
  await feed?.close();
  feed = undefined;
  await removeWithRetries(userDataDir);
  await removeWithRetries(cacheDir);
});

/**
 * Starts the app with updating pointed at a feed on this computer. Unless a test says otherwise the
 * app does not look by itself, so that what a test sees comes only from what the test does.
 */
function launchWithFeed(
  url: string,
  firstCheckAfterMs: string = NO_CHECK_BY_ITSELF,
  extraEnvironment: Record<string, string> = {},
): Promise<RunningApp> {
  return launchApp({
    userDataDir,
    env: {
      MDREADER_UPDATES: 'on',
      MDREADER_UPDATE_FEED: url,
      MDREADER_UPDATE_FIRST_CHECK_MS: firstCheckAfterMs,
      LOCALAPPDATA: cacheDir,
      ...extraEnvironment,
    },
  });
}

async function waitForStartScreen(running: RunningApp): Promise<void> {
  await running.page
    .getByRole('heading', { name: 'Open a Markdown file' })
    .waitFor({ state: 'visible', timeout: 20_000 });
}

const updatesPanel = (running: RunningApp) => running.page.getByRole('region', { name: 'Updates' });

const READY = 'MD Reader 99.0.0 is ready. It installs when you close the app.';

async function savedSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(userDataDir, 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** Settings are written a moment after a click; wait until they say what the test expects. */
async function waitForSaved(
  isSaved: (settings: Record<string, unknown>) => boolean,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const settings = await savedSettings().catch(() => ({}));
    if (isSaved(settings)) return;
    if (Date.now() > deadline) throw new Error('The settings were not saved in time.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Waits until update.log in the profile folder has a line that matches, and returns its text. */
async function waitForLog(pattern: RegExp): Promise<string> {
  const file = path.join(userDataDir, 'update.log');
  const deadline = Date.now() + 10_000;
  for (;;) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (pattern.test(text)) return text;
    if (Date.now() > deadline) {
      throw new Error(`update.log never matched ${String(pattern)}. It holds:\n${text}`);
    }
    await pause(100);
  }
}

describe('updates', () => {
  it('has no Updates section when updates are disabled from the environment, and the main process says so', async () => {
    app = await launchApp({ userDataDir });
    await waitForStartScreen(app);

    // Ask the main process rather than only look at the page, which may not have heard yet.
    const state = await app.page.evaluate(() =>
      (
        window as unknown as { mdReader: { getUpdateState(): Promise<unknown> } }
      ).mdReader.getUpdateState(),
    );

    expect(state).toEqual({ status: 'unavailable', reason: 'disabled' });
    expect(await updatesPanel(app).count()).toBe(0);
  });
});

// What only a packaged app shows: the update library is built into the package and reads the update
// configuration from inside it. Every request is sent to a proxy that refuses it, so nothing outside
// is reached and the check has to end in an error. That is what is expected: the app tried, did not
// hang, said so, and left a record. Whether a real release is found is for the beta rehearsal.
describe.skipIf(developmentBuild)('updating in a packaged app', () => {
  it('tries to check, fails cleanly when nothing can be reached, and writes down why', async () => {
    app = await launchApp({
      userDataDir,
      extraArgs: ['--proxy-server=127.0.0.1:1'],
      env: {
        MDREADER_UPDATES: 'on',
        MDREADER_UPDATE_FIRST_CHECK_MS: NO_CHECK_BY_ITSELF,
        LOCALAPPDATA: cacheDir,
      },
    });
    await waitForStartScreen(app);
    const panel = updatesPanel(app);
    await panel.getByText(`Version ${currentVersion}`).waitFor();

    await panel.getByRole('button', { name: 'Check for updates' }).click();

    await panel
      .getByText('MD Reader could not check for or download an update. Try again later.')
      .waitFor({ state: 'visible', timeout: 30_000 });
    expect(await panel.getByText(/is ready/).count()).toBe(0);
    await waitForLog(/^\S+ error /m);
  });
});

describe.skipIf(!developmentBuild)('updates from a feed on this computer', () => {
  it('finds a newer version, downloads it, checks it against its hash and announces it', async () => {
    feed = await startFeed({ version: '99.0.0' });
    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    const panel = updatesPanel(app);
    await panel.getByText('Automatic updates are on.', { exact: false }).waitFor();
    await panel.getByText(`Version ${currentVersion}`).waitFor();

    await panel.getByRole('button', { name: 'Check for updates' }).click();

    await panel.getByText(READY).waitFor({ state: 'visible', timeout: 30_000 });
    await app.page
      .locator('.notice-message', { hasText: 'MD Reader 99.0.0 is ready' })
      .waitFor({ state: 'visible' });
    expect(feed.requests).toContain('GET /latest.yml');
    expect(feed.requests).toContain('GET /MDReader-Setup-99.0.0.exe');
    // What it did is on record in the profile folder, for the day an update does not arrive.
    const log = await waitForLog(/Found version 99\.0\.0/);
    expect(log).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z info {2}Checking for update/m);
  });

  it('sends no identifier of this installation, although the library keeps one in the profile', async () => {
    feed = await startFeed({ version: '99.0.0' });
    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    const panel = updatesPanel(app);
    await panel.getByRole('button', { name: 'Check for updates' }).click();
    await panel.getByText(READY).waitFor({ state: 'visible', timeout: 30_000 });

    // The library writes a random id the first time it looks, and would send it with every request.
    const id = (await readFile(path.join(userDataDir, '.updaterId'), 'utf8')).trim();

    expect(id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(feed.requestHeaders.length).toBeGreaterThanOrEqual(2);
    for (const headers of feed.requestHeaders) {
      expect(headers['x-user-staging-id']).toBe('unset');
      expect(JSON.stringify(headers)).not.toContain(id);
    }
  });

  it('never runs what it downloaded while a test feed is in use, even when asked to restart', async () => {
    feed = await startFeed({ version: '99.0.0' });
    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    const panel = updatesPanel(app);
    await panel.getByRole('button', { name: 'Check for updates' }).click();
    await panel.getByText(READY).waitFor({ state: 'visible', timeout: 30_000 });

    await panel.getByRole('button', { name: 'Restart now' }).click();
    await pause(1500);

    expect(app.child.exitCode).toBeNull();
    expect(await app.page.getByRole('heading', { name: 'Open a Markdown file' }).isVisible()).toBe(
      true,
    );
  });

  it('refuses a download that does not match the hash in the update file', async () => {
    feed = await startFeed({ version: '99.0.0', corrupt: true });
    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    const panel = updatesPanel(app);

    await panel.getByRole('button', { name: 'Check for updates' }).click();

    await panel
      .getByText('MD Reader could not check for or download an update. Try again later.')
      .waitFor({ state: 'visible', timeout: 30_000 });
    expect(await panel.getByText(/is ready/).count()).toBe(0);
    expect(await app.page.getByRole('button', { name: 'Restart now' }).count()).toBe(0);
  });

  it('refuses an update that asks for administrator rights, and downloads nothing', async () => {
    feed = await startFeed({ version: '99.0.0', adminRights: true });
    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    const panel = updatesPanel(app);

    await panel.getByRole('button', { name: 'Check for updates' }).click();

    await panel
      .getByText('MD Reader could not check for or download an update. Try again later.')
      .waitFor({ state: 'visible', timeout: 30_000 });
    expect(feed.requests).toContain('GET /latest.yml');
    expect(feed.requests).not.toContain('GET /MDReader-Setup-99.0.0.exe');
    expect(feed.requests).not.toContain('HEAD /MDReader-Setup-99.0.0.exe');
    // The reason is on record too.
    await waitForLog(
      /error\s+The update server offered something this app does not accept: .*administrator rights/,
    );
  });

  // Electron's network stack never gives up on a server that accepts a request and says nothing,
  // and neither did the update library: the check stayed "Checking for updates…" for ever, and
  // every later check was handed the same stuck one. A short limit (the app uses a minute) stands in
  // for the real one here. It applies to every request of the test, so it is long enough that a slow
  // computer pausing the app or this process for a moment does not fail a request that is answered.
  it('gives up on a feed that stops answering, says so, and works again once it answers', async () => {
    feed = await startFeed({ version: '99.0.0', silentRequests: 1 });
    app = await launchWithFeed(feed.url, NO_CHECK_BY_ITSELF, {
      MDREADER_UPDATE_REQUEST_TIMEOUT_MS: '4000',
    });
    await waitForStartScreen(app);
    const panel = updatesPanel(app);

    await panel.getByRole('button', { name: 'Check for updates' }).click();
    await panel.getByText('Checking for updates…').waitFor({ state: 'visible' });
    // Even while it waits, the reader can turn updating off.
    expect(
      await panel.getByRole('button', { name: 'Turn off automatic updates' }).isVisible(),
    ).toBe(true);
    await panel
      .getByText('MD Reader could not check for or download an update. Try again later.')
      .waitFor({ state: 'visible', timeout: 20_000 });

    // A failure is held for five seconds, so a retry is not answered with the failure it follows.
    await pause(5500);
    await panel.getByRole('button', { name: 'Check again' }).click();

    await panel.getByText(READY).waitFor({ state: 'visible', timeout: 30_000 });
    expect(feed.requests.filter((request) => request === 'GET /latest.yml')).toHaveLength(2);
  });

  // The update library says it stops after ten redirects but does not, and Electron never stops a
  // loop by itself: a server that redirected to itself kept it busy, and the check never ended.
  it('gives up on a feed that redirects for ever, and says so', async () => {
    feed = await startFeed({ version: '99.0.0', redirectForever: true });
    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    const panel = updatesPanel(app);

    await panel.getByRole('button', { name: 'Check for updates' }).click();

    await panel
      .getByText('MD Reader could not check for or download an update. Try again later.')
      .waitFor({ state: 'visible', timeout: 20_000 });
    await pause(1000);
    // The first request, and no more than ten redirects after it.
    expect(feed.requests.length).toBeLessThanOrEqual(11);
    await waitForLog(/More than 10 redirects in a row/);
  });

  it('stops a download that is under way when the reader switches updating off', async () => {
    feed = await startFeed({ version: '99.0.0', slowInstaller: true });
    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    const panel = updatesPanel(app);
    await panel.getByRole('button', { name: 'Check for updates' }).click();
    await panel.getByText(/Downloading MD Reader 99\.0\.0/).waitFor({ state: 'visible' });

    await panel.getByRole('button', { name: 'Turn off automatic updates' }).click();

    await panel.getByText('Automatic updates are off.').waitFor({ state: 'visible' });
    // The far end sees the connection go before the file is complete, and nothing is announced.
    const deadline = Date.now() + 10_000;
    while (feed.interrupted === 0 && Date.now() < deadline) await pause(100);
    expect(feed.interrupted).toBe(1);
    await pause(3500);
    expect(await panel.getByText(/is ready/).count()).toBe(0);
    expect(await panel.getByText('Automatic updates are off.').count()).toBe(1);
  });

  it('says so when the feed has nothing newer', async () => {
    feed = await startFeed({ version: '0.0.1' });
    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    const panel = updatesPanel(app);

    await panel.getByRole('button', { name: 'Check for updates' }).click();

    await panel
      .getByText(`MD Reader ${currentVersion} is up to date.`)
      .waitFor({ state: 'visible', timeout: 30_000 });
    expect(feed.requests).not.toContain('GET /MDReader-Setup-0.0.1.exe');
  });

  it('does not ask the feed again when asked to check again a moment later', async () => {
    feed = await startFeed({ version: '0.0.1' });
    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    const panel = updatesPanel(app);
    await panel.getByRole('button', { name: 'Check for updates' }).click();
    await panel
      .getByText(`MD Reader ${currentVersion} is up to date.`)
      .waitFor({ state: 'visible', timeout: 30_000 });
    const asked = feed.requests.length;

    await panel.getByRole('button', { name: 'Check again' }).click();
    await pause(1500);

    expect(feed.requests).toHaveLength(asked);
    await panel
      .getByText(`MD Reader ${currentVersion} is up to date.`)
      .waitFor({ state: 'visible' });
  });

  describe('looking by itself', () => {
    it('looks shortly after starting, and downloads what it finds, without being asked', async () => {
      feed = await startFeed({ version: '99.0.0' });
      app = await launchWithFeed(feed.url, CHECK_SOON);
      await waitForStartScreen(app);

      await updatesPanel(app).getByText(READY).waitFor({ state: 'visible', timeout: 30_000 });

      expect(feed.requests).toContain('GET /latest.yml');
      expect(feed.requests).toContain('GET /MDReader-Setup-99.0.0.exe');
    });

    it('switches off, stays off after a restart, and then does not look by itself', async () => {
      feed = await startFeed({ version: '99.0.0' });
      app = await launchWithFeed(feed.url);
      await waitForStartScreen(app);

      await updatesPanel(app).getByRole('button', { name: 'Turn off automatic updates' }).click();
      await updatesPanel(app).getByText('Automatic updates are off.').waitFor();
      await waitForSaved((settings) => settings['automaticUpdates'] === false);
      await app.close();

      // This time the app would look within half a second, if it were still allowed to.
      app = await launchWithFeed(feed.url, CHECK_SOON);
      await waitForStartScreen(app);
      await updatesPanel(app).getByText('Automatic updates are off.').waitFor();
      await pause(3000);

      expect(feed.requests).toEqual([]);
    });

    it('starts looking by itself when it is switched on again', async () => {
      feed = await startFeed({ version: '99.0.0' });
      await writeFile(
        path.join(userDataDir, 'settings.json'),
        JSON.stringify({ ...SETTINGS_READ, automaticUpdates: false }),
      );
      app = await launchWithFeed(feed.url, CHECK_SOON);
      await waitForStartScreen(app);
      await updatesPanel(app).getByText('Automatic updates are off.').waitFor();
      await pause(2000);
      expect(feed.requests).toEqual([]);

      await updatesPanel(app).getByRole('button', { name: 'Turn on automatic updates' }).click();

      await updatesPanel(app).getByText(READY).waitFor({ state: 'visible', timeout: 30_000 });
      await waitForSaved((settings) => settings['automaticUpdates'] === true);
      expect(feed.requests).toContain('GET /latest.yml');
    });
  });

  it('explains automatic updates once, and not again after the reader has seen it', async () => {
    feed = await startFeed({ version: '99.0.0' });
    await writeFile(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({ ...SETTINGS_READ, updateNoticeSeen: false }),
    );
    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    const explanation = app.page.getByText(/no information from your documents or settings/);
    await explanation.waitFor({ state: 'visible' });

    await app.page.getByRole('button', { name: 'OK' }).click();

    await explanation.waitFor({ state: 'hidden' });
    await waitForSaved((settings) => settings['updateNoticeSeen'] === true);
    await app.close();

    app = await launchWithFeed(feed.url);
    await waitForStartScreen(app);
    await updatesPanel(app).waitFor({ state: 'visible' });
    expect(await app.page.getByText(/no information from your documents or settings/).count()).toBe(
      0,
    );
  });
});
