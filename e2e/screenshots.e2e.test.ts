import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { createWorkspace, removeWithRetries, type Workspace } from './support/fixtures';
import { launchApp, type RunningApp } from './support/launch';

// Regenerates the screenshots used in the README from the real application:
//   $env:MDREADER_SCREENSHOTS = '1'; npm run test:e2e -- screenshots   (PowerShell)
const enabled = process.env['MDREADER_SCREENSHOTS'] === '1';
const outputDir =
  process.env['MDREADER_SCREENSHOT_DIR'] ?? path.join(process.cwd(), 'docs', 'screenshots');

let workspace: Workspace;
let userDataDir: string;
let app: RunningApp | undefined;

/** Parks the pointer on the document first, so no button is shown in its hover state. */
async function capture(page: Page, fileName: string): Promise<void> {
  await page.mouse.move(300, 400);
  await page.screenshot({ path: path.join(outputDir, fileName) });
}

beforeEach(async () => {
  workspace = await createWorkspace();
  userDataDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-e2e-profile-'));
});

afterEach(async () => {
  await app?.kill();
  app = undefined;
  await removeWithRetries(userDataDir);
  await workspace.cleanup();
});

describe.runIf(enabled)('screenshots', () => {
  it('captures the empty state, a document in light and dark, and a narrow window', async () => {
    await mkdir(outputDir, { recursive: true });
    const sample = path.join(workspace.root, 'Welcome to MD Reader.md');
    await copyFile(path.join(process.cwd(), 'docs', 'sample.md'), sample);

    // Empty state, light theme (the default for a fresh profile follows the OS; force light). The
    // packaged app shows its Updates section only when updating is not switched off, and the
    // explanation of updates is marked as read so that it is not in front of the start screen.
    // With updating on, a packaged app that stayed open long enough would look for a newer version
    // and, finding one, download it and install it when it closed. So the first check is put a day
    // away: taking pictures can never update the copy that takes them.
    await writeFile(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({ theme: 'system', zoom: 1, automaticUpdates: true, updateNoticeSeen: true }),
    );
    app = await launchApp({
      userDataDir,
      env: { MDREADER_UPDATES: 'on', MDREADER_UPDATE_FIRST_CHECK_MS: '86400000' },
    });
    const { page } = app;
    // Tall enough for the whole start screen, including the Updates section at the bottom.
    await page.setViewportSize({ width: 1100, height: 880 });
    await page.getByRole('heading', { name: 'Open a Markdown file' }).waitFor();
    // Only a packaged build has one; a development build starts with updates unavailable.
    await page
      .getByRole('region', { name: 'Updates' })
      .waitFor({ timeout: 5_000 })
      .catch(() => undefined);
    if ((await page.evaluate(() => document.documentElement.dataset['theme'])) === 'dark') {
      await page.getByRole('button', { name: 'Switch to light theme' }).click();
    }
    await capture(page, 'empty-state.png');
    await app.close();

    // The sample document, light.
    app = await launchApp({ userDataDir, files: [sample] });
    await app.page.setViewportSize({ width: 1100, height: 720 });
    await app.page.getByRole('heading', { name: 'Welcome to MD Reader' }).waitFor();
    await app.page.getByText(/\d+ words/).waitFor();
    await capture(app.page, 'document-light.png');

    // Dark.
    await app.page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await capture(app.page, 'document-dark.png');

    // Narrow window.
    await app.page.setViewportSize({ width: 520, height: 720 });
    await capture(app.page, 'narrow-dark.png');

    // The whole sample document in one tall frame, light, for reviewing every element.
    await app.page.getByRole('button', { name: 'Switch to light theme' }).click();
    await app.page.setViewportSize({ width: 1100, height: 1780 });
    await capture(app.page, 'document-full-light.png');
  });
});

describe.skipIf(enabled)('screenshots', () => {
  it.skip('are only regenerated on request (set MDREADER_SCREENSHOTS=1)', () => undefined);
});
