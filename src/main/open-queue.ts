/**
 * Holds the latest "please open this" request until the renderer can receive
 * it. Opening a file can be requested before the window has finished loading
 * (command line, file association launch), so requests must not be dropped
 * and must not be sent to a page that is not listening yet.
 *
 * Only the most recent pending request is kept: the app shows one document at
 * a time, so an older unopened request has already been superseded.
 */
export class OpenRequestQueue<T> {
  private readonly deliver: (value: T) => void;
  private pending: { value: T } | undefined;
  private ready = false;

  constructor(deliver: (value: T) => void) {
    this.deliver = deliver;
  }

  request(value: T): void {
    if (this.ready) {
      this.deliver(value);
      return;
    }
    this.pending = { value };
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    if (!ready || this.pending === undefined) return;

    const { value } = this.pending;
    this.pending = undefined;
    this.deliver(value);
  }
}
