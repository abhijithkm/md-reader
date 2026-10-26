import { describe, expect, it, vi } from 'vitest';
import type { TabsSnapshot } from '../shared/tabs';
import type { MarkdownDocument, OpenOutcome } from '../shared/types';
import { activeView, Workspace, type WorkspaceBridge } from './workspace';

function doc(name: string, content = `# ${name}`): MarkdownDocument {
  return {
    path: `C:\\docs\\${name}`,
    name,
    directory: 'C:\\docs',
    baseUrl: 'file:///C:/docs/',
    content,
    sizeBytes: content.length,
    modifiedMs: 1,
    encoding: 'utf-8',
  };
}

function opened(
  tabId: string,
  name: string,
  extra: { anchor?: string; content?: string } = {},
): OpenOutcome {
  return {
    status: 'opened',
    tabId,
    document: doc(name, extra.content),
    ...(extra.anchor === undefined ? {} : { anchor: extra.anchor }),
  };
}

const failed = (message: string): OpenOutcome => ({
  status: 'failed',
  error: { code: 'not-found', message },
});

const canceled: OpenOutcome = { status: 'canceled' };

/** Tabs that show the named files; the active one is named by its id. */
function snapshot(
  version: number,
  tabs: readonly (readonly [id: string, name: string])[],
  activeId?: string,
): TabsSnapshot {
  return {
    tabs: tabs.map(([id, name]) => ({ id, path: `C:\\docs\\${name}` })),
    activeId,
    version,
  };
}

const ONE = (version = 1): TabsSnapshot => snapshot(version, [['tab-1', 'a.md']], 'tab-1');
const TWO = (active: string, version = 1): TabsSnapshot =>
  snapshot(
    version,
    [
      ['tab-1', 'a.md'],
      ['tab-2', 'b.md'],
    ],
    active,
  );
const THREE = (active: string, version = 1): TabsSnapshot =>
  snapshot(
    version,
    [
      ['tab-1', 'a.md'],
      ['tab-2', 'b.md'],
      ['tab-3', 'c.md'],
    ],
    active,
  );

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A promise that the test finishes, for requests that have to overlap with something else. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createBridge(initial: TabsSnapshot = snapshot(0, [])) {
  let documentListener: ((outcome: OpenOutcome) => void) | undefined;
  let tabsListener: ((next: TabsSnapshot) => void) | undefined;
  const stopDocuments = vi.fn();
  const stopTabs = vi.fn();
  const bridge = {
    onDocumentOpened: vi.fn((listener: (outcome: OpenOutcome) => void) => {
      documentListener = listener;
      return stopDocuments;
    }),
    onTabsChanged: vi.fn((listener: (next: TabsSnapshot) => void) => {
      tabsListener = listener;
      return stopTabs;
    }),
    getTabs: vi.fn<() => Promise<TabsSnapshot>>(() => Promise.resolve(initial)),
    notifyReady: vi.fn(() => Promise.resolve()),
    openFileDialog: vi.fn<() => Promise<OpenOutcome[]>>(),
    openDroppedFiles: vi.fn<(files: File[]) => Promise<OpenOutcome[]>>(),
    reopenDocument: vi.fn<WorkspaceBridge['reopenDocument']>(),
    openLink: vi.fn<WorkspaceBridge['openLink']>(),
    reloadDocument: vi.fn<WorkspaceBridge['reloadDocument']>(),
    activateTab: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
    closeTab: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
    moveTab: vi.fn<(id: string, toIndex: number) => Promise<void>>(() => Promise.resolve()),
    loadTab: vi.fn<(id: string) => Promise<OpenOutcome>>(() => Promise.resolve(canceled)),
  } satisfies WorkspaceBridge;
  return {
    bridge,
    stopDocuments,
    stopTabs,
    pushDocument: (outcome: OpenOutcome): void => {
      documentListener?.(outcome);
    },
    pushTabs: (next: TabsSnapshot): void => {
      tabsListener?.(next);
    },
  };
}

/** A workspace that has started and been told about the tabs. `scroll.top` is where the page is scrolled to. */
async function started(
  initial?: TabsSnapshot,
  options: { prepare?: (bridge: ReturnType<typeof createBridge>['bridge']) => void } = {},
) {
  const harness = createBridge(initial);
  options.prepare?.(harness.bridge);
  const scroll = { top: 0 };
  const workspace = new Workspace(harness.bridge, () => scroll.top);
  const stop = workspace.start();
  await flush();
  return { ...harness, workspace, scroll, stop };
}

const shown = (workspace: Workspace): MarkdownDocument | undefined =>
  activeView(workspace.getState())?.document;

const viewOf = (workspace: Workspace, id: string) => workspace.getState().views.get(id);

const tokenOf = (workspace: Workspace): number => workspace.getState().scrollRequest.token;

/**
 * What the main process does when a tab is taken to another document: the tabs are announced as they
 * are now, and then the question that asked for it is answered.
 */
const answeringAfter =
  (announce: (next: TabsSnapshot) => void, after: TabsSnapshot, outcome: OpenOutcome) =>
  (): Promise<OpenOutcome> => {
    announce(after);
    return Promise.resolve(outcome);
  };

describe('Workspace: starting', () => {
  it('listens for what the main process sends before it asks for the tabs, and before it says it is ready', async () => {
    const { bridge } = await started();
    const order = (fn: { mock: { invocationCallOrder: number[] } }): number =>
      fn.mock.invocationCallOrder[0] ?? 0;

    expect(order(bridge.onDocumentOpened)).toBeLessThan(order(bridge.getTabs));
    expect(order(bridge.onTabsChanged)).toBeLessThan(order(bridge.getTabs));
    expect(order(bridge.getTabs)).toBeLessThan(order(bridge.notifyReady));
  });

  it('is not ready until the main process has said which tabs there are', () => {
    const { bridge } = createBridge();
    bridge.getTabs.mockReturnValue(new Promise(() => undefined));
    const workspace = new Workspace(bridge, () => 0);

    workspace.start();

    expect(workspace.getState().ready).toBe(false);
  });

  it('shows the tabs it is told about, and which one is on screen', async () => {
    const { workspace } = await started(TWO('tab-2'));

    expect(workspace.getState()).toMatchObject({
      ready: true,
      activeId: 'tab-2',
      tabs: [
        { id: 'tab-1', path: 'C:\\docs\\a.md' },
        { id: 'tab-2', path: 'C:\\docs\\b.md' },
      ],
    });
  });

  it('takes in a snapshot that is pushed', async () => {
    const { workspace, pushTabs } = await started(ONE());

    pushTabs(TWO('tab-2', 2));

    expect(workspace.getState().activeId).toBe('tab-2');
    expect(workspace.getState().tabs).toHaveLength(2);
  });

  it('keeps the newer of two snapshots when they arrive in the wrong order', async () => {
    const harness = createBridge();
    const answer = deferred<TabsSnapshot>();
    harness.bridge.getTabs.mockReturnValue(answer.promise);
    const workspace = new Workspace(harness.bridge, () => 0);
    workspace.start();

    harness.pushTabs(TWO('tab-2', 3));
    answer.resolve(ONE(2));
    await flush();

    expect(workspace.getState().tabs).toHaveLength(2);
    expect(workspace.getState().activeId).toBe('tab-2');
  });

  it('treats a failed question about the tabs as no tabs, so that the window still appears', async () => {
    const harness = createBridge();
    harness.bridge.getTabs.mockRejectedValue(new Error('ipc closed'));
    const workspace = new Workspace(harness.bridge, () => 0);

    workspace.start();
    await flush();

    expect(workspace.getState()).toMatchObject({ ready: true, tabs: [], activeId: undefined });
  });

  it('keeps the tabs it was pushed when its question about them fails afterwards', async () => {
    const harness = createBridge();
    const answer = deferred<TabsSnapshot>();
    harness.bridge.getTabs.mockReturnValue(answer.promise);
    const workspace = new Workspace(harness.bridge, () => 0);
    workspace.start();
    harness.pushTabs(ONE());

    answer.reject(new Error('ipc closed'));
    await flush();

    expect(workspace.getState().tabs).toHaveLength(1);
  });

  it('tells whoever is listening about each change, until they stop', async () => {
    const { workspace, pushTabs } = await started(ONE());
    const listener = vi.fn();
    const stopListening = workspace.subscribe(listener);

    pushTabs(TWO('tab-2', 2));
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    stopListening();
    pushTabs(TWO('tab-1', 3));
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops listening to the main process when told to', async () => {
    const { stop, stopDocuments, stopTabs } = await started();

    stop();

    expect(stopDocuments).toHaveBeenCalledOnce();
    expect(stopTabs).toHaveBeenCalledOnce();
  });
});

