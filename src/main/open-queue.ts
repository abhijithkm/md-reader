import { MAX_TABS } from '../shared/tabs';

/**
 * Holds the "please open this" requests until the renderer can receive them. Opening a file can be
 * requested before the window has finished loading (command line, file association launch, several
 * files chosen in Explorer at once), so requests must not be dropped and must not be sent to a page
 * that is not listening yet.
 *
 * Every request is kept, in the order it came, because each file opens in a tab of its own. Only a
 * limit stops a flood of them from growing without end: beyond it the oldest are let go.
 */
export class OpenRequestQueue<T> {
  private readonly deliver: (value: T) => void;
  private readonly limit: number;
  private pending: T[] = [];
  private ready = false;

  constructor(deliver: (value: T) => void, limit: number = MAX_TABS) {
    this.deliver = deliver;
    this.limit = limit;
  }

  request(value: T): void {
    if (this.ready) {
      this.deliver(value);
      return;
    }
    this.pending.push(value);
    if (this.pending.length > this.limit) this.pending.shift();
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    if (!ready) return;

    const waiting = this.pending;
    this.pending = [];
    for (const value of waiting) this.deliver(value);
  }
}
