export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface MarkdownDocument {
  /** Absolute path of the file on disk. */
  path: string;
  /** File name including its extension. */
  name: string;
  /** Absolute path of the directory that contains the file. */
  directory: string;
  /** file: URL of that directory, always ending in "/"; the base for relative links and images. */
  baseUrl: string;
  /** Decoded document text. */
  content: string;
  sizeBytes: number;
  /** Last modification time, milliseconds since the Unix epoch. */
  modifiedMs: number;
  encoding: TextEncodingName;
}

export type OpenErrorCode =
  | 'invalid-path'
  | 'unsupported-type'
  | 'not-found'
  | 'not-a-file'
  | 'too-large'
  | 'unreadable'
  | 'blocked-link'
  | 'too-many-tabs';

export interface OpenError {
  code: OpenErrorCode;
  /** Plain-language explanation that is safe to show to the user. */
  message: string;
  path?: string;
}

/** What reading a file gives: the document, or why it cannot be shown. It knows nothing of tabs. */
export type DocumentOutcome =
  { status: 'opened'; document: MarkdownDocument } | { status: 'failed'; error: OpenError };

/** What the page is told about a request to open a document. */
export type OpenOutcome =
  | {
      status: 'opened';
      document: MarkdownDocument;
      /** The tab that shows the document: a new one, or the one that already showed it. */
      tabId: string;
      /** Heading to scroll to when the document was opened through a link such as `guide.md#install`. */
      anchor?: string;
    }
  | { status: 'failed'; error: OpenError }
  | { status: 'canceled' };

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  /**
   * True when this copy installs the updates it downloads. False for the portable executable,
   * which cannot replace itself and only reports that a newer version exists.
   */
  installsUpdates: boolean;
}
