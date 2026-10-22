/**
 * Local images are served to the renderer through a dedicated scheme so the
 * Content Security Policy can allow them without opening up file: URLs.
 * The original file: URL travels in the `u` query parameter.
 */
export const LOCAL_IMAGE_SCHEME = 'mdreader-local';

const LOCAL_IMAGE_HOST = 'image';

export function buildLocalImageUrl(fileUrl: string): string {
  return `${LOCAL_IMAGE_SCHEME}://${LOCAL_IMAGE_HOST}/?u=${encodeURIComponent(fileUrl)}`;
}

/** The embedded file: URL, or null when the URL is not a well-formed local image request. */
export function parseLocalImageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${LOCAL_IMAGE_SCHEME}:` || parsed.hostname !== LOCAL_IMAGE_HOST) {
    return null;
  }

  const target = parsed.searchParams.get('u');
  if (!target) return null;
  try {
    return new URL(target).protocol === 'file:' ? target : null;
  } catch {
    return null;
  }
}