describe('Workspace: documents that the main process hands over', () => {
  it('shows a document for the tab that is on screen', async () => {
    const { workspace, pushDocument } = await started(ONE());

    pushDocument(opened('tab-1', 'a.md'));

    expect(shown(workspace)?.name).toBe('a.md');
    expect(workspace.getState().notice).toBeUndefined();
  });

  it('keeps the document of a tab that is not on screen, and has it ready when the tab comes on screen', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(TWO('tab-1'));
    pushDocument(opened('tab-1', 'a.md'));

    pushDocument(opened('tab-2', 'b.md'));
    expect(shown(workspace)?.name).toBe('a.md');

    pushTabs(TWO('tab-2', 2));
    await flush();

    expect(shown(workspace)?.name).toBe('b.md');
    expect(bridge.loadTab).not.toHaveBeenCalledWith('tab-2');
  });

  it('accepts a document that arrives before the message that announces its tab', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(ONE());

    pushDocument(opened('tab-2', 'b.md'));
    pushTabs(TWO('tab-2', 2));
    await flush();

    expect(shown(workspace)?.name).toBe('b.md');
    expect(bridge.loadTab).not.toHaveBeenCalledWith('tab-2');
  });

  it('explains a failed open and keeps what is on screen', async () => {
    const { workspace, pushDocument } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));

    pushDocument(failed('"gone.md" could not be found.'));

    expect(shown(workspace)?.name).toBe('a.md');
    expect(workspace.getState().notice).toMatchObject({
      kind: 'error',
      message: '"gone.md" could not be found.',
    });
  });

  it('clears an explanation once something opens', async () => {
    const { workspace, pushDocument } = await started(ONE());
    pushDocument(failed('nope'));
    expect(workspace.getState().notice).toBeDefined();

    pushDocument(opened('tab-1', 'a.md'));

    expect(workspace.getState().notice).toBeUndefined();
  });

  it('does nothing about a cancelled outcome', async () => {
    const { workspace, pushDocument } = await started(ONE());
    const before = workspace.getState();

    pushDocument(canceled);

    expect(workspace.getState()).toBe(before);
  });

  it('shows the same page again without redrawing it when nothing in it has changed', async () => {
    const { workspace, pushDocument } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    const before = workspace.getState().scrollRequest;

    pushDocument(opened('tab-1', 'a.md'));

    expect(workspace.getState().scrollRequest).toBe(before);
  });

  it('redraws a page whose text has changed, from the top', async () => {
    const { workspace, pushDocument } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    const before = workspace.getState().scrollRequest;

    pushDocument(opened('tab-1', 'a.md', { content: '# changed' }));

    expect(shown(workspace)?.content).toBe('# changed');
    expect(workspace.getState().scrollRequest.token).toBeGreaterThan(before.token);
    expect(workspace.getState().scrollRequest).toMatchObject({ top: 0 });
  });
});

