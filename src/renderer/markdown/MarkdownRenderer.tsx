import {
  memo,
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import type { LinkWish } from '../../shared/tabs';
import { RenderBoundary } from '../components/RenderBoundary';
import { findAnchorTarget } from './anchors';
import { splitMarkdown, type ChunkOptions } from './chunks';
import { resolveImageSource } from './images';
import { classifyLink } from './links';
import { nestsTooDeeply } from './nesting';
import { remarkPlugins, rehypePluginsFor } from './pipeline';
import { SlugSequence } from './slugs';

export interface LinkActions {
  openExternal: (url: string) => void;
  /**
   * `fileUrl` is an absolute file: URL, possibly with a #fragment. Without a wish it opens in the
   * tab the link is in; a click with Ctrl held, or a middle click, asks for a tab of its own.
   */
  openLocal: (fileUrl: string, wish?: LinkWish) => void;
}

export interface MarkdownRendererProps {
  source: string;
  /** file: URL of the document's folder; relative links and images resolve against it. */
  baseUrl: string;
  actions: LinkActions;
  /** Called once the whole document is on screen (at once for a short one). */
  onComplete?: () => void;
  /** Overrides when long documents are split into pieces; for tests. */
  chunking?: ChunkOptions;
}

type ElementProps<T extends keyof HTMLElementTagNameMap> = ComponentPropsWithoutRef<T> & ExtraProps;

// The sanitizer already prefixes every id once ("user-content-"); a second
// prefix from remark-rehype would break footnote links.
const REMARK_REHYPE_OPTIONS = { clobberPrefix: '' };

// Sanitizing already restricted every URL; the default transform would also
// strip file: and data: URLs that the components validate themselves.
const keepUrl = (url: string): string => url;

/**
 * Renders Markdown as React elements. HTML in the document is sanitized (see
 * pipeline.ts), links never navigate the page, and images only load from
 * places the app allows.
 *
 * A long document is split (see chunks.ts) and shown one piece per turn of the
 * event loop: the first screenful appears immediately, the window stays
 * responsive while the rest is processed, and `onComplete` fires at the end.
 *
 * A hostile file must not be able to hang or blank the window, so a document
 * that stacks quotes or lists absurdly deep is shown as plain text (nesting.ts),
 * and each piece is drawn inside an error boundary: if the parser throws on one
 * piece, a message replaces that piece and the rest is still shown.
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  source,
  baseUrl,
  actions,
  onComplete,
  chunking,
}: MarkdownRendererProps) {
  const components = useMemo(() => createComponents(baseUrl, actions), [baseUrl, actions]);
  const tooDeep = useMemo(() => nestsTooDeeply(source), [source]);
  const chunks = useMemo(
    () => (tooDeep ? [] : splitMarkdown(source, chunking)),
    [source, chunking, tooDeep],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a fresh sequence for every document
  const slugs = useMemo(() => new SlugSequence(), [chunks]);

  // How many pieces of these `chunks` are on screen.
  const [progress, setProgress] = useState({ chunks, shown: 1 });
  let shown = progress.shown;
  if (progress.chunks !== chunks) {
    // A different document arrived: start again from its first piece.
    shown = 1;
    setProgress({ chunks, shown });
  }

  const latestOnComplete = useRef(onComplete);
  useEffect(() => {
    latestOnComplete.current = onComplete;
  });

  // A layout effect, so a short document is reported before the first paint.
  useLayoutEffect(() => {
    if (shown >= chunks.length) latestOnComplete.current?.();
  }, [shown, chunks]);

  useEffect(() => {
    if (shown >= chunks.length) return;
    const timer = window.setTimeout(() => {
      startTransition(() => {
        setProgress((current) =>
          current.chunks === chunks ? { chunks, shown: current.shown + 1 } : current,
        );
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [shown, chunks]);

  if (tooDeep) {
    return (
      <div className="markdown-body">
        <p className="render-error" role="alert">
          This document nests quotes or lists too deeply to be formatted safely, so it is shown as
          plain text.
        </p>
        <pre tabIndex={0}>
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="markdown-body">
      {chunks.slice(0, shown).map((chunk, index) => (
        <RenderBoundary
          // Pieces only ever append, so their position identifies them.
          key={index}
          resetKey={chunk}
          fallback={
            <p className="render-error" role="alert">
              This part of the document could not be displayed.
            </p>
          }
        >
          <MarkdownChunk source={chunk} index={index} slugs={slugs} components={components} />
        </RenderBoundary>
      ))}
    </div>
  );
});

interface MarkdownChunkProps {
  source: string;
  index: number;
  slugs: SlugSequence;
  components: Components;
}

/** One piece of the document. Memoized so already-shown pieces are never processed again. */
const MarkdownChunk = memo(function MarkdownChunk({
  source,
  index,
  slugs,
  components,
}: MarkdownChunkProps) {
  const rehypePlugins = useMemo(
    () => rehypePluginsFor(source, slugs.pluginFor(index)),
    [source, slugs, index],
  );

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={REMARK_REHYPE_OPTIONS}
      components={components}
      urlTransform={keepUrl}
    >
      {source}
    </ReactMarkdown>
  );
});

