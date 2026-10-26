import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TABS, type TabsSnapshot } from '../shared/tabs';
import type { DocumentOutcome, MarkdownDocument, OpenOutcome } from '../shared/types';
import { AppController, type WindowPort } from './app-controller';
import { createDocumentService, type DocumentService, type OpenOptions } from './documents';
import type { SessionData } from './session-store';

const onWindows = process.platform === 'win32';
const exe = path.join(os.tmpdir(), 'MDReader.exe');

class FakeWindow implements WindowPort {
  readonly outcomes: OpenOutcome[] = [];
  readonly tabs: TabsSnapshot[] = [];
  /** Everything the page was sent, in the order it was sent. */
  readonly sent: ('tabs' | 'outcome')[] = [];
  revealCount = 0;

  sendOutcome(outcome: OpenOutcome): void {
    this.outcomes.push(outcome);
    this.sent.push('outcome');
  }

  sendTabs(snapshot: TabsSnapshot): void {
    this.tabs.push(snapshot);
    this.sent.push('tabs');
  }

  reveal(): void {
    this.revealCount += 1;
  }
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-ctl-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

interface Harness {
  controller: AppController;
  window: FakeWindow;
  /** What the controller said was worth remembering for the next run, in order. */
  sessions: SessionData[];
}

function createHarness(
  options: { documents?: DocumentService; chosenFiles?: string[] } = {},
): Harness {
  const window = new FakeWindow();
  const sessions: SessionData[] = [];
  const controller = new AppController({
    documents: options.documents ?? createDocumentService(),
    getWindow: () => window,
    showOpenDialog: () => Promise.resolve(options.chosenFiles ?? []),
    isPackaged: true,
    onTabsChanged: (session) => {
      sessions.push(session);
    },
  });
  return { controller, window, sessions };
}

async function writeDoc(relative: string, content: string): Promise<string> {
  const file = path.join(workDir, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

function openedDocument(outcome: OpenOutcome | undefined): MarkdownDocument {
  if (outcome?.status !== 'opened') {
    throw new Error(`expected an opened document, got ${JSON.stringify(outcome)}`);
  }
  return outcome.document;
}

function tabIdOf(outcome: OpenOutcome | undefined): string {
  if (outcome?.status !== 'opened') {
    throw new Error(`expected an opened document, got ${JSON.stringify(outcome)}`);
  }
  return outcome.tabId;
}

function fakeDocument(filePath: string, content: string): DocumentOutcome {
  return {
    status: 'opened',
    document: {
      path: filePath,
      name: path.basename(filePath),
      directory: path.dirname(filePath),
      baseUrl: 'file:///x/',
      content,
      sizeBytes: content.length,
      modifiedMs: 0,
      encoding: 'utf-8',
    },
  };
}

/** A document service that finds every file at once, without touching the disk. */
const everyFileExists: DocumentService = {
  open: (input) => Promise.resolve(fakeDocument(String(input), 'x')),
};

/**
 * A document service whose reads of the files it is told to hold do not finish until the test says
 * so, which makes requests overlap. Every other file is read at once by `fallback`.
 */
function holdingDocuments(
  initiallyHeld: readonly string[] = [],
  fallback: DocumentService = everyFileExists,
) {
  const held = new Set(initiallyHeld);
  const waiting = new Map<string, ((outcome: DocumentOutcome) => void)[]>();
  const documents: DocumentService = {
    open: (input, options) => {
      const key = String(input);
      if (!held.has(key)) return fallback.open(input, options);
      return new Promise<DocumentOutcome>((resolve) => {
        waiting.set(key, [...(waiting.get(key) ?? []), resolve]);
      });
    },
  };
  return {
    documents,
    /** The reads of this file that start from now on do not finish until `finish` says so. */
    hold: (filePath: string): void => {
      held.add(filePath);
    },
    /** Lets the reads of a held file finish, with this text, and stops holding it. */
    finish: (filePath: string, content = 'x'): void => {
      held.delete(filePath);
      for (const resolve of waiting.get(filePath) ?? []) resolve(fakeDocument(filePath, content));
      waiting.delete(filePath);
    },
  };
}

const pathsOf = (controller: AppController): string[] =>
  controller.getTabs().tabs.map((tab) => tab.path);

function fileUrl(file: string): string {
  return new URL(`file:///${file.replaceAll('\\', '/')}`).href;
}

describe('AppController: launching with a file', () => {
  it('waits for the renderer before delivering the file named on the command line, in a tab', async () => {
    const file = await writeDoc('My Docs/日本語 notes.md', '# From the command line');
    const { controller, window } = createHarness();

    controller.handleLaunch([exe, file], workDir);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.outcomes).toHaveLength(0);

    controller.rendererReady();
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));

    expect(openedDocument(window.outcomes[0]).content).toBe('# From the command line');
    const id = tabIdOf(window.outcomes[0]);
    expect(controller.getTabs()).toMatchObject({ tabs: [{ id, path: file }], activeId: id });
    expect(controller.getCurrentDocumentPath()).toBe(file);
  });

  it('delivers nothing when the app starts without a file', async () => {
    const { controller, window } = createHarness();

    controller.handleLaunch([exe], workDir);
    controller.rendererReady();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(window.outcomes).toHaveLength(0);
    expect(controller.getTabs()).toMatchObject({ tabs: [], activeId: undefined });
    expect(controller.getCurrentDocumentPath()).toBeUndefined();
  });

  it('resolves a relative file name against the working directory', async () => {
    await writeDoc('notes/todo.md', 'relative');
    const { controller, window } = createHarness();
    controller.rendererReady();

    controller.handleLaunch([exe, 'todo.md'], path.join(workDir, 'notes'));

    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));
    expect(openedDocument(window.outcomes[0]).content).toBe('relative');
  });

  it('tells the user when the file on the command line is not a Markdown file, and opens no tab', async () => {
    const file = await writeDoc('notes.txt', 'plain');
    const { controller, window } = createHarness();
    controller.rendererReady();

    controller.handleLaunch([exe, file], workDir);

    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));
    expect(window.outcomes[0]).toMatchObject({
      status: 'failed',
      error: { code: 'unsupported-type' },
    });
    expect(controller.getTabs().tabs).toEqual([]);
  });

  it('tells the user when the file on the command line does not exist', async () => {
    const { controller, window } = createHarness();
    controller.rendererReady();

    controller.handleLaunch([exe, path.join(workDir, 'gone.md')], workDir);

    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));
    expect(window.outcomes[0]).toMatchObject({ status: 'failed', error: { code: 'not-found' } });
  });
});

