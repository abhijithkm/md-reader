import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPng, createWorkspace, removeWithRetries, type Workspace } from './support/fixtures';
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

/** Waits until a heading is on screen. */
async function heading(
  page: Page,
  name: string,
  level?: number,
  timeoutMs = 20_000,
): Promise<void> {
  await page
    .getByRole('heading', { name, ...(level === undefined ? {} : { level }) })
    .waitFor({ state: 'visible', timeout: timeoutMs });
}

async function openApp(...files: string[]): Promise<RunningApp> {
  app = await launchApp({ userDataDir, files });
  return app;
}

describe('opening documents', () => {
  it('opens the file named on the command line, even with spaces and unicode in its path', async () => {
    const file = await workspace.write(
      'My Docs/日本語 résumé #1.md',
      '# Héllo wörld\n\nA paragraph with **bold** text.',
    );

    const { page } = await openApp(file);

    await heading(page, 'Héllo wörld', 1);
    expect(await page.title()).toBe('日本語 résumé #1.md — MD Reader');
    expect(await page.locator('footer').innerText()).toContain('日本語 résumé #1.md');
  });

  it('starts with an empty state when no file is given', async () => {
    const { page } = await openApp();
    await heading(page, 'Open a Markdown file', 1);
    expect(await page.title()).toBe('MD Reader');
  });

  it('shows a file opened by a second launch in the window that is already running', async () => {
    const first = await workspace.write('first.md', '# First document');
    const second = await workspace.write('folder with spaces/second.md', '# Second document');
    const { page } = await openApp(first);
    await heading(page, 'First document');

    const exitCode = await launchSecondInstance({ userDataDir, files: [second] });

    expect(exitCode).toBe(0);
    await heading(page, 'Second document');
    expect(page.context().pages()).toHaveLength(1);
    expect(await page.title()).toBe('second.md — MD Reader');
  });

  it('shows a file from a second launch when the first window was empty', async () => {
    const file = await workspace.write('later.md', '# Opened later');
    const { page } = await openApp();
    await heading(page, 'Open a Markdown file');

    await launchSecondInstance({ userDataDir, files: [file] });

    await heading(page, 'Opened later');
  });

  it('keeps the current document when a second launch has no file', async () => {
    const file = await workspace.write('stay.md', '# Stay here');
    const { page } = await openApp(file);
    await heading(page, 'Stay here');

    const exitCode = await launchSecondInstance({ userDataDir });

    expect(exitCode).toBe(0);
    await heading(page, 'Stay here');
  });

  it('explains why a file that is not Markdown was not opened', async () => {
    const file = await workspace.write('notes.txt', 'plain text');
    const { page } = await openApp(file);

    const alert = page.getByRole('alert');
    await alert.waitFor({ state: 'visible', timeout: 20_000 });
    expect(await alert.innerText()).toContain('is not a Markdown file');
  });

  it('explains when the file on the command line does not exist', async () => {
    const { page } = await openApp(path.join(workspace.root, 'gone.md'));

    const alert = page.getByRole('alert');
    await alert.waitFor({ state: 'visible', timeout: 20_000 });
    expect(await alert.innerText()).toContain('could not be found');
  });

  it('opens a file that is dropped on the window', async () => {
    const file = await workspace.write('dropped file.md', '# Dropped in');
    const { page } = await openApp();
    await heading(page, 'Open a Markdown file');

    const cdp = await page.context().newCDPSession(page);
    const point = { x: 300, y: 300 };
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', ...point, data });
    await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...point, data });
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...point, data });

    await heading(page, 'Dropped in');
  });

  it('shows the changes after the file is edited and reloaded with F5', async () => {
    const file = await workspace.write('live.md', '# Version one');
    const { page } = await openApp(file);
    await heading(page, 'Version one');

    await writeFile(file, '# Version two');
    await page.keyboard.press('F5');

    await heading(page, 'Version two');
  });

  it('refuses a document that is too large and explains why', async () => {
    const file = await workspace.write('huge.md', Buffer.alloc(11 * 1024 * 1024, 0x61));
    const { page } = await openApp(file);

    const alert = page.getByRole('alert');
    await alert.waitFor({ state: 'visible', timeout: 20_000 });
    expect(await alert.innerText()).toMatch(/huge\.md.*more than/);
  });
});