function createComponents(baseUrl: string, actions: LinkActions): Components {
  return {
    a: ({
      node: _node,
      href,
      title,
      children,
      target: _target,
      rel: _rel,
      ...attributes
    }: ElementProps<'a'>) => (
      <MarkdownLink
        href={href}
        title={title}
        attributes={attributes}
        baseUrl={baseUrl}
        actions={actions}
      >
        {children}
      </MarkdownLink>
    ),
    img: ({ src, alt, title, width, height }: ElementProps<'img'>) => (
      <MarkdownImage
        key={`${baseUrl}|${typeof src === 'string' ? src : ''}`}
        src={typeof src === 'string' ? src : undefined}
        alt={alt}
        title={title}
        width={width}
        height={height}
        baseUrl={baseUrl}
      />
    ),
    table: ({ children }: ElementProps<'table'>) => (
      <div className="table-scroll" tabIndex={0}>
        <table>{children}</table>
      </div>
    ),
    pre: ({ children }: ElementProps<'pre'>) => <pre tabIndex={0}>{children}</pre>,
    // Task list checkboxes: display only.
    input: ({ type, checked }: ElementProps<'input'>) => (
      <input type={type} checked={checked} disabled readOnly />
    ),
  };
}

interface MarkdownLinkProps {
  href: string | undefined;
  title: string | undefined;
  /** Remaining (already sanitized) attributes such as id, name, aria-* and data-*. */
  attributes: ComponentPropsWithoutRef<'a'>;
  baseUrl: string;
  actions: LinkActions;
  children: ReactNode;
}

function MarkdownLink({ href, title, attributes, baseUrl, actions, children }: MarkdownLinkProps) {
  // `<a name="section"></a>` is an anchor target, not a link.
  if (href === undefined) return <a {...attributes}>{children}</a>;

  const target = classifyLink(href, baseUrl);
  if (target.kind === 'blocked') {
    // Unsafe or unusable target: keep the words, drop the link.
    return (
      <span {...attributes} className="link-inert">
        {children}
      </span>
    );
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    // The page must never navigate; the app decides what each kind of link does.
    event.preventDefault();
    switch (target.kind) {
      case 'anchor': {
        // Search the whole document, which may be made of several pieces.
        const root = event.currentTarget.closest('.markdown-body');
        const element = root === null ? null : findAnchorTarget(root, target.id);
        element?.scrollIntoView({ block: 'start' });
        break;
      }
      case 'external':
        actions.openExternal(target.url);
        break;
      case 'local':
        if (event.ctrlKey) actions.openLocal(target.fileUrl, { newTab: true });
        else actions.openLocal(target.fileUrl);
        break;
    }
  };

  const destination = target.kind === 'anchor' ? `#${target.id}` : displayUrl(target);
  return (
    <a
      {...attributes}
      href={target.kind === 'anchor' ? href : destination}
      title={title ?? (target.kind === 'anchor' ? undefined : destination)}
      onClick={handleClick}
      onAuxClick={(event) => {
        // The page must never follow a link itself, whatever button was used.
        event.preventDefault();
        if (event.button === 1 && target.kind === 'local') {
          actions.openLocal(target.fileUrl, { newTab: true });
        }
      }}
    >
      {children}
    </a>
  );
}

function displayUrl(
  target: { kind: 'external'; url: string } | { kind: 'local'; fileUrl: string },
) {
  return target.kind === 'external' ? target.url : target.fileUrl;
}

interface MarkdownImageProps {
  src: string | undefined;
  alt: string | undefined;
  title: string | undefined;
  width: string | number | undefined;
  height: string | number | undefined;
  baseUrl: string;
}

function MarkdownImage({ src, alt, title, width, height, baseUrl }: MarkdownImageProps) {
  const [failed, setFailed] = useState(false);
  const source = resolveImageSource(src, baseUrl);
  const description = alt ?? '';

  if (source.kind === 'blocked') {
    return <ImagePlaceholder text={`Image blocked: ${description}`.trim()} />;
  }
  if (failed) {
    return <ImagePlaceholder text={`Image not found: ${description}`.trim()} />;
  }

  return (
    <img
      src={source.url}
      alt={description}
      title={title}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

function ImagePlaceholder({ text }: { text: string }) {
  return <span className="image-placeholder">{text}</span>;
}
