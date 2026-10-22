import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer, type MarkdownRendererProps } from './MarkdownRenderer';

const BASE = 'file:///C:/docs/';

function renderMarkdown(source: string, overrides: Partial<MarkdownRendererProps> = {}) {
  const actions = {
    openExternal: vi.fn<(url: string) => void>(),
    openLocal: vi.fn<(url: string) => void>(),
  };
  const view = render(
    <MarkdownRenderer source={source} baseUrl={BASE} actions={actions} {...overrides} />,
  );
  return { ...view, actions };
}

describe('MarkdownRenderer: document structure', () => {
  it('renders headings 1 to 6 with anchor ids', () => {
    renderMarkdown('# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six');

    const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    names.forEach((name, index) => {
      const heading = screen.getByRole('heading', { level: index + 1, name });
      expect(heading).toHaveAttribute('id', name.toLowerCase());
    });
  });

  it('gives repeated headings unique ids', () => {
    renderMarkdown('## Intro\n\n## Intro');
    const ids = screen.getAllByRole('heading', { name: 'Intro' }).map((h) => h.id);
    expect(ids).toEqual(['intro', 'intro-1']);
  });

  it('renders emphasis, strong text, strikethrough and inline code', () => {
    const { container } = renderMarkdown('*em* **strong** ~~gone~~ `code`');
    expect(container.querySelector('em')).toHaveTextContent('em');
    expect(container.querySelector('strong')).toHaveTextContent('strong');
    expect(container.querySelector('del')).toHaveTextContent('gone');
    expect(container.querySelector('code')).toHaveTextContent('code');
  });

  it('renders ordered, unordered and nested lists', () => {
    const { container } = renderMarkdown('1. one\n2. two\n\n- a\n  - nested\n- b');
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelectorAll('ul > li')).toHaveLength(3);
    expect(container.querySelector('ul ul > li')).toHaveTextContent('nested');
  });

  it('renders task list items as read-only checkboxes', () => {
    renderMarkdown('- [x] done\n- [ ] todo');
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    boxes.forEach((box) => expect(box).toBeDisabled());
  });

  it('renders GFM tables with their alignment inside a scrollable container', () => {
    const { container } = renderMarkdown('| Left | Center | Right |\n|:--|:-:|--:|\n| a | b | c |');

    expect(container.querySelector('.table-scroll table')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Left' })).toHaveStyle({ textAlign: 'left' });
    expect(screen.getByRole('columnheader', { name: 'Center' })).toHaveStyle({
      textAlign: 'center',
    });
    expect(screen.getByRole('cell', { name: 'c' })).toHaveStyle({ textAlign: 'right' });
  });

  it('renders blockquotes and horizontal rules', () => {
    const { container } = renderMarkdown('> quoted\n\n---\n\nafter');
    expect(container.querySelector('blockquote')).toHaveTextContent('quoted');
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('keeps multilingual text, right-to-left text and emoji intact', () => {
    renderMarkdown('# 日本語の見出し\n\nمرحبا بالعالم — Привет, мир 🌍');
    expect(screen.getByRole('heading', { name: '日本語の見出し' })).toBeInTheDocument();
    expect(screen.getByText(/مرحبا بالعالم — Привет, мир 🌍/)).toBeInTheDocument();
  });

  it('renders footnotes with a way back to the reference', () => {
    const { container } = renderMarkdown('Text[^1]\n\n[^1]: The note.');
    expect(container.querySelector('section[data-footnotes]')).toHaveTextContent('The note.');
    expect(container.querySelector('a[data-footnote-ref]')).not.toBeNull();
    expect(container.querySelector('a[data-footnote-backref]')).not.toBeNull();
  });

  it('jumps between a footnote reference and its note', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { container } = renderMarkdown('Text[^1]\n\n[^1]: The note.');
    const user = userEvent.setup();

    await user.click(container.querySelector('a[data-footnote-ref]') as HTMLElement);
    expect(scroll.mock.contexts.at(-1)).toBe(container.querySelector('section[data-footnotes] li'));

    await user.click(container.querySelector('a[data-footnote-backref]') as HTMLElement);
    expect(scroll.mock.contexts.at(-1)).toBe(container.querySelector('a[data-footnote-ref]'));
  });
});

describe('MarkdownRenderer: code', () => {
  it('highlights a fenced block in a known language', () => {
    const { container } = renderMarkdown('```ts\nconst answer: number = 42;\n```');
    const code = container.querySelector('pre code');
    expect(code).toHaveClass('language-ts');
    expect(code?.querySelector('[class*="hljs-"]')).not.toBeNull();
    expect(code).toHaveTextContent('const answer: number = 42;');
  });

  it('highlights PowerShell, which is common in Windows documentation', () => {
    const { container } = renderMarkdown(
      '```powershell\nGet-ChildItem | Where-Object { $_.Length -gt 1 }\n```',
    );
    expect(container.querySelector('pre code [class*="hljs-"]')).not.toBeNull();
  });

  it('shows an unknown language as plain text instead of failing', () => {
    const { container } = renderMarkdown('```notalanguage\nsome text\n```');
    expect(container.querySelector('pre code')).toHaveTextContent('some text');
  });

  it('shows a block with one enormous line as plain text, promptly, instead of colouring it for minutes', () => {
    // highlight.js takes time quadratic in the length of a line: about two and a half seconds for
    // this one, and minutes for a 200 KB line.
    const started = performance.now();
    const { container } = renderMarkdown(`\`\`\`ini\n${'a=b;'.repeat(5000)}\n\`\`\``);

    expect(container.querySelector('pre code')).not.toHaveClass('language-ini');
    expect(container.querySelector('pre code [class*="hljs-"]')).toBeNull();
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('does not guess a language for fences without one', () => {
    const { container } = renderMarkdown('```\nconst x = 1;\n```');
    expect(container.querySelector('pre code')).toHaveTextContent('const x = 1;');
    expect(container.querySelector('pre code [class*="hljs-"]')).toBeNull();
  });
});

describe('MarkdownRenderer: hostile input', () => {
  it('shows a document that nests quotes absurdly deep as plain text, at once, instead of hanging', () => {
    // The parsers are recursive and slow down with the square of the depth: 50,000 levels
    // (100 KB of "> ") took twenty seconds to fail with a stack overflow.
    const hostile = `${'> '.repeat(50_000)}deep\n`;
    const onComplete = vi.fn();

    const started = performance.now();
    const { container } = renderMarkdown(hostile, { onComplete });

    expect(performance.now() - started).toBeLessThan(2000);
    expect(screen.getByRole('alert')).toHaveTextContent(/too deeply/i);
    expect(container.querySelector('pre code')).toHaveTextContent('deep');
    expect(container.querySelector('blockquote')).toBeNull();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('still formats an ordinary document that merely contains some quotes and lists', () => {
    const { container } = renderMarkdown('> quoted\n>\n> - item\n\n- a\n  - b\n');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('blockquote ul > li')).toHaveTextContent('item');
  });
});

describe('MarkdownRenderer: links', () => {
  it('opens web links through the app instead of navigating the page', async () => {
    const { actions } = renderMarkdown('[site](https://example.com/a)');
    await userEvent.setup().click(screen.getByRole('link', { name: 'site' }));
    expect(actions.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/a');
  });

  it('prevents the browser from following a link itself', () => {
    renderMarkdown('[site](https://example.com/a)');
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'site' }));
    expect(notPrevented).toBe(false);
  });

  it('opens mail links through the app', async () => {
    const { actions } = renderMarkdown('[write](mailto:ada@example.com)');
    await userEvent.setup().click(screen.getByRole('link', { name: 'write' }));
    expect(actions.openExternal).toHaveBeenCalledExactlyOnceWith('mailto:ada@example.com');
  });

  it('resolves relative links against the document folder', async () => {
    const { actions } = renderMarkdown('[setup](guide/setup.md#install)');
    await userEvent.setup().click(screen.getByRole('link', { name: 'setup' }));
    expect(actions.openLocal).toHaveBeenCalledExactlyOnceWith(
      'file:///C:/docs/guide/setup.md#install',
    );
  });

  it('scrolls to the heading for in-page links', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderMarkdown('[jump](#my-section)\n\n## My Section');

    await userEvent.setup().click(screen.getByRole('link', { name: 'jump' }));

    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll.mock.contexts[0]).toBe(screen.getByRole('heading', { name: 'My Section' }));
  });

  it('also finds anchors written by the author with an id or name attribute', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { container } = renderMarkdown(
      '[old](#old-school)\n\n<a name="old-school"></a>Old style anchor',
    );

    await userEvent.setup().click(screen.getByRole('link', { name: 'old' }));

    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('a[name]'));
  });

  it('does nothing for an in-page link whose target does not exist', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { actions } = renderMarkdown('[nowhere](#missing)');

    await userEvent.setup().click(screen.getByRole('link', { name: 'nowhere' }));

    expect(scroll).not.toHaveBeenCalled();
    expect(actions.openExternal).not.toHaveBeenCalled();
    expect(actions.openLocal).not.toHaveBeenCalled();
  });

  it('renders a link with an unsafe protocol as inert text', async () => {
    const { actions } = renderMarkdown('[click me](javascript:alert(1))');

    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.setup().click(screen.getByText('click me'));
    expect(actions.openExternal).not.toHaveBeenCalled();
    expect(actions.openLocal).not.toHaveBeenCalled();
  });

  it('shows where a link goes when hovering it', () => {
    renderMarkdown('[site](https://example.com/a)');
    expect(screen.getByRole('link', { name: 'site' })).toHaveAttribute(
      'title',
      'https://example.com/a',
    );
  });
});

