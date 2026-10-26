/** The most tabs that can be open at once. Each one keeps the text of its document in memory. */
export const MAX_TABS = 30;

/** What the page is told about one tab. */
export interface TabInfo {
  /** Issued by the main process. The page can only refer to a tab by an id it was given. */
  id: string;
  /** Absolute path of the document the tab shows now. It changes when a link is followed. */
  path: string;
}

/** The tabs in the order they are shown, and which one is on screen. */
export interface TabList {
  tabs: TabInfo[];
  activeId: string | undefined;
}

/**
 * What the page is told about the tabs. Each change is numbered, so that a page that is handed two
 * of them in the wrong order (a message that was slow, and the answer to its own question) keeps
 * the newer one.
 */
export interface TabsSnapshot extends TabList {
  /** Grows with every change of the tabs; starts at 0 for the tabs of an earlier session. */
  version: number;
}

/** What a click on a link can ask for besides opening the document it leads to. */
export interface OpenLinkOptions {
  /** Show the linked document in a tab of its own instead of in the tab the link is in. */
  newTab?: boolean;
  /**
   * The tab the link is in, as the page knows it. The page may still be showing a tab that the main
   * process has since moved on from, and the link belongs to the one the reader clicked in. Without
   * it, the tab on screen is meant.
   */
  tabId?: string;
}

/** What a click on a link asks for. Which tab it is in, the page knows and says on its own. */
export type LinkWish = Pick<OpenLinkOptions, 'newTab'>;

const TAB_ID = /^tab-\d{1,9}$/;

/** Whether a value has the shape of an id the main process issues. It may still be an unknown one. */
export function isTabId(value: unknown): value is string {
  return typeof value === 'string' && TAB_ID.test(value);
}

function segmentsOf(filePath: string): string[] {
  return filePath.split(/[\\/]/).filter((part) => part !== '');
}

/** The file name at the end of a path, whichever kind of separator it is written with. */
export function fileNameOf(filePath: string): string {
  return segmentsOf(filePath).at(-1) ?? filePath;
}

/** The name of the folder that holds the file, which tells apart files that share a name. */
export function folderNameOf(filePath: string): string | undefined {
  return segmentsOf(filePath).at(-2);
}

/**
 * Whether two paths name the same file as far as the page can tell. Windows does not tell a path from
 * the same path in other letters, and a path may be written with slashes or with backslashes.
 */
export function samePath(a: string, b: string): boolean {
  const key = (filePath: string): string => filePath.replaceAll('/', '\\').toLowerCase();
  return key(a) === key(b);
}
