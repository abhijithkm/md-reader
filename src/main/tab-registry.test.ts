import { describe, expect, it } from 'vitest';
import { isTabId, MAX_TABS } from '../shared/tabs';
import { TabRegistry } from './tab-registry';

const A = 'C:\\docs\\a.md';
const B = 'C:\\docs\\b.md';
const C = 'C:\\docs\\c.md';

function registryWith(...paths: string[]): TabRegistry {
  const registry = new TabRegistry();
  for (const filePath of paths) registry.open(filePath);
  return registry;
}

const idsOf = (registry: TabRegistry): string[] => registry.snapshot().tabs.map((tab) => tab.id);
const pathsOf = (registry: TabRegistry): string[] =>
  registry.snapshot().tabs.map((tab) => tab.path);

describe('TabRegistry', () => {
  it('starts with no tabs', () => {
    const registry = new TabRegistry();

    expect(registry.snapshot()).toEqual({ tabs: [], activeId: undefined });
    expect(registry.currentPath()).toBeUndefined();
  });

  describe('opening', () => {
    it('adds a tab for a document and makes it the active one', () => {
      const registry = new TabRegistry();

      const opened = registry.open(A);

      expect(opened).toEqual({ id: expect.stringMatching(/^tab-\d+$/) as string, created: true });
      expect(registry.snapshot()).toEqual({
        tabs: [{ id: opened?.id, path: A }],
        activeId: opened?.id,
      });
      expect(registry.currentPath()).toBe(A);
    });

    it('puts each new tab after the others and activates it', () => {
      const registry = registryWith(A, B);

      const third = registry.open(C);

      expect(pathsOf(registry)).toEqual([A, B, C]);
      expect(registry.snapshot().activeId).toBe(third?.id);
    });

    it('gives each tab an id of its own, and never one that was used before', () => {
      const registry = registryWith(A, B);
      const [first, second] = idsOf(registry);
      registry.close(second ?? '');

      const again = registry.open(B);

      expect(new Set([first, second, again?.id]).size).toBe(3);
    });

    it('shows the existing tab for a document that is already open, instead of adding another', () => {
      const registry = registryWith(A, B);
      const [first] = idsOf(registry);

      const again = registry.open(A);

      expect(again).toEqual({ id: first, created: false });
      expect(pathsOf(registry)).toEqual([A, B]);
      expect(registry.snapshot().activeId).toBe(first);
    });

    it.runIf(process.platform === 'win32')(
      'knows a Windows path by its letters, not their case, and by its shape',
      () => {
        const registry = registryWith(A);

        const again = registry.open('c:\\DOCS\\.\\A.md');

        expect(again?.created).toBe(false);
        expect(registry.snapshot().tabs).toHaveLength(1);
      },
    );

    it('can open a tab without leaving the one the reader is on', () => {
      const registry = registryWith(A);
      const [first] = idsOf(registry);

      const opened = registry.open(B, { activate: false });

      expect(opened?.created).toBe(true);
      expect(registry.snapshot().activeId).toBe(first);
      expect(pathsOf(registry)).toEqual([A, B]);
    });

    it('refuses a tab beyond the limit and changes nothing, but still finds one that is open', () => {
      const registry = new TabRegistry(2);
      registry.open(A);
      registry.open(B);
      const before = registry.snapshot();

      expect(registry.open(C)).toBeUndefined();
      expect(registry.open(A)).toMatchObject({ created: false });
      expect(registry.snapshot().tabs).toEqual(before.tabs);
    });

    it('allows as many tabs as the shared limit says', () => {
      const registry = new TabRegistry();
      for (let n = 0; n < MAX_TABS; n += 1)
        expect(registry.open(`C:\\docs\\${n}.md`)).toBeDefined();

      expect(registry.open('C:\\docs\\one-more.md')).toBeUndefined();
    });
  });

  describe('finding', () => {
    it('knows which tab shows a document, and which document a tab shows', () => {
      const registry = registryWith(A, B);
      const [first, second] = idsOf(registry);

      expect(registry.find(B)?.id).toBe(second);
      expect(registry.find(C)).toBeUndefined();
      expect(registry.pathOf(first ?? '')).toBe(A);
      expect(registry.pathOf('tab-999')).toBeUndefined();
      expect(registry.has(second ?? '')).toBe(true);
      expect(registry.has('tab-999')).toBe(false);
    });
  });

  describe('the tab on screen', () => {
    it('is none until a tab is open, and none again after the last one is closed', () => {
      const registry = new TabRegistry();
      expect(registry.activeTabId()).toBeUndefined();

      const opened = registry.open(A);
      expect(registry.activeTabId()).toBe(opened?.id);

      registry.close(opened?.id ?? '');
      expect(registry.activeTabId()).toBeUndefined();
    });

    it('is the tab that was activated last', () => {
      const registry = registryWith(A, B);
      const [first] = idsOf(registry);

      registry.activate(first ?? '');

      expect(registry.activeTabId()).toBe(first);
    });
  });

  describe('room for more', () => {
    it('counts the places left up to the limit, and gives them back when a tab is closed', () => {
      const registry = new TabRegistry(2);
      expect(registry.room()).toBe(2);

      registry.open(A);
      expect(registry.room()).toBe(1);

      registry.open(B);
      expect(registry.room()).toBe(0);

      registry.close(idsOf(registry)[0] ?? '');
      expect(registry.room()).toBe(1);
    });

    it('does not count a document that already has a tab as taking another place', () => {
      const registry = new TabRegistry(2);
      registry.open(A);

      registry.open(A);

      expect(registry.room()).toBe(1);
    });

    it('is the shared limit to begin with', () => {
      expect(new TabRegistry().room()).toBe(MAX_TABS);
    });
  });

  describe('following a link in a tab', () => {
    it('makes the tab show the other document, under the same id and in the same place', () => {
      const registry = registryWith(A, B);
      const [first, second] = idsOf(registry);

      expect(registry.navigate(first ?? '', C)).toBe(true);

      expect(registry.snapshot().tabs).toEqual([
        { id: first, path: C },
        { id: second, path: B },
      ]);
    });

    it('moves the current path with the active tab', () => {
      const registry = registryWith(A);
      const [only] = idsOf(registry);

      registry.navigate(only ?? '', B);

      expect(registry.currentPath()).toBe(B);
    });

    it('knows nothing of a tab it did not issue', () => {
      const registry = registryWith(A);

      expect(registry.navigate('tab-999', B)).toBe(false);
      expect(pathsOf(registry)).toEqual([A]);
    });
  });

  describe('activating', () => {
    it('switches to a tab, and only to one that exists', () => {
      const registry = registryWith(A, B);
      const [first] = idsOf(registry);

      expect(registry.activate(first ?? '')).toBe(true);
      expect(registry.snapshot().activeId).toBe(first);
      expect(registry.currentPath()).toBe(A);

      expect(registry.activate('tab-999')).toBe(false);
      expect(registry.snapshot().activeId).toBe(first);
    });
  });

  describe('closing', () => {
    it('removes the tab and passes on to the one that follows it', () => {
      const registry = registryWith(A, B, C);
      const [first, second, third] = idsOf(registry);
      registry.activate(second ?? '');

      expect(registry.close(second ?? '')).toBe(true);

      expect(idsOf(registry)).toEqual([first, third]);
      expect(registry.snapshot().activeId).toBe(third);
    });

    it('passes on to the one before when the last tab is closed', () => {
      const registry = registryWith(A, B, C);
      const [, second, third] = idsOf(registry);

      registry.close(third ?? '');

      expect(registry.snapshot().activeId).toBe(second);
    });

    it('leaves the active tab alone when another one is closed', () => {
      const registry = registryWith(A, B, C);
      const [first, , third] = idsOf(registry);
      registry.activate(third ?? '');

      registry.close(first ?? '');

      expect(registry.snapshot().activeId).toBe(third);
    });

    it('ends with no tabs and no current path when the last one is closed', () => {
      const registry = registryWith(A);
      const [only] = idsOf(registry);

      registry.close(only ?? '');

      expect(registry.snapshot()).toEqual({ tabs: [], activeId: undefined });
      expect(registry.currentPath()).toBeUndefined();
    });

    it('knows nothing of a tab it did not issue', () => {
      const registry = registryWith(A);

      expect(registry.close('tab-999')).toBe(false);
      expect(pathsOf(registry)).toEqual([A]);
    });
  });

  describe('moving', () => {
    it('puts a tab in another place and keeps the same tab active', () => {
      const registry = registryWith(A, B, C);
      const [first, second, third] = idsOf(registry);
      registry.activate(second ?? '');

      expect(registry.move(third ?? '', 0)).toBe(true);

      expect(idsOf(registry)).toEqual([third, first, second]);
      expect(registry.snapshot().activeId).toBe(second);
    });

    it('keeps a place beyond either end inside the row', () => {
      const registry = registryWith(A, B, C);
      const [first, second, third] = idsOf(registry);

      registry.move(first ?? '', 99);
      expect(idsOf(registry)).toEqual([second, third, first]);

      registry.move(first ?? '', -5);
      expect(idsOf(registry)).toEqual([first, second, third]);
    });

    it('refuses a place that is not a whole number, and a tab it did not issue', () => {
      const registry = registryWith(A, B);
      const before = idsOf(registry);

      expect(registry.move(before[0] ?? '', 0.5)).toBe(false);
      expect(registry.move(before[0] ?? '', Number.NaN)).toBe(false);
      expect(registry.move('tab-999', 0)).toBe(false);
      expect(idsOf(registry)).toEqual(before);
    });
  });

  describe('restoring tabs from an earlier session', () => {
    it('opens them in order and makes the chosen one active', () => {
      const registry = new TabRegistry();

      registry.restore([A, B, C], 1);

      expect(pathsOf(registry)).toEqual([A, B, C]);
      expect(registry.currentPath()).toBe(B);
    });

    it('takes a document only once, and no more than the limit', () => {
      const registry = new TabRegistry(2);

      registry.restore([A, A, B, C], 0);

      expect(pathsOf(registry)).toEqual([A, B]);
    });

    it.each([-1, 5, 1.5, Number.NaN])('falls back to the first tab for the place %s', (place) => {
      const registry = new TabRegistry();

      registry.restore([A, B], place);

      expect(registry.currentPath()).toBe(A);
    });

    it('keeps the active document active when an earlier duplicate was left out', () => {
      const registry = new TabRegistry();

      registry.restore([A, A, B], 2);

      expect(pathsOf(registry)).toEqual([A, B]);
      expect(registry.currentPath()).toBe(B);
    });

    it('shows the one tab a document has when it was the active one and was listed twice', () => {
      const registry = new TabRegistry();

      registry.restore([A, B, A], 2);

      expect(pathsOf(registry)).toEqual([A, B]);
      expect(registry.currentPath()).toBe(A);
    });

    it('falls back to the first tab when the active document was cut off by the limit', () => {
      const registry = new TabRegistry(2);

      registry.restore([A, B, C], 2);

      expect(pathsOf(registry)).toEqual([A, B]);
      expect(registry.currentPath()).toBe(A);
    });

    it('replaces what was there, and ends with no tabs for an empty list', () => {
      const registry = registryWith(A);

      registry.restore([], 0);

      expect(registry.snapshot()).toEqual({ tabs: [], activeId: undefined });
    });

    it('reports the place of the active tab, so that it can be saved', () => {
      const registry = registryWith(A, B, C);
      registry.activate(idsOf(registry)[1] ?? '');

      expect(registry.activeIndex()).toBe(1);
      expect(new TabRegistry().activeIndex()).toBe(0);
    });
  });

  it('hands out copies, so that nothing outside can change the list', () => {
    const registry = registryWith(A);

    const snapshot = registry.snapshot();
    snapshot.tabs.length = 0;
    snapshot.tabs.push({ id: 'tab-7', path: B });

    expect(pathsOf(registry)).toEqual([A]);
  });
});

describe('isTabId', () => {
  it('accepts what the registry issues', () => {
    const registry = registryWith(A, B);

    for (const id of idsOf(registry)) expect(isTabId(id)).toBe(true);
  });

  it.each([
    undefined,
    null,
    7,
    '',
    'tab-',
    'tab-x',
    'tab-1.5',
    'TAB-1',
    ' tab-1',
    'tab-1234567890',
  ])('refuses %j', (value) => {
    expect(isTabId(value)).toBe(false);
  });
});
