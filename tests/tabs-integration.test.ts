import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController, type WindowPort } from '../src/main/app-controller';
import { createDocumentService, type DocumentService } from '../src/main/documents';
import { activeView, Workspace, type WorkspaceBridge } from '../src/renderer/workspace';
import type { TabsSnapshot } from '../src/shared/tabs';
import type { OpenOutcome } from '../src/shared/types';

/**
 * The page's `Workspace` and the main process's `AppController`, both real, with nothing but the line
 * between them made up. What each says to the other has to fit what the other does with it: the order
 * in which things arrive, which tab an answer is for, and what the page reads for itself.
 */

const exe = path.join(os.tmpdir(), 'MDReader.exe');

let workDir: string;
const stops: (() => void)[] = [];

beforeEach(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-together-'));
});

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await rm(workDir, { recursive: true, force: true });
});

async function writeDoc(name: string, content: string): Promise<string> {
  const file = path.join(workDir, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

const fileUrl = (file: string): string => new URL(`file:///${file.replaceAll('\\', '/')}`).href;

/**
 * What goes from the main process to the page, and the answers to what the page asked, in one line:
 * in Electron an answer cannot get ahead of a message that was sent before it.
 */
class Line {
  private waiting: (() => void)[] = [];
  private scheduled = false;

  post(deliver: () => void): void {
    this.waiting.push(deliver);
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      for (const next of this.waiting.splice(0)) next();
    });
  }
}

function createApp(options: { documents?: DocumentService; chosenFiles?: string[] } = {}) {
  const line = new Line();
  let documentListener: ((outcome: OpenOutcome) => void) | undefined;
  let tabsListener: ((snapshot: TabsSnapshot) => void) | undefined;
  /** The tabs the page has asked the main process to read. */
  const loads: string[] = [];

  const window: WindowPort = {
    sendOutcome: (outcome) => {
      line.post(() => {
        documentListener?.(outcome);
      });
    },
    sendTabs: (snapshot) => {
      line.post(() => {
        tabsListener?.(snapshot);
      });
    },
    reveal: () => undefined,
  };
  const controller = new AppController({
    documents: options.documents ?? createDocumentService(),
    getWindow: () => window,
    showOpenDialog: () => Promise.resolve(options.chosenFiles ?? []),
    isPackaged: true,
    onTabsChanged: () => undefined,
  });

  /** A question from the page: it reaches the main process, and the answer comes back along the line. */
  const ask = <T>(question: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      setImmediate(() => {
        question().then(
          (answer) => {
            line.post(() => {
              resolve(answer);
            });
          },
          (error: unknown) => {
            line.post(() => {
              reject(error instanceof Error ? error : new Error(String(error)));
            });
          },
        );
      });
    });

  const bridge = {
    onDocumentOpened: (listener) => {
      documentListener = listener;
      return () => {
        documentListener = undefined;
      };
    },
    onTabsChanged: (listener) => {
      tabsListener = listener;
      return () => {
        tabsListener = undefined;
      };
    },
    getTabs: () => ask(() => Promise.resolve(controller.getTabs())),
    notifyReady: () =>
      ask(() => {
        controller.rendererReady();
        return Promise.resolve();
      }),
    openFileDialog: () => ask(() => controller.openFromDialog()),
    // The preload script turns each dropped file into its path; here the file is made to carry it.
    openDroppedFiles: (files) => ask(() => controller.openPaths(files.map((file) => file.name))),
    reopenDocument: (tabId, filePath) => ask(() => controller.reopen(tabId, filePath)),
    openLink: (href, wish) => ask(() => controller.openLink(href, wish ?? {})),
    reloadDocument: (tabId) => ask(() => controller.reload(tabId)),
    activateTab: (id) =>
      ask(() => {
        controller.activateTab(id);
        return Promise.resolve();
      }),
    closeTab: (id) =>
      ask(() => {
        controller.closeTab(id);
        return Promise.resolve();
      }),
    moveTab: (id, toIndex) =>
      ask(() => {
        controller.moveTab(id, toIndex);
        return Promise.resolve();
      }),
    loadTab: (id) => {
      loads.push(id);
      return ask(() => controller.loadTab(id));
    },
  } satisfies WorkspaceBridge;

  const workspace = new Workspace(bridge, () => 0);
  return {
    controller,
    workspace,
    loads,
    /** The page starts, as it does when its window has loaded. */
    start(): void {
      stops.push(workspace.start());
    },
  };
}