describe('Workspace: reading a tab that has no document yet', () => {
  it('reads the document of the tab on screen when the page starts with tabs from an earlier session', async () => {
    const { bridge, workspace } = await started(TWO('tab-2'), {
      prepare: (b) => b.loadTab.mockResolvedValue(opened('tab-2', 'b.md')),
    });

    expect(bridge.loadTab).toHaveBeenCalledExactlyOnceWith('tab-2');
    expect(shown(workspace)?.name).toBe('b.md');
    expect(workspace.getState().views.has('tab-1')).toBe(false);
  });

  it('reads another tab when it comes on screen, and not before', async () => {
    const { bridge, workspace, pushTabs } = await started(TWO('tab-1'), {
      prepare: (b) =>
        b.loadTab.mockImplementation((id) =>
          Promise.resolve(opened(id, id === 'tab-1' ? 'a.md' : 'b.md')),
        ),
    });
    expect(bridge.loadTab.mock.calls).toEqual([['tab-1']]);

    pushTabs(TWO('tab-2', 2));
    await flush();

    expect(bridge.loadTab.mock.calls).toEqual([['tab-1'], ['tab-2']]);
    expect(shown(workspace)?.name).toBe('b.md');
  });

  it('puts the tab it read at the top', async () => {
    const { workspace } = await started(ONE(), {
      prepare: (b) => b.loadTab.mockResolvedValue(opened('tab-1', 'a.md')),
    });

    expect(workspace.getState().scrollRequest).toMatchObject({ top: 0 });
    expect(tokenOf(workspace)).toBeGreaterThan(0);
  });

  it('waits for the answer to a request of its own, and does not read the tab at all when the answer fills it', async () => {
    const { bridge, workspace, pushTabs } = await started(ONE());
    expect(bridge.loadTab).toHaveBeenCalledTimes(1);
    const dialog = deferred<OpenOutcome[]>();
    bridge.openFileDialog.mockReturnValue(dialog.promise);

    const opening = workspace.openFile();
    pushTabs(TWO('tab-2', 2));
    dialog.resolve([opened('tab-2', 'b.md')]);
    await opening;

    expect(shown(workspace)?.name).toBe('b.md');
    expect(bridge.loadTab).toHaveBeenCalledTimes(1);
  });

  it('reads the tab after all when the answer to a request of its own did not fill it', async () => {
    const { bridge, workspace, pushTabs } = await started(ONE());
    const dialog = deferred<OpenOutcome[]>();
    bridge.openFileDialog.mockReturnValue(dialog.promise);

    const opening = workspace.openFile();
    pushTabs(TWO('tab-2', 2));
    dialog.reject(new Error('ipc closed'));
    await opening;
    await flush();

    expect(bridge.loadTab).toHaveBeenLastCalledWith('tab-2');
  });

  it('waits for a link that opens a tab of its own, as for a file that was chosen', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    bridge.loadTab.mockClear();
    const answer = deferred<OpenOutcome>();
    bridge.openLink.mockReturnValue(answer.promise);

    const following = workspace.openLink('tab-1', 'file:///C:/docs/b.md', { newTab: true });
    pushTabs(TWO('tab-2', 2));
    await flush();
    expect(bridge.loadTab).not.toHaveBeenCalled();

    answer.resolve(opened('tab-2', 'b.md'));
    await following;

    expect(shown(workspace)?.name).toBe('b.md');
    expect(bridge.loadTab).not.toHaveBeenCalled();
  });

  it('does not wait for a link that is followed in the tab it is in, to read another tab that comes on screen', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(TWO('tab-1'));
    pushDocument(opened('tab-1', 'a.md'));
    bridge.loadTab.mockClear();
    const answer = deferred<OpenOutcome>();
    bridge.openLink.mockReturnValue(answer.promise);

    const following = workspace.openLink('tab-1', 'file:///C:/docs/c.md');
    pushTabs(TWO('tab-2', 2));
    await flush();

    expect(bridge.loadTab).toHaveBeenCalledExactlyOnceWith('tab-2');
    answer.resolve(canceled);
    await following;
  });

  it('does not wait for Back or for a reload either', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(TWO('tab-1'));
    pushDocument(opened('tab-1', 'a.md'));
    bridge.openLink.mockImplementation(
      answeringAfter(
        pushTabs,
        snapshot(
          2,
          [
            ['tab-1', 'c.md'],
            ['tab-2', 'b.md'],
          ],
          'tab-1',
        ),
        opened('tab-1', 'c.md'),
      ),
    );
    await workspace.openLink('tab-1', 'file:///C:/docs/c.md');
    bridge.loadTab.mockClear();
    const back = deferred<OpenOutcome>();
    bridge.reopenDocument.mockReturnValue(back.promise);
    const reloading = deferred<OpenOutcome>();
    bridge.reloadDocument.mockReturnValue(reloading.promise);

    const going = workspace.goBack('tab-1');
    const reloaded = workspace.reload('tab-1');
    pushTabs(
      snapshot(
        3,
        [
          ['tab-1', 'c.md'],
          ['tab-2', 'b.md'],
        ],
        'tab-2',
      ),
    );
    await flush();

    expect(bridge.loadTab).toHaveBeenCalledExactlyOnceWith('tab-2');
    back.resolve(canceled);
    reloading.resolve(canceled);
    await Promise.all([going, reloaded]);
  });

  it('keeps a tab whose file cannot be read, says so on the tab, and reads it again when asked', async () => {
    const { bridge, workspace } = await started(ONE(), {
      prepare: (b) => b.loadTab.mockResolvedValueOnce(failed('"a.md" could not be found.')),
    });
    expect(activeView(workspace.getState())).toMatchObject({
      document: undefined,
      problem: '"a.md" could not be found.',
    });
    expect(workspace.getState().notice).toBeUndefined();

    bridge.loadTab.mockResolvedValue(opened('tab-1', 'a.md'));
    workspace.retry('tab-1');
    await flush();

    expect(shown(workspace)?.name).toBe('a.md');
    expect(activeView(workspace.getState())?.problem).toBeUndefined();
  });

  it('says so on the tab when the question to the main process itself fails', async () => {
    const { workspace } = await started(ONE(), {
      prepare: (b) => b.loadTab.mockRejectedValue(new Error('ipc closed')),
    });

    expect(activeView(workspace.getState())).toMatchObject({
      document: undefined,
      problem: expect.stringContaining('could not complete') as string,
    });
    expect(workspace.getState().notice).toBeUndefined();
  });

  it('leaves it to the main process to say that a read tab has gone, and stays as it is', async () => {
    const { workspace } = await started(ONE(), {
      prepare: (b) => b.loadTab.mockResolvedValue(canceled),
    });

    expect(activeView(workspace.getState())).toBeUndefined();
    expect(workspace.getState().notice).toBeUndefined();
  });

  it('tries nothing again for a tab that is not there, and nothing when no tab is named', async () => {
    const { bridge, workspace } = await started(ONE());
    bridge.loadTab.mockClear();

    workspace.retry('tab-9');
    workspace.retry(undefined);
    await flush();

    expect(bridge.loadTab).not.toHaveBeenCalled();
    expect(viewOf(workspace, 'tab-9')).toBeUndefined();
  });

  it('does not ask again and again for a tab that the main process no longer has', async () => {
    const { bridge, pushTabs } = await started(ONE());
    expect(bridge.loadTab).toHaveBeenCalledTimes(1);

    pushTabs(ONE(2));
    await flush();

    expect(bridge.loadTab).toHaveBeenCalledTimes(1);
  });

  it('asks again once the tab shows another document', async () => {
    const { bridge, pushTabs } = await started(ONE());

    pushTabs(snapshot(2, [['tab-1', 'c.md']], 'tab-1'));
    await flush();

    expect(bridge.loadTab).toHaveBeenCalledTimes(2);
  });

  it('does not let a document that was read replace one that arrived while it was being read', async () => {
    const reading = deferred<OpenOutcome>();
    const { workspace, pushDocument } = await started(ONE(), {
      prepare: (b) => b.loadTab.mockReturnValue(reading.promise),
    });

    pushDocument(opened('tab-1', 'a.md', { content: '# pushed' }));
    reading.resolve(opened('tab-1', 'a.md', { content: '# read' }));
    await flush();

    expect(shown(workspace)?.content).toBe('# pushed');
  });

  it('leaves what is on screen alone when a tab that is not on screen finishes being read', async () => {
    const reading = deferred<OpenOutcome>();
    const { workspace, pushDocument, pushTabs } = await started(ONE(), {
      prepare: (b) =>
        b.loadTab.mockImplementation((id) =>
          id === 'tab-1' ? reading.promise : Promise.resolve(canceled),
        ),
    });
    pushTabs(TWO('tab-2', 2));
    pushDocument(opened('tab-2', 'b.md'));
    const before = workspace.getState().scrollRequest;

    reading.resolve(opened('tab-1', 'a.md'));
    await flush();

    expect(workspace.getState().views.get('tab-1')?.document?.name).toBe('a.md');
    expect(shown(workspace)?.name).toBe('b.md');
    expect(workspace.getState().scrollRequest).toBe(before);
  });
});