describe('AppController: a second launch while the app is running', () => {
  it('opens the new file in a tab of its own, shows it, and brings the window to the front', async () => {
    const first = await writeDoc('first.md', 'first');
    const second = await writeDoc('with space/second.md', 'second');
    const { controller, window } = createHarness();
    controller.rendererReady();
    controller.handleLaunch([exe, first], workDir);
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));

    controller.handleLaunch([exe, second], workDir, { reveal: true });

    await vi.waitFor(() => expect(window.outcomes).toHaveLength(2));
    expect(openedDocument(window.outcomes[1]).content).toBe('second');
    expect(pathsOf(controller)).toEqual([first, second]);
    expect(controller.getTabs().activeId).toBe(tabIdOf(window.outcomes[1]));
    expect(controller.getCurrentDocumentPath()).toBe(second);
    expect(window.revealCount).toBe(1);
  });

  it('still brings the window to the front when no file was passed', async () => {
    const { controller, window } = createHarness();
    controller.rendererReady();

    controller.handleLaunch([exe], workDir, { reveal: true });

    expect(window.revealCount).toBe(1);
    expect(window.outcomes).toHaveLength(0);
  });

  it('reveals the window immediately even if the page is still loading, then delivers the file', async () => {
    const file = await writeDoc('late.md', 'late');
    const { controller, window } = createHarness();

    controller.handleLaunch([exe, file], workDir, { reveal: true });
    expect(window.revealCount).toBe(1);
    expect(window.outcomes).toHaveLength(0);

    controller.rendererReady();
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));
  });

  it('opens every file that was asked for before the page was ready, in the order it was asked for, whichever the disk reads first', async () => {
    const one = path.join(workDir, 'one.md');
    const two = path.join(workDir, 'two.md');
    const three = path.join(workDir, 'three.md');
    const { documents, finish } = holdingDocuments([one, two, three]);
    const { controller, window } = createHarness({ documents });

    controller.handleLaunch([exe, one], workDir);
    controller.handleLaunch([exe, two], workDir, { reveal: true });
    controller.handleLaunch([exe, three], workDir, { reveal: true });
    controller.rendererReady();
    // Were the files read side by side, the last would be through first.
    finish(three);
    finish(two);
    finish(one);
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(3));

    expect(pathsOf(controller)).toEqual([one, two, three]);
    expect(controller.getCurrentDocumentPath()).toBe(three);
  });

  it('opens the files asked for from outside one after the other, so that a slow one is not overtaken in the row of tabs', async () => {
    const slow = path.join(workDir, 'slow.md');
    const fast = path.join(workDir, 'fast.md');
    const { documents, finish } = holdingDocuments([slow]);
    const { controller, window, sessions } = createHarness({ documents });
    controller.rendererReady();

    controller.handleLaunch([exe, slow], workDir);
    controller.handleLaunch([exe, fast], workDir);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.outcomes).toHaveLength(0);
    expect(pathsOf(controller)).toEqual([]);
    finish(slow, 'slow');
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(2));

    expect(pathsOf(controller)).toEqual([slow, fast]);
    expect(controller.getCurrentDocumentPath()).toBe(fast);
    expect(sessions.at(-1)).toEqual({ paths: [slow, fast], active: 1 });
  });

  it('keeps opening what is asked for from outside after one of the files could not be read', async () => {
    const good = await writeDoc('good.md', 'good');
    const { controller, window } = createHarness();
    controller.rendererReady();

    controller.handleLaunch([exe, path.join(workDir, 'gone.md')], workDir);
    controller.handleLaunch([exe, good], workDir);

    await vi.waitFor(() => expect(window.outcomes).toHaveLength(2));
    expect(window.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(window.outcomes[1]?.status).toBe('opened');
  });

  it('opens both documents when requests of the page overlap, but only the newest takes the screen', async () => {
    const slow = path.join(workDir, 'slow.md');
    const fast = path.join(workDir, 'fast.md');
    const { documents, finish } = holdingDocuments([slow, fast]);
    const { controller, window, sessions } = createHarness({ documents });

    const older = controller.openPath(slow);
    const newer = controller.openPath(fast);
    finish(fast, 'fast');
    await newer;
    finish(slow, 'slow');
    await older;

    expect(pathsOf(controller)).toEqual([fast, slow]);
    expect(controller.getCurrentDocumentPath()).toBe(fast);
    // The older one arrived too late to take the screen, and still reached the page and the session.
    expect(window.tabs.at(-1)?.tabs.map((tab) => tab.path)).toEqual([fast, slow]);
    expect(window.tabs.at(-1)?.activeId).toBe(controller.getTabs().activeId);
    expect(sessions.at(-1)).toEqual({ paths: [fast, slow], active: 0 });
  });

  it('shows the tab that already has the file, instead of opening it twice', async () => {
    const file = await writeDoc('again.md', 'again');
    const { controller, window } = createHarness();
    controller.rendererReady();
    controller.handleLaunch([exe, file], workDir);
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));

    controller.handleLaunch([exe, file], workDir, { reveal: true });
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(2));

    expect(pathsOf(controller)).toEqual([file]);
    expect(tabIdOf(window.outcomes[1])).toBe(tabIdOf(window.outcomes[0]));
  });

  it('queues requests again after the page goes away and delivers them when it is back', async () => {
    const file = await writeDoc('again.md', 'again');
    const { controller, window } = createHarness();
    controller.rendererReady();
    controller.rendererGone();

    controller.handleLaunch([exe, file], workDir);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.outcomes).toHaveLength(0);

    controller.rendererReady();
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));
  });

  it('handles a path supplied by the operating system the same way', async () => {
    const file = await writeDoc('os-open.md', 'from the OS');
    const { controller, window } = createHarness();
    controller.rendererReady();

    controller.handleOpenRequest(file, { reveal: true });

    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));
    expect(window.revealCount).toBe(1);
  });

  it('tells the page about the tabs, and the app which ones to remember, each time they change', async () => {
    const file = await writeDoc('told.md', 'told');
    const { controller, window, sessions } = createHarness();
    controller.rendererReady();

    controller.handleLaunch([exe, file], workDir);
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));

    expect(window.tabs.at(-1)).toEqual(controller.getTabs());
    expect(sessions.at(-1)).toEqual({ paths: [file], active: 0 });
  });

  it('numbers each change of the tabs, so that a message that arrives late can be told from a newer one', async () => {
    const first = await writeDoc('first.md', 'first');
    const second = await writeDoc('second.md', 'second');
    const { controller, window } = createHarness();
    expect(controller.getTabs().version).toBe(0);

    await controller.openPath(first);
    await controller.openPath(second);

    expect(window.tabs.map((snapshot) => snapshot.version)).toEqual([1, 2]);
    expect(controller.getTabs().version).toBe(2);
  });

  it('does not number a change that did not happen', async () => {
    const file = await writeDoc('same.md', 'same');
    const { controller, window } = createHarness();
    await controller.openPath(file);

    await controller.openPath(file);

    expect(window.tabs.map((snapshot) => snapshot.version)).toEqual([1]);
    expect(controller.getTabs().version).toBe(1);
  });

  it('hands the page the document before it announces the tab that shows it, so that the page has no reason to ask for it', async () => {
    const file = await writeDoc('ordered.md', 'ordered');
    const { controller, window } = createHarness();
    controller.rendererReady();

    controller.handleLaunch([exe, file], workDir);
    await vi.waitFor(() => expect(window.tabs).toHaveLength(1));

    expect(window.sent).toEqual(['outcome', 'tabs']);
  });
});

