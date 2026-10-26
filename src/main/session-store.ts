import { readFileSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isMarkdownFileName } from '../shared/markdown-files';
import { MAX_TABS } from '../shared/tabs';
import { errorCode } from './errors';
import { assessLocalPath } from './local-path-policy';

/** The documents that were open in tabs, and the place of the one that was on screen. */
export interface SessionData {
  paths: string[];
  active: number;
}

const MAX_PATH_LENGTH = 32_767;

/**
 * Thirty paths of the longest length, with every character written as three bytes and every
 * backslash doubled, come to less than this. A file larger than that was not written by MD Reader.
 */
const MAX_SESSION_BYTES = 8 * 1024 * 1024;

const empty = (): SessionData => ({ paths: [], active: 0 });

function isUsablePath(entry: unknown): entry is string {
  return (
    typeof entry === 'string' &&
    entry !== '' &&
    entry.length <= MAX_PATH_LENGTH &&
    !entry.includes('\0') &&
    path.isAbsolute(entry) &&
    isMarkdownFileName(entry) &&
    // Reading a file on a network share makes Windows send the user's credentials to its server. That
    // is not something to do on its own when the app starts, so a path that points at one is not
    // kept, nor is a device path or an alternate data stream. A drive letter that is a mapped share
    // looks like any other drive, and is kept.
    assessLocalPath(entry, undefined).ok
  );
}

/**
 * What an earlier run saved, read with care: anything that is not the absolute path of a Markdown
 * file on this computer is dropped, and no more than the limit are kept. The file is the app's own,
 * but it is a file in the user's profile, so it is not believed blindly. (Each path is checked again
 * when its tab is first read; see `AppController.loadTab`.)
 */
export function parseSession(input: unknown): SessionData {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return empty();
  const record = input as Record<string, unknown>;
  const listed: unknown[] = Array.isArray(record['tabs']) ? record['tabs'] : [];
  const wanted = record['active'];

  const paths: string[] = [];
  let activePath: string | undefined;
  listed.forEach((entry, index) => {
    if (!isUsablePath(entry) || paths.length >= MAX_TABS) return;
    paths.push(entry);
    if (index === wanted) activePath = entry;
  });
  return { paths, active: activePath === undefined ? 0 : paths.indexOf(activePath) };
}

export interface SessionStoreOptions {
  /** Called when reading or writing the file fails. */
  onError?: (error: unknown) => void;
  /** How long changes are collected before they are written. */
  delayMs?: number;
}

/**
 * Remembers which documents are open in tabs, in `session.json` in the user's profile, so that the
 * next run can open them again. Only the main process writes it, and only from the tabs it holds
 * itself: the page can switch the remembering off, but can never put a path into the file.
 *
 * Changes are collected for a moment and written together, atomically (a temporary file, then a
 * rename), one write after another. A file that cannot be read or written never stops the app.
 */
export class SessionStore {
  private readonly filePath: string;
  private readonly onError: (error: unknown) => void;
  private readonly delayMs: number;
  private enabled = true;
  private waiting: SessionData | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writes: Promise<void> = Promise.resolve();

  constructor(filePath: string, options: SessionStoreOptions = {}) {
    this.filePath = filePath;
    this.onError = options.onError ?? (() => undefined);
    this.delayMs = options.delayMs ?? 300;
  }

  /** Read once, at start-up. No file, or a damaged one, means no tabs. */
  load(): SessionData {
    try {
      if (statSync(this.filePath).size > MAX_SESSION_BYTES) {
        throw new Error('The file of remembered tabs is too large to be one that MD Reader wrote.');
      }
      return parseSession(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') this.onError(error);
      return empty();
    }
  }

  /** The tabs as they are now. They are written a moment later, together with any change after them. */
  save(data: SessionData): void {
    if (!this.enabled) return;
    this.waiting = data;
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.writeWaiting();
    }, this.delayMs);
    this.timer.unref();
  }

  /** Switching off forgets what was waiting and removes the file; switching on lets `save` write. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) return;

    this.cancelTimer();
    this.waiting = undefined;
    this.enqueue(() => this.remove());
  }

  /** Writes what is waiting at once and resolves when every write has finished. */
  flush(): Promise<void> {
    if (this.timer !== undefined) {
      this.cancelTimer();
      this.writeWaiting();
    }
    return this.writes;
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private writeWaiting(): void {
    const data = this.waiting;
    this.waiting = undefined;
    if (data === undefined || !this.enabled) return;
    this.enqueue(() => this.persist(data));
  }

  private enqueue(task: () => Promise<void>): void {
    this.writes = this.writes.then(task).catch((error: unknown) => {
      this.onError(error);
    });
  }

  private async persist(data: SessionData): Promise<void> {
    const temporary = this.temporaryPath();
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const text = JSON.stringify({ version: 1, tabs: data.paths, active: data.active });
    try {
      await writeFile(temporary, `${text}\n`, 'utf8');
      await rename(temporary, this.filePath);
    } catch (error) {
      // What could not be moved into place is not left lying about: it holds the paths of the open files.
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Removes the file, and a version of it that was being made. */
  private async remove(): Promise<void> {
    await rm(this.filePath, { force: true });
    await rm(this.temporaryPath(), { force: true });
  }

  private temporaryPath(): string {
    return `${this.filePath}.tmp`;
  }
}