describe('relative images and links', () => {
  it('loads images relative to the document, including a parent folder, and degrades gracefully when one is missing', async () => {
    await workspace.write('docs/images/pic.png', createPng());
    await workspace.write('shared/up.png', createPng(8, 8, [20, 90, 200, 255]));
    const file = await workspace.write(
      'docs/readme.md',
      [
        '# Pictures',
        '',
        '![beside](images/pic.png)',
        '',
        '![parent](../shared/up.png)',
        '',
        '![missing](images/nope.png)',
      ].join('\n'),
    );

    const { page } = await openApp(file);
    await heading(page, 'Pictures');

    await page.waitForFunction(
      () => {
        const loaded = (alt: string) => {
          const image = document.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);
          return image !== null && image.complete && image.naturalWidth > 0;
        };
        return loaded('beside') && loaded('parent');
      },
      undefined,
      { timeout: 20_000 },
    );
    await page.getByText('Image not found: missing').waitFor({ state: 'visible', timeout: 20_000 });
  });

  it('follows a link to another Markdown file, scrolls to its section, and goes back', async () => {
    await workspace.write(
      'guide.md',
      // Enough text after the heading that it can actually be scrolled to the top.
      `# Guide\n\n${'Filler paragraph.\n\n'.repeat(80)}## Install\n\nInstall steps.\n\n${'More filler.\n\n'.repeat(80)}`,
    );
    const index = await workspace.write('index.md', '# Index\n\n[Install guide](guide.md#install)');
    const { page } = await openApp(index);
    await heading(page, 'Index');

    await page.getByRole('link', { name: 'Install guide' }).click();
    await heading(page, 'Install', 2);
    await page.waitForFunction(
      () => {
        const target = Array.from(document.querySelectorAll('h2')).find(
          (h) => h.textContent === 'Install',
        );
        return target !== undefined && target.getBoundingClientRect().top < window.innerHeight / 2;
      },
      undefined,
      { timeout: 10_000 },
    );

    await page.getByRole('button', { name: 'Back' }).click();
    await heading(page, 'Index');
  });

  it('refuses to open a linked file that is not Markdown', async () => {
    await workspace.write('script.bat', 'echo hello');
    const index = await workspace.write('index.md', '# Index\n\n[run me](script.bat)');
    const { page } = await openApp(index);
    await heading(page, 'Index');

    await page.getByRole('link', { name: 'run me' }).click();

    const alert = page.getByRole('alert');
    await alert.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await alert.innerText()).toContain('.md and .markdown');
    await heading(page, 'Index');
  });
});

