import { LOCAL_IMAGE_SCHEME } from './local-image-url';

export interface CspOptions {
  /** Relaxes only what the Vite dev server needs (inline preamble, websocket). */
  development: boolean;
}

/**
 * The Content Security Policy for the renderer page.
 *
 * Markdown is untrusted, so the page is locked down to its own bundle: no
 * inline script, no eval, no network connections, no plugins, frames or forms.
 * Images are the one exception, because documents reference them: the app
 * bundle, `data:` URIs, `https:` (not plain http) and local document images
 * served through the dedicated mdreader-local scheme.
 */
export function buildContentSecurityPolicy({ development }: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': development ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'style-src': development ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'img-src': ["'self'", 'data:', 'https:', `${LOCAL_IMAGE_SCHEME}:`],
    'font-src': ["'self'"],
    'connect-src': development ? ["'self'", 'ws://localhost:*', 'http://localhost:*'] : ["'none'"],
    'object-src': ["'none'"],
    'media-src': ["'none'"],
    'frame-src': ["'none'"],
    'worker-src': ["'none'"],
    'manifest-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}