describe('AppController: opening from inside the app', () => {
  it('opens each file chosen in the dialog in a tab of its own, and shows the last', async () => {
    const one = await writeDoc('one.md', '1');
    const two = await writeDoc('two.md', '2');
    const { controller } = createHarness({ chosenFiles: [one, two] });

    const outcomes = await controller.openFromDialog();

    expect(outcomes.map((outcome) => openedDocument(outcome).content)).toEqual(['1', '2']);
    expect(pathsOf(controller)).toEqual([one, two]);
    expect(controller.getCurrentDocumentPath()).toBe(two);
  });

  it('tells the page once about everything a batch opened, with the last file on screen', async () => {
    const files = await Promise.all(['a.md', 'b.md', 'c.md'].map((name) => writeDoc(name, name)));
    const { controller, window, sessions } = createHarness({ chosenFiles: files });

    const outcomes = await controller.openFromDialog();

    expect(window.tabs).toHaveLength(1);
    expect(window.tabs[0]?.tabs.map((tab) => tab.path)).toEqual(files);
    expect(window.tabs[0]?.activeId).toBe(tabIdOf(outcomes[2]));
    expect(sessions).toEqual([{ paths: files, active: 2 }]);
  });

  it('reports a cancelled dialog and keeps the tabs as they are', async () => {
    const file = await writeDoc('current.md', 'current');
    const { controller } = createHarness({ chosenFiles: [] });
    await controller.openPath(file);

    expect(await controller.openFromDialog()).toEqual([{ status: 'canceled' }]);
    expect(pathsOf(controller)).toEqual([file]);
  });

  it('opens what it can of the files chosen, and says why it could not open the others', async () => {
    const good = await writeDoc('good.md', 'good');
    const gone = path.join(workDir, 'gone.md');
    const { controller } = createHarness({ chosenFiles: [gone, good] });

    const outcomes = await controller.openFromDialog();

    expect(outcomes[0]).toMatchObject({ status: 'failed', error: { code: 'not-found' } });
    expect(outcomes[1]?.status).toBe('opened');
    expect(pathsOf(controller)).toEqual([good]);
  });

  it('opens a dropped file in a new tab and shows it', async () => {
    const first = await writeDoc('first.md', 'first');
    const dropped = await writeDoc('dropped.md', 'dropped');
    const { controller } = createHarness();
    await controller.openPath(first);

    const outcome = await controller.openPath(dropped);

    expect(openedDocument(outcome).content).toBe('dropped');
    expect(pathsOf(controller)).toEqual([first, dropped]);
    expect(controller.getTabs().activeId).toBe(tabIdOf(outcome));
  });

  it('opens several dropped files, one tab each, from a list of paths', async () => {
    const one = await writeDoc('one.md', '1');
    const two = await writeDoc('two.md', '2');
    const { controller } = createHarness();

    const outcomes = await controller.openPaths([one, two]);

    expect(outcomes.map((outcome) => openedDocument(outcome).content)).toEqual(['1', '2']);
    expect(pathsOf(controller)).toEqual([one, two]);
  });

  it.each(['C:\\docs\\a.md', null, undefined, 42, {}])(
    'refuses %j where a list of paths was expected',
    async (input) => {
      const { controller } = createHarness({ documents: everyFileExists });

      expect(await controller.openPaths(input)).toEqual([
        expect.objectContaining({ status: 'failed', error: expect.anything() as unknown }),
      ]);
      expect(controller.getTabs().tabs).toEqual([]);
    },
  );

  it('reads no more files from one request than there can be tabs, and says that the rest did not fit', async () => {
    const open = vi.fn((input: unknown) => Promise.resolve(fakeDocument(String(input), 'x')));
    const { controller } = createHarness({ documents: { open } });
    const many = Array.from({ length: MAX_TABS + 5 }, (_unused, n) =>
      path.join(workDir, `doc ${n}.md`),
    );

    const outcomes = await controller.openPaths(many);

    expect(open).toHaveBeenCalledTimes(MAX_TABS);
    expect(outcomes).toHaveLength(MAX_TABS + 1);
    expect(outcomes.slice(0, MAX_TABS).every((outcome) => outcome.status === 'opened')).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: 'failed', error: { code: 'too-many-tabs' } });
  });

  it('shows a file that is already open in the tab it has, with what the file says now', async () => {
    const file = await writeDoc('live.md', 'before');
    const other = await writeDoc('other.md', 'other');
    const { controller } = createHarness();
    const first = await controller.openPath(file);
    await controller.openPath(other);
    await writeFile(file, 'after');

    const again = await controller.openPath(file);

    expect(tabIdOf(again)).toBe(tabIdOf(first));
    expect(openedDocument(again).content).toBe('after');
    expect(pathsOf(controller)).toEqual([file, other]);
    expect(controller.getCurrentDocumentPath()).toBe(file);
  });

  it('keeps the tabs as they are when a different file fails to open', async () => {
    const file = await writeDoc('current.md', 'current');
    const { controller } = createHarness();
    await controller.openPath(file);

    const outcome = await controller.openPath(path.join(workDir, 'gone.md'));

    expect(outcome.status).toBe('failed');
    expect(pathsOf(controller)).toEqual([file]);
    expect(controller.getCurrentDocumentPath()).toBe(file);
  });

  it('does not tell the page again when nothing about the tabs has changed', async () => {
    const file = await writeDoc('same.md', 'same');
    const { controller, window, sessions } = createHarness();
    const tab = tabIdOf(await controller.openPath(file));
    expect(window.tabs).toHaveLength(1);

    await controller.openPath(file);
    await controller.reload(tab);

    expect(window.tabs).toHaveLength(1);
    expect(sessions).toHaveLength(1);
  });

  it('says that the file could not be opened when the document service gives up', async () => {
    const documents: DocumentService = { open: () => Promise.reject(new Error('boom')) };
    const { controller } = createHarness({ documents });

    const outcome = await controller.openPath(path.join(workDir, 'x.md'));

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'unreadable' } });
  });

  it('goes on without a window, and still lets the tabs be remembered', async () => {
    const sessions: SessionData[] = [];
    const controller = new AppController({
      documents: createDocumentService(),
      getWindow: () => undefined,
      showOpenDialog: () => Promise.resolve([]),
      isPackaged: true,
      onTabsChanged: (session) => {
        sessions.push(session);
      },
    });
    const file = await writeDoc('quiet.md', 'quiet');

    expect((await controller.openPath(file)).status).toBe('opened');

    expect(sessions.at(-1)).toEqual({ paths: [file], active: 0 });
  });

  describe('the limit on tabs', () => {
    async function fillToTheLimit(controller: AppController): Promise<string[]> {
      const files = Array.from({ length: MAX_TABS }, (_unused, n) =>
        path.join(workDir, `doc ${n}.md`),
      );
      for (const file of files) await controller.openPath(file);
      return files;
    }

    it('refuses another tab, says what to do about it, and does not read the file', async () => {
      const open = vi.fn((input: unknown) => Promise.resolve(fakeDocument(String(input), 'x')));
      const { controller } = createHarness({ documents: { open } });
      await fillToTheLimit(controller);
      open.mockClear();

      const outcome = await controller.openPath(path.join(workDir, 'one too many.md'));

      expect(outcome).toMatchObject({
        status: 'failed',
        error: { code: 'too-many-tabs', message: expect.stringContaining('Close a tab') as string },
      });
      expect(open).not.toHaveBeenCalled();
      expect(controller.getTabs().tabs).toHaveLength(MAX_TABS);
    });

    it('still shows a document that is already open', async () => {
      const { controller } = createHarness({ documents: everyFileExists });
      const files = await fillToTheLimit(controller);

      const outcome = await controller.openPath(files[3]);

      expect(outcome.status).toBe('opened');
      expect(controller.getTabs().tabs).toHaveLength(MAX_TABS);
      expect(controller.getCurrentDocumentPath()).toBe(files[3]);
    });

    it('refuses the tab that no longer fits once its file has been read', async () => {
      const lateA = path.join(workDir, 'late a.md');
      const lateB = path.join(workDir, 'late b.md');
      const { documents, finish } = holdingDocuments([lateA, lateB]);
      const { controller } = createHarness({ documents });
      for (let n = 0; n < MAX_TABS - 1; n += 1) {
        await controller.openPath(path.join(workDir, `doc ${n}.md`));
      }

      const first = controller.openPath(lateA);
      const second = controller.openPath(lateB);
      finish(lateA);
      finish(lateB);

      expect((await first).status).toBe('opened');
      expect(await second).toMatchObject({ status: 'failed', error: { code: 'too-many-tabs' } });
      expect(controller.getTabs().tabs).toHaveLength(MAX_TABS);
    });

    it('counts the new tabs of a batch as it goes, so that the files that would not fit are not read', async () => {
      const open = vi.fn((input: unknown) => Promise.resolve(fakeDocument(String(input), 'x')));
      const { controller } = createHarness({ documents: { open } });
      for (let n = 0; n < MAX_TABS - 2; n += 1) {
        await controller.openPath(path.join(workDir, `doc ${n}.md`));
      }
      open.mockClear();

      const outcomes = await controller.openPaths(
        ['x', 'y', 'z', 'w'].map((name) => path.join(workDir, `${name}.md`)),
      );

      expect(open).toHaveBeenCalledTimes(2);
      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        'opened',
        'opened',
        'failed',
        'failed',
      ]);
    });
  });

  describe('reloading', () => {
    it('reads the document of the tab named from disk again, in the same tab', async () => {
      const file = await writeDoc('live.md', 'before');
      const { controller } = createHarness();
      const opened = await controller.openPath(file);
      await writeFile(file, 'after');

      const reloaded = await controller.reload(tabIdOf(opened));

      expect(openedDocument(reloaded).content).toBe('after');
      expect(tabIdOf(reloaded)).toBe(tabIdOf(opened));
    });

    it('reloads the tab the page names, though another tab is on screen', async () => {
      const first = await writeDoc('first.md', 'first before');
      const second = await writeDoc('second.md', 'second');
      const { controller } = createHarness();
      const tab = tabIdOf(await controller.openPath(first));
      await controller.openPath(second);
      await writeFile(first, 'first after');

      const reloaded = await controller.reload(tab);

      expect(tabIdOf(reloaded)).toBe(tab);
      expect(openedDocument(reloaded).content).toBe('first after');
      expect(controller.getCurrentDocumentPath()).toBe(second);
    });

    it.each(['tab-999', 'C:\\private\\notes.md', 42, null, undefined, {}])(
      'has nothing to reload for %j, which is no tab that is open',
      async (id) => {
        const { controller } = createHarness({ documents: everyFileExists });
        await controller.openPath(path.join(workDir, 'open.md'));

        expect(await controller.reload(id)).toEqual({ status: 'canceled' });
      },
    );

    it('keeps the tab when the file has gone, so that the reader can see which one it was', async () => {
      const file = await writeDoc('vanishing.md', 'here');
      const { controller } = createHarness();
      const tab = tabIdOf(await controller.openPath(file));
      await rm(file);

      expect(await controller.reload(tab)).toMatchObject({
        status: 'failed',
        error: { code: 'not-found' },
      });
      expect(pathsOf(controller)).toEqual([file]);
    });
  });
});