describe('untrusted Markdown', () => {
  const hostile = [
    '# Hostile document',
    '',
    "<script>window.__pwned = 'script'</script>",
    '',
    '<img src="x" onerror="window.__pwned = \'onerror\'">',
    '',
    '<a href="javascript:window.__pwned=\'link\'" onclick="window.__pwned=\'click\'">click me</a>',
    '',
    '<iframe src="https://example.com"></iframe>',
    '',
    '<svg onload="window.__pwned = \'svg\'"></svg>',
    '',
    '<form action="https://example.com"><input name="x"></form>',
    '',
    '<style>body { display: none }</style>',
    '',
    '<meta http-equiv="refresh" content="0;url=https://example.com">',
    '',
    "[bad](javascript:window.__pwned='md')",
    '',
    '![tracker](http://example.com/pixel.gif)',
    '',
    'Still readable.',
  ].join('\n');

  it('removes everything that could run code, and the page stays intact', async () => {
    const file = await workspace.write('hostile.md', hostile);
    const { page } = await openApp(file);
    await heading(page, 'Hostile document');
    const pageUrl = page.url();

    await page.getByText('click me').click();
    await page.getByText('bad', { exact: true }).click();

    const result = await page.evaluate(() => {
      const article = document.querySelector('article');
      const forbidden = 'script, iframe, object, embed, form, style, link, meta, base, svg';
      return {
        pwned: (window as unknown as { __pwned?: string }).__pwned,
        forbiddenInDocument: article?.querySelectorAll(forbidden).length ?? -1,
        handlers:
          article?.querySelectorAll('[onerror],[onclick],[onload],[onmouseover],[style]').length ??
          -1,
        javascriptLinks: article?.querySelectorAll('a[href^="javascript:"]').length ?? -1,
        bodyDisplay: getComputedStyle(document.body).display,
        text: article?.textContent ?? '',
      };
    });

    expect(result.pwned).toBeUndefined();
    expect(result.forbiddenInDocument).toBe(0);
    expect(result.handlers).toBe(0);
    expect(result.javascriptLinks).toBe(0);
    expect(result.bodyDisplay).not.toBe('none');
    expect(result.text).toContain('Still readable.');
    expect(page.url()).toBe(pageUrl);
  });

  it('enforces the Content Security Policy: no inline script, no eval, no network access', async () => {
    const { page } = await openApp();
    await heading(page, 'Open a Markdown file');

    const result = await page.evaluate(async () => {
      const scope = window as unknown as { __injected?: number; __evaluated?: number };
      const script = document.createElement('script');
      script.textContent = 'window.__injected = 1';
      document.head.append(script);

      // Code run through DevTools is exempt from the eval restriction, so ask the
      // page itself to compile a string a moment later, outside this call.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- compiling a string is the point
      window.setTimeout('window.__evaluated = 1', 0);

      const fetchResult = await fetch('https://example.com/').then(
        () => 'allowed',
        () => 'blocked',
      );
      return { injected: scope.__injected, fetchResult };
    });
    await page.waitForTimeout(300);
    const evaluated = await page.evaluate(
      () => (window as unknown as { __evaluated?: number }).__evaluated,
    );

    expect(result.injected).toBeUndefined();
    expect(evaluated).toBeUndefined();
    expect(result.fetchResult).toBe('blocked');
  });

  it('makes no network requests of its own while showing a document', async () => {
    const file = await workspace.write('quiet.md', '# Quiet\n\n![local](pic.png)\n\nText.');
    await workspace.write('pic.png', createPng());
    app = await launchApp({ userDataDir, files: [] });
    const requests: string[] = [];
    app.page.on('request', (request) => requests.push(request.url()));

    await launchSecondInstance({ userDataDir, files: [file] });
    await heading(app.page, 'Quiet');
    await app.page.waitForFunction(
      () => document.querySelector<HTMLImageElement>('img[alt="local"]')?.naturalWidth !== 0,
      undefined,
      { timeout: 20_000 },
    );

    const outside = requests.filter((url) => /^(https?|wss?|ftp):/i.test(url));
    expect(outside).toEqual([]);
  });
});

describe('keyboard and mouse', () => {
  it('zooms with Ctrl+Plus, Ctrl+Minus and Ctrl+0', async () => {
    const file = await workspace.write('zoom.md', '# Zoom me');
    const { page } = await openApp(file);
    await heading(page, 'Zoom me');
    const zoom = page.getByRole('status');

    await page.keyboard.press('Control+Equal');
    await page.keyboard.press('Control+Equal');
    expect(await zoom.innerText()).toBe('125%');

    await page.keyboard.press('Control+Minus');
    expect(await zoom.innerText()).toBe('110%');

    await page.keyboard.press('Control+0');
    expect(await zoom.innerText()).toBe('100%');
  });

  it('opens a linked document with the keyboard and goes back with Alt+Left', async () => {
    await workspace.write('two.md', '# Page two');
    const one = await workspace.write('one.md', '# Page one\n\n[next](two.md)');
    const { page } = await openApp(one);
    await heading(page, 'Page one');

    await page.getByRole('link', { name: 'next' }).focus();
    await page.keyboard.press('Enter');
    await heading(page, 'Page two');

    await page.keyboard.press('Alt+ArrowLeft');
    await heading(page, 'Page one');
  });
});

