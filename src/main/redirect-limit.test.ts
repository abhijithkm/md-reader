import { describe, expect, it, vi } from 'vitest';
import { addRedirectLimit, MAX_REDIRECTS, type RedirectExecutor } from './redirect-limit';

/**
 * A stand-in for the library. It follows a redirect by asking its handler for a new request and then
 * watching that one for redirects too, as `doApiRequest` and `doDownload` do.
 */
function setup(limit?: number) {
  const requests: object[] = [];
  const handlers: ((next: object) => void)[] = [];
  const library = vi.fn<RedirectExecutor['addRedirectHandlers']>(
    (_request, options, _reject, _count, handler) => {
      requests.push(options);
      handlers.push(handler);
    },
  );
  const executor: RedirectExecutor = { addRedirectHandlers: library };
  addRedirectLimit(executor, limit);

  /** A first request, and whatever it is redirected to, all of them settling the same promise. */
  function begin(first: object = { hop: 0 }) {
    const reject = vi.fn<(error: Error) => void>();
    const watch = (options: object): void => {
      executor.addRedirectHandlers({}, options, reject, 0, watch);
    };
    watch(first);
    return reject;
  }
  /** The latest request is told to go somewhere else. */
  const redirect = (next: object): void => {
    handlers.at(-1)?.(next);
  };
  return { library, requests, begin, redirect };
}

describe('addRedirectLimit', () => {
  // The library says it stops after ten redirects, but hands the same count to every hop, so a
  // server that always answers with another redirect keeps it busy until the app is closed.
  it('lets a request be redirected ten times, and refuses the eleventh', () => {
    const { requests, begin, redirect } = setup();
    const reject = begin();

    for (let hop = 1; hop <= MAX_REDIRECTS; hop += 1) redirect({ hop });
    expect(requests).toHaveLength(MAX_REDIRECTS + 1);
    expect(reject).not.toHaveBeenCalled();

    redirect({ hop: MAX_REDIRECTS + 1 });
    expect(requests).toHaveLength(MAX_REDIRECTS + 1);
    expect(reject).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: expect.stringMatching(/more than 10 redirects/i) as unknown,
      }),
    );
  });

  it('counts the redirects of each request on its own', () => {
    const { requests, begin, redirect } = setup(2);
    const first = begin({ name: 'first' });
    redirect({ name: 'first, once' });
    const second = begin({ name: 'second' });
    redirect({ name: 'second, once' });
    redirect({ name: 'second, twice' });

    expect(requests.map((options) => (options as { name: string }).name)).toEqual([
      'first',
      'first, once',
      'second',
      'second, once',
      'second, twice',
    ]);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('refuses at the limit it was given', () => {
    const { requests, begin, redirect } = setup(1);
    const reject = begin();

    redirect({ hop: 1 });
    redirect({ hop: 2 });

    expect(requests).toHaveLength(2);
    expect(reject).toHaveBeenCalledOnce();
  });

  it('still gives the library its own handlers, with what it asked for', () => {
    const { library, begin } = setup();

    begin();

    expect(library).toHaveBeenCalledOnce();
    expect(library.mock.calls[0]?.[3]).toBe(0);
  });
});
