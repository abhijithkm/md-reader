import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, removeWithRetries, type Workspace } from './support/fixtures';
import { launchApp, launchSecondInstance, type RunningApp } from './support/launch';

let workspace: Workspace;
let userDataDir: string;
let app: RunningApp | undefined;

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

const sessionFile = (): string => path.join(userDataDir, 'session.json');
const exists = (file: string): Promise<boolean> =>
  stat(file).then(
    () => true,
    () => false,
  );

async function heading(page: Page, name: string, timeoutMs = 20_000): Promise<void> {
  await page.getByRole('heading', { name }).waitFor({ state: 'visible', timeout: timeoutMs });
}

const tabNames = (page: Page): Promise<string[]> => page.getByRole('tab').allInnerTexts();

/** Waits until the tabs say what the test expects: they change a moment after the keys are pressed. */
async function expectTabs(page: Page, expected: string[]): Promise<void> {
  await expect.poll(() => tabNames(page), { timeout: 15_000 }).toEqual(expected);
}

async function openApp(...files: string[]): Promise<RunningApp> {
  app = await launchApp({ userDataDir, files });
  return app;
}

/** Waits for a condition that depends on a file the app writes a moment after something changed. */
async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (accept(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

const readJson = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(file, 'utf8')) as unknown;

describe('tabs', () => {
  it('keeps the first document open when a second launch brings another, and switches between them', async () => {
    const first = await workspace.write('first.md', '# First document');
    const second = await workspace.write('second.md', '# Second document');
    const { page } = await openApp(first);
    await heading(page, 'First document');

    await launchSecondInstance({ userDataDir, files: [second] });
    await heading(page, 'Second document');
    expect(await tabNames(page)).toEqual(['first.md', 'second.md']);
    expect(await page.getByRole('tab', { name: 'second.md' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    await page.getByRole('tab', { name: 'first.md' }).click();
    await heading(page, 'First document');
    expect(await page.title()).toBe('first.md — MD Reader');
    expect(await page.getByRole('heading', { name: 'Second document' }).count()).toBe(0);
  });

  it('shows the tab that already has a file, instead of opening it a second time', async () => {
    const first = await workspace.write('first.md', '# First document');
    const second = await workspace.write('second.md', '# Second document');
    const { page } = await openApp(first);
    await launchSecondInstance({ userDataDir, files: [second] });
    await heading(page, 'Second document');

    await launchSecondInstance({ userDataDir, files: [first] });

    await heading(page, 'First document');
    expect(await tabNames(page)).toEqual(['first.md', 'second.md']);
  });

  it('keeps where the reader was in each tab', async () => {
    const filler = 'Filler paragraph.\n\n'.repeat(300);
    const first = await workspace.write('first.md', `# First document\n\n${filler}`);
    const second = await workspace.write('second.md', `# Second document\n\n${filler}`);
    const { page } = await openApp(first);
    await heading(page, 'First document');
    // The app remembers where the reader is only once they have acted on the document (the wheel here),
    // and not where it was put by the app itself, so a nudge of the wheel comes first.
    const scrollTo = async (top: number) => {
      const box = await page.locator('.document-scroll').boundingBox();
      if (box !== null) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 1);
      await page.evaluate((to) => {
        const scroller = document.querySelector('.document-scroll');
        if (scroller !== null) scroller.scrollTop = to;
      }, top);
    };
    const scrolled = (top: number) =>
      page.waitForFunction(
        (to) => Math.abs((document.querySelector('.document-scroll')?.scrollTop ?? -1) - to) < 4,
        top,
        { timeout: 15_000 },
      );

    await scrollTo(900);
    await scrolled(900);
    await launchSecondInstance({ userDataDir, files: [second] });
    await heading(page, 'Second document');
    await scrollTo(400);
    await scrolled(400);

    await page.getByRole('tab', { name: 'first.md' }).click();
    await heading(page, 'First document');
    await scrolled(900);

    await page.getByRole('tab', { name: 'second.md' }).click();
    await heading(page, 'Second document');
    await scrolled(400);
  });

  it('steps through the tabs with Ctrl+Tab and Ctrl+Shift+Tab', async () => {
    const a = await workspace.write('a.md', '# Document A');
    const b = await workspace.write('b.md', '# Document B');
    const c = await workspace.write('c.md', '# Document C');
    const { page } = await openApp(a);
    await launchSecondInstance({ userDataDir, files: [b] });
    await launchSecondInstance({ userDataDir, files: [c] });
    await heading(page, 'Document C');

    await page.keyboard.press('Control+Tab');
    await heading(page, 'Document A');
    await page.keyboard.press('Control+Shift+Tab');
    await heading(page, 'Document C');
    await page.keyboard.press('Control+Shift+Tab');
    await heading(page, 'Document B');
  });

  it('moves a tab along the row with Ctrl+Shift+Page Up', async () => {
    const a = await workspace.write('a.md', '# Document A');
    const b = await workspace.write('b.md', '# Document B');
    const c = await workspace.write('c.md', '# Document C');
    const { page } = await openApp(a);
    await launchSecondInstance({ userDataDir, files: [b] });
    await launchSecondInstance({ userDataDir, files: [c] });
    await heading(page, 'Document C');

    await page.keyboard.press('Control+Shift+PageUp');

    await expectTabs(page, ['a.md', 'c.md', 'b.md']);
    await heading(page, 'Document C');
  });

  it('closes the tab on screen with Ctrl+W, and the window with the last one', async () => {
    const a = await workspace.write('a.md', '# Document A');
    const b = await workspace.write('b.md', '# Document B');
    const running = await openApp(a);
    await launchSecondInstance({ userDataDir, files: [b] });
    await heading(running.page, 'Document B');

    await running.page.keyboard.press('Control+w');
    await expectTabs(running.page, ['a.md']);
    await heading(running.page, 'Document A');
    expect(running.child.exitCode).toBeNull();

    // The window goes away while the key is still being sent, so the press itself may report that.
    await running.page.keyboard.press('Control+w').catch(() => undefined);
    const exit = await Promise.race([
      running.exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
    ]);
    expect(exit).not.toBe('timeout');
  });

  it('opens a link in a tab of its own when it is clicked with Ctrl held', async () => {
    await workspace.write('two.md', '# Page two');
    const one = await workspace.write('one.md', '# Page one\n\n[next](two.md)');
    const { page } = await openApp(one);
    await heading(page, 'Page one');

    await page.getByRole('link', { name: 'next' }).click({ modifiers: ['Control'] });

    await heading(page, 'Page two');
    await expectTabs(page, ['one.md', 'two.md']);
    expect(await page.getByRole('button', { name: 'Back' }).count()).toBe(0);
  });

  it('follows a link in the same tab otherwise, with its own Back', async () => {
    await workspace.write('two.md', '# Page two');
    const one = await workspace.write('one.md', '# Page one\n\n[next](two.md)');
    const { page } = await openApp(one);
    await heading(page, 'Page one');

    await page.getByRole('link', { name: 'next' }).click();

    await heading(page, 'Page two');
    await expectTabs(page, ['two.md']);
    await page.getByRole('button', { name: 'Back' }).click();
    await heading(page, 'Page one');
    await expectTabs(page, ['one.md']);
  });
});

describe('reopening the tabs', () => {
  it('opens the tabs of the last run, with the same one on screen, and reads each as it comes on screen', async () => {
    const a = await workspace.write('a.md', '# Document A');
    const b = await workspace.write('b.md', '# Document B');
    const c = await workspace.write('c.md', '# Document C');
    const first = await openApp(a);
    await launchSecondInstance({ userDataDir, files: [b] });
    await launchSecondInstance({ userDataDir, files: [c] });
    await heading(first.page, 'Document C');
    // What the app has written by itself so far, which does not yet include the switch to b.md. Whatever
    // reaches the file after this was written because the app was closed, not because it was left alone.
    const before = await eventually(
      () => readJson(sessionFile()).catch(() => undefined),
      (found) =>
        JSON.stringify(found) === JSON.stringify({ version: 1, tabs: [a, b, c], active: 2 }),
    );
    expect(before).toEqual({ version: 1, tabs: [a, b, c], active: 2 });
    await first.page.getByRole('tab', { name: 'b.md' }).click();
    await heading(first.page, 'Document B');
    await first.close();
    app = undefined;
    expect(await readJson(sessionFile())).toEqual({ version: 1, tabs: [a, b, c], active: 1 });

    const second = await openApp();

    await heading(second.page, 'Document B');
    expect(await tabNames(second.page)).toEqual(['a.md', 'b.md', 'c.md']);
    await second.page.getByRole('tab', { name: 'c.md' }).click();
    await heading(second.page, 'Document C');
    await second.page.getByRole('tab', { name: 'a.md' }).click();
    await heading(second.page, 'Document A');
  });

  it('puts a file named at launch after the tabs of the last run', async () => {
    const a = await workspace.write('a.md', '# Document A');
    const b = await workspace.write('b.md', '# Document B');
    const first = await openApp(a);
    await heading(first.page, 'Document A');
    await first.close();
    app = undefined;

    const second = await openApp(b);

    await heading(second.page, 'Document B');
    expect(await tabNames(second.page)).toEqual(['a.md', 'b.md']);
  });

  it('forgets the tabs, and removes what was remembered, when reopening is switched off', async () => {
    const a = await workspace.write('a.md', '# Document A');
    const first = await openApp(a);
    await heading(first.page, 'Document A');
    await eventually(
      () => exists(sessionFile()),
      (found) => found,
    );

    await first.page.getByRole('button', { name: 'Settings' }).click();
    await first.page.getByRole('switch', { name: 'Reopen tabs when MD Reader starts' }).click();

    const found = await eventually(
      () => exists(sessionFile()),
      (present) => !present,
    );
    expect(found).toBe(false);
    // The choice is written a moment after it is made, like the tabs are.
    const settings = await eventually(
      () => readJson(path.join(userDataDir, 'settings.json')).catch(() => undefined),
      (stored) => (stored as { restoreTabs?: boolean } | undefined)?.restoreTabs === false,
    );
    expect(settings).toMatchObject({ restoreTabs: false });
    await first.close();
    app = undefined;
    expect(await exists(sessionFile())).toBe(false);

    const second = await openApp();

    await second.page.getByRole('heading', { name: 'Open a Markdown file' }).waitFor();
    expect(await tabNames(second.page)).toEqual([]);
  });

  it('does not reopen tabs that were remembered when reopening is switched off, and removes them', async () => {
    const a = await workspace.write('a.md', '# Document A');
    await writeFile(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({ theme: 'system', zoom: 1, restoreTabs: false }),
    );
    await writeFile(sessionFile(), JSON.stringify({ version: 1, tabs: [a], active: 0 }));

    const running = await openApp();

    await running.page.getByRole('heading', { name: 'Open a Markdown file' }).waitFor();
    expect(await tabNames(running.page)).toEqual([]);
    const present = await eventually(
      () => exists(sessionFile()),
      (found) => !found,
    );
    expect(present).toBe(false);
  });

  it('remembers the tabs that are open from the moment reopening is switched on again', async () => {
    await writeFile(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({ theme: 'system', zoom: 1, restoreTabs: false }),
    );
    const a = await workspace.write('a.md', '# Document A');
    const first = await openApp(a);
    await heading(first.page, 'Document A');
    expect(await exists(sessionFile())).toBe(false);

    await first.page.getByRole('button', { name: 'Settings' }).click();
    await first.page.getByRole('switch', { name: 'Reopen tabs when MD Reader starts' }).click();

    const written = await eventually(
      () => exists(sessionFile()),
      (present) => present,
    );
    expect(written).toBe(true);
    expect(await readJson(sessionFile())).toEqual({ version: 1, tabs: [a], active: 0 });
  });

  it('keeps a tab whose file has gone, says so, and lets the reader close it', async () => {
    const a = await workspace.write('a.md', '# Document A');
    const b = await workspace.write('b.md', '# Document B');
    const first = await openApp(a);
    await launchSecondInstance({ userDataDir, files: [b] });
    await heading(first.page, 'Document B');
    await first.page.getByRole('tab', { name: 'a.md' }).click();
    await heading(first.page, 'Document A');
    await first.close();
    app = undefined;
    await rm(a);

    const second = await openApp();

    await second.page.getByRole('heading', { level: 1, name: 'a.md' }).waitFor({ timeout: 20_000 });
    expect(await second.page.getByRole('alert').innerText()).toContain('could not be found');
    expect(await tabNames(second.page)).toEqual(['a.md', 'b.md']);

    await second.page.getByRole('tab', { name: 'b.md' }).click();
    await heading(second.page, 'Document B');
    await second.page.getByRole('tab', { name: 'a.md' }).click();
    await second.page.getByRole('button', { name: 'Close tab' }).click();
    await expectTabs(second.page, ['b.md']);
    await heading(second.page, 'Document B');
  });

  it('starts normally when the remembered tabs are damaged', async () => {
    await writeFile(sessionFile(), '{ this is not json');

    const running = await openApp();

    await running.page.getByRole('heading', { name: 'Open a Markdown file' }).waitFor();
    expect(await tabNames(running.page)).toEqual([]);
    expect(running.output()).toContain('[session]');
  });

  it('opens only what is a Markdown file by name on this computer, whatever the remembered list says', async () => {
    const real = await workspace.write('real.md', '# Real document');
    await writeFile(
      sessionFile(),
      JSON.stringify({
        version: 1,
        tabs: [
          'relative.md',
          'C:\\Windows\\win.ini',
          // A network location would be contacted, with the reader's credentials, when its tab is read.
          '\\\\mdreader-test.invalid\\share\\notes.md',
          '\\\\?\\UNC\\mdreader-test.invalid\\share\\notes.md',
          `${real}:stream.md`,
          real,
          7,
          null,
        ],
        active: 5,
      }),
    );

    const running = await openApp();

    await heading(running.page, 'Real document');
    expect(await tabNames(running.page)).toEqual(['real.md']);
  });
});