describe('hostile documents and pages', () => {
  it('shows a document that nests quotes absurdly deep as plain text, and stays responsive', async () => {
    // 20,000 levels is 40 KB. The parsers need minutes for that and overflow the stack.
    const file = await workspace.write('deep.md', `${'> '.repeat(20_000)}deep\n`);

    const started = Date.now();
    const { page } = await openApp(file);
    await page.getByRole('alert').filter({ hasText: 'too deeply' }).waitFor({ timeout: 15_000 });

    expect(Date.now() - started).toBeLessThan(15_000);
    // The interface still answers.
    await page.keyboard.press('Control+Equal');
    expect(await page.getByRole('status').innerText()).toBe('110%');
  });

  it('gives the page no way to name a file of its own choosing', async () => {
    // If a hostile document ever took the page over, this is all it could ask the app to do.
    const secret = await workspace.write('private/notes.md', '# private notes');
    const shown = await workspace.write('shown.md', '# shown');
    const { page } = await openApp(shown);
    await heading(page, 'shown');

    const result = await page.evaluate(async (secretPath) => {
      const api = (window as unknown as { mdReader: Record<string, unknown> }).mdReader;
      const reopen = api['reopenDocument'] as (path: string) => Promise<unknown>;
      const dropped = api['openDroppedFile'] as (file: unknown) => Promise<unknown>;
      return {
        offersOpenPath: 'openPath' in api,
        offersPathOfFile: 'getPathForFile' in api,
        // A file that exists but that the app has not shown.
        reopen: await reopen(secretPath),
        // A File made up by the page has no location on disk.
        dropped: await dropped(new File(['# made up'], 'made-up.md')),
      };
    }, secret);

    expect(result.offersOpenPath).toBe(false);
    expect(result.offersPathOfFile).toBe(false);
    expect(result.reopen).toMatchObject({ status: 'failed', error: { code: 'not-found' } });
    expect(result.dropped).toMatchObject({ status: 'failed', error: { code: 'invalid-path' } });
    // Nothing changed on screen.
    await heading(page, 'shown');
  });
});

describe('large documents', () => {
  it('renders a document of about a megabyte and stays responsive', async () => {
    const section = (n: number) =>
      [
        `## Section ${n}`,
        '',
        `Paragraph ${n} with *emphasis*, **strong text**, \`inline code\` and a [link](#section-${n}).`,
        '',
        '- first item',
        '- second item',
        '',
        '| name | value |',
        '| ---- | ----- |',
        `| ${n} | x |`,
        '',
      ].join('\n');
    const content = `# Big document\n\n${Array.from({ length: 6000 }, (_unused, n) => section(n)).join('\n')}\n## The end\n`;
    const file = await workspace.write('big.md', content);

    const started = Date.now();
    const { page } = await openApp(file);
    await heading(page, 'Big document', 1);
    const firstContentMs = Date.now() - started;
    // About 18 seconds on a fast desktop; a shared CI runner is several times slower.
    await heading(page, 'The end', 2, 100_000);
    const renderMs = Date.now() - started;

    // The longest stretch the page was busy without yielding, from the Long Tasks API.
    const longestTaskMs = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const observer = new PerformanceObserver((list) => {
            resolve(Math.max(0, ...list.getEntries().map((entry) => entry.duration)));
          });
          observer.observe({ type: 'longtask', buffered: true });
          setTimeout(() => {
            resolve(0);
          }, 1000);
        }),
    );
    console.info(
      `${(content.length / 1024).toFixed(0)} KB: first content after ${firstContentMs} ms, complete after ${renderMs} ms, longest blocked stretch ${Math.round(longestTaskMs)} ms`,
    );

    // The interface still answers: zooming updates immediately.
    await page.keyboard.press('Control+Equal');
    expect(await page.getByRole('status').innerText()).toBe('110%');
    // The limits leave room for a slow machine. Without splitting the document the page is
    // blocked for 12 seconds or more, so they still catch a regression.
    expect(firstContentMs).toBeLessThan(15_000);
    expect(renderMs).toBeLessThan(100_000);
    // No single piece of work freezes the window for long enough to look like a hang.
    expect(longestTaskMs).toBeLessThan(3000);
  });
});
