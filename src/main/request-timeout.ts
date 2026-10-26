/** What the timeout needs from a request: Electron's `net.request` provides all of it. */
interface WatchedRequest {
  abort(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface WatchedResponse {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** The part of the update library's HTTP executor that this wraps. */
export interface RequestExecutor {
  addErrorAndTimeoutHandlers(
    request: WatchedRequest,
    reject: (error: Error) => void,
    timeout?: number,
  ): void;
}

/** The library's own default, and what it intends: a request that hears nothing for a minute fails. */
export const REQUEST_IDLE_TIMEOUT_MS = 60_000;

/** What this keeps of the requests it watches. */
export interface RequestWatch {
  /** Stops every request that is still under way, and fails each of them with `reason`. */
  abortAll(reason: string): void;
}

/**
 * Makes the library's requests give up when they hear nothing for a while.
 *
 * The library starts that timer when its request emits `socket`, which Electron's `net.request`
 * never does, so a request to a server that accepts the connection and then says nothing waits
 * forever: the check never finishes, and the library hands the same stuck check to every later one.
 *
 * This adds the timer the library meant to have. It counts the time without data, not the time a
 * download takes, so a large file on a slow connection is never cut off while it is arriving.
 *
 * What ends the watch is chosen with care, because Electron does not behave as its documentation
 * suggests: it emits `finish` and `close` on a request as soon as the request has been sent, long
 * before the response, so `close` cannot be taken for the end. The watch ends when the response ends
 * or fails, when the request fails, and when the request is told to abort, whoever tells it. The
 * library makes that last call itself to follow a redirect. Electron 44 reports it with an `abort`
 * event, but its documentation says it does not once a request has closed, so the call is what this
 * relies on. Tried against Electron's real network stack: a server that goes silent fails after the
 * limit, a download that keeps trickling in for longer than the limit completes, one that stalls
 * fails, and so do both behind a redirect, which is how GitHub serves its release files.
 *
 * The requests it watches are also the only handle on a download that has to stop. The library's own
 * cancellation fails the promise of a download and leaves the transfer running, so `abortAll` is how
 * a reader who switched updating off is not left with a file still arriving.
 */
export function addRequestTimeout(
  executor: RequestExecutor,
  idleMs: number = REQUEST_IDLE_TIMEOUT_MS,
): RequestWatch {
  const addLibraryHandlers = executor.addErrorAndTimeoutHandlers.bind(executor);
  /** One way to give up for each request that is neither over nor given up on by the library. */
  const underWay = new Set<(reason: string) => void>();

  executor.addErrorAndTimeoutHandlers = (request, reject, timeout) => {
    addLibraryHandlers(request, reject, timeout);

    const limit = timeout ?? idleMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const stop = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const finish = (): void => {
      finished = true;
      stop();
      underWay.delete(giveUp);
    };

    // The library aborts a request to follow a redirect and carries on with a new one that settles
    // the same promise. Once it has done so, this request has nothing left to time, and its timer
    // must not fail what the new request is still doing.
    const abortRequest = request.abort.bind(request);
    request.abort = () => {
      finish();
      abortRequest();
    };

    function giveUp(reason: string): void {
      finish();
      abortRequest();
      reject(new Error(reason));
    }
    underWay.add(giveUp);

    const wait = (): void => {
      stop();
      if (finished) return;
      timer = setTimeout(() => {
        giveUp(`The server sent nothing for ${Math.round(limit / 1000)} seconds.`);
      }, limit);
      timer.unref();
    };

    wait();
    request.on('response', (response) => {
      wait();
      const body = response as WatchedResponse;
      body.on('data', wait);
      for (const event of ['end', 'aborted', 'error', 'close']) body.on(event, finish);
    });
    for (const event of ['abort', 'error']) request.on(event, finish);
  };

  return {
    abortAll(reason) {
      // Giving up takes a request out of the set, so the loop goes over a copy.
      for (const giveUp of [...underWay]) giveUp(reason);
    },
  };
}
