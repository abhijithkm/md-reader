import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRequestTimeout,
  REQUEST_IDLE_TIMEOUT_MS,
  type RequestExecutor,
} from './request-timeout';

/** What Electron's `net.request` gives: events, and a way to give up. */
class FakeRequest extends EventEmitter {
  /** Counts the times the request itself was told to stop, whoever asked. */
  readonly stopped = vi.fn();

  abort(): void {
    this.stopped();
  }
}

/** The response of such a request: a stream of data. */
class FakeResponse extends EventEmitter {}

function setup(idleMs?: number) {
  const original = vi.fn<RequestExecutor['addErrorAndTimeoutHandlers']>();
  const executor: RequestExecutor = { addErrorAndTimeoutHandlers: original };
  const watch = addRequestTimeout(executor, idleMs);

  /** Hands a new request to the library, as it does for each one it makes. */
  function begin(timeout?: number, reject = vi.fn<(error: Error) => void>()) {
    const request = new FakeRequest();
    executor.addErrorAndTimeoutHandlers(request, reject, timeout);
    return { request, reject };
  }
  return { executor, original, begin, watch };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('addRequestTimeout', () => {
  it('still gives the library its own handlers, with what it asked for', () => {
    const { original, begin } = setup();

    const { request, reject } = begin(5_000);

    expect(original).toHaveBeenCalledExactlyOnceWith(request, reject, 5_000);
  });

  it('gives up on a request that gets no answer, which Electron would never do by itself', () => {
    const { begin } = setup();
    const { request, reject } = begin();

    vi.advanceTimersByTime(REQUEST_IDLE_TIMEOUT_MS - 1);
    expect(request.stopped).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(request.stopped).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: expect.stringMatching(/60 seconds/) as unknown }),
    );
  });

  // Electron says `finish` and then `close` as soon as a request has been sent. It is not done:
  // the response has not begun. Taking that for the end is how a first version never timed out.
  it('keeps watching after the request has been sent, which Electron announces at once', () => {
    const { begin } = setup(10_000);
    const { request, reject } = begin();

    request.emit('finish');
    request.emit('close');
    vi.advanceTimersByTime(10_000);

    expect(request.stopped).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledOnce();
  });

  it('counts the time without data, not the time a download takes', () => {
    const { begin } = setup(10_000);
    const { request, reject } = begin();
    const response = new FakeResponse();
    request.emit('response', response);

    // Five minutes of a download that never stalls for as long as the limit.
    for (let second = 0; second < 300; second += 5) {
      vi.advanceTimersByTime(5_000);
      response.emit('data', Buffer.from('x'));
    }
    expect(request.stopped).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(request.stopped).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledOnce();
  });

  it('starts counting again when the response begins', () => {
    const { begin } = setup(10_000);
    const { request } = begin();

    vi.advanceTimersByTime(9_000);
    request.emit('response', new FakeResponse());
    vi.advanceTimersByTime(9_000);

    expect(request.stopped).not.toHaveBeenCalled();
  });

  it.each([
    ['the response ends', (_request: FakeRequest, response: FakeResponse) => response.emit('end')],
    [
      'the response is cut off',
      (_request: FakeRequest, response: FakeResponse) => response.emit('aborted'),
    ],
    [
      'the response fails',
      (_request: FakeRequest, response: FakeResponse) => response.emit('error', new Error('x')),
    ],
    [
      'the response closes',
      (_request: FakeRequest, response: FakeResponse) => response.emit('close'),
    ],
    ['the request fails', (request: FakeRequest) => request.emit('error', new Error('x'))],
    ['the request reports that it was aborted', (request: FakeRequest) => request.emit('abort')],
  ])('stops watching when %s', (_label, finish) => {
    const { begin } = setup(10_000);
    const { request, reject } = begin();
    const response = new FakeResponse();
    request.emit('response', response);

    finish(request, response);
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(request.stopped).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  // The library follows a redirect by aborting the request and making a new one that settles the
  // same promise. Electron's documentation says it does not report `abort` once a request has
  // closed, so the library's own call to abort() is what ends the watch: a download that goes on
  // for longer than the limit must not be failed by the timer of the request it left behind.
  it('stops watching a request that the library aborts, as it does to follow a redirect', () => {
    const { begin } = setup(10_000);
    const settled = vi.fn<(error: Error) => void>();
    const first = begin(undefined, settled);
    const second = begin(undefined, settled);

    first.request.abort();
    const response = new FakeResponse();
    second.request.emit('response', response);
    for (let seconds = 0; seconds < 120; seconds += 5) {
      vi.advanceTimersByTime(5_000);
      response.emit('data', Buffer.from('x'));
    }

    expect(first.request.stopped).toHaveBeenCalledOnce();
    expect(settled).not.toHaveBeenCalled();
  });

  it('watches each request on its own', () => {
    const { begin } = setup(10_000);
    const busy = begin();
    const silent = begin();
    const response = new FakeResponse();
    busy.request.emit('response', response);

    for (let second = 0; second < 30; second += 5) {
      vi.advanceTimersByTime(5_000);
      response.emit('data', Buffer.from('x'));
    }

    expect(silent.request.stopped).toHaveBeenCalledOnce();
    expect(busy.request.stopped).not.toHaveBeenCalled();
  });

  it('honours a limit the library asks for', () => {
    const { begin } = setup();
    const { request } = begin(2_000);

    vi.advanceTimersByTime(2_000);

    expect(request.stopped).toHaveBeenCalledOnce();
  });

  // The library's own way of cancelling a download rejects its promise and leaves the transfer
  // running, so stopping updating for good means stopping the requests themselves.
  describe('stopping everything', () => {
    it('gives up on every request that is still under way, and tells each why', () => {
      const { watch, begin } = setup();
      const first = begin();
      const second = begin();
      second.request.emit('response', new FakeResponse());

      watch.abortAll('Updating was turned off.');

      for (const { request, reject } of [first, second]) {
        expect(request.stopped).toHaveBeenCalledOnce();
        expect(reject).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ message: 'Updating was turned off.' }),
        );
      }
    });

    it('leaves alone a request that is over, or that the library gave up on itself', () => {
      const { watch, begin } = setup();
      const finished = begin();
      const response = new FakeResponse();
      finished.request.emit('response', response);
      response.emit('end');
      const aborted = begin();
      aborted.request.abort();
      aborted.request.stopped.mockClear();

      watch.abortAll('Updating was turned off.');

      expect(finished.request.stopped).not.toHaveBeenCalled();
      expect(finished.reject).not.toHaveBeenCalled();
      expect(aborted.request.stopped).not.toHaveBeenCalled();
      expect(aborted.reject).not.toHaveBeenCalled();
    });

    it('does nothing when no request is under way, and the requests stay quiet afterwards', () => {
      const { watch, begin } = setup(10_000);
      expect(() => {
        watch.abortAll('nothing to stop');
      }).not.toThrow();
      const { request, reject } = begin();
      watch.abortAll('stop');

      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(request.stopped).toHaveBeenCalledOnce();
      expect(reject).toHaveBeenCalledOnce();
    });
  });

  it('rejects only once, however many times the response comes and goes quiet', () => {
    const { begin } = setup(1_000);
    const { request, reject } = begin();

    vi.advanceTimersByTime(10_000);
    request.emit('response', new FakeResponse());
    vi.advanceTimersByTime(10_000);

    expect(reject).toHaveBeenCalledOnce();
  });
});
