import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLocalImageUrl } from '../shared/local-image-url';
import { errorCode } from './errors';
import { assessLocalPath } from './local-path-policy';
import { resolveSymlinksSafely, type SymlinkFileSystem } from './symlink-policy';

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export interface LocalImageDeps {
  fs: SymlinkFileSystem & {
    stat(filePath: string): Promise<{ isFile(): boolean; size: number }>;
    readFile(filePath: string): Promise<Uint8Array>;
  };
  /** Path of the document being shown; decides whether a network share may be read. */
  getCurrentDocumentPath(): string | undefined;
  maxBytes?: number;
}

// Only these extensions are ever served. Anything else (documents, scripts,
// executables) is refused before the disk is touched.
const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

// An SVG opened as an image cannot run script, but if it were ever navigated
// to directly this policy keeps it inert.
const IMAGE_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Serves the local images referenced by a Markdown document (the mdreader-local
 * scheme). The renderer never gets general file access: it can only ask for an
 * image file, and the request is validated here in the main process.
 */
export async function handleLocalImageRequest(
  request: Request,
  deps: LocalImageDeps,
): Promise<Response> {
  if (request.method !== 'GET') return plain(405, 'Method not allowed');

  const fileUrl = parseLocalImageUrl(request.url);
  if (fileUrl === null) return plain(400, 'Bad request');

  let filePath: string;
  try {
    filePath = fileURLToPath(fileUrl);
  } catch {
    return plain(400, 'Bad request');
  }

  const verdict = assessLocalPath(filePath, deps.getCurrentDocumentPath());
  if (!verdict.ok) return plain(403, 'Forbidden');

  const mimeType = IMAGE_MIME_TYPES[path.extname(verdict.path).toLowerCase()];
  if (mimeType === undefined) return plain(415, 'Unsupported media type');

  const maxBytes = deps.maxBytes ?? MAX_IMAGE_BYTES;
  try {
    // The document calls the file `logo.png`, but it may be a symbolic link to somewhere else, such
    // as a network share. Find out where it really is without following the link, and apply the
    // same rules to that place.
    const real = await resolveSymlinksSafely(deps.fs, verdict.path, deps.getCurrentDocumentPath());
    if (!real.ok) return plain(403, 'Forbidden');
    const realType = IMAGE_MIME_TYPES[path.extname(real.path).toLowerCase()];
    if (realType === undefined) return plain(415, 'Unsupported media type');

    const stats = await deps.fs.stat(real.path);
    if (!stats.isFile()) return plain(404, 'Not found');
    if (stats.size > maxBytes) return plain(413, 'Image too large');

    const data = await deps.fs.readFile(real.path);
    if (data.byteLength > maxBytes) return plain(413, 'Image too large');

    return new Response(Buffer.from(data), {
      status: 200,
      headers: {
        'Content-Type': realType,
        'Content-Length': String(data.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': IMAGE_CONTENT_SECURITY_POLICY,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    return plain(statusForError(error), 'Image unavailable');
  }
}

function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

function statusForError(error: unknown): number {
  const code = errorCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') return 404;
  if (code === 'EACCES' || code === 'EPERM') return 403;
  return 500;
}
