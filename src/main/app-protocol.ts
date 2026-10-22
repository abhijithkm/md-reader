import path from 'node:path';
import { errorCode } from './errors';

export const APP_SCHEME = 'app';
export const APP_HOST = 'md-reader';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export interface AppAssetDeps {
  /** Folder that holds the built renderer (index.html and assets/). */
  rootDir: string;
  readFile(filePath: string): Promise<Uint8Array>;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/**
 * Serves the bundled renderer from `app://md-reader/`. Using a custom scheme
 * instead of file:// gives the page a real origin for the Content Security
 * Policy and means the page never has file-system privileges of its own.
 * Requests can only reach files inside `rootDir`.
 */
export async function handleAppRequest(request: Request, deps: AppAssetDeps): Promise<Response> {
  if (request.method !== 'GET') return plain(405, 'Method not allowed');

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return plain(400, 'Bad request');
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== APP_HOST) {
    return plain(404, 'Not found');
  }

  let requested: string;
  try {
    requested = decodeURIComponent(url.pathname);
  } catch {
    return plain(400, 'Bad request');
  }
  if (requested.includes('\0')) return plain(400, 'Bad request');
  if (requested.endsWith('/')) requested += 'index.html';

  const root = path.resolve(deps.rootDir);
  const target = path.resolve(root, `.${requested}`);
  if (!isInside(root, target)) return plain(403, 'Forbidden');

  try {
    const data = await deps.readFile(target);
    return new Response(Buffer.from(data), {
      status: 200,
      headers: {
        'Content-Type':
          MIME_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    const code = errorCode(error);
    const missing = code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
    return plain(missing ? 404 : 500, missing ? 'Not found' : 'Internal error');
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}
