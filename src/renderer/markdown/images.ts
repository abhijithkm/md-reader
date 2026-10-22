import { buildLocalImageUrl } from '../../shared/local-image-url';

export type ImageSource =
  /** A file next to the document (or elsewhere on disk), served by the main process. */
  | { kind: 'local'; url: string }
  /** An https image, loaded directly. */
  | { kind: 'remote'; url: string }
  /** A small inline image. */
  | { kind: 'data'; url: string }
  | { kind: 'blocked' };

// Only inline images are accepted: a data: URL for anything else is refused.
const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i;

/**
 * Decides where an image may be loaded from. Relative paths resolve against
 * the document's folder, not the app's install folder. Plain http is refused
 * because it can be read and altered in transit.
 */
export function resolveImageSource(src: string | undefined, baseUrl: string): ImageSource {
  const value = src?.trim() ?? '';
  if (value === '') return { kind: 'blocked' };

  if (/^data:/i.test(value)) {
    return INLINE_IMAGE.test(value) ? { kind: 'data', url: value } : { kind: 'blocked' };
  }

  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    return { kind: 'blocked' };
  }

  switch (url.protocol) {
    case 'https:':
      return { kind: 'remote', url: url.href };
    case 'file:':
      return { kind: 'local', url: buildLocalImageUrl(url.href) };
    default:
      return { kind: 'blocked' };
  }
}
