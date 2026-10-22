import { describe, expect, it } from 'vitest';
import { findAnchorTarget } from './anchors';

function build(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('findAnchorTarget', () => {
  it('finds a heading by its id', () => {
    const root = build('<h2 id="install">Install</h2><h2 id="usage">Usage</h2>');
    expect(findAnchorTarget(root, 'usage')).toBe(root.querySelector('#usage'));
  });

  it('finds an anchor the author wrote, which the sanitizer prefixed', () => {
    const root = build('<a name="user-content-old"></a><p id="user-content-new">x</p>');
    expect(findAnchorTarget(root, 'old')).toBe(root.querySelector('a'));
    expect(findAnchorTarget(root, 'new')).toBe(root.querySelector('p'));
  });

  it('prefers an id over a name', () => {
    const root = build('<a name="topic"></a><h2 id="topic">Topic</h2>');
    expect(findAnchorTarget(root, 'topic')).toBe(root.querySelector('h2'));
  });

  it('returns null when nothing matches', () => {
    expect(findAnchorTarget(build('<h2 id="a">A</h2>'), 'b')).toBeNull();
  });
});