describe('Workspace: a tab that shows another document than the one it has', () => {
  it('lets go of the document, and reads the tab again, when the main process says that the tab has another one', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    bridge.loadTab.mockResolvedValue(opened('tab-1', 'c.md'));

    pushTabs(snapshot(2, [['tab-1', 'c.md']], 'tab-1'));
    await flush();

    expect(bridge.loadTab).toHaveBeenCalledTimes(2);
    expect(shown(workspace)?.name).toBe('c.md');
  });

  it('shows no document in the meantime, and keeps no history of what it let go of', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    bridge.openLink.mockImplementation(
      answeringAfter(pushTabs, snapshot(2, [['tab-1', 'c.md']], 'tab-1'), opened('tab-1', 'c.md')),
    );
    await workspace.openLink('tab-1', 'file:///C:/docs/c.md');
    expect(viewOf(workspace, 'tab-1')?.history).toHaveLength(1);
    bridge.loadTab.mockReturnValue(new Promise(() => undefined));

    pushTabs(snapshot(3, [['tab-1', 'd.md']], 'tab-1'));

    expect(viewOf(workspace, 'tab-1')).toBeUndefined();
  });

  it('does not take a path written in other letters, or with other slashes, for another document', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    bridge.loadTab.mockClear();

    pushTabs({ tabs: [{ id: 'tab-1', path: 'c:/DOCS/A.MD' }], activeId: 'tab-1', version: 2 });
    await flush();

    expect(shown(workspace)?.name).toBe('a.md');
    expect(bridge.loadTab).not.toHaveBeenCalled();
  });

  it('keeps the document while a request of its own is waiting, whose answer is what puts the tab right', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    bridge.loadTab.mockClear();
    const answer = deferred<OpenOutcome>();
    bridge.openLink.mockReturnValue(answer.promise);

    const following = workspace.openLink('tab-1', 'file:///C:/docs/c.md');
    pushTabs(snapshot(2, [['tab-1', 'c.md']], 'tab-1'));
    await flush();
    expect(shown(workspace)?.name).toBe('a.md');

    answer.resolve(opened('tab-1', 'c.md'));
    await following;
    await flush();

    expect(shown(workspace)?.name).toBe('c.md');
    expect(bridge.loadTab).not.toHaveBeenCalled();
  });

  it('reads the tab again once the request is over, when its answer did not come', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    bridge.loadTab.mockClear();
    bridge.loadTab.mockResolvedValue(opened('tab-1', 'c.md'));
    const answer = deferred<OpenOutcome>();
    bridge.openLink.mockReturnValue(answer.promise);

    const following = workspace.openLink('tab-1', 'file:///C:/docs/c.md');
    pushTabs(snapshot(2, [['tab-1', 'c.md']], 'tab-1'));
    answer.reject(new Error('ipc closed'));
    await following;
    await flush();

    expect(bridge.loadTab).toHaveBeenCalledExactlyOnceWith('tab-1');
    expect(shown(workspace)?.name).toBe('c.md');
  });

  it('does not touch a tab that has no document yet', async () => {
    const { bridge, workspace, pushTabs } = await started(TWO('tab-1'));
    bridge.loadTab.mockClear();

    pushTabs(TWO('tab-1', 2));
    await flush();

    expect(bridge.loadTab).not.toHaveBeenCalled();
    expect(viewOf(workspace, 'tab-2')).toBeUndefined();
  });
});

describe('Workspace: switching tabs', () => {
  it('asks the main process to bring a tab on screen, and changes nothing until it says so', async () => {
    const { bridge, workspace } = await started(TWO('tab-1'));

    workspace.activate('tab-2');

    expect(bridge.activateTab).toHaveBeenCalledExactlyOnceWith('tab-2');
    expect(workspace.getState().activeId).toBe('tab-1');
  });

  it('does not ask for the tab that is on screen already', async () => {
    const { bridge, workspace } = await started(TWO('tab-1'));

    workspace.activate('tab-1');

    expect(bridge.activateTab).not.toHaveBeenCalled();
  });

  it('does not read where the page is scrolled to when a tab is left: it was told as the reader went', async () => {
    const harness = createBridge(TWO('tab-1'));
    const read = vi.fn(() => 77);
    const workspace = new Workspace(harness.bridge, read);
    workspace.start();
    await flush();
    harness.pushDocument(opened('tab-1', 'a.md'));
    harness.pushDocument(opened('tab-2', 'b.md'));

    harness.pushTabs(TWO('tab-2', 2));
    harness.pushTabs(TWO('tab-1', 3));

    expect(read).not.toHaveBeenCalled();
    expect(workspace.getState().scrollRequest).toMatchObject({ top: 0 });
  });

  it('lets go of the documents of tabs that were closed', async () => {
    const { workspace, pushDocument, pushTabs } = await started(TWO('tab-1'));
    pushDocument(opened('tab-1', 'a.md'));
    pushDocument(opened('tab-2', 'b.md'));

    pushTabs(ONE(2));

    expect([...workspace.getState().views.keys()]).toEqual(['tab-1']);
  });

  it('has no tab on screen once the last one is closed, and asks for nothing', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    bridge.loadTab.mockClear();
    const before = workspace.getState().scrollRequest;

    pushTabs(snapshot(2, []));
    await flush();

    expect(workspace.getState()).toMatchObject({ activeId: undefined, tabs: [] });
    expect(workspace.getState().scrollRequest).toBe(before);
    expect(bridge.loadTab).not.toHaveBeenCalled();
  });

  it('asks the main process to close a tab and to move one', async () => {
    const { bridge, workspace } = await started(TWO('tab-1'));

    workspace.close('tab-2');
    workspace.move('tab-2', 0);

    expect(bridge.closeTab).toHaveBeenCalledExactlyOnceWith('tab-2');
    expect(bridge.moveTab).toHaveBeenCalledExactlyOnceWith('tab-2', 0);
  });

  it('goes on when the main process cannot be asked to switch, close or move', async () => {
    const { bridge, workspace } = await started(TWO('tab-1'));
    bridge.activateTab.mockRejectedValue(new Error('ipc closed'));
    bridge.closeTab.mockRejectedValue(new Error('ipc closed'));
    bridge.moveTab.mockRejectedValue(new Error('ipc closed'));

    workspace.activate('tab-2');
    workspace.close('tab-2');
    workspace.move('tab-2', 0);
    await flush();

    expect(workspace.getState().activeId).toBe('tab-1');
  });

  it('steps to the next tab, and from the last to the first', async () => {
    const { bridge, workspace, pushTabs } = await started(THREE('tab-1'));

    workspace.next();
    pushTabs(THREE('tab-3', 2));
    workspace.next();

    expect(bridge.activateTab.mock.calls).toEqual([['tab-2'], ['tab-1']]);
  });

  it('steps to the previous tab, and from the first to the last', async () => {
    const { bridge, workspace, pushTabs } = await started(THREE('tab-2'));

    workspace.previous();
    pushTabs(THREE('tab-1', 2));
    workspace.previous();

    expect(bridge.activateTab.mock.calls).toEqual([['tab-1'], ['tab-3']]);
  });

  it('has nowhere to step to with one tab', async () => {
    const { bridge, workspace } = await started(ONE());

    workspace.next();
    workspace.previous();

    expect(bridge.activateTab).not.toHaveBeenCalled();
  });

  it('moves the tab on screen one place along, but not past either end', async () => {
    const { bridge, workspace, pushTabs } = await started(THREE('tab-2'));

    workspace.moveActive(-1);
    workspace.moveActive(1);
    expect(bridge.moveTab.mock.calls).toEqual([
      ['tab-2', 0],
      ['tab-2', 2],
    ]);

    bridge.moveTab.mockClear();
    pushTabs(THREE('tab-1', 2));
    workspace.moveActive(-1);
    pushTabs(THREE('tab-3', 3));
    workspace.moveActive(1);
    expect(bridge.moveTab).not.toHaveBeenCalled();
  });
});

