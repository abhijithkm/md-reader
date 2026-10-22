/**
 * Finds the element an in-page link such as `#install` points at.
 *
 * Heading ids are added after sanitizing and are used as they are. Anchors
 * written by the author (`<a name="install">`, `<h2 id="install">`) have been
 * prefixed with "user-content-" by the sanitizer, so both spellings are tried.
 */
export function findAnchorTarget(root: ParentNode, id: string): Element | null {
  const wanted = [id, `user-content-${id}`];
  for (const attribute of ['id', 'name']) {
    for (const element of root.querySelectorAll(`[${attribute}]`)) {
      if (wanted.includes(element.getAttribute(attribute) ?? '')) return element;
    }
  }
  return null;
}
