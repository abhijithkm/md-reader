import { lstat, readFile, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMarkdownFileName } from '../shared/markdown-files';
import type { DocumentOutcome, OpenError, OpenErrorCode } from '../shared/types';
import { errorCode } from './errors';
import { resolveSymlinksSafely, type SymlinkFileSystem } from './symlink-policy';
import { decodeText } from './text-decoding';

/**
 * Larger files are refused. Rendering cost grows with the number of blocks, and
 * every block becomes DOM nodes in memory, so an unbounded file could exhaust it.
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const MAX_PATH_LENGTH = 32_767;

export interface DocumentFileSystem extends SymlinkFileSystem {
  stat(filePath: string): Promise<{ isFile(): boolean; size: number; mtimeMs: number }>;
  readFile(filePath: string): Promise<Uint8Array>;
}

export interface DocumentServiceOptions {
  fs?: DocumentFileSystem;
  maxBytes?: number;
}

export interface OpenOptions {
  /**
   * The path came from a link inside another document, which is untrusted. Besides the checks on
   * the path itself, the file must really be where it appears to be: a symbolic link or junction
   * that leads to a network share, a device or a file that is not Markdown is refused.
   * `currentDocumentPath` is the document the link is in.
   */
  fromLink?: { currentDocumentPath: string | undefined };
}

export interface DocumentService {
  open(input: unknown, options?: OpenOptions): Promise<DocumentOutcome>;
}

const nodeFileSystem: DocumentFileSystem = {
  stat: (filePath) => stat(filePath),
  readFile: (filePath) => readFile(filePath),
  lstat: (filePath) => lstat(filePath),
  readlink: (filePath) => readlink(filePath),
};

/**
 * Reads Markdown files from disk. Every problem a user can run into (missing
 * file, wrong type, permissions, size) comes back as a `failed` outcome with a
 * message fit to show on screen; nothing is thrown.
 */
export function createDocumentService(options: DocumentServiceOptions = {}): DocumentService {
  const fs = options.fs ?? nodeFileSystem;
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  return { open: (input, options = {}) => openDocument(input, fs, maxBytes, options) };
}

async function openDocument(
  input: unknown,
  fs: DocumentFileSystem,
  maxBytes: number,
  options: OpenOptions,
): Promise<DocumentOutcome> {
  if (
    typeof input !== 'string' ||
    input === '' ||
    input.length > MAX_PATH_LENGTH ||
    input.includes('\0') ||
    !path.isAbsolute(input)
  ) {
    return failed('invalid-path', 'That is not a usable file path.');
  }

  const filePath = path.normalize(input);
  const name = path.basename(filePath);
  if (!isMarkdownFileName(name)) {
    return failed(
      'unsupported-type',
      `"${name}" is not a Markdown file. MD Reader opens .md and .markdown files.`,
      filePath,
    );
  }

  // Where the bytes are read from. It differs from `filePath` only when a link in another
  // document names a symbolic link; the document is still shown under the name it was linked as.
  let location = filePath;
  if (options.fromLink !== undefined) {
    const real = await resolveSymlinksSafely(fs, filePath, options.fromLink.currentDocumentPath);
    if (!real.ok) {
      return failed(
        'blocked-link',
        'MD Reader does not follow links to network locations or special Windows paths.',
        filePath,
      );
    }
    if (!isMarkdownFileName(real.path)) {
      return failed(
        'unsupported-type',
        `"${name}" is a link to something that is not a Markdown file.`,
        filePath,
      );
    }
    location = real.path;
  }

  let stats;
  try {
    stats = await fs.stat(location);
  } catch (error) {
    return failedFromFileSystem(error, name, filePath);
  }
  if (!stats.isFile()) {
    return failed('not-a-file', `"${name}" is a folder, not a file.`, filePath);
  }
  if (stats.size > maxBytes) return tooLarge(name, stats.size, maxBytes, filePath);

  let buffer: Uint8Array;
  try {
    buffer = await fs.readFile(location);
  } catch (error) {
    return failedFromFileSystem(error, name, filePath);
  }
  // The file may have grown between the size check and the read.
  if (buffer.byteLength > maxBytes) return tooLarge(name, buffer.byteLength, maxBytes, filePath);

  const directory = path.dirname(filePath);
  const decoded = decodeText(buffer);
  return {
    status: 'opened',
    document: {
      path: filePath,
      name,
      directory,
      baseUrl: directoryUrl(directory),
      content: decoded.text,
      sizeBytes: buffer.byteLength,
      modifiedMs: stats.mtimeMs,
      encoding: decoded.encoding,
    },
  };
}

function directoryUrl(directory: string): string {
  const withSeparator = directory.endsWith(path.sep) ? directory : directory + path.sep;
  return pathToFileURL(withSeparator).href;
}

function failed(code: OpenErrorCode, message: string, filePath?: string): DocumentOutcome {
  const error: OpenError =
    filePath === undefined ? { code, message } : { code, message, path: filePath };
  return { status: 'failed', error };
}

function failedFromFileSystem(error: unknown, name: string, filePath: string): DocumentOutcome {
  const code = errorCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return failed(
      'not-found',
      `"${name}" could not be found. It may have been moved, renamed or deleted.`,
      filePath,
    );
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return failed('unreadable', `MD Reader does not have permission to read "${name}".`, filePath);
  }
  if (code === 'EBUSY') {
    return failed(
      'unreadable',
      `"${name}" is in use by another program and cannot be read right now.`,
      filePath,
    );
  }
  return failed(
    'unreadable',
    `"${name}" could not be read${code === undefined ? '' : ` (${code})`}.`,
    filePath,
  );
}

function tooLarge(name: string, size: number, maxBytes: number, filePath: string): DocumentOutcome {
  return failed(
    'too-large',
    `"${name}" is ${formatSize(size)}, which is more than the ${formatSize(maxBytes)} MD Reader can open.`,
    filePath,
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