describe('Workspace: remembering where the reader is', () => {
  async function twoDocuments() {
    const harness = await started(TWO('tab-1'));
    harness.pushDocument(opened('tab-1', 'a.md'));
    harness.pushDocument(opened('tab-2', 'b.md'));
    return harness;
  }

  it('gives the reader back the place they had scrolled to in a tab they left', async () => {
    const { workspace, pushTabs } = await twoDocuments();
    workspace.noteScrolled('tab-1', tokenOf(workspace), 240);

    pushTabs(TWO('tab-2', 2));
    pushTabs(TWO('tab-1', 3));

    expect(workspace.getState().scrollRequest).toMatchObject({ top: 240 });
  });

  it('keeps the latest of the places the reader has scrolled to', async () => {
    const { workspace, pushTabs } = await twoDocuments();

    workspace.noteScrolled('tab-1', tokenOf(workspace), 100);
    workspace.noteScrolled('tab-1', tokenOf(workspace), 360);
    pushTabs(TWO('tab-2', 2));
    pushTabs(TWO('tab-1', 3));

    expect(workspace.getState().scrollRequest).toMatchObject({ top: 360 });
  });

  it('keeps the place of each tab apart', async () => {
    const { workspace, pushTabs } = await twoDocuments();
    workspace.noteScrolled('tab-1', tokenOf(workspace), 240);
    pushTabs(TWO('tab-2', 2));
    workspace.noteScrolled('tab-2', tokenOf(workspace), 500);

    pushTabs(TWO('tab-1', 3));
    expect(workspace.getState().scrollRequest).toMatchObject({ top: 240 });
    pushTabs(TWO('tab-2', 4));
    expect(workspace.getState().scrollRequest).toMatchObject({ top: 500 });
  });

  it('puts a tab the reader has not been in before at the top', async () => {
    const { workspace, pushTabs } = await twoDocuments();
    workspace.noteScrolled('tab-1', tokenOf(workspace), 240);

    pushTabs(TWO('tab-2', 2));

    expect(workspace.getState().scrollRequest).toMatchObject({ top: 0 });
  });

  it('does not take in what a page that is behind says, for it is about another document than the one that is current', async () => {
    const { workspace, pushTabs } = await twoDocuments();
    const drawn = tokenOf(workspace);
    pushTabs(TWO('tab-2', 2));

    // The page was still showing the first tab when this was reported.
    workspace.noteScrolled('tab-1', drawn, 240);
    pushTabs(TWO('tab-1', 3));

    expect(workspace.getState().scrollRequest).toMatchObject({ top: 0 });
  });

  it('does not change what is shown, nor tell anyone, when the reader scrolls', async () => {
    const { workspace } = await twoDocuments();
    const listener = vi.fn();
    workspace.subscribe(listener);
    const before = workspace.getState();

    workspace.noteScrolled('tab-1', tokenOf(workspace), 240);
    workspace.noteScrolled(undefined, tokenOf(workspace), 240);

    expect(workspace.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not move the reader when it is told again about the tab that is on screen', async () => {
    const { workspace, pushTabs } = await twoDocuments();
    workspace.noteScrolled('tab-1', tokenOf(workspace), 240);
    const before = workspace.getState().scrollRequest;

    pushTabs(TWO('tab-1', 2));
    expect(workspace.getState().scrollRequest).toBe(before);

    pushTabs(THREE('tab-1', 3));
    expect(workspace.getState().scrollRequest).toBe(before);
  });

  it('puts a document that was handed over for a tab out of sight at its heading when the tab comes on screen', async () => {
    const { workspace, pushDocument, pushTabs } = await twoDocuments();

    pushDocument(opened('tab-2', 'b.md', { anchor: 'usage', content: '# b\n\n## Usage' }));
    expect(workspace.getState().scrollRequest).toMatchObject({ top: 0 });
    pushTabs(TWO('tab-2', 2));

    expect(workspace.getState().scrollRequest).toMatchObject({ anchor: 'usage' });
    expect(workspace.getState().scrollRequest.top).toBeUndefined();
  });

  it('forgets where the reader was in a tab whose document was replaced while it was out of sight', async () => {
    const { workspace, pushDocument, pushTabs } = await twoDocuments();
    pushTabs(TWO('tab-2', 2));
    workspace.noteScrolled('tab-2', tokenOf(workspace), 500);
    pushTabs(TWO('tab-1', 3));

    pushDocument(opened('tab-2', 'b.md', { content: '# a different text' }));
    pushTabs(TWO('tab-2', 4));

    expect(workspace.getState().scrollRequest).toMatchObject({ top: 0 });
  });

  it('keeps where the reader was in a tab whose document was handed over again, unchanged, while it was out of sight', async () => {
    const { workspace, pushDocument, pushTabs } = await twoDocuments();
    pushTabs(TWO('tab-2', 2));
    workspace.noteScrolled('tab-2', tokenOf(workspace), 500);
    pushTabs(TWO('tab-1', 3));

    pushDocument(opened('tab-2', 'b.md'));
    pushTabs(TWO('tab-2', 4));

    expect(workspace.getState().scrollRequest).toMatchObject({ top: 500 });
  });
});

describe('Workspace: opening from the page', () => {
  it('opens each file the dialog returned', async () => {
    const { bridge, workspace, pushTabs } = await started(snapshot(1, []));
    bridge.openFileDialog.mockResolvedValue([opened('tab-1', 'a.md'), opened('tab-2', 'b.md')]);

    await workspace.openFile();
    pushTabs(TWO('tab-2', 2));

    expect(workspace.getState().views.get('tab-1')?.document?.name).toBe('a.md');
    expect(shown(workspace)?.name).toBe('b.md');
  });

  it.each([
    ['before', true],
    ['after', false],
  ])(
    'asks for no tab to be read when the tabs of a request are announced %s its answer',
    async (_label, tabsFirst) => {
      const { bridge, workspace, pushTabs } = await started(snapshot(1, []));
      const dialog = deferred<OpenOutcome[]>();
      bridge.openFileDialog.mockReturnValue(dialog.promise);

      const opening = workspace.openFile();
      if (tabsFirst) pushTabs(TWO('tab-2', 2));
      dialog.resolve([opened('tab-1', 'a.md'), opened('tab-2', 'b.md')]);
      await opening;
      if (!tabsFirst) pushTabs(TWO('tab-2', 2));
      await flush();

      expect(bridge.loadTab).not.toHaveBeenCalled();
      expect(shown(workspace)?.name).toBe('b.md');
      expect(viewOf(workspace, 'tab-1')?.document?.name).toBe('a.md');
    },
  );

  it('changes nothing when the dialog is cancelled', async () => {
    const { bridge, workspace, pushDocument } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    bridge.openFileDialog.mockResolvedValue([canceled]);

    await workspace.openFile();

    expect(shown(workspace)?.name).toBe('a.md');
    expect(workspace.getState().notice).toBeUndefined();
  });

  it('hands the files that were dropped to the main process as they are', async () => {
    const { bridge, workspace } = await started(ONE());
    const files = [new File(['# one'], 'one.md'), new File(['# two'], 'two.md')];
    bridge.openDroppedFiles.mockResolvedValue([opened('tab-1', 'a.md')]);

    await workspace.openDropped(files);

    expect(bridge.openDroppedFiles).toHaveBeenCalledExactlyOnceWith(files);
    expect(shown(workspace)?.name).toBe('a.md');
  });

  it('shows what could be opened first, and then why something else could not', async () => {
    const { bridge, workspace } = await started(ONE());
    bridge.openDroppedFiles.mockResolvedValue([
      failed('"gone.md" could not be found.'),
      opened('tab-1', 'a.md'),
    ]);

    await workspace.openDropped([new File([''], 'gone.md'), new File([''], 'a.md')]);

    expect(shown(workspace)?.name).toBe('a.md');
    expect(workspace.getState().notice).toMatchObject({ message: '"gone.md" could not be found.' });
  });

  it('reports only the first of several things that could not be opened', async () => {
    const { bridge, workspace } = await started(ONE());
    bridge.openDroppedFiles.mockResolvedValue([failed('first problem'), failed('second problem')]);

    await workspace.openDropped([new File([''], 'a.txt'), new File([''], 'b.txt')]);

    expect(workspace.getState().notice?.message).toBe('first problem');
  });

  it('clears an earlier explanation once something opens', async () => {
    const { bridge, workspace, pushDocument } = await started(ONE());
    pushDocument(failed('nope'));
    bridge.openDroppedFiles.mockResolvedValue([opened('tab-1', 'a.md')]);

    await workspace.openDropped([new File([''], 'a.md')]);

    expect(workspace.getState().notice).toBeUndefined();
  });

  it('explains it when the request to the main process itself fails', async () => {
    const { bridge, workspace } = await started(ONE());
    bridge.openFileDialog.mockRejectedValue(new Error('ipc closed'));

    await workspace.openFile();

    expect(workspace.getState().notice).toMatchObject({ kind: 'error' });
  });

  it('counts a request while it waits for the answer', async () => {
    const { bridge, workspace } = await started(ONE());
    const answer = deferred<OpenOutcome[]>();
    bridge.openDroppedFiles.mockReturnValue(answer.promise);

    const opening = workspace.openDropped([new File([''], 'a.md')]);
    expect(workspace.getState().pending).toBe(1);

    answer.resolve([opened('tab-1', 'a.md')]);
    await opening;
    expect(workspace.getState().pending).toBe(0);
  });

  it('lets the app report a problem of its own, and the reader dismiss it', async () => {
    const { workspace } = await started(ONE());

    workspace.report('That link could not be opened.');
    expect(workspace.getState().notice).toMatchObject({
      kind: 'error',
      message: 'That link could not be opened.',
    });

    workspace.dismissNotice();
    expect(workspace.getState().notice).toBeUndefined();
  });
});

describe('Workspace: following links and going back', () => {
  /** Reading `a.md` in tab-1, scrolled to `scrollTop`. */
  async function readingIndex(scrollTop = 0) {
    const harness = await started(ONE());
    harness.scroll.top = scrollTop;
    harness.pushDocument(opened('tab-1', 'a.md'));
    return harness;
  }

  /** Tab-1 now shows `name`, as the main process announces it. */
  const inTab1 = (version: number, name: string): TabsSnapshot =>
    snapshot(version, [['tab-1', name]], 'tab-1');

  const historyOf = (workspace: Workspace, id = 'tab-1') => viewOf(workspace, id)?.history;

  it('opens a linked document in the tab the link is in, and remembers where the reader was', async () => {
    const { bridge, workspace, pushTabs } = await readingIndex(240);
    bridge.openLink.mockImplementation(
      answeringAfter(pushTabs, inTab1(2, 'guide.md'), opened('tab-1', 'guide.md')),
    );
    expect(historyOf(workspace)).toEqual([]);

    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md');

    expect(bridge.openLink).toHaveBeenCalledExactlyOnceWith('file:///C:/docs/guide.md', {
      tabId: 'tab-1',
    });
    expect(shown(workspace)?.name).toBe('guide.md');
    expect(historyOf(workspace)).toEqual([{ path: 'C:\\docs\\a.md', scrollTop: 240 }]);
  });

  it('reads where the reader is from the function it was last given, at the moment of the click', async () => {
    const { bridge, workspace, pushTabs } = await readingIndex(240);
    workspace.readScrollWith(() => 321);
    bridge.openLink.mockImplementation(
      answeringAfter(pushTabs, inTab1(2, 'guide.md'), opened('tab-1', 'guide.md')),
    );

    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md');

    expect(historyOf(workspace)).toEqual([{ path: 'C:\\docs\\a.md', scrollTop: 321 }]);
  });

  it('follows a link in the tab it names, which is not the one the workspace has on screen', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(TWO('tab-2'));
    pushDocument(opened('tab-1', 'a.md'));
    pushDocument(opened('tab-2', 'b.md'));
    bridge.openLink.mockImplementation(
      answeringAfter(
        pushTabs,
        snapshot(
          2,
          [
            ['tab-1', 'guide.md'],
            ['tab-2', 'b.md'],
          ],
          'tab-2',
        ),
        opened('tab-1', 'guide.md'),
      ),
    );

    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md');

    expect(bridge.openLink).toHaveBeenCalledExactlyOnceWith('file:///C:/docs/guide.md', {
      tabId: 'tab-1',
    });
    // What was left is the document of the tab that was named, and nothing happened to the other one.
    expect(historyOf(workspace, 'tab-1')).toEqual([{ path: 'C:\\docs\\a.md', scrollTop: 0 }]);
    expect(historyOf(workspace, 'tab-2')).toEqual([]);
    expect(viewOf(workspace, 'tab-1')?.document?.name).toBe('guide.md');
    expect(shown(workspace)?.name).toBe('b.md');
  });

  it('has nothing to follow a link in when no tab is named', async () => {
    const { bridge, workspace } = await readingIndex();

    await workspace.openLink(undefined, 'file:///C:/docs/guide.md');

    expect(bridge.openLink).not.toHaveBeenCalled();
  });

  it('puts the tab at its place when the reader has moved on to another tab by the time the link opens', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(TWO('tab-1'));
    pushDocument(opened('tab-1', 'a.md'));
    pushDocument(opened('tab-2', 'b.md'));
    const answer = deferred<OpenOutcome>();
    bridge.openLink.mockReturnValue(answer.promise);

    const following = workspace.openLink('tab-1', 'file:///C:/docs/guide.md#install');
    pushTabs(TWO('tab-2', 2));
    const request = workspace.getState().scrollRequest;
    pushTabs(
      snapshot(
        3,
        [
          ['tab-1', 'guide.md'],
          ['tab-2', 'b.md'],
        ],
        'tab-2',
      ),
    );
    answer.resolve(opened('tab-1', 'guide.md', { anchor: 'install' }));
    await following;

    expect(shown(workspace)?.name).toBe('b.md');
    expect(workspace.getState().scrollRequest).toBe(request);

    pushTabs(
      snapshot(
        4,
        [
          ['tab-1', 'guide.md'],
          ['tab-2', 'b.md'],
        ],
        'tab-1',
      ),
    );
    expect(shown(workspace)?.name).toBe('guide.md');
    expect(workspace.getState().scrollRequest).toMatchObject({ anchor: 'install' });
  });

  it('goes back to the previous document at the previous scroll position', async () => {
    const { bridge, workspace, pushTabs } = await readingIndex(240);
    bridge.openLink.mockImplementation(
      answeringAfter(pushTabs, inTab1(2, 'guide.md'), opened('tab-1', 'guide.md')),
    );
    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md');
    bridge.reopenDocument.mockImplementation(
      answeringAfter(pushTabs, inTab1(3, 'a.md'), opened('tab-1', 'a.md')),
    );

    await workspace.goBack('tab-1');

    expect(bridge.reopenDocument).toHaveBeenCalledExactlyOnceWith('tab-1', 'C:\\docs\\a.md');
    expect(shown(workspace)?.name).toBe('a.md');
    expect(workspace.getState().scrollRequest).toMatchObject({ top: 240 });
    expect(historyOf(workspace)).toEqual([]);
  });

  it('goes back in the tab it names, though the workspace has another one on screen', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(TWO('tab-1'));
    pushDocument(opened('tab-1', 'a.md'));
    pushDocument(opened('tab-2', 'b.md'));
    bridge.openLink.mockImplementation(
      answeringAfter(
        pushTabs,
        snapshot(
          2,
          [
            ['tab-1', 'guide.md'],
            ['tab-2', 'b.md'],
          ],
          'tab-1',
        ),
        opened('tab-1', 'guide.md'),
      ),
    );
    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md');
    pushTabs(
      snapshot(
        3,
        [
          ['tab-1', 'guide.md'],
          ['tab-2', 'b.md'],
        ],
        'tab-2',
      ),
    );
    bridge.reopenDocument.mockImplementation(
      answeringAfter(
        pushTabs,
        snapshot(
          4,
          [
            ['tab-1', 'a.md'],
            ['tab-2', 'b.md'],
          ],
          'tab-2',
        ),
        opened('tab-1', 'a.md'),
      ),
    );

    await workspace.goBack('tab-1');

    expect(bridge.reopenDocument).toHaveBeenCalledExactlyOnceWith('tab-1', 'C:\\docs\\a.md');
    expect(viewOf(workspace, 'tab-1')?.document?.name).toBe('a.md');
    expect(shown(workspace)?.name).toBe('b.md');
  });

  it('has nothing to do for Back when there is nowhere to go back to, or no tab is named', async () => {
    const { bridge, workspace } = await readingIndex();

    await workspace.goBack('tab-1');
    await workspace.goBack(undefined);

    expect(bridge.reopenDocument).not.toHaveBeenCalled();
  });

  it('puts the reader at the place they left when the page that Back leads to is the one that is shown', async () => {
    const { bridge, workspace, pushTabs } = await readingIndex(240);
    bridge.openLink.mockResolvedValue(opened('tab-1', 'a.md', { anchor: 'intro' }));
    await workspace.openLink('tab-1', 'file:///C:/docs/a.md#intro');
    expect(historyOf(workspace)).toEqual([{ path: 'C:\\docs\\a.md', scrollTop: 240 }]);
    const before = workspace.getState().scrollRequest;
    bridge.reopenDocument.mockImplementation(
      answeringAfter(pushTabs, inTab1(3, 'a.md'), opened('tab-1', 'a.md')),
    );

    await workspace.goBack('tab-1');

    expect(workspace.getState().scrollRequest.token).toBeGreaterThan(before.token);
    expect(workspace.getState().scrollRequest).toMatchObject({ top: 240 });
    expect(historyOf(workspace)).toEqual([]);
  });

  it('takes one document off the Back stack for two presses of Back that are answered with the same document', async () => {
    const { bridge, workspace, pushTabs } = await readingIndex();
    bridge.openLink.mockImplementationOnce(
      answeringAfter(pushTabs, inTab1(2, 'b.md'), opened('tab-1', 'b.md')),
    );
    await workspace.openLink('tab-1', 'file:///C:/docs/b.md');
    bridge.openLink.mockImplementationOnce(
      answeringAfter(pushTabs, inTab1(3, 'c.md'), opened('tab-1', 'c.md')),
    );
    await workspace.openLink('tab-1', 'file:///C:/docs/c.md');
    const first = deferred<OpenOutcome>();
    const second = deferred<OpenOutcome>();
    bridge.reopenDocument.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const one = workspace.goBack('tab-1');
    const two = workspace.goBack('tab-1');
    pushTabs(inTab1(4, 'b.md'));
    first.resolve(opened('tab-1', 'b.md'));
    second.resolve(opened('tab-1', 'b.md'));
    await Promise.all([one, two]);

    expect(shown(workspace)?.name).toBe('b.md');
    expect(historyOf(workspace)).toEqual([{ path: 'C:\\docs\\a.md', scrollTop: 0 }]);
  });

  it('keeps the document and the history when Back is refused', async () => {
    const { bridge, workspace, pushTabs } = await readingIndex();
    bridge.openLink.mockImplementation(
      answeringAfter(pushTabs, inTab1(2, 'guide.md'), opened('tab-1', 'guide.md')),
    );
    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md');
    bridge.reopenDocument.mockResolvedValue(failed('That document is no longer available.'));

    await workspace.goBack('tab-1');

    expect(shown(workspace)?.name).toBe('guide.md');
    expect(workspace.getState().notice).toMatchObject({
      message: 'That document is no longer available.',
    });
    expect(historyOf(workspace)).toHaveLength(1);
  });

  it('keeps the history when Back is overtaken by something else, which says nothing', async () => {
    const { bridge, workspace, pushTabs } = await readingIndex();
    bridge.openLink.mockImplementation(
      answeringAfter(pushTabs, inTab1(2, 'guide.md'), opened('tab-1', 'guide.md')),
    );
    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md');
    bridge.reopenDocument.mockResolvedValue(canceled);

    await workspace.goBack('tab-1');

    expect(shown(workspace)?.name).toBe('guide.md');
    expect(workspace.getState().notice).toBeUndefined();
    expect(historyOf(workspace)).toHaveLength(1);
  });

  it('asks to scroll to the section a link points at', async () => {
    const { bridge, workspace, pushTabs } = await readingIndex();
    bridge.openLink.mockImplementation(
      answeringAfter(
        pushTabs,
        inTab1(2, 'guide.md'),
        opened('tab-1', 'guide.md', { anchor: 'install' }),
      ),
    );

    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md#install');

    expect(workspace.getState().scrollRequest).toMatchObject({ anchor: 'install' });
  });

  it('does not record history for a link that failed to open', async () => {
    const { bridge, workspace } = await readingIndex();
    bridge.openLink.mockResolvedValue(failed('blocked'));

    await workspace.openLink('tab-1', 'file:///C:/docs/nope.md');

    expect(historyOf(workspace)).toEqual([]);
    expect(shown(workspace)?.name).toBe('a.md');
    expect(workspace.getState().notice).toMatchObject({ message: 'blocked' });
  });

  it('does not record history, and says nothing, for a link that the main process overtook', async () => {
    const { bridge, workspace } = await readingIndex();
    bridge.openLink.mockResolvedValue(canceled);

    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md');

    expect(historyOf(workspace)).toEqual([]);
    expect(shown(workspace)?.name).toBe('a.md');
    expect(workspace.getState().notice).toBeUndefined();
  });

  it('asks for a tab of its own when the link says so, and gives that tab no history', async () => {
    const { bridge, workspace, pushTabs } = await readingIndex();
    bridge.openLink.mockImplementation(
      answeringAfter(pushTabs, TWO('tab-2', 2), opened('tab-2', 'b.md')),
    );

    await workspace.openLink('tab-1', 'file:///C:/docs/b.md', { newTab: true });

    expect(bridge.openLink).toHaveBeenCalledExactlyOnceWith('file:///C:/docs/b.md', {
      tabId: 'tab-1',
      newTab: true,
    });
    expect(shown(workspace)?.name).toBe('b.md');
    expect(historyOf(workspace, 'tab-2')).toEqual([]);
    expect(historyOf(workspace, 'tab-1')).toEqual([]);
  });

  it('keeps no history when the link led to a tab other than the one it was in', async () => {
    const { bridge, workspace } = await readingIndex();
    bridge.openLink.mockResolvedValue(opened('tab-2', 'b.md'));

    await workspace.openLink('tab-1', 'file:///C:/docs/b.md');

    expect(historyOf(workspace)).toEqual([]);
    expect(historyOf(workspace, 'tab-2')).toEqual([]);
  });

  it('reads a tab again that was let go, even when it was asked for under that path before', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(ONE());
    pushDocument(opened('tab-1', 'c.md'));
    bridge.loadTab.mockResolvedValue(opened('tab-1', 'a.md'));

    pushTabs(ONE(2));
    await flush();

    expect(bridge.loadTab).toHaveBeenCalledTimes(2);
    expect(shown(workspace)?.name).toBe('a.md');
  });

  it('keeps the history of each tab to itself', async () => {
    const { bridge, workspace, pushDocument, pushTabs } = await started(TWO('tab-1'));
    pushDocument(opened('tab-1', 'a.md'));
    pushDocument(opened('tab-2', 'b.md'));
    const both = (active: string, version: number): TabsSnapshot =>
      snapshot(
        version,
        [
          ['tab-1', 'guide.md'],
          ['tab-2', 'b.md'],
        ],
        active,
      );
    bridge.openLink.mockImplementation(
      answeringAfter(pushTabs, both('tab-1', 2), opened('tab-1', 'guide.md')),
    );
    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md');
    expect(activeView(workspace.getState())?.history).toHaveLength(1);

    pushTabs(both('tab-2', 3));
    expect(activeView(workspace.getState())?.history).toEqual([]);

    pushTabs(both('tab-1', 4));
    expect(activeView(workspace.getState())?.history).toHaveLength(1);
  });

  it('keeps no history when it did not know which document the link was in', async () => {
    const { bridge, workspace, pushTabs } = await started(ONE());
    bridge.openLink.mockImplementation(
      answeringAfter(pushTabs, inTab1(2, 'guide.md'), opened('tab-1', 'guide.md')),
    );

    await workspace.openLink('tab-1', 'file:///C:/docs/guide.md');

    expect(shown(workspace)?.name).toBe('guide.md');
    expect(historyOf(workspace)).toEqual([]);
  });
});

