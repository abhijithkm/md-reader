const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);
const MAX_URL_LENGTH = 8192;

/**
 * Returns a canonical URL that is safe to hand to the operating system, or
 * null. Markdown is untrusted, so only web and mail links are ever opened
 * outside the app: no javascript:, file:, custom protocol handlers, or
 * addresses with embedded credentials.
 */
export function toSafeExternalUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > MAX_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;

  if (url.protocol === 'mailto:') {
    if (url.pathname === '') return null;
    // The address part of a mailto: link is kept exactly as typed (the URL parser encodes quotes
    // and spaces only after the "?"). A raw quote, space, pipe or similar character in it could
    // reach the mail program's command line unchanged and break out of its quoted argument.
    return /["\s<>\\^|`]/.test(url.href) ? null : url.href;
  }
  if (url.hostname === '' || url.username !== '' || url.password !== '') return null;
  return url.href;
}
