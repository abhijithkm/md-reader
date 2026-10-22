/**
 * IPC messages must come from the app's own page. Compares the origin of the
 * sending frame with the allowed list (scheme + host + port, case-insensitive).
 * Credentials in the URL, other schemes and unparsable values are rejected.
 */
export function isTrustedSender(frameUrl: unknown, trustedOrigins: readonly string[]): boolean {
  if (typeof frameUrl !== 'string' || frameUrl === '') return false;

  let url: URL;
  try {
    url = new URL(frameUrl);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;

  const origin = `${url.protocol}//${url.host}`.toLowerCase();
  return trustedOrigins.some((trusted) => trusted.toLowerCase() === origin);
}
