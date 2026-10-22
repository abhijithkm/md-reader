import type { Element, Root } from 'hast';
import { describe, expect, it } from 'vitest';
import { SlugSequence } from './slugs';

function heading(text: string, properties: Element['properties'] = {}, tagName = 'h2'): Element {
  return { type: 'element', tagName, properties, children: [{ type: 'text', value: text }] };
}

const tree = (...children: Element[]): Root => ({ type: 'root', children });

function ids(root: Root): unknown[] {
  return root.children.map((child) => (child as Element).properties.id);
}

function run(slugs: SlugSequence, index: number, root: Root): Root {
  slugs.pluginFor(index)()(root);
  return root;
}

describe('SlugSequence', () => {
  it('gives headings GitHub-style ids and numbers repeats', () => {
    const root = run(
      new SlugSequence(),
      0,
      tree(heading('Hello, World!'), heading('Intro'), heading('Intro'), heading('Intro')),
    );
    expect(ids(root)).toEqual(['hello-world', 'intro', 'intro-1', 'intro-2']);
  });

  it('keeps numbering repeated headings across pieces, as if the document were whole', () => {
    const slugs = new SlugSequence();
    run(slugs, 0, tree(heading('Intro'), heading('Intro')));

    const second = run(slugs, 1, tree(heading('Intro'), heading('Other'), heading('Intro')));

    expect(ids(second)).toEqual(['intro-2', 'other', 'intro-3']);
  });

  it('gives a piece the same ids every time it is rendered', () => {
    const slugs = new SlugSequence();
    run(slugs, 0, tree(heading('Intro')));

    const first = run(slugs, 1, tree(heading('Intro')));
    const again = run(slugs, 1, tree(heading('Intro')));

    expect(ids(first)).toEqual(['intro-1']);
    expect(ids(again)).toEqual(['intro-1']);
  });

  it('leaves a heading that already has an id alone', () => {
    const root = run(
      new SlugSequence(),
      0,
      tree(heading('Install', { id: 'user-content-install' }), heading('Install')),
    );
    expect(ids(root)).toEqual(['user-content-install', 'install']);
  });

  it('uses the text a reader sees, including nested elements', () => {
    const emphasised: Element = {
      type: 'element',
      tagName: 'h3',
      properties: {},
      children: [
        { type: 'text', value: 'Hello ' },
        {
          type: 'element',
          tagName: 'em',
          properties: {},
          children: [{ type: 'text', value: 'World' }],
        },
      ],
    };
    expect(ids(run(new SlugSequence(), 0, tree(emphasised)))).toEqual(['hello-world']);
  });

  it('only numbers headings', () => {
    const paragraph: Element = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [{ type: 'text', value: 'Intro' }],
    };
    expect(ids(run(new SlugSequence(), 0, tree(paragraph)))).toEqual([undefined]);
  });
});
