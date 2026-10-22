import { createRef, type RefObject } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MarkdownDocument } from '../../shared/types';
import { DocumentView, type DocumentViewProps } from './DocumentView';

function makeDocument(content: string): MarkdownDocument {
  return {
    path: 'C:\\docs\\notes.md',
    name: 'notes.md',
    directory: 'C:\\docs',
    baseUrl: 'file:///C:/docs/',
    content,
    sizeBytes: content.length,
    modifiedMs: 1,
    encoding: 'utf-8',
  };
}

function renderView(content: string, overrides: Partial<DocumentViewProps> = {}) {
  const scrollRef: RefObject<HTMLElement | null> = createRef<HTMLElement>();
  const props: DocumentViewProps = {
    document: makeDocument(content),
    zoom: 1,
    scrollRequest: { token: 1, top: 0 },
    scrollRef,
    actions: { openExternal: vi.fn(), openLocal: vi.fn() },
    onStats: vi.fn(),
    onZoomStep: vi.fn<DocumentViewProps['onZoomStep']>(),
    ...overrides,
  };
  const view = render(<DocumentView {...props} />);
  return { ...view, props, scrollRef };
}

describe('DocumentView', () => {
  it('renders the Markdown as a document the reader can scroll with the keyboard', () => {
    renderView('# Title\n\nSome *text*.');

    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'notes.md' });
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('scales the document with the zoom level', () => {
    const { container } = renderView('# Title', { zoom: 1.5 });
    // The stylesheet applies `zoom: var(--doc-zoom)`; jsdom has no layout engine to check that.
    expect(container.querySelector('article')?.style.getPropertyValue('--doc-zoom')).toBe('1.5');
  });

  it('reports the word and line counts once the text is on screen', async () => {
    const { props } = renderView('# Title\n\nOne two three four.\n');

    await vi.waitFor(() => {
      expect(props.onStats).toHaveBeenCalledWith({ words: 5, readingMinutes: 1, lines: 3 });
    });
  });

  it('puts the reader at the requested scroll position', () => {
    const { scrollRef } = renderView('# Title', { scrollRequest: { token: 2, top: 240 } });
    expect(scrollRef.current?.scrollTop).toBe(240);
  });

  it('scrolls to the requested section', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderView('# Top\n\n## Install\n\ntext', { scrollRequest: { token: 3, anchor: 'install' } });

    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll.mock.contexts[0]).toBe(screen.getByRole('heading', { name: 'Install' }));
  });

  it('moves back to the top for a new document', () => {
    const { scrollRef, rerender, props } = renderView('# One', {
      scrollRequest: { token: 1, top: 500 },
    });
    expect(scrollRef.current?.scrollTop).toBe(500);

    rerender(
      <DocumentView
        {...props}
        document={makeDocument('# Two')}
        scrollRequest={{ token: 2, top: 0 }}
      />,
    );

    expect(scrollRef.current?.scrollTop).toBe(0);
  });

  describe('Ctrl + mouse wheel zoom', () => {
    it('zooms in when the wheel turns away and out when it turns toward the reader', () => {
      const { props } = renderView('# Title');
      const region = screen.getByRole('region', { name: 'notes.md' });

      fireEvent.wheel(region, { ctrlKey: true, deltaY: -100 });
      fireEvent.wheel(region, { ctrlKey: true, deltaY: 100 });

      expect(vi.mocked(props.onZoomStep).mock.calls).toEqual([['in'], ['out']]);
    });

    it('keeps the browser from also zooming the page', () => {
      renderView('# Title');
      const region = screen.getByRole('region', { name: 'notes.md' });

      expect(fireEvent.wheel(region, { ctrlKey: true, deltaY: -100 })).toBe(false);
    });

    it('scrolls normally without Ctrl', () => {
      const { props } = renderView('# Title');
      const region = screen.getByRole('region', { name: 'notes.md' });

      expect(fireEvent.wheel(region, { deltaY: 100 })).toBe(true);
      expect(props.onZoomStep).not.toHaveBeenCalled();
    });
  });

  describe('a large document that is shown piece by piece', () => {
    const big = Array.from(
      { length: 1000 },
      (_unused, n) =>
        `## Section ${n}\n\nParagraph ${n} with *emphasis* and [a link](#section-${n}).\n\n- item a\n- item b\n\n`,
    ).join('');

    it('waits for the whole document before restoring a scroll position', async () => {
      const { scrollRef } = renderView(big, { scrollRequest: { token: 2, top: 400 } });
      expect(scrollRef.current?.scrollTop).toBe(0);

      await vi.waitFor(
        () => {
          expect(scrollRef.current?.scrollTop).toBe(400);
        },
        { timeout: 30_000 },
      );
      expect(screen.getByRole('heading', { name: 'Section 999' })).toBeInTheDocument();
    }, 60_000);

    it('does not pull back a reader who has already started scrolling', async () => {
      const { scrollRef } = renderView(big, { scrollRequest: { token: 2, top: 400 } });
      const region = screen.getByRole('region', { name: 'notes.md' });

      fireEvent.wheel(region, { deltaY: 120 });
      if (scrollRef.current !== null) scrollRef.current.scrollTop = 120;
      await screen.findByRole('heading', { name: 'Section 999' }, { timeout: 30_000 });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(scrollRef.current?.scrollTop).toBe(120);
    }, 60_000);

    it('counts the words only once the whole document is on screen', async () => {
      const { props } = renderView(big);
      expect(props.onStats).not.toHaveBeenCalled();

      await vi.waitFor(
        () => {
          expect(props.onStats).toHaveBeenCalled();
        },
        { timeout: 30_000 },
      );
      expect(screen.getByRole('heading', { name: 'Section 999' })).toBeInTheDocument();
    }, 60_000);
  });
});
