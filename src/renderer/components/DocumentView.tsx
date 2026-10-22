import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { computeTextStats, countLines } from '../../shared/text-stats';
import type { MarkdownDocument } from '../../shared/types';
import { useWheelZoom } from '../hooks/useWheelZoom';
import type { ScrollRequest } from '../hooks/useDocument';
import { findAnchorTarget } from '../markdown/anchors';
import { MarkdownRenderer, type LinkActions } from '../markdown/MarkdownRenderer';

export interface DocumentStats {
  words: number;
  readingMinutes: number;
  lines: number;
}

export interface DocumentViewProps {
  document: MarkdownDocument;
  zoom: number;
  scrollRequest: ScrollRequest;
  /** The scrolling element; the app reads its position when following links or reloading. */
  scrollRef: RefObject<HTMLElement | null>;
  actions: LinkActions;
  onStats: (stats: DocumentStats) => void;
  onZoomStep: (direction: 'in' | 'out') => void;
}

/** Visible text of the rendered document, with a space between text runs so words never fuse. */
function extractText(root: HTMLElement): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    parts.push(node.nodeValue ?? '');
  }
  return parts.join(' ');
}

/** Moves the scroll position without the animation the stylesheet uses for in-page jumps. */
function jumpTo(scroller: HTMLElement, top: number): void {
  scroller.style.scrollBehavior = 'auto';
  scroller.scrollTop = top;
  scroller.style.scrollBehavior = '';
}

export function DocumentView({
  document,
  zoom,
  scrollRequest,
  scrollRef,
  actions,
  onStats,
  onZoomStep,
}: DocumentViewProps) {
  const articleRef = useRef<HTMLElement>(null);
  const token = scrollRequest.token;
  useWheelZoom(scrollRef, onZoomStep);

  // A long document is shown piece by piece. Positions that depend on all of the
  // text (a saved scroll offset, a section further down) wait until it is complete.
  const [settledToken, setSettledToken] = useState<number | undefined>(undefined);
  const settled = settledToken === token;
  const handleComplete = useCallback(() => {
    setSettledToken(token);
  }, [token]);

  const startedToken = useRef<number | undefined>(undefined);
  const positionedToken = useRef<number | undefined>(undefined);
  const interactedToken = useRef<number | undefined>(undefined);
  const markInteracted = useCallback(() => {
    interactedToken.current = token;
  }, [token]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) return;
    const wantsPosition = scrollRequest.anchor !== undefined || (scrollRequest.top ?? 0) > 0;

    if (startedToken.current !== token) {
      startedToken.current = token;
      if (!wantsPosition) {
        // A new document starts at the top, whatever the previous one was scrolled to.
        jumpTo(scroller, 0);
        positionedToken.current = token;
        return;
      }
    }
    if (!wantsPosition || !settled || positionedToken.current === token) return;
    positionedToken.current = token;
    // A reader who has started scrolling while the rest loaded is not pulled back.
    if (interactedToken.current === token) return;

    if (scrollRequest.anchor !== undefined && articleRef.current !== null) {
      const target = findAnchorTarget(articleRef.current, scrollRequest.anchor);
      if (target !== null) {
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
        return;
      }
    }
    jumpTo(scroller, scrollRequest.top ?? 0);
  }, [token, scrollRequest.anchor, scrollRequest.top, settled, scrollRef]);

  // Count words once the whole text is on screen, without delaying the first paint.
  useEffect(() => {
    if (!settled) return;
    const article = articleRef.current;
    if (article === null) return;

    const timer = window.setTimeout(() => {
      const { words, readingMinutes } = computeTextStats(extractText(article));
      onStats({ words, readingMinutes, lines: countLines(document.content) });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [document, onStats, settled]);

  return (
    <div
      className="document-scroll"
      role="region"
      aria-label={document.name}
      tabIndex={0}
      ref={scrollRef as RefObject<HTMLDivElement>}
      onWheel={markInteracted}
      onKeyDown={markInteracted}
      onPointerDown={markInteracted}
      onTouchStart={markInteracted}
    >
      <article
        className="document"
        ref={articleRef}
        style={{ '--doc-zoom': zoom } as CSSProperties}
      >
        <MarkdownRenderer
          key={token}
          source={document.content}
          baseUrl={document.baseUrl}
          actions={actions}
          onComplete={handleComplete}
        />
      </article>
    </div>
  );
}