type App = ReturnType<typeof createApp>;

const names = (app: App): string[] =>
  app.workspace.getState().tabs.map((tab) => path.basename(tab.path));

const shownName = (app: App): string | undefined =>
  activeView(app.workspace.getState())?.document?.name;

/** Waits until the page shows these tabs, with the last one's document on screen. */
async function showing(app: App, tabs: readonly string[], active: string): Promise<void> {
  await vi.waitFor(() => {
    expect(names(app)).toEqual(tabs);
    expect(shownName(app)).toBe(active);
  });
}

describe('the page and the main process together: opening files', () => {
  it('shows a file named at launch, queued before the page was ready, without asking for it again', async () => {
    const start = await writeDoc('start.md', '# Start');
    const app = createApp();
    app.controller.handleLaunch([exe, start], workDir);

    app.start();

    await showing(app, ['start.md'], 'start.md');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(app.loads).toEqual([]);
  });

  it('shows every file asked for before the page was ready, each in a tab, the last one on screen', async () => {
    const one = await writeDoc('one.md', '# One');
    const two = await writeDoc('two.md', '# Two');
    const three = await writeDoc('three.md', '# Three');
    const app = createApp();
    app.controller.handleLaunch([exe, one], workDir);
    app.controller.handleLaunch([exe, two], workDir, { reveal: true });
    app.controller.handleLaunch([exe, three], workDir, { reveal: true });

    app.start();

    await showing(app, ['one.md', 'two.md', 'three.md'], 'three.md');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(app.loads).toEqual([]);
    expect(app.workspace.getState().views.get('tab-1')?.document?.name).toBe('one.md');
  });

  it('shows a file that a second launch asks for while the page is running, without asking for it again', async () => {
    const first = await writeDoc('first.md', '# First');
    const second = await writeDoc('second.md', '# Second');
    const app = createApp();
    app.controller.handleLaunch([exe, first], workDir);
    app.start();
    await showing(app, ['first.md'], 'first.md');

    app.controller.handleLaunch([exe, second], workDir, { reveal: true });

    await showing(app, ['first.md', 'second.md'], 'second.md');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(app.loads).toEqual([]);
  });

  it('shows the tab that has a file already, when a second launch asks for it again', async () => {
    const first = await writeDoc('first.md', '# First');
    const second = await writeDoc('second.md', '# Second');
    const app = createApp();
    app.controller.handleLaunch([exe, first], workDir);
    app.controller.handleLaunch([exe, second], workDir);
    app.start();
    await showing(app, ['first.md', 'second.md'], 'second.md');

    app.controller.handleLaunch([exe, first], workDir, { reveal: true });

    await showing(app, ['first.md', 'second.md'], 'first.md');
    expect(app.loads).toEqual([]);
  });

  it('shows the files chosen in the dialog, each in a tab, without asking for any of them again', async () => {
    const one = await writeDoc('one.md', '# One');
    const two = await writeDoc('two.md', '# Two');
    const app = createApp({ chosenFiles: [one, two] });
    app.start();
    await vi.waitFor(() => {
      expect(app.workspace.getState().ready).toBe(true);
    });

    await app.workspace.openFile();

    await showing(app, ['one.md', 'two.md'], 'two.md');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(app.loads).toEqual([]);
    expect(app.workspace.getState().views.get('tab-1')?.document?.name).toBe('one.md');
  });

  it('shows the files that were dropped, each in a tab, and says why it could not open the others', async () => {
    const good = await writeDoc('good.md', '# Good');
    const app = createApp();
    app.start();
    await vi.waitFor(() => {
      expect(app.workspace.getState().ready).toBe(true);
    });
    const dropped = [{ name: path.join(workDir, 'gone.md') }, { name: good }] as unknown as File[];

    await app.workspace.openDropped(dropped);

    await showing(app, ['good.md'], 'good.md');
    expect(app.workspace.getState().notice?.message).toMatch(/could not be found/i);
    expect(app.loads).toEqual([]);
  });

  it('opens a file that is opened again in the tab that has it, with what is in the file now', async () => {
    const file = await writeDoc('live.md', '# Before');
    const app = createApp({ chosenFiles: [file] });
    app.start();
    await vi.waitFor(() => {
      expect(app.workspace.getState().ready).toBe(true);
    });
    await app.workspace.openFile();
    await showing(app, ['live.md'], 'live.md');
    await writeFile(file, '# After');

    await app.workspace.openFile();

    await vi.waitFor(() => {
      expect(activeView(app.workspace.getState())?.document?.content).toBe('# After');
    });
    expect(names(app)).toEqual(['live.md']);
  });
});

