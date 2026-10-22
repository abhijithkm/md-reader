import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownDocument, OpenOutcome } from '../shared/types';
import { AppController, type WindowPort } from './app-controller';
import { createDocumentService, type DocumentService, type OpenOptions } from './documents';

const onWindows = process.platform === 'win32';
const exe = path.join(os.tmpdir(), 'MDReader.exe');

class FakeWindow implements WindowPort {
  readonly outcomes: OpenOutcome[] = [];
  revealCount = 0;

  sendOutcome(outcome: OpenOutcome): void {
    this.outcomes.push(outcome);
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
}

function createHarness(
  options: { documents?: DocumentService; chosenFile?: string | undefined } = {},
): Harness {
  const window = new FakeWindow();
  const controller = new AppController({
    documents: options.documents ?? createDocumentService(),
    getWindow: () => window,
    showOpenDialog: () => Promise.resolve(options.chosenFile),
    isPackaged: true,
  });
  return { controller, window };
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

function fakeDocument(filePath: string, content: string): OpenOutcome {
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

describe('AppController: launching with a file', () => {
  it('waits for the renderer before delivering the file named on the command line', async () => {
    const file = await writeDoc('My Docs/日本語 notes.md', '# From the command line');
    const { controller, window } = createHarness();

    controller.handleLaunch([exe, file], workDir);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.outcomes).toHaveLength(0);

    controller.rendererReady();
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));

    expect(openedDocument(window.outcomes[0]).content).toBe('# From the command line');
    expect(controller.getCurrentDocumentPath()).toBe(file);
  });

  it('delivers nothing when the app starts without a file', async () => {
    const { controller, window } = createHarness();

    controller.handleLaunch([exe], workDir);
    controller.rendererReady();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(window.outcomes).toHaveLength(0);
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

  it('tells the user when the file on the command line is not a Markdown file', async () => {
    const file = await writeDoc('notes.txt', 'plain');
    const { controller, window } = createHarness();
    controller.rendererReady();

    controller.handleLaunch([exe, file], workDir);

    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));
    expect(window.outcomes[0]).toMatchObject({
      status: 'failed',
      error: { code: 'unsupported-type' },
    });
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
  it('shows the new file in the existing window and brings it to the front', async () => {
    const first = await writeDoc('first.md', 'first');
    const second = await writeDoc('with space/second.md', 'second');
    const { controller, window } = createHarness();
    controller.rendererReady();
    controller.handleLaunch([exe, first], workDir);
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));

    controller.handleLaunch([exe, second], workDir, { reveal: true });

    await vi.waitFor(() => expect(window.outcomes).toHaveLength(2));
    expect(openedDocument(window.outcomes[1]).content).toBe('second');
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

  it('shows only the newest document when requests overlap', async () => {
    const slow = path.join(workDir, 'slow.md');
    const fast = path.join(workDir, 'fast.md');
    const pending = new Map<string, (outcome: OpenOutcome) => void>();
    const documents: DocumentService = {
      open: (input) =>
        new Promise<OpenOutcome>((resolve) => {
          pending.set(String(input), resolve);
        }),
    };
    const { controller, window } = createHarness({ documents });
    controller.rendererReady();

    controller.handleLaunch([exe, slow], workDir);
    controller.handleLaunch([exe, fast], workDir);
    pending.get(fast)?.(fakeDocument(fast, 'fast'));
    await vi.waitFor(() => expect(window.outcomes).toHaveLength(1));
    pending.get(slow)?.(fakeDocument(slow, 'slow'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(window.outcomes).toHaveLength(1);
    expect(openedDocument(window.outcomes[0]).content).toBe('fast');
    expect(controller.getCurrentDocumentPath()).toBe(fast);
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
});

describe('AppController: opening from inside the app', () => {
  it('opens the file chosen in the dialog', async () => {
    const file = await writeDoc('chosen.md', 'chosen');
    const { controller } = createHarness({ chosenFile: file });

    const outcome = await controller.openFromDialog();

    expect(openedDocument(outcome).content).toBe('chosen');
    expect(controller.getCurrentDocumentPath()).toBe(file);
  });

  it('reports a cancelled dialog and keeps the current document', async () => {
    const file = await writeDoc('current.md', 'current');
    const { controller } = createHarness({ chosenFile: undefined });
    await controller.openPath(file);

    expect(await controller.openFromDialog()).toEqual({ status: 'canceled' });
    expect(controller.getCurrentDocumentPath()).toBe(file);
  });

  it('keeps the current document when a different file fails to open', async () => {
    const file = await writeDoc('current.md', 'current');
    const { controller } = createHarness();
    await controller.openPath(file);

    const outcome = await controller.openPath(path.join(workDir, 'gone.md'));

    expect(outcome.status).toBe('failed');
    expect(controller.getCurrentDocumentPath()).toBe(file);
  });

  it('reloads the current document from disk', async () => {
    const file = await writeDoc('live.md', 'before');
    const { controller } = createHarness();
    await controller.openPath(file);
    await writeFile(file, 'after');

    expect(openedDocument(await controller.reload()).content).toBe('after');
  });

  it('explains that there is nothing to reload when no document is open', async () => {
    const { controller } = createHarness();
    expect(await controller.reload()).toMatchObject({ status: 'failed' });
  });
});

describe('AppController: going back to documents that were already shown', () => {
  it('reopens a document that was shown earlier', async () => {
    const first = await writeDoc('first.md', 'first');
    const second = await writeDoc('second.md', 'second');
    const { controller } = createHarness();
    await controller.openPath(first);
    await controller.openPath(second);

    const outcome = await controller.reopen(first);

    expect(openedDocument(outcome).content).toBe('first');
    expect(controller.getCurrentDocumentPath()).toBe(first);
  });

  it('refuses a document that was never shown, even though it exists', async () => {
    // The page may be compromised by a hostile document; it must not be able to read other files.
    const shown = await writeDoc('shown.md', 'shown');
    const private_ = await writeDoc('private/notes.md', 'private notes');
    const { controller } = createHarness();
    await controller.openPath(shown);

    const outcome = await controller.reopen(private_);

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'not-found' } });
    expect(controller.getCurrentDocumentPath()).toBe(shown);
  });

  it.each([42, null, undefined, {}, ''])('refuses %j', async (input) => {
    const { controller } = createHarness();
    expect(await controller.reopen(input)).toMatchObject({ status: 'failed' });
  });

  it('does not count a document that failed to open as shown', async () => {
    const { controller } = createHarness();
    const missing = path.join(workDir, 'missing.md');
    await controller.openPath(missing);
    await writeFile(missing, 'it exists now');

    expect(await controller.reopen(missing)).toMatchObject({ status: 'failed' });
  });

  it('remembers a limited number of documents', async () => {
    const { controller } = createHarness({
      documents: { open: (input) => Promise.resolve(fakeDocument(String(input), 'x')) },
    });
    const files = Array.from({ length: 205 }, (_unused, n) => path.join(workDir, `doc ${n}.md`));
    for (const file of files) await controller.openPath(file);

    expect(await controller.reopen(files[0])).toMatchObject({ status: 'failed' });
    expect((await controller.reopen(files[204])).status).toBe('opened');
  });
});

describe('AppController: following links in a document', () => {
  function fileUrl(file: string): string {
    return new URL(`file:///${file.replaceAll('\\', '/')}`).href;
  }

  it('opens a linked Markdown file and passes the anchor along', async () => {
    const index = await writeDoc('docs/index.md', 'index');
    const guide = await writeDoc('docs/guide to it.md', 'guide');
    const { controller } = createHarness();
    await controller.openPath(index);

    const outcome = await controller.openLink(`${fileUrl(guide)}#install`);

    expect(openedDocument(outcome).content).toBe('guide');
    expect(outcome).toMatchObject({ status: 'opened', anchor: 'install' });
    expect(controller.getCurrentDocumentPath()).toBe(guide);
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
