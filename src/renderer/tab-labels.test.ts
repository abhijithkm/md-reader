import { describe, expect, it } from 'vitest';
import type { TabInfo } from '../shared/tabs';
import { dropIndex, labelTabs } from './tab-labels';

const tab = (id: string, path: string): TabInfo => ({ id, path });

describe('labelTabs', () => {
  it('names a tab after its file, and adds nothing when no other tab has that name', () => {
    expect(labelTabs([tab('tab-1', 'C:\\docs\\a.md'), tab('tab-2', 'C:\\docs\\b.md')])).toEqual([
      { id: 'tab-1', name: 'a.md', folder: undefined, path: 'C:\\docs\\a.md' },
      { id: 'tab-2', name: 'b.md', folder: undefined, path: 'C:\\docs\\b.md' },
    ]);
  });

  it('adds the folder to tabs that share a name, so that they can be told apart', () => {
    const labels = labelTabs([
      tab('tab-1', 'C:\\work\\api\\README.md'),
      tab('tab-2', 'C:\\work\\web\\README.md'),
      tab('tab-3', 'C:\\work\\notes.md'),
    ]);

    expect(labels.map((label) => label.folder)).toEqual(['api', 'web', undefined]);
  });

  it('counts names that differ only in case as the same, as Windows does', () => {
    const labels = labelTabs([tab('tab-1', 'C:\\a\\Readme.md'), tab('tab-2', 'C:\\b\\README.MD')]);

    expect(labels.map((label) => label.folder)).toEqual(['a', 'b']);
  });

  it('takes the name and the folder from a path written with slashes as well', () => {
    expect(labelTabs([tab('tab-1', '/home/ada/notes/a.md')])[0]).toMatchObject({
      name: 'a.md',
      path: '/home/ada/notes/a.md',
    });
  });

  it('has no labels for no tabs', () => {
    expect(labelTabs([])).toEqual([]);
  });
});

describe('dropIndex', () => {
  it.each([
    // [from, over, after, where it ends up]
    [0, 2, false, 1],
    [0, 2, true, 2],
    [2, 0, false, 0],
    [2, 0, true, 1],
    [1, 2, false, 1],
    [1, 0, true, 1],
    [3, 1, false, 1],
    [0, 3, true, 3],
  ])('puts the tab from %i dropped over %i (after: %s) at %i', (from, over, after, expected) => {
    expect(dropIndex(from, over, after)).toBe(expected);
  });

  it('leaves a tab where it is when it is dropped on itself, whichever half', () => {
    for (const place of [0, 1, 4]) {
      expect(dropIndex(place, place, false)).toBe(place);
      expect(dropIndex(place, place, true)).toBe(place);
    }
  });
});