describe('Workspace: reloading', () => {
  it('shows the new content and keeps the scroll position', async () => {
    const { bridge, workspace, scroll, pushDocument } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    scroll.top = 300;
    bridge.reloadDocument.mockResolvedValue(opened('tab-1', 'a.md', { content: '# changed' }));

    await workspace.reload('tab-1');

    expect(bridge.reloadDocument).toHaveBeenCalledExactlyOnceWith('tab-1');
    expect(shown(workspace)?.content).toBe('# changed');
    expect(workspace.getState().scrollRequest).toMatchObject({ top: 300 });
  });

  it('does not redraw a document that has not changed', async () => {
    const { bridge, workspace, pushDocument } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    const before = workspace.getState().scrollRequest;
    bridge.reloadDocument.mockResolvedValue(opened('tab-1', 'a.md'));

    await workspace.reload('tab-1');

    expect(workspace.getState().scrollRequest).toBe(before);
  });

  it('keeps the old content and explains the problem when the file has gone', async () => {
    const { bridge, workspace, pushDocument } = await started(ONE());
    pushDocument(opened('tab-1', 'a.md'));
    bridge.reloadDocument.mockResolvedValue(failed('"a.md" could not be found.'));

    await workspace.reload('tab-1');

    expect(shown(workspace)?.content).toBe('# a.md');
    expect(workspace.getState().notice).toMatchObject({ kind: 'error' });
  });

  it('reloads the tab it names, and puts the reader back where they were when that tab is on screen again', async () => {
    const { bridge, workspace, scroll, pushDocument, pushTabs } = await started(TWO('tab-1'));
    pushDocument(opened('tab-1', 'a.md'));
    pushDocument(opened('tab-2', 'b.md'));
    scroll.top = 300;
    const answer = deferred<OpenOutcome>();
    bridge.reloadDocument.mockReturnValue(answer.promise);

    const reloading = workspace.reload('tab-1');
    pushTabs(TWO('tab-2', 2));
    answer.resolve(opened('tab-1', 'a.md', { content: '# changed' }));
    await reloading;
    expect(shown(workspace)?.name).toBe('b.md');

    pushTabs(TWO('tab-1', 3));

    expect(bridge.reloadDocument).toHaveBeenCalledExactlyOnceWith('tab-1');
    expect(shown(workspace)?.content).toBe('# changed');
    expect(workspace.getState().scrollRequest).toMatchObject({ top: 300 });
  });

  it('has nothing to reload when no tab is named', async () => {
    const { bridge, workspace } = await started(snapshot(1, []));

    await workspace.reload(undefined);

    expect(bridge.reloadDocument).not.toHaveBeenCalled();
  });
});
