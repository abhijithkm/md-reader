import { fileURLToPath } from 'node:url';
import { isMarkdownFileName } from '../shared/markdown-files';
import { assessLocalPath } from './local-path-policy';

export type LocalLinkResult =
  | { ok: true; path: string; anchor?: string }
  | { ok: false; reason: 'invalid-url' | 'unsupported-type' | 'blocked' };

/**
 * Turns a clicked link (already resolved by the renderer into an absolute
 * file: URL) into a Markdown file path that the app may open. Only Markdown
 * documents are ever opened this way; links to anything else are refused so a
 * document cannot make the app launch or read arbitrary files.
 */
export function resolveLocalMarkdownLink(
  href: unknown,
  currentDocumentPath: string | undefined,
): LocalLinkResult {
  if (typeof href !== 'string') return { ok: false, reason: 'invalid-url' };

  let url: URL;
  let filePath: string;
  try {
    url = new URL(href);
    if (url.protocol !== 'file:') return { ok: false, reason: 'invalid-url' };
    filePath = fileURLToPath(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  const verdict = assessLocalPath(filePath, currentDocumentPath);
  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason === 'invalid' ? 'invalid-url' : 'blocked' };
  }
  if (!isMarkdownFileName(verdict.path)) return { ok: false, reason: 'unsupported-type' };

  const anchor = decodeAnchor(url.hash);
  return anchor === ''
    ? { ok: true, path: verdict.path }
    : { ok: true, path: verdict.path, anchor };
}

function decodeAnchor(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
