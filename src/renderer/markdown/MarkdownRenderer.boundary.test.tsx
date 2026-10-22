import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Pipeline from './pipeline';

// A document piece containing this word is processed by a plugin that throws, the way an
// unforeseen input can make the Markdown parser throw.
vi.mock('./pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof Pipeline>();
  const explode = () => () => {
    throw new Error('the parser gave up');
  };
  return {
    ...actual,
    rehypePluginsFor: (...args: Parameters<typeof actual.rehypePluginsFor>) =>
      args[0].includes('EXPLODE') ? [explode] : actual.rehypePluginsFor(...args),
  };
});

const { MarkdownRenderer } = await import('./MarkdownRenderer');

const actions = { openExternal: vi.fn(), openLocal: vi.fn() };

beforeEach(() => {
  // React reports a caught render error on the console; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MarkdownRenderer: a piece that cannot be rendered', () => {
  it('is replaced by a message, and the rest of the document is shown', async () => {
    const source = '# Before\n\ntext\n\n# Broken\n\nEXPLODE\n\n# After\n\nfine\n';

    render(
      <MarkdownRenderer
        source={source}
        baseUrl="file:///C:/docs/"
        actions={actions}
        chunking={{ thresholdBytes: 10, targetBytes: 5 }}
      />,
    );

    // The piece that fails is the one holding the word; the pieces around it are untouched.
    expect(await screen.findByRole('heading', { name: 'After' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Before' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Broken' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be displayed/i);
    expect(screen.queryByText('EXPLODE')).toBeNull();
  });

  it('shows a short document that fails as a message instead of an empty window', () => {
    const { container } = render(
      <MarkdownRenderer source="EXPLODE" baseUrl="file:///C:/docs/" actions={actions} />,
    );

    expect(container.querySelector('.markdown-body')).not.toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