describe('AppController: going back to documents that were already shown', () => {
  it('shows an earlier document in the same tab, and leaves the other tabs alone', async () => {
    const first = await writeDoc('first.md', 'first');
    const second = await writeDoc('second.md', 'second');
    const other = await writeDoc('other.md', 'other');
    const { controller } = createHarness();
    const tab = tabIdOf(await controller.openPath(first));
    await controller.openLink(fileUrl(second));
    await controller.openPath(other);
    controller.activateTab(tab);

    const outcome = await controller.reopen(tab, first);

    expect(openedDocument(outcome).content).toBe('first');
    expect(tabIdOf(outcome)).toBe(tab);
    expect(pathsOf(controller)).toEqual([first, other]);
    expect(controller.getCurrentDocumentPath()).toBe(first);
  });

  it('goes back in the tab the page names, though another tab is on screen', async () => {
    const first = await writeDoc('first.md', 'first');
    const second = await writeDoc('second.md', 'second');
    const other = await writeDoc('other.md', 'other');
    const { controller } = createHarness();
    const tab = tabIdOf(await controller.openPath(first));
    await controller.openLink(fileUrl(second));
    await controller.openPath(other);

    const outcome = await controller.reopen(tab, first);

    expect(tabIdOf(outcome)).toBe(tab);
    expect(pathsOf(controller)).toEqual([first, other]);
    expect(controller.getCurrentDocumentPath()).toBe(other);
  });

  it('refuses a document that was never shown, even though it exists', async () => {
    // The page may be compromised by a hostile document; it must not be able to read other files.
    const shown = await writeDoc('shown.md', 'shown');
    const private_ = await writeDoc('private/notes.md', 'private notes');
    const { controller } = createHarness();
    const tab = tabIdOf(await controller.openPath(shown));

    const outcome = await controller.reopen(tab, private_);

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'not-found' } });
    expect(controller.getCurrentDocumentPath()).toBe(shown);
  });

  it.each([42, null, undefined, {}, ''])('refuses %j', async (input) => {
    const { controller } = createHarness({ documents: everyFileExists });
    const tab = tabIdOf(await controller.openPath(path.join(workDir, 'open.md')));

    expect(await controller.reopen(tab, input)).toMatchObject({ status: 'failed' });
  });

  it.each(['tab-999', 'C:\\private\\notes.md', 42, null, undefined, {}])(
    'has nothing to go back in for %j, which is no tab that is open',
    async (id) => {
      const { controller } = createHarness({ documents: everyFileExists });
      const file = path.join(workDir, 'open.md');
      await controller.openPath(file);

      expect(await controller.reopen(id, file)).toEqual({ status: 'canceled' });
    },
  );

  it('does not count a document that failed to open as shown', async () => {
    const other = await writeDoc('other.md', 'other');
    const { controller } = createHarness();
    const tab = tabIdOf(await controller.openPath(other));
    const missing = path.join(workDir, 'missing.md');
    await controller.openPath(missing);
    await writeFile(missing, 'it exists now');

    expect(await controller.reopen(tab, missing)).toMatchObject({ status: 'failed' });
  });

  it('has nowhere to go back to once the tab is closed', async () => {
    const file = await writeDoc('closed.md', 'closed');
    const { controller } = createHarness();
    const tab = tabIdOf(await controller.openPath(file));
    controller.closeTab(tab);

    expect(await controller.reopen(tab, file)).toEqual({ status: 'canceled' });
    expect(controller.getTabs().tabs).toEqual([]);
  });

  it('remembers a limited number of documents', async () => {
    const { controller } = createHarness({ documents: everyFileExists });
    const files = Array.from({ length: 205 }, (_unused, n) => path.join(workDir, `doc ${n}.md`));
    const tab = tabIdOf(await controller.openPath(files[0]));
    for (const file of files.slice(1)) await controller.openLink(fileUrl(file));

    expect(await controller.reopen(tab, files[0])).toMatchObject({ status: 'failed' });
    expect((await controller.reopen(tab, files[204])).status).toBe('opened');
  });

  it('counts a document that was shown again among the latest, so that it is not the first to be forgotten', async () => {
    const { controller } = createHarness({ documents: everyFileExists });
    const files = Array.from({ length: 205 }, (_unused, n) => path.join(workDir, `doc ${n}.md`));
    const tab = tabIdOf(await controller.openPath(files[0]));
    for (const file of files.slice(1, 150)) await controller.openLink(fileUrl(file));
    await controller.openLink(fileUrl(files[0] ?? ''));
    for (const file of files.slice(150)) await controller.openLink(fileUrl(file));

    expect((await controller.reopen(tab, files[0])).status).toBe('opened');
    expect(await controller.reopen(tab, files[1])).toMatchObject({ status: 'failed' });
  });
});