describe('the page and the main process together: tabs from an earlier run', () => {
  it('reads only the tab that comes on screen, and each other tab when it does', async () => {
    const a = await writeDoc('a.md', '# A');
    const b = await writeDoc('b.md', '# B');
    const c = await writeDoc('c.md', '# C');
    const app = createApp();
    app.controller.restoreSession({ paths: [a, b, c], active: 1 });

    app.start();

    await showing(app, ['a.md', 'b.md', 'c.md'], 'b.md');
    expect(app.loads).toEqual(['tab-2']);

    app.workspace.activate('tab-3');
    await vi.waitFor(() => {
      expect(shownName(app)).toBe('c.md');
    });
    expect(app.loads).toEqual(['tab-2', 'tab-3']);
  });

  it('keeps a tab whose file is gone, says so on it, and shows it once the file is back', async () => {
    const gone = path.join(workDir, 'gone.md');
    const app = createApp();
    app.controller.restoreSession({ paths: [gone], active: 0 });

    app.start();

    await vi.waitFor(() => {
      expect(activeView(app.workspace.getState())?.problem).toMatch(/could not be found/i);
    });
    expect(names(app)).toEqual(['gone.md']);

    await writeFile(gone, '# Back');
    app.workspace.retry('tab-1');

    await showing(app, ['gone.md'], 'gone.md');
  });

  it('puts the file named at launch after the tabs of the earlier run, and shows it', async () => {
    const old = await writeDoc('old.md', '# Old');
    const fresh = await writeDoc('fresh.md', '# Fresh');
    const app = createApp();
    app.controller.restoreSession({ paths: [old], active: 0 });
    app.controller.handleLaunch([exe, fresh], workDir);

    app.start();

    await showing(app, ['old.md', 'fresh.md'], 'fresh.md');
  });
});

