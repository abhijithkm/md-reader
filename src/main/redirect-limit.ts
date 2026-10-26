/** The part of the update library's HTTP executor that follows redirects. */
export interface RedirectExecutor {
  addRedirectHandlers(
    request: unknown,
    options: object,
    reject: (error: Error) => void,
    redirectCount: number,
    handler: (options: object) => void,
  ): void;
}

/** What the library means to allow: it follows a request through at most this many redirects. */
export const MAX_REDIRECTS = 10;

/**
 * Makes the limit on redirects real. The library says it stops after ten, but it hands the same
 * count to every hop, so a server that answers every request with another redirect keeps it busy
 * for as long as the app is open: the check never ends, and neither does the download.
 *
 * Each redirect is followed by a new request whose options are a copy of the old ones, so the count
 * is kept per set of options and carried from one to the next.
 */
export function addRedirectLimit(executor: RedirectExecutor, limit: number = MAX_REDIRECTS): void {
  const hops = new WeakMap<object, number>();
  const addLibraryHandlers = executor.addRedirectHandlers.bind(executor);

  executor.addRedirectHandlers = (request, options, reject, redirectCount, handler) => {
    const used = hops.get(options) ?? 0;
    addLibraryHandlers(request, options, reject, redirectCount, (next) => {
      if (used >= limit) {
        reject(new Error(`More than ${limit} redirects in a row.`));
        return;
      }
      hops.set(next, used + 1);
      handler(next);
    });
  };
}