describe('AppController: following links in a document', () => {
  it('opens a linked Markdown file in the same tab and passes the anchor along', async () => {
    const index = await writeDoc('docs/index.md', 'index');
    const guide = await writeDoc('docs/guide to it.md', 'guide');
    const { controller } = createHarness();
    const tab = await controller.openPath(index);

    const outcome = await controller.openLink(`${fileUrl(guide)}#install`);

    expect(openedDocument(outcome).content).toBe('guide');
    expect(outcome).toMatchObject({ status: 'opened', anchor: 'install', tabId: tabIdOf(tab) });
    expect(pathsOf(controller)).toEqual([guide]);
    expect(controller.getCurrentDocumentPath()).toBe(guide);
  });

  it('opens it in a tab of its own when asked to, and leaves the first tab as it was', async () => {
    const index = await writeDoc('docs/index.md', 'index');
    const guide = await writeDoc('docs/guide.md', 'guide');
    const { controller } = createHarness();
    const first = await controller.openPath(index);

    const outcome = await controller.openLink(fileUrl(guide), { newTab: true });

    expect(tabIdOf(outcome)).not.toBe(tabIdOf(first));
    expect(pathsOf(controller)).toEqual([index, guide]);
    expect(controller.getCurrentDocumentPath()).toBe(guide);
  });

  it('shows the tab that has the linked file already, when asked for a tab of its own', async () => {
    const index = await writeDoc('docs/index.md', 'index');
    const guide = await writeDoc('docs/guide.md', 'guide');
    const { controller } = createHarness();
    const first = await controller.openPath(index);
    const second = await controller.openPath(guide);
    controller.activateTab(tabIdOf(first));

    const outcome = await controller.openLink(fileUrl(guide), { newTab: true });

    expect(tabIdOf(outcome)).toBe(tabIdOf(second));
    expect(pathsOf(controller)).toEqual([index, guide]);
    expect(controller.getTabs().activeId).toBe(tabIdOf(second));
  });

  it('lets a tab follow a link to a document that another tab already shows', async () => {
    const index = await writeDoc('docs/index.md', 'index');
    const guide = await writeDoc('docs/guide.md', 'guide');
    const { controller } = createHarness();
    const first = await controller.openPath(index);
    await controller.openPath(guide);
    controller.activateTab(tabIdOf(first));

    await controller.openLink(fileUrl(guide));

    expect(pathsOf(controller)).toEqual([guide, guide]);
  });

  it('opens a link in a tab of its own when no tab is open to follow it in', async () => {
    const guide = await writeDoc('docs/guide.md', 'guide');
    const { controller } = createHarness();

    const outcome = await controller.openLink(fileUrl(guide));

    expect(openedDocument(outcome).content).toBe('guide');
    expect(pathsOf(controller)).toEqual([guide]);
  });

  it('refuses a tab of its own for a link when there can be no more tabs', async () => {
    const { controller } = createHarness({ documents: everyFileExists });
    for (let n = 0; n < MAX_TABS; n += 1) {
      await controller.openPath(path.join(workDir, `doc ${n}.md`));
    }

    const outcome = await controller.openLink(fileUrl(path.join(workDir, 'more.md')), {
      newTab: true,
    });

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'too-many-tabs' } });
  });

  it('follows the link in the tab that was on screen when it was clicked, even if the reader has moved on', async () => {
    const index = await writeDoc('docs/index.md', 'index');
    const other = await writeDoc('docs/other.md', 'other');
    const guide = path.join(workDir, 'docs', 'guide.md');
    const { documents, finish } = holdingDocuments([guide], createDocumentService());
    const { controller } = createHarness({ documents });
    const first = await controller.openPath(index);
    const second = await controller.openPath(other);

    controller.activateTab(tabIdOf(first));
    const following = controller.openLink(fileUrl(guide));
    controller.activateTab(tabIdOf(second));
    finish(guide, 'guide');
    const outcome = await following;

    expect(tabIdOf(outcome)).toBe(tabIdOf(first));
    expect(pathsOf(controller)).toEqual([guide, other]);
    expect(controller.getCurrentDocumentPath()).toBe(other);
  });

  describe('in the tab the page names', () => {
    it('follows the link in that tab, though the main process has another one on screen', async () => {
      const index = await writeDoc('docs/index.md', 'index');
      const other = await writeDoc('docs/other.md', 'other');
      const guide = await writeDoc('docs/guide.md', 'guide');
      const { controller } = createHarness();
      const first = tabIdOf(await controller.openPath(index));
      await controller.openPath(other);

      const outcome = await controller.openLink(fileUrl(guide), { tabId: first });

      expect(tabIdOf(outcome)).toBe(first);
      expect(pathsOf(controller)).toEqual([guide, other]);
      expect(controller.getCurrentDocumentPath()).toBe(other);
    });

    it('checks the link against the document of that tab, not the one on screen', async () => {
      const open = vi.fn((input: unknown, _options?: OpenOptions) =>
        Promise.resolve(fakeDocument(String(input), 'x')),
      );
      const { controller } = createHarness({ documents: { open } });
      const index = path.join(workDir, 'docs', 'index.md');
      const other = path.join(workDir, 'elsewhere', 'other.md');
      const guide = path.join(workDir, 'docs', 'guide.md');
      const first = tabIdOf(await controller.openPath(index));
      await controller.openPath(other);

      await controller.openLink(fileUrl(guide), { tabId: first });

      expect(open).toHaveBeenLastCalledWith(guide, { fromLink: { currentDocumentPath: index } });
    });

    it('opens a link in a tab of its own, without touching the tab that was named', async () => {
      const index = await writeDoc('docs/index.md', 'index');
      const guide = await writeDoc('docs/guide.md', 'guide');
      const { controller } = createHarness();
      const first = tabIdOf(await controller.openPath(index));

      const outcome = await controller.openLink(fileUrl(guide), { tabId: first, newTab: true });

      expect(tabIdOf(outcome)).not.toBe(first);
      expect(pathsOf(controller)).toEqual([index, guide]);
    });

    it.each(['tab-999', 'C:\\private\\notes.md', 'not a tab'])(
      'does nothing for a link in %j, which is no tab that is open, and reads nothing',
      async (id) => {
        const open = vi.fn((input: unknown) => Promise.resolve(fakeDocument(String(input), 'x')));
        const { controller } = createHarness({ documents: { open } });
        await controller.openPath(path.join(workDir, 'docs', 'index.md'));
        open.mockClear();

        const outcome = await controller.openLink(fileUrl(path.join(workDir, 'docs', 'guide.md')), {
          tabId: id,
        });

        expect(outcome).toEqual({ status: 'canceled' });
        expect(open).not.toHaveBeenCalled();
      },
    );

    it('does nothing for a link in a tab that was closed, and reads nothing', async () => {
      const open = vi.fn((input: unknown) => Promise.resolve(fakeDocument(String(input), 'x')));
      const { controller } = createHarness({ documents: { open } });
      const tab = tabIdOf(await controller.openPath(path.join(workDir, 'docs', 'index.md')));
      controller.closeTab(tab);
      open.mockClear();

      const outcome = await controller.openLink(fileUrl(path.join(workDir, 'docs', 'guide.md')), {
        tabId: tab,
      });

      expect(outcome).toEqual({ status: 'canceled' });
      expect(open).not.toHaveBeenCalled();
    });
  });

  it('shows the newest link when two are followed in the same tab, whichever answers first', async () => {
    const index = path.join(workDir, 'docs', 'index.md');
    const slow = path.join(workDir, 'docs', 'slow.md');
    const fast = path.join(workDir, 'docs', 'fast.md');
    const { documents, finish } = holdingDocuments([slow, fast]);
    const { controller } = createHarness({ documents });
    await controller.openPath(index);

    const older = controller.openLink(fileUrl(slow));
    const newer = controller.openLink(fileUrl(fast));
    finish(fast, 'fast');
    finish(slow, 'slow');

    expect((await newer).status).toBe('opened');
    expect(await older).toEqual({ status: 'canceled' });
    expect(pathsOf(controller)).toEqual([fast]);
  });

  it('shows nothing, and brings no tab back, when the tab was closed while its link was loading', async () => {
    const index = path.join(workDir, 'docs', 'index.md');
    const guide = path.join(workDir, 'docs', 'guide.md');
    const { documents, finish } = holdingDocuments([guide]);
    const { controller } = createHarness({ documents });
    const tab = await controller.openPath(index);

    const following = controller.openLink(fileUrl(guide));
    controller.closeTab(tabIdOf(tab));
    finish(guide);

    expect(await following).toEqual({ status: 'canceled' });
    expect(controller.getTabs().tabs).toEqual([]);
  });

  it('has the document service check a linked file for symbolic links, and no other kind of open', async () => {
    const open = vi.fn((input: unknown, _options?: OpenOptions) =>
      Promise.resolve(fakeDocument(String(input), 'x')),
    );
    const { controller } = createHarness({ documents: { open } });
    const index = path.join(workDir, 'docs', 'index.md');
    const guide = path.join(workDir, 'docs', 'guide.md');

    await controller.openPath(index);
    await controller.openLink(fileUrl(guide));

    expect(open).toHaveBeenNthCalledWith(1, index, undefined);
    expect(open).toHaveBeenNthCalledWith(2, guide, { fromLink: { currentDocumentPath: index } });
  });

  it('checks a link against the document of the tab that is on screen when the page names none', async () => {
    const open = vi.fn((input: unknown, _options?: OpenOptions) =>
      Promise.resolve(fakeDocument(String(input), 'x')),
    );
    const { controller } = createHarness({ documents: { open } });
    const index = path.join(workDir, 'docs', 'index.md');
    const other = path.join(workDir, 'docs', 'other.md');
    const guide = path.join(workDir, 'docs', 'guide.md');
    const first = await controller.openPath(index);
    await controller.openPath(other);
    controller.activateTab(tabIdOf(first));

    await controller.openLink(fileUrl(guide));

    expect(open).toHaveBeenLastCalledWith(guide, { fromLink: { currentDocumentPath: index } });
  });

  it('refuses a link to a file that is not Markdown', async () => {
    const index = await writeDoc('docs/index.md', 'index');
    const other = await writeDoc('docs/run.bat', 'echo hi');
    const { controller } = createHarness();
    await controller.openPath(index);

    const outcome = await controller.openLink(fileUrl(other));

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'unsupported-type' } });
    expect(controller.getCurrentDocumentPath()).toBe(index);
  });

  it('refuses anything that is not a file link', async () => {
    const { controller } = createHarness();
    expect(await controller.openLink('https://example.com/a.md')).toMatchObject({
      status: 'failed',
      error: { code: 'blocked-link' },
    });
  });

  it.skipIf(!onWindows)('refuses a link into a network share the document is not on', async () => {
    const index = await writeDoc('docs/index.md', 'index');
    const { controller } = createHarness();
    await controller.openPath(index);

    const outcome = await controller.openLink('file://evil.example/share/a.md');

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'blocked-link' } });
  });
});

