import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeWithRetries } from './support/fixtures';
import { launchApp, type RunningApp } from './support/launch';

let userDataDir: string;
let app: RunningApp | undefined;

beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-e2e-profile-'));
});

afterEach(async () => {
  await app?.kill();
  app = undefined;
  await removeWithRetries(userDataDir);
});

describe('saved settings', () => {
  it('remembers the theme and zoom level after the app is closed and started again', async () => {
    app = await launchApp({ userDataDir });
    await app.page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await app.page.keyboard.press('Control+Equal');
    await app.page.keyboard.press('Control+Equal');
    expect(await app.page.getByRole('status').innerText()).toBe('125%');
    await app.close();

    app = await launchApp({ userDataDir });
    await app.page.getByRole('status').waitFor({ state: 'visible', timeout: 20_000 });

    expect(await app.page.getByRole('status').innerText()).toBe('125%');
    expect(await app.page.evaluate(() => document.documentElement.dataset['theme'])).toBe('dark');
    expect(JSON.parse(await readFile(path.join(userDataDir, 'settings.json'), 'utf8'))).toEqual({
      theme: 'dark',
      zoom: 1.25,
      automaticUpdates: true,
      updateNoticeSeen: false,
    });
  });

  it('starts normally when the saved settings are damaged', async () => {
    await writeFile(path.join(userDataDir, 'settings.json'), '{ this is not json');

    app = await launchApp({ userDataDir });

    await app.page.getByRole('status').waitFor({ state: 'visible', timeout: 20_000 });
    expect(await app.page.getByRole('status').innerText()).toBe('100%');
  });

  it('paints the window in the saved theme before the page loads, so dark mode never flashes white', async () => {
    await writeFile(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({ theme: 'dark', zoom: 1 }),
    );

    app = await launchApp({ userDataDir });
    await app.page.getByRole('status').waitFor({ state: 'visible', timeout: 20_000 });

    const background = await app.page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(background).toBe('rgb(31, 31, 31)');
  });
});
