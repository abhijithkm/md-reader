import GithubSlugger from 'github-slugger';
import type { Element, Root } from 'hast';
import { toString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';

const HEADINGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * Gives headings GitHub-style ids (`install`, then `install-1`, `install-2` for
 * repeats) across the pieces of a long document, so the ids are exactly what a
 * single pass over the whole text would produce.
 *
 * Each piece starts from a snapshot of the counts left by the one before it.
 * Rendering a piece twice (React may do so) therefore gives the same ids.
 */
export class SlugSequence {
  /** `snapshots[n]` holds the counts at the start of piece `n`. */
  private readonly snapshots: (Record<string, number> | undefined)[] = [{}];

  /** The rehype plugin for piece `index`. Pieces are rendered in order. */
  pluginFor(index: number): () => (tree: Root) => void {
    return () => (tree) => {
      const slugger = new GithubSlugger();
      slugger.occurrences = { ...this.snapshots[index] };

      visit(tree, 'element', (node: Element) => {
        // Headings that already carry an id (written by the author) keep it.
        if (!HEADINGS.has(node.tagName) || node.properties.id) return;
        node.properties.id = slugger.slug(toString(node));
      });

      this.snapshots[index + 1] = { ...slugger.occurrences };
    };
  }
}
