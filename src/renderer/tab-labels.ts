import { fileNameOf, folderNameOf, type TabInfo } from '../shared/tabs';

/** What a tab says about its document. */
export interface TabLabel {
  id: string;
  /** The file name. */
  name: string;
  /**
   * The name of the folder the file is in, for a tab whose name another open tab shares, so that the
   * two can be told apart. Left out otherwise: most tabs need nothing but a name.
   */
  folder: string | undefined;
  /** The whole path, for the tooltip. */
  path: string;
}

export function labelTabs(tabs: readonly TabInfo[]): TabLabel[] {
  // Windows does not tell README.md from readme.md, and neither does a reader.
  const times = new Map<string, number>();
  for (const tab of tabs) {
    const key = fileNameOf(tab.path).toLowerCase();
    times.set(key, (times.get(key) ?? 0) + 1);
  }

  return tabs.map((tab) => {
    const name = fileNameOf(tab.path);
    const shared = (times.get(name.toLowerCase()) ?? 0) > 1;
    return {
      id: tab.id,
      name,
      folder: shared ? folderNameOf(tab.path) : undefined,
      path: tab.path,
    };
  });
}

/**
 * Where a tab that is dragged ends up in the row, once it is let go on the left half (`after` is
 * false) or the right half of the tab at `over`. Both places are those of the row as it is before
 * the move, and a tab let go on itself stays where it is.
 */
export function dropIndex(from: number, over: number, after: boolean): number {
  const insertAt = over + (after ? 1 : 0);
  return from < insertAt ? insertAt - 1 : insertAt;
}
