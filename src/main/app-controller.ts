import path from 'node:path';
import type { OpenError, OpenErrorCode, OpenOutcome } from '../shared/types';
import { findLaunchFile } from './cli';
import type { DocumentService, OpenOptions } from './documents';
import { resolveLocalMarkdownLink } from './link-resolution';
import { OpenRequestQueue } from './open-queue';

export interface WindowPort {
  /** Sends the result of an open request to the page. */
  sendOutcome(outcome: OpenOutcome): void;
  /** Restores the window if it is minimized and brings it to the front. */
  reveal(): void;
}

export interface AppControllerDeps {
  documents: DocumentService;
  getWindow(): WindowPort | undefined;
  /** Shows the native open dialog; resolves to the chosen path or undefined if cancelled. */
  showOpenDialog(): Promise<string | undefined>;
  isPackaged: boolean;
}

export interface LaunchOptions {
  /** Bring the window to the front (a second launch while the app is running). */
  reveal?: boolean;
}

/** How many documents the window remembers having shown, for going back to them. */
const MAX_REMEMBERED_DOCUMENTS = 200;

/**
 * Decides which document the single window shows. It owns the rules that make
 * file opening dependable on Windows:
 *
 * - a file named at launch, by a second launch, or by the operating system is
 *   queued until the page is listening, then pushed to it;
 * - when requests overlap, only the newest one is shown;
 * - the path of the document on screen is tracked so links and local images
 *   can be resolved safely relative to it;
 * - the paths of the documents shown so far are remembered, so that going back
 *   can be limited to them.
 *
 * It has no Electron dependency; the window and the dialog are passed in.
 */
export class AppController {
  private readonly deps: AppControllerDeps;
  private readonly queue: OpenRequestQueue<string>;
  private currentPath: string | undefined;
  private readonly shown = new Set<string>();
  private latestRequestId = 0;

  constructor(deps: AppControllerDeps) {
    this.deps = deps;
    this.queue = new OpenRequestQueue((filePath) => {
      void this.deliver(filePath);
    });
  }

  /** Handles the process arguments of the first launch or of a second instance. */
  handleLaunch(argv: readonly string[], cwd: string, options: LaunchOptions = {}): void {
    if (options.reveal === true) this.deps.getWindow()?.reveal();

    const filePath = findLaunchFile(argv, { cwd, isPackaged: this.deps.isPackaged });
    if (filePath !== undefined) this.queue.request(filePath);
  }

  /** Handles a path handed over by the operating system (for example macOS "open-file"). */
  handleOpenRequest(filePath: string, options: LaunchOptions = {}): void {
    if (options.reveal === true) this.deps.getWindow()?.reveal();
    this.queue.request(filePath);
  }

  /** The page has subscribed to document events and can receive queued requests. */
  rendererReady(): void {
    this.queue.setReady(true);
  }

  /** The page is gone or reloading; hold requests until it reports ready again. */
  rendererGone(): void {
    this.queue.setReady(false);
  }

  async openFromDialog(): Promise<OpenOutcome> {
    const chosen = await this.deps.showOpenDialog();
    if (chosen === undefined) return { status: 'canceled' };
    return this.openPath(chosen);
  }

  async openPath(input: unknown, options?: OpenOptions): Promise<OpenOutcome> {
    this.nextRequestId();
    const outcome = await this.open(input, options);
    this.track(outcome);
    return outcome;
  }

  /**
   * Shows a document this window has already shown, for Back. The page names it by path, but the
   * page is not trusted (a hostile document may have taken it over), so only paths the main
   * process itself opened are accepted. Otherwise this would let the page read any Markdown file.
   */
  reopen(input: unknown): Promise<OpenOutcome> {
    if (typeof input !== 'string' || !this.shown.has(path.normalize(input))) {
      return Promise.resolve(
        failure('not-found', 'That document is no longer available to go back to.'),
      );
    }
    return this.openPath(input);
  }

  async openLink(href: unknown): Promise<OpenOutcome> {
    const resolved = resolveLocalMarkdownLink(href, this.currentPath);
    if (!resolved.ok) {
      switch (resolved.reason) {
        case 'unsupported-type':
          return failure(
            'unsupported-type',
            'MD Reader only opens .md and .markdown files from links.',
          );
        case 'blocked':
          return failure(
            'blocked-link',
            'MD Reader does not follow links to network locations or special Windows paths.',
          );
        case 'invalid-url':
          return failure('blocked-link', 'That link cannot be opened by MD Reader.');
      }
    }

    // The file was named by another document, so it is checked more closely than one the user chose.
    const outcome = await this.openPath(resolved.path, {
      fromLink: { currentDocumentPath: this.currentPath },
    });
    if (outcome.status === 'opened' && resolved.anchor !== undefined) {
      return { ...outcome, anchor: resolved.anchor };
    }
    return outcome;
  }

  reload(): Promise<OpenOutcome> {
    if (this.currentPath === undefined) {
      return Promise.resolve(failure('not-found', 'There is no document to reload.'));
    }
    return this.openPath(this.currentPath);
  }

  getCurrentDocumentPath(): string | undefined {
    return this.currentPath;
  }

  private async deliver(filePath: string): Promise<void> {
    const requestId = this.nextRequestId();
    const outcome = await this.open(filePath);
    if (requestId !== this.latestRequestId) return; // a newer request replaced this one
    this.track(outcome);
    this.deps.getWindow()?.sendOutcome(outcome);
  }

  private async open(input: unknown, options?: OpenOptions): Promise<OpenOutcome> {
    try {
      return await this.deps.documents.open(input, options);
    } catch {
      return failure('unreadable', 'The file could not be opened.');
    }
  }

  /** Remembers the document that is now on screen; failed opens leave it unchanged. */
  private track(outcome: OpenOutcome): void {
    if (outcome.status !== 'opened') return;
    this.currentPath = outcome.document.path;
    this.remember(outcome.document.path);
  }

  private remember(filePath: string): void {
    // Moving a path to the end keeps the most recent ones when the limit is reached.
    this.shown.delete(filePath);
    this.shown.add(filePath);
    if (this.shown.size > MAX_REMEMBERED_DOCUMENTS) {
      const oldest = this.shown.values().next().value;
      if (oldest !== undefined) this.shown.delete(oldest);
    }
  }

  private nextRequestId(): number {
    this.latestRequestId += 1;
    return this.latestRequestId;
  }
}

function failure(code: OpenErrorCode, message: string): OpenOutcome {
  const error: OpenError = { code, message };
  return { status: 'failed', error };
}