describe('AppController: requests that overlap', () => {
  it('lets an older request that finds its file already open leave the screen to a newer one', async () => {
    const a = path.join(workDir, 'a.md');
    const b = path.join(workDir, 'b.md');
    const c = path.join(workDir, 'c.md');
    const { documents, hold, finish } = holdingDocuments();
    const { controller } = createHarness({ documents });
    await controller.openPath(a);
    await controller.openPath(b);
    hold(a);

    const older = controller.openPath(a);
    await controller.openPath(c);
    finish(a);
    await older;

    expect(controller.getCurrentDocumentPath()).toBe(c);
  });

  it('shows what an older request opened when the newer one opened nothing', async () => {
    const current = path.join(workDir, 'current.md');
    const slow = path.join(workDir, 'slow.md');
    const { documents, finish } = holdingDocuments([slow], createDocumentService());
    await writeFile(current, 'current');
    const { controller } = createHarness({ documents });
    await controller.openPath(current);

    const older = controller.openPath(slow);
    const newer = await controller.openPath(path.join(workDir, 'missing.md'));
    expect(newer.status).toBe('failed');
    finish(slow);
    await older;

    expect(controller.getCurrentDocumentPath()).toBe(slow);
  });

  it('shows a file that was opened while none was on screen, whichever request opened it', async () => {
    const slow = path.join(workDir, 'slow.md');
    const { documents, finish } = holdingDocuments([slow], createDocumentService());
    const { controller } = createHarness({ documents });

    const older = controller.openPath(slow);
    await controller.openPath(path.join(workDir, 'missing.md'));
    finish(slow);
    await older;

    expect(controller.getCurrentDocumentPath()).toBe(slow);
    expect(controller.getTabs().activeId).toBeDefined();
  });

  it.each(['a reload', 'going back'] as const)(
    'gives way when %s is overtaken by a link followed in the same tab',
    async (kind) => {
      const index = path.join(workDir, 'docs', 'index.md');
      const guide = path.join(workDir, 'docs', 'guide.md');
      const next = path.join(workDir, 'docs', 'next.md');
      const { documents, hold, finish } = holdingDocuments();
      const { controller } = createHarness({ documents });
      const tab = tabIdOf(await controller.openPath(index));
      await controller.openLink(fileUrl(guide));
      // A reload reads the document that is shown; going back reads the one that was left.
      const held = kind === 'a reload' ? guide : index;
      hold(held);

      const overtaken =
        kind === 'a reload' ? controller.reload(tab) : controller.reopen(tab, index);
      await controller.openLink(fileUrl(next));
      finish(held);

      expect(await overtaken).toEqual({ status: 'canceled' });
      expect(pathsOf(controller)).toEqual([next]);
    },
  );

  describe('a batch of files', () => {
    it('gives a tab of its own to a file whose tab followed a link while the other files were being read', async () => {
      const x = path.join(workDir, 'x.md');
      const y = path.join(workDir, 'y.md');
      const z = path.join(workDir, 'z.md');
      const { documents, hold, finish } = holdingDocuments();
      const { controller } = createHarness({ documents });
      const tab = tabIdOf(await controller.openPath(x));
      hold(y);

      const batch = controller.openPaths([x, y]);
      await controller.openLink(fileUrl(z), { tabId: tab });
      finish(y);
      const outcomes = await batch;

      // The tab that had x shows z now, so what the batch says about x must not name it.
      expect(tabIdOf(outcomes[0])).not.toBe(tab);
      expect(pathsOf(controller)).toEqual([z, x, y]);
      expect(controller.getTabs().tabs.find((candidate) => candidate.path === x)?.id).toBe(
        tabIdOf(outcomes[0]),
      );
    });

    it('opens a file again when the tab that had it was closed while the other files were being read', async () => {
      const x = path.join(workDir, 'x.md');
      const y = path.join(workDir, 'y.md');
      const { documents, hold, finish } = holdingDocuments();
      const { controller } = createHarness({ documents });
      const tab = tabIdOf(await controller.openPath(x));
      hold(y);

      const batch = controller.openPaths([x, y]);
      controller.closeTab(tab);
      finish(y);
      const outcomes = await batch;

      expect(outcomes.map((outcome) => outcome.status)).toEqual(['opened', 'opened']);
      expect(tabIdOf(outcomes[0])).not.toBe(tab);
      expect(pathsOf(controller)).toEqual([x, y]);
    });
  });
});

