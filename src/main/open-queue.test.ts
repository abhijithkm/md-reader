import { describe, expect, it, vi } from 'vitest';
import { OpenRequestQueue } from './open-queue';

describe('OpenRequestQueue', () => {
  it('holds a request until the renderer is ready', () => {
    const deliver = vi.fn<(path: string) => void>();
    const queue = new OpenRequestQueue(deliver);

    queue.request('C:\\a.md');
    expect(deliver).not.toHaveBeenCalled();

    queue.setReady(true);
    expect(deliver).toHaveBeenCalledExactlyOnceWith('C:\\a.md');
  });

  // Each file opens in a tab of its own, so a file asked for early is not made obsolete by the next.
  it('keeps every request received before the renderer is ready, in the order it came', () => {
    const deliver = vi.fn<(path: string) => void>();
    const queue = new OpenRequestQueue(deliver);

    queue.request('C:\\first.md');
    queue.request('C:\\second.md');
    queue.setReady(true);

    expect(deliver.mock.calls).toEqual([['C:\\first.md'], ['C:\\second.md']]);
  });

  it('keeps no more than a limit of them, and lets the oldest go first', () => {
    const deliver = vi.fn<(path: string) => void>();
    const queue = new OpenRequestQueue(deliver, 2);

    queue.request('C:\\1.md');
    queue.request('C:\\2.md');
    queue.request('C:\\3.md');
    queue.setReady(true);

    expect(deliver.mock.calls).toEqual([['C:\\2.md'], ['C:\\3.md']]);
  });

  it('delivers immediately once the renderer is ready', () => {
    const deliver = vi.fn<(path: string) => void>();
    const queue = new OpenRequestQueue(deliver);
    queue.setReady(true);

    queue.request('C:\\a.md');
    queue.request('C:\\b.md');

    expect(deliver.mock.calls).toEqual([['C:\\a.md'], ['C:\\b.md']]);
  });

  it('queues again when the renderer goes away and flushes when it returns', () => {
    const deliver = vi.fn<(path: string) => void>();
    const queue = new OpenRequestQueue(deliver);
    queue.setReady(true);
    queue.setReady(false);

    queue.request('C:\\a.md');
    expect(deliver).not.toHaveBeenCalled();

    queue.setReady(true);
    expect(deliver).toHaveBeenCalledExactlyOnceWith('C:\\a.md');
  });

  it('keeps a request that is waiting when it is told again that the renderer is not ready', () => {
    const deliver = vi.fn<(path: string) => void>();
    const queue = new OpenRequestQueue(deliver);
    queue.request('C:\\a.md');

    queue.setReady(false);
    expect(deliver).not.toHaveBeenCalled();

    queue.setReady(true);
    expect(deliver).toHaveBeenCalledExactlyOnceWith('C:\\a.md');
  });

  it('never delivers the same request twice', () => {
    const deliver = vi.fn<(path: string) => void>();
    const queue = new OpenRequestQueue(deliver);

    queue.request('C:\\a.md');
    queue.setReady(true);
    queue.setReady(false);
    queue.setReady(true);

    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the renderer is ready and nothing is waiting', () => {
    const deliver = vi.fn<(path: string) => void>();
    new OpenRequestQueue(deliver).setReady(true);
    expect(deliver).not.toHaveBeenCalled();
  });
});
