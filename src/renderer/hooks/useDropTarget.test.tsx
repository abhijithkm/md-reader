import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDropTarget } from './useDropTarget';

function dragEvent(type: string, files: File[] = [], types: string[] = ['Files']): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types, dropEffect: 'none' },
  });
  return event;
}

function fire(event: Event): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = window.dispatchEvent(event);
  });
  return notPrevented;
}

const file = (name: string) => new File(['x'], name);

describe('useDropTarget', () => {
  it('reports dragging while files are over the window', () => {
    const { result } = renderHook(() => useDropTarget(vi.fn()));
    expect(result.current.dragging).toBe(false);

    fire(dragEvent('dragenter'));
    expect(result.current.dragging).toBe(true);

    fire(dragEvent('dragleave'));
    expect(result.current.dragging).toBe(false);
  });

  it('does not flicker when the pointer moves between elements', () => {
    const { result } = renderHook(() => useDropTarget(vi.fn()));

    fire(dragEvent('dragenter'));
    fire(dragEvent('dragenter'));
    fire(dragEvent('dragleave'));
    expect(result.current.dragging).toBe(true);

    fire(dragEvent('dragleave'));
    expect(result.current.dragging).toBe(false);
  });

  it('ignores drags that carry no files', () => {
    const { result } = renderHook(() => useDropTarget(vi.fn()));

    fire(dragEvent('dragenter', [], ['text/plain']));

    expect(result.current.dragging).toBe(false);
  });

  it('stops the browser from navigating to a dropped file', () => {
    renderHook(() => useDropTarget(vi.fn()));

    expect(fire(dragEvent('dragover', [file('a.md')]))).toBe(false);
    expect(fire(dragEvent('drop', [file('a.md')]))).toBe(false);
  });

  it('hands the dropped file over and stops showing the drop hint', () => {
    const onDropFile = vi.fn();
    const { result } = renderHook(() => useDropTarget(onDropFile));
    const dropped = file('notes.md');

    fire(dragEvent('dragenter', [dropped]));
    fire(dragEvent('drop', [dropped]));

    expect(onDropFile).toHaveBeenCalledExactlyOnceWith(dropped);
    expect(result.current.dragging).toBe(false);
  });

  it('prefers a Markdown file when several are dropped', () => {
    const onDropFile = vi.fn();
    renderHook(() => useDropTarget(onDropFile));
    const markdown = file('readme.md');

    fire(dragEvent('drop', [file('photo.png'), markdown, file('other.markdown')]));

    expect(onDropFile).toHaveBeenCalledExactlyOnceWith(markdown);
  });

  it('opens the first file when none is Markdown so the user hears why it cannot be opened', () => {
    const onDropFile = vi.fn();
    renderHook(() => useDropTarget(onDropFile));
    const first = file('photo.png');

    fire(dragEvent('drop', [first, file('notes.txt')]));

    expect(onDropFile).toHaveBeenCalledExactlyOnceWith(first);
  });

  it('ignores a drop with no files', () => {
    const onDropFile = vi.fn();
    renderHook(() => useDropTarget(onDropFile));

    fire(dragEvent('drop', [], ['text/plain']));

    expect(onDropFile).not.toHaveBeenCalled();
  });

  it('stops listening when the page goes away', () => {
    const onDropFile = vi.fn();
    const { unmount } = renderHook(() => useDropTarget(onDropFile));

    unmount();
    fire(dragEvent('drop', [file('a.md')]));

    expect(onDropFile).not.toHaveBeenCalled();
  });
});