describe('AppController: the tabs', () => {
  async function threeTabs() {
    const harness = createHarness();
    const a = await writeDoc('a.md', 'a');
    const b = await writeDoc('b.md', 'b');
    const c = await writeDoc('c.md', 'c');
    const ids: [string, string, string] = [
      tabIdOf(await harness.controller.openPath(a)),
      tabIdOf(await harness.controller.openPath(b)),
      tabIdOf(await harness.controller.openPath(c)),
    ];
    return { ...harness, a, b, c, ids };
  }

  it('switches to a tab, so that links and images are resolved against its document', async () => {
    const { controller, window, sessions, a, b, c, ids } = await threeTabs();
    const pushed = window.tabs.length;

    controller.activateTab(ids[0]);

    expect(controller.getCurrentDocumentPath()).toBe(a);
    expect(controller.getTabs().activeId).toBe(ids[0]);
    expect(window.tabs).toHaveLength(pushed + 1);
    expect(window.tabs.at(-1)?.activeId).toBe(ids[0]);
    expect(sessions.at(-1)).toEqual({ paths: [a, b, c], active: 0 });
  });

  it.each(['tab-999', 'C:\\private\\notes.md', 42, null, undefined, {}])(
    'ignores an id that it did not issue: %j',
    async (id) => {
      const { controller, window, c, ids } = await threeTabs();
      const pushed = window.tabs.length;

      controller.activateTab(id);
      controller.closeTab(id);
      controller.moveTab(id, 0);

      expect(controller.getTabs().activeId).toBe(ids[2]);
      expect(controller.getTabs().tabs).toHaveLength(3);
      expect(controller.getCurrentDocumentPath()).toBe(c);
      expect(window.tabs).toHaveLength(pushed);
    },
  );

  it('closes a tab and passes on to the one next to it', async () => {
    const { controller, a, c, ids } = await threeTabs();
    controller.activateTab(ids[1]);

    controller.closeTab(ids[1]);

    expect(pathsOf(controller)).toEqual([a, c]);
    expect(controller.getTabs().activeId).toBe(ids[2]);
    expect(controller.getCurrentDocumentPath()).toBe(c);
  });

  it('has no current document once the last tab is closed', async () => {
    const harness = createHarness();
    const tab = await harness.controller.openPath(await writeDoc('only.md', 'only'));

    harness.controller.closeTab(tabIdOf(tab));

    expect(harness.controller.getTabs()).toMatchObject({ tabs: [], activeId: undefined });
    expect(harness.controller.getCurrentDocumentPath()).toBeUndefined();
    expect(harness.sessions.at(-1)).toEqual({ paths: [], active: 0 });
  });

  it('moves a tab to another place and keeps the one on screen', async () => {
    const { controller, a, b, c, ids } = await threeTabs();

    controller.moveTab(ids[2], 0);

    expect(pathsOf(controller)).toEqual([c, a, b]);
    expect(controller.getTabs().activeId).toBe(ids[2]);
  });

  it.each(['1', 1.5, Number.NaN, null, undefined])(
    'ignores a place that is not a whole number: %j',
    async (place) => {
      const { controller, window, a, b, c, ids } = await threeTabs();
      const pushed = window.tabs.length;

      controller.moveTab(ids[2], place);

      expect(pathsOf(controller)).toEqual([a, b, c]);
      expect(window.tabs).toHaveLength(pushed);
    },
  );

  describe('reading the document of a tab', () => {
    it('gives the document, without making the tab the one on screen', async () => {
      const { controller, window, a, ids } = await threeTabs();
      const pushed = window.tabs.length;

      const outcome = await controller.loadTab(ids[0]);

      expect(openedDocument(outcome).path).toBe(a);
      expect(tabIdOf(outcome)).toBe(ids[0]);
      expect(controller.getTabs().activeId).toBe(ids[2]);
      expect(window.tabs).toHaveLength(pushed);
    });

    it('says so when the tab is not one it issued, and reads nothing', async () => {
      const open = vi.fn((input: unknown) => Promise.resolve(fakeDocument(String(input), 'x')));
      const { controller } = createHarness({ documents: { open } });

      expect(await controller.loadTab('tab-999')).toMatchObject({
        status: 'failed',
        error: { code: 'not-found' },
      });
      expect(await controller.loadTab('C:\\private\\notes.md')).toMatchObject({
        status: 'failed',
      });
      expect(open).not.toHaveBeenCalled();
    });

    it('keeps the tab when its file cannot be read, so that the reader sees which one is gone', async () => {
      const harness = createHarness();
      const file = await writeDoc('vanishing.md', 'here');
      const tab = await harness.controller.openPath(file);
      await rm(file);

      const outcome = await harness.controller.loadTab(tabIdOf(tab));

      expect(outcome).toMatchObject({ status: 'failed', error: { code: 'not-found' } });
      expect(pathsOf(harness.controller)).toEqual([file]);
    });

    it('hands back nothing when the tab shows another document by the time its file was read', async () => {
      const old = path.join(workDir, 'old.md');
      const newer = path.join(workDir, 'newer.md');
      const { documents, finish } = holdingDocuments([old]);
      const { controller } = createHarness({ documents });
      controller.restoreSession({ paths: [old], active: 0 });
      const id = controller.getTabs().activeId ?? '';

      const loading = controller.loadTab(id);
      await controller.openLink(fileUrl(newer));
      finish(old);

      expect(await loading).toEqual({ status: 'canceled' });
      expect(pathsOf(controller)).toEqual([newer]);
    });

    it('hands back nothing, and remembers nothing, for a tab that was closed while its file was read', async () => {
      const old = path.join(workDir, 'old.md');
      const { documents, finish } = holdingDocuments([old]);
      const { controller } = createHarness({ documents });
      controller.restoreSession({ paths: [old], active: 0 });
      const id = controller.getTabs().activeId ?? '';

      const loading = controller.loadTab(id);
      controller.closeTab(id);
      finish(old);

      expect(await loading).toEqual({ status: 'canceled' });
      // What was read was never shown, so it is not a document that the reader may go back to.
      const other = tabIdOf(await controller.openPath(path.join(workDir, 'other.md')));
      expect(await controller.reopen(other, old)).toMatchObject({
        status: 'failed',
        error: { code: 'not-found' },
      });
    });

    it('reads the file once for requests that come while it is being read, and again for a later one', async () => {
      const file = path.join(workDir, 'a.md');
      const { documents, hold, finish } = holdingDocuments();
      const open = vi.fn(documents.open);
      const { controller } = createHarness({ documents: { open } });
      controller.restoreSession({ paths: [file], active: 0 });
      const id = controller.getTabs().activeId ?? '';
      hold(file);

      const first = controller.loadTab(id);
      const second = controller.loadTab(id);
      finish(file, 'text');
      const answers = await Promise.all([first, second]);

      expect(open).toHaveBeenCalledOnce();
      expect(answers[0]).toEqual(answers[1]);
      expect(openedDocument(answers[0]).content).toBe('text');

      await controller.loadTab(id);
      expect(open).toHaveBeenCalledTimes(2);
    });
  });
});

