import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeSettings, type Settings } from '../shared/settings';
import { errorCode } from './errors';

export interface SettingsStoreOptions {
  /** Called when reading or writing the settings file fails. */
  onError?: (error: unknown) => void;
}

/**
 * Keeps theme and zoom in a small JSON file in the user's profile. Settings
 * are loaded synchronously once at startup (the window needs them before it is
 * created) and written asynchronously afterwards. A damaged or unwritable file
 * never prevents the app from working; the problem is reported through
 * `onError` and the in-memory values stay authoritative.
 */
export class SettingsStore {
  private readonly filePath: string;
  private readonly onError: (error: unknown) => void;
  private settings: Settings = normalizeSettings(undefined);
  private writes: Promise<void> = Promise.resolve();

  constructor(filePath: string, options: SettingsStoreOptions = {}) {
    this.filePath = filePath;
    this.onError = options.onError ?? (() => undefined);
  }

  load(): Settings {
    try {
      this.settings = normalizeSettings(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      this.settings = normalizeSettings(undefined);
      if (!isMissingFile(error)) this.onError(error);
    }
    return this.get();
  }

  get(): Settings {
    return { ...this.settings };
  }

  /** Applies the patch immediately, then resolves once it has been written (or the write failed). */
  update(patch: Partial<Settings>): Promise<Settings> {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    const snapshot = this.get();

    // Writes run one after another so the file always ends with the newest values.
    const write = this.writes.then(() => this.persist(snapshot));
    this.writes = write;
    return write.then(() => snapshot);
  }

  /** Resolves once every queued write has finished; call before the app exits. */
  flush(): Promise<void> {
    return this.writes;
  }

  private async persist(settings: Settings): Promise<void> {
    const temporary = `${this.filePath}.tmp`;
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      await rename(temporary, this.filePath);
    } catch (error) {
      this.onError(error);
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}