describe('the page and the main process together: links and Back', () => {
  it('follows a link in place and goes back, with nothing read twice', async () => {
    const guide = await writeDoc('guide.md', '# Guide');
    const index = await writeDoc('index.md', `# Index\n\n[guide](${fileUrl(guide)})`);
    const app = createApp({ chosenFiles: [index] });
    app.start();
    await vi.waitFor(() => {
      expect(app.workspace.getState().ready).toBe(true);
    });
    await app.workspace.openFile();
    await showing(app, ['index.md'], 'index.md');

    await app.workspace.openLink('tab-1', fileUrl(guide));

    await showing(app, ['guide.md'], 'guide.md');
    expect(activeView(app.workspace.getState())?.history).toHaveLength(1);

    await app.workspace.goBack('tab-1');

    await showing(app, ['index.md'], 'index.md');
    expect(activeView(app.workspace.getState())?.history).toEqual([]);
    expect(app.loads).toEqual([]);
  });

  it('opens a link in a tab of its own, and leaves the first tab as it was', async () => {
    const guide = await writeDoc('guide.md', '# Guide');
    const index = await writeDoc('index.md', '# Index');
    const app = createApp({ chosenFiles: [index] });
    app.start();
    await vi.waitFor(() => {
      expect(app.workspace.getState().ready).toBe(true);
    });
    await app.workspace.openFile();
    await showing(app, ['index.md'], 'index.md');

    await app.workspace.openLink('tab-1', fileUrl(guide), { newTab: true });

    await showing(app, ['index.md', 'guide.md'], 'guide.md');
    expect(app.workspace.getState().views.get('tab-1')?.document?.name).toBe('index.md');
    expect(app.loads).toEqual([]);
  });

  it('follows a link in the tab the page names, while the main process has another one on screen', async () => {
    const guide = await writeDoc('guide.md', '# Guide');
    const one = await writeDoc('one.md', '# One');
    const two = await writeDoc('two.md', '# Two');
    const app = createApp();
    app.controller.handleLaunch([exe, one], workDir);
    app.controller.handleLaunch([exe, two], workDir);
    app.start();
    await showing(app, ['one.md', 'two.md'], 'two.md');

    await app.workspace.openLink('tab-1', fileUrl(guide));

    await vi.waitFor(() => {
      expect(names(app)).toEqual(['guide.md', 'two.md']);
    });
    expect(shownName(app)).toBe('two.md');
    expect(app.workspace.getState().views.get('tab-1')?.document?.name).toBe('guide.md');
    expect(app.workspace.getState().views.get('tab-1')?.history).toHaveLength(1);
    expect(app.workspace.getState().views.get('tab-2')?.history).toEqual([]);
  });

  it('shows the newer of two links followed in the same tab, whichever opens first, and gives the tab one way back', async () => {
    const real = createDocumentService();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = await writeDoc('slow.md', '# Slow');
    const fast = await writeDoc('fast.md', '# Fast');
    const index = await writeDoc('index.md', '# Index');
    const documents: DocumentService = {
      open: async (input, options) => {
        if (typeof input === 'string' && path.normalize(input) === slow) await held;
        return real.open(input, options);
      },
    };
    const app = createApp({ documents, chosenFiles: [index] });
    app.start();
    await vi.waitFor(() => {
      expect(app.workspace.getState().ready).toBe(true);
    });
    await app.workspace.openFile();
    await showing(app, ['index.md'], 'index.md');

    const older = app.workspace.openLink('tab-1', fileUrl(slow));
    const newer = app.workspace.openLink('tab-1', fileUrl(fast));
    await newer;
    release();
    await older;

    await showing(app, ['fast.md'], 'fast.md');
    expect(activeView(app.workspace.getState())?.history).toEqual([{ path: index, scrollTop: 0 }]);
    expect(app.workspace.getState().notice).toBeUndefined();
  });

  it('brings no tab back when it was closed while its link was being read', async () => {
    const real = createDocumentService();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const guide = await writeDoc('guide.md', '# Guide');
    const index = await writeDoc('index.md', '# Index');
    const documents: DocumentService = {
      open: async (input, options) => {
        if (typeof input === 'string' && path.normalize(input) === guide) await held;
        return real.open(input, options);
      },
    };
    const app = createApp({ documents, chosenFiles: [index] });
    app.start();
    await vi.waitFor(() => {
      expect(app.workspace.getState().ready).toBe(true);
    });
    await app.workspace.openFile();
    await showing(app, ['index.md'], 'index.md');

    const following = app.workspace.openLink('tab-1', fileUrl(guide));
    app.workspace.close('tab-1');
    await vi.waitFor(() => {
      expect(names(app)).toEqual([]);
    });
    release();
    await following;

    expect(names(app)).toEqual([]);
    expect(app.workspace.getState().notice).toBeUndefined();
    expect(app.controller.getTabs().tabs).toEqual([]);
  });

  it('refuses a link that leads out of the documents it has to do with, and says so', async () => {
    const index = await writeDoc('index.md', '# Index');
    const app = createApp({ chosenFiles: [index] });
    app.start();
    await vi.waitFor(() => {
      expect(app.workspace.getState().ready).toBe(true);
    });
    await app.workspace.openFile();
    await showing(app, ['index.md'], 'index.md');

    await app.workspace.openLink('tab-1', 'https://example.com/a.md');

    expect(app.workspace.getState().notice?.message).toMatch(/cannot be opened|network/i);
    expect(shownName(app)).toBe('index.md');
  });

  it('reloads a tab with what is in its file now, and keeps the tab', async () => {
    const file = await writeDoc('live.md', '# Before');
    const app = createApp({ chosenFiles: [file] });
    app.start();
    await vi.waitFor(() => {
      expect(app.workspace.getState().ready).toBe(true);
    });
    await app.workspace.openFile();
    await showing(app, ['live.md'], 'live.md');
    await writeFile(file, '# After');

    await app.workspace.reload('tab-1');

    expect(activeView(app.workspace.getState())?.document?.content).toBe('# After');
    expect(names(app)).toEqual(['live.md']);
  });
});