describe('MarkdownRenderer: images', () => {
  it('loads relative images through the local image scheme', () => {
    renderMarkdown('![Logo](images/logo.png)');
    expect(screen.getByAltText('Logo')).toHaveAttribute(
      'src',
      'mdreader-local://image/?u=file%3A%2F%2F%2FC%3A%2Fdocs%2Fimages%2Flogo.png',
    );
  });

  it('encodes spaces and non-ASCII characters in the path', () => {
    renderMarkdown('![cat](<pics/my cat 猫.png>)');
    const src = screen.getByAltText('cat').getAttribute('src') ?? '';
    expect(decodeURIComponent(src.split('?u=')[1] ?? '')).toBe(
      'file:///C:/docs/pics/my%20cat%20%E7%8C%AB.png',
    );
  });

  it('keeps https images as they are and loads them lazily', () => {
    renderMarkdown('![badge](https://img.shields.io/badge/a-b-green.svg)');
    const image = screen.getByAltText('badge');
    expect(image).toHaveAttribute('src', 'https://img.shields.io/badge/a-b-green.svg');
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  it('does not load plain http images and says so', () => {
    renderMarkdown('![insecure](http://example.com/a.png)');
    expect(screen.queryByRole('img', { name: 'insecure' })?.tagName).not.toBe('IMG');
    expect(screen.getByText(/insecure/)).toBeInTheDocument();
  });

  it('accepts small inline images but not other data URLs', () => {
    renderMarkdown(
      '![dot](data:image/png;base64,iVBORw0KGgo=)\n\n![bad](data:text/html;base64,PHNjcmlwdD4=)',
    );
    expect(screen.getByAltText('dot')).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
    expect(document.querySelector('img[src^="data:text"]')).toBeNull();
  });

  it('shows a readable placeholder when an image fails to load', () => {
    renderMarkdown('![Missing logo](images/gone.png)');
    fireEvent.error(screen.getByAltText('Missing logo'));

    expect(screen.queryByAltText('Missing logo')).toBeNull();
    expect(screen.getByText(/Missing logo/)).toBeInTheDocument();
    expect(screen.getByText(/image/i)).toBeInTheDocument();
  });
});

describe('MarkdownRenderer: untrusted HTML', () => {
  it('removes scripts, frames, plugins, styles, forms and document-level elements', () => {
    const { container } = renderMarkdown(
      [
        '<script>window.pwned = 1</script>',
        '<iframe src="https://evil.example"></iframe>',
        '<object data="x"></object><embed src="x">',
        '<style>body{display:none}</style>',
        '<form action="https://evil.example"><button>go</button></form>',
        '<meta http-equiv="refresh" content="0;url=https://evil.example">',
        '<base href="https://evil.example/">',
        '<link rel="stylesheet" href="https://evil.example/x.css">',
        '<svg onload="window.pwned = 2"><circle/></svg>',
        '',
        'visible text',
      ].join('\n'),
    );

    for (const tag of [
      'script',
      'iframe',
      'object',
      'embed',
      'style',
      'form',
      'button',
      'meta',
      'base',
      'link',
      'svg',
    ]) {
      expect(container.querySelector(tag), tag).toBeNull();
    }
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    expect(container).toHaveTextContent('visible text');
  });

  it('removes event handlers, inline styles and javascript: links from allowed elements', () => {
    const { container } = renderMarkdown(
      [
        '<img src="https://example.com/a.png" onerror="alert(1)" onclick="alert(2)" style="position:fixed" width="40">',
        '',
        '<a href="javascript:alert(1)" onclick="alert(3)">unsafe link</a>',
        '',
        '<div onmouseover="alert(4)" style="color:red" align="center">centred</div>',
      ].join('\n'),
    );

    const image = container.querySelector('img');
    expect(image).not.toHaveAttribute('onerror');
    expect(image).not.toHaveAttribute('onclick');
    expect(image).not.toHaveAttribute('style');
    expect(image).toHaveAttribute('width', '40');
    expect(screen.getByText('unsafe link')).not.toHaveAttribute('href');
    expect(screen.getByText('unsafe link')).not.toHaveAttribute('onclick');
    const div = screen.getByText('centred');
    expect(div).not.toHaveAttribute('onmouseover');
    expect(div).not.toHaveAttribute('style');
    expect(div).toHaveAttribute('align', 'center');
  });

  it('keeps harmless formatting HTML', () => {
    const { container } = renderMarkdown(
      '<details><summary>More</summary>hidden text</details>\n\nPress <kbd>Ctrl</kbd>+<kbd>O</kbd>, H<sub>2</sub>O, x<sup>2</sup><br>next line',
    );
    expect(container.querySelector('details > summary')).toHaveTextContent('More');
    expect(container.querySelectorAll('kbd')).toHaveLength(2);
    expect(container.querySelector('sub')).toHaveTextContent('2');
    expect(container.querySelector('sup')).toHaveTextContent('2');
    expect(container.querySelector('br')).not.toBeNull();
  });

  it('prefixes author ids and names so they cannot shadow page globals', () => {
    const { container } = renderMarkdown(
      '<a id="location" name="cookie">x</a>\n\n<img name="documentElement" alt="y">',
    );
    expect(container.querySelector('#location')).toBeNull();
    expect(container.querySelector('[name="cookie"]')).toBeNull();
    expect(container.querySelector('[name="documentElement"]')).toBeNull();
    expect(container.querySelector('#user-content-location')).not.toBeNull();
  });

  it('turns a form field into a harmless disabled checkbox', () => {
    renderMarkdown('<input name="password" value="secret">');
    const field = document.querySelector('input');
    expect(field).toHaveAttribute('type', 'checkbox');
    expect(field).toBeDisabled();
  });
});

describe('MarkdownRenderer: picture elements', () => {
  it('drops <picture> and <source>, whose srcset addresses escape the image checks, and keeps the <img>', () => {
    const { container } = renderMarkdown(
      '<picture><source srcset="http://evil.example/a.png" media="(min-width: 1px)">' +
        '<img src="https://example.com/b.png" alt="logo"></picture>',
    );

    expect(container.querySelector('source')).toBeNull();
    expect(container.querySelector('picture')).toBeNull();
    expect(container.querySelector('[srcset]')).toBeNull();
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/b.png');
  });
});

describe('MarkdownRenderer: large documents', () => {
  // Past the size where a document is split into pieces and shown progressively.
  const section = (n: number, title = `Section ${n}`) =>
    `## ${title}\n\nParagraph ${n} with *emphasis* and [a link](#section-${n}).\n\n- item a\n- item b\n\n`;
  const manySections = (count: number, title?: (n: number) => string) =>
    Array.from({ length: count }, (_unused, n) => section(n, title?.(n))).join('');
  const LARGE = manySections(1000);

  it('shows the beginning at once and fills in the rest afterwards', async () => {
    renderMarkdown(LARGE);

    expect(screen.getByRole('heading', { name: 'Section 0' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Section 999' })).toBeNull();

    expect(
      await screen.findByRole('heading', { name: 'Section 999' }, { timeout: 30_000 }),
    ).toBeInTheDocument();
  }, 60_000);

  it('reports once when the whole document is on screen', async () => {
    const onComplete = vi.fn();
    renderMarkdown(LARGE, { onComplete });
    expect(onComplete).not.toHaveBeenCalled();

    await vi.waitFor(
      () => {
        expect(onComplete).toHaveBeenCalledOnce();
      },
      { timeout: 30_000 },
    );
    expect(screen.getByRole('heading', { name: 'Section 999' })).toBeInTheDocument();
  }, 60_000);

  it('reports a small document as complete straight away', () => {
    const onComplete = vi.fn();
    renderMarkdown('# Small', { onComplete });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('numbers repeated headings across the pieces exactly as one pass would', async () => {
    const onComplete = vi.fn();
    const { container } = renderMarkdown(
      manySections(1000, () => 'Notes'),
      { onComplete },
    );
    await vi.waitFor(
      () => {
        expect(onComplete).toHaveBeenCalledOnce();
      },
      { timeout: 30_000 },
    );

    const found = Array.from(container.querySelectorAll('h2')).map((heading) => heading.id);
    expect(found).toHaveLength(1000);
    expect(found[0]).toBe('notes');
    expect(found[1]).toBe('notes-1');
    expect(found[999]).toBe('notes-999');
    expect(new Set(found).size).toBe(1000);
  }, 60_000);

  it('produces exactly what a single pass would, including links defined at the end', async () => {
    const source = `${manySections(1000, (n) => (n % 7 === 0 ? 'Notes' : `Section ${n}`))}See [the site][ref].\n\n[ref]: https://example.com\n`;
    const whole = renderMarkdown(source, {
      chunking: { thresholdBytes: Number.POSITIVE_INFINITY },
    });
    // Whitespace between block elements is invisible; only the seams between pieces differ.
    const normalized = (html: string) => html.replace(/>\s+</g, '><');
    const expected = normalized(whole.container.innerHTML);
    whole.unmount();

    const onComplete = vi.fn();
    const pieces = renderMarkdown(source, { onComplete });
    await vi.waitFor(
      () => {
        expect(onComplete).toHaveBeenCalledOnce();
      },
      { timeout: 60_000 },
    );

    expect(normalized(pieces.container.innerHTML)).toBe(expected);
    expect(screen.getByRole('link', { name: 'the site' })).toHaveAttribute(
      'href',
      'https://example.com/',
    );
  }, 120_000);
});
