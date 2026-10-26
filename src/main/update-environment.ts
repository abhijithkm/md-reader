import type { UpdateUnavailableReason } from '../shared/updates';

export type UpdateEnvironment =
  | { kind: 'unavailable'; reason: UpdateUnavailableReason }
  | {
      kind: 'active';
      notifyOnly: boolean;
      testFeedUrl?: string;
      /** The wait before the first check, when the environment sets one. */
      firstCheckDelayMs?: number;
      /**
       * How long a request may stay silent before it is given up on, when a test shortens it. Only
       * a development build with a feed on this computer honours this.
       */
      requestTimeoutMs?: number;
    };

export interface UpdateEnvironmentInput {
  isPackaged: boolean;
  env: Readonly<Record<string, string | undefined>>;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The address of a feed served from this computer, with a trailing slash; undefined for anything else. */
function parseLoopbackFeed(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const onThisComputer =
    url.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.port !== '' &&
    url.username === '' &&
    url.password === '';
  if (!onThisComputer) return undefined;
  const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.protocol}//${url.host}${pathname}`;
}

const MAX_FIRST_CHECK_DELAY_MS = 24 * 60 * 60 * 1000;
const MIN_REQUEST_TIMEOUT_MS = 100;
const MAX_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** A wait in whole milliseconds, up to a day; undefined for anything else. */
function parseFirstCheckDelay(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,9}$/.test(value)) return undefined;
  const delay = Number(value);
  return delay <= MAX_FIRST_CHECK_DELAY_MS ? delay : undefined;
}

/** A limit in whole milliseconds, from a tenth of a second to ten minutes; undefined for anything else. */
function parseRequestTimeout(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,7}$/.test(value)) return undefined;
  const limit = Number(value);
  return limit >= MIN_REQUEST_TIMEOUT_MS && limit <= MAX_REQUEST_TIMEOUT_MS ? limit : undefined;
}

/**
 * Decides whether this run may look for updates, and how. The environment can only take updating
 * away (`MDREADER_UPDATES=off`, which the tests of the packaged app set so that they never touch the
 * network), change when the first check happens (`MDREADER_UPDATE_FIRST_CHECK_MS`, which moves a
 * check that was coming anyway), or, in a development build only, point updating at a feed on this
 * computer so that a test can try the whole flow. A packaged build ignores every other variable:
 * where updates come from is fixed in the package.
 */
export function resolveUpdateEnvironment({
  isPackaged,
  env,
}: UpdateEnvironmentInput): UpdateEnvironment {
  if (env['MDREADER_UPDATES'] === 'off') return { kind: 'unavailable', reason: 'disabled' };

  const delay = parseFirstCheckDelay(env['MDREADER_UPDATE_FIRST_CHECK_MS']);
  const firstCheck = delay === undefined ? {} : { firstCheckDelayMs: delay };

  if (isPackaged) {
    // The launcher of the portable executable sets this; such a copy cannot replace itself.
    const portable = (env['PORTABLE_EXECUTABLE_FILE'] ?? '') !== '';
    return { kind: 'active', notifyOnly: portable, ...firstCheck };
  }

  const testFeedUrl = parseLoopbackFeed(env['MDREADER_UPDATE_FEED']);
  const limit = parseRequestTimeout(env['MDREADER_UPDATE_REQUEST_TIMEOUT_MS']);
  return testFeedUrl === undefined
    ? { kind: 'unavailable', reason: 'development' }
    : {
        kind: 'active',
        notifyOnly: false,
        testFeedUrl,
        ...firstCheck,
        ...(limit === undefined ? {} : { requestTimeoutMs: limit }),
      };
}
