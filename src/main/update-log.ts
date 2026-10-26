import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

/** What the update library asks of a logger. */
export interface LibraryLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug(message?: unknown): void;
}

export interface UpdateLog {
  write(level: LogLevel, message: unknown): void;
  /** The same log, as the update library wants it. */
  readonly library: LibraryLogger;
}

export interface UpdateLogOptions {
  /** The file stays below about this many bytes. */
  maxBytes?: number;
  now?: () => Date;
}

const DEFAULT_MAX_BYTES = 200 * 1024;
const MAX_MESSAGE_CHARS = 1000;

/**
 * Any value as text for the log: a string as it is, an error by its message, the rest as JSON. It
 * never throws, whatever it is given.
 */
export function describeForLog(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

/** The random id of the installation, which the library writes about and this app never sends. */
const INSTALLATION_ID = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi;
/** Every control character but tab, which a server must not be able to send to a log or a terminal. */
const CONTROL_CHARACTERS = /(?![\t\n\r])\p{Cc}/gu;
/** Only this much of a message is looked at, so that a huge one costs no more than a long one. */
const MAX_INPUT_CHARS = 4 * MAX_MESSAGE_CHARS;

/** The first `max` characters, without cutting a character that is two code units long in half. */
function cut(text: string, max: number): string {
  const lastKept = text.charCodeAt(max - 1);
  const splitsAPair = lastKept >= 0xd800 && lastKept <= 0xdbff;
  return text.slice(0, splitsAPair ? max - 1 : max);
}

function oneLine(text: string): string {
  const flat = text
    .slice(0, MAX_INPUT_CHARS)
    .replace(INSTALLATION_ID, '<id>')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/[\r\n]+/g, ' | ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return flat.length > MAX_MESSAGE_CHARS ? `${cut(flat, MAX_MESSAGE_CHARS)}…` : flat;
}

/**
 * A small log of what the updater did and why, in the user's profile folder. It exists for the day an
 * update does not arrive: the library writes to a console that a packaged app does not have, so
 * without this a failure would leave no trace. It stays on the computer, holds version numbers, web
 * addresses of GitHub and error messages, keeps itself small, and never gets in the way of updating.
 */
export function createUpdateLog(file: string, options: UpdateLogOptions = {}): UpdateLog {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const now = options.now ?? (() => new Date());

  /**
   * Past the limit, keeps the newest half, counted in bytes, and says that older lines are gone. The
   * shorter file is written whole and put in place in one step, so a crash cannot leave half of it.
   */
  const trim = (): void => {
    if (statSync(file).size <= maxBytes) return;
    const kept = readFileSync(file);
    const tail = kept.subarray(kept.length - Math.floor(maxBytes / 2)).toString('utf8');
    const fromNextLine = tail.slice(tail.indexOf('\n') + 1);
    const shortened = `${file}.tmp`;
    writeFileSync(shortened, `${now().toISOString()} info  (older lines removed)\n${fromNextLine}`);
    renameSync(shortened, file);
  };

  const write = (level: LogLevel, message: unknown): void => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const line = `${now().toISOString()} ${level.padEnd(5)} ${oneLine(describeForLog(message))}\n`;
      appendFileSync(file, line, 'utf8');
      trim();
    } catch {
      // A log that cannot be written must never get in the way of updating.
    }
  };

  return {
    write,
    library: {
      info: (message) => {
        // A download in pieces says this for every piece, which would fill the file and push out
        // the lines that matter.
        if (typeof message === 'string' && message.startsWith('Redirect to ')) return;
        write('info', message);
      },
      warn: (message) => {
        write('warn', message);
      },
      error: (message) => {
        write('error', message);
      },
      // The library's debugging detail would drown what matters.
      debug: () => undefined,
    },
  };
}