describe('AppController: tabs from an earlier session', () => {
  it('shows the tabs at once without reading any file, and makes the chosen one active', () => {
    const open = vi.fn((input: unknown) => Promise.resolve(fakeDocument(String(input), 'x')));
    const { controller, window, sessions } = createHarness({ documents: { open } });
    const a = path.join(workDir, 'a.md');
    const b = path.join(workDir, 'b.md');

    controller.restoreSession({ paths: [a, b], active: 1 });

    expect(pathsOf(controller)).toEqual([a, b]);
    expect(controller.getCurrentDocumentPath()).toBe(b);
    expect(open).not.toHaveBeenCalled();
    // Nothing changed: what was saved is what was restored.
    expect(window.tabs).toEqual([]);
    expect(sessions).toEqual([]);
  });

  it('tidies the paths it was given', () => {
    const { controller } = createHarness();
    const untidy = path.join(workDir, 'sub', '..', 'a.md');

    controller.restoreSession({ paths: [untidy], active: 0 });

    expect(pathsOf(controller)).toEqual([path.join(workDir, 'a.md')]);
  });

  it('gives back the tabs and the place of the active one, so that they can be saved', async () => {
    const harness = createHarness();
    const a = await writeDoc('a.md', 'a');
    const b = await writeDoc('b.md', 'b');
    await harness.controller.openPath(a);
    const second = await harness.controller.openPath(b);
    harness.controller.activateTab(tabIdOf(second));

    expect(harness.controller.sessionData()).toEqual({ paths: [a, b], active: 1 });
  });

  it('reads a restored tab when the page asks for it, and the file opens as any other does', async () => {
    const file = await writeDoc('restored.md', '# Restored');
    const { controller } = createHarness();
    controller.restoreSession({ paths: [file], active: 0 });
    const id = controller.getTabs().activeId ?? '';

    const outcome = await controller.loadTab(id);

    expect(openedDocument(outcome).content).toBe('# Restored');
  });

  it('lets the reader go back to a document a restored tab showed, once it has been read', async () => {
    const first = await writeDoc('first.md', 'first');
    const second = await writeDoc('second.md', 'second');
    const { controller } = createHarness();
    controller.restoreSession({ paths: [first], active: 0 });
    const tab = controller.getTabs().activeId ?? '';
    await controller.loadTab(tab);
    await controller.openLink(fileUrl(second));

    expect(openedDocument(await controller.reopen(tab, first)).content).toBe('first');
  });

  it('puts a file named at launch after the restored tabs, and shows it', async () => {
    const restored = await writeDoc('restored.md', 'restored');
    const launched = await writeDoc('launched.md', 'launched');
    const { controller, window } = createHarness();
    controller.restoreSession({ paths: [restored], active: 0 });

    controller.handleLaunch([exe, launched], workDir);
    controller.rendererReady();
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));

    expect(pathsOf(controller)).toEqual([restored, launched]);
    expect(controller.getCurrentDocumentPath()).toBe(launched);
  });

  describe('is read with care', () => {
    // The paths in the file of remembered tabs were not chosen by the user this time. A file that was
    // an ordinary one when the tab was saved can have become a link to a network share (a repository
    // that was updated), and reading that would send the reader's credentials to its server.
    const file = (): string => path.join(workDir, 'a.md');

    function stub() {
      return vi.fn((input: unknown, _options?: OpenOptions) =>
        Promise.resolve(fakeDocument(String(input), 'x')),
      );
    }

    it('the first time, as a link in a document is, and as an ordinary document after that', async () => {
      const open = stub();
      const { controller } = createHarness({ documents: { open } });
      controller.restoreSession({ paths: [file()], active: 0 });
      const id = controller.getTabs().activeId ?? '';

      await controller.loadTab(id);
      await controller.loadTab(id);

      expect(open.mock.calls).toEqual([
        [file(), { fromLink: { currentDocumentPath: undefined } }],
        [file(), undefined],
      ]);
    });

    it('again, if reading it was refused, because nothing has shown that the file is all right', async () => {
      const open = vi.fn((_input: unknown, _options?: OpenOptions) =>
        Promise.resolve<DocumentOutcome>({
          status: 'failed',
          error: { code: 'blocked-link', message: 'blocked' },
        }),
      );
      const { controller } = createHarness({ documents: { open } });
      controller.restoreSession({ paths: [file()], active: 0 });
      const id = controller.getTabs().activeId ?? '';

      const outcome = await controller.loadTab(id);
      await controller.loadTab(id);

      expect(outcome).toMatchObject({ status: 'failed', error: { code: 'blocked-link' } });
      expect(open).toHaveBeenCalledTimes(2);
      expect(open.mock.calls.every(([, options]) => options?.fromLink !== undefined)).toBe(true);
    });

    it.skipIf(!onWindows)(
      'without being read at all, when its path points at a network share',
      async () => {
        const open = stub();
        const { controller } = createHarness({ documents: { open } });
        controller.restoreSession({ paths: ['\\\\server\\share\\a.md'], active: 0 });
        const id = controller.getTabs().activeId ?? '';

        const outcome = await controller.loadTab(id);

        expect(outcome).toMatchObject({ status: 'failed', error: { code: 'blocked-link' } });
        expect(open).not.toHaveBeenCalled();
      },
    );

    it('no longer once the user has opened that file themselves', async () => {
      const open = stub();
      const { controller } = createHarness({ documents: { open } });
      controller.restoreSession({ paths: [file()], active: 0 });
      const id = controller.getTabs().activeId ?? '';
      await controller.openPath(file());
      open.mockClear();

      await controller.loadTab(id);

      expect(open.mock.calls).toEqual([[file(), undefined]]);
    });

    it('no longer once a link has been followed in it', async () => {
      const open = stub();
      const { controller } = createHarness({ documents: { open } });
      controller.restoreSession({ paths: [file()], active: 0 });
      const id = controller.getTabs().activeId ?? '';
      const guide = path.join(workDir, 'guide.md');
      await controller.openLink(fileUrl(guide));
      open.mockClear();

      await controller.loadTab(id);

      expect(open.mock.calls).toEqual([[guide, undefined]]);
    });

    it('not for a document that the user opened this time', async () => {
      const open = stub();
      const { controller } = createHarness({ documents: { open } });
      const id = tabIdOf(await controller.openPath(file()));
      open.mockClear();

      await controller.loadTab(id);

      expect(open.mock.calls).toEqual([[file(), undefined]]);
    });

    it('not any more once its tab is closed, and a new tab for that file is the user’s', async () => {
      const open = stub();
      const { controller } = createHarness({ documents: { open } });
      controller.restoreSession({ paths: [file()], active: 0 });
      controller.closeTab(controller.getTabs().activeId);
      const id = tabIdOf(await controller.openPath(file()));
      open.mockClear();

      await controller.loadTab(id);

      expect(open.mock.calls).toEqual([[file(), undefined]]);
    });
  });
});
