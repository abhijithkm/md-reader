import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TabInfo } from '../../shared/tabs';
import { TabStrip, TAB_DRAG_TYPE, TAB_PANEL_ID, tabButtonId, type TabStripProps } from './TabStrip';

const TABS: TabInfo[] = [
  { id: 'tab-1', path: 'C:\\docs\\a.md' },
  { id: 'tab-2', path: 'C:\\docs\\b.md' },
  { id: 'tab-3', path: 'C:\\docs\\c.md' },
];

function renderStrip(overrides: Partial<TabStripProps> = {}) {
  const props = {
    tabs: TABS,
    activeId: 'tab-2',
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onMove: vi.fn(),
    onNew: vi.fn(),
    ...overrides,
  };
  const view = render(<TabStrip {...props} />);
  return { props, view, user: userEvent.setup() };
}

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });

/** A stand-in for the object a drag carries, which jsdom does not have. */
function createTransfer() {
  const data = new Map<string, string>();
  return {
    dataTransfer: {
      setData: (type: string, value: string) => {
        data.set(type, value);
      },
      getData: (type: string) => data.get(type) ?? '',
      get types() {
        return [...data.keys()];
      },
      effectAllowed: 'uninitialized',
      dropEffect: 'none',
    },
  };
}

/** The row each tab sits in, which is what is dragged. */
const wrapperOf = (name: string): HTMLElement => tab(name).parentElement as HTMLElement;

describe('TabStrip', () => {
  it('has a tab for each document, named after its file, with the one on screen selected', () => {
    renderStrip();

    expect(screen.getByRole('tablist', { name: 'Open documents' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((element) => element.textContent)).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ]);
    expect(tab('a.md')).toHaveAttribute('aria-selected', 'false');
    expect(tab('b.md')).toHaveAttribute('aria-selected', 'true');
    expect(tab('c.md')).toHaveAttribute('aria-selected', 'false');
  });

  it('tells apart tabs that share a name by the folder their files are in', () => {
    renderStrip({
      tabs: [
        { id: 'tab-1', path: 'C:\\work\\api\\README.md' },
        { id: 'tab-2', path: 'C:\\work\\web\\README.md' },
      ],
      activeId: 'tab-1',
    });

    expect(screen.getAllByRole('tab').map((element) => element.textContent)).toEqual([
      'README.mdapi',
      'README.mdweb',
    ]);
    expect(screen.getByRole('button', { name: 'Close README.md in api' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close README.md in web' })).toBeInTheDocument();
  });

  it('gives the whole path of the document on hover', () => {
    renderStrip();
    expect(tab('b.md')).toHaveAttribute('title', 'C:\\docs\\b.md');
  });

  it('puts only the tab on screen in the tab order, and the others one arrow key away', () => {
    renderStrip();

    expect(tab('a.md')).toHaveAttribute('tabindex', '-1');
    expect(tab('b.md')).toHaveAttribute('tabindex', '0');
    expect(tab('c.md')).toHaveAttribute('tabindex', '-1');
  });

  it('can be reached from the keyboard when no tab is on screen yet', () => {
    renderStrip({ activeId: undefined });

    expect(tab('a.md')).toHaveAttribute('tabindex', '0');
    expect(tab('b.md')).toHaveAttribute('tabindex', '-1');
  });

  it('connects the tab on screen to the panel it controls, and names the panel after it', () => {
    renderStrip();

    expect(tab('b.md')).toHaveAttribute('aria-controls', TAB_PANEL_ID);
    expect(tab('a.md')).not.toHaveAttribute('aria-controls');
    expect(tab('b.md')).toHaveAttribute('id', tabButtonId('tab-2'));
  });

  it('switches to a tab that is clicked', async () => {
    const { props, user } = renderStrip();

    await user.click(tab('c.md'));

    expect(props.onActivate).toHaveBeenCalledExactlyOnceWith('tab-3');
  });

  it('closes a tab from its cross, without switching to it first', async () => {
    const { props, user } = renderStrip();

    await user.click(screen.getByRole('button', { name: 'Close a.md' }));

    expect(props.onClose).toHaveBeenCalledExactlyOnceWith('tab-1');
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('closes a tab on a middle click, and does not let the page start scrolling', () => {
    const { props } = renderStrip();

    const notPrevented = fireEvent.mouseDown(tab('a.md'), { button: 1 });
    fireEvent(
      tab('a.md'),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    );

    expect(notPrevented).toBe(false);
    expect(props.onClose).toHaveBeenCalledExactlyOnceWith('tab-1');
  });

  it('leaves the other mouse buttons alone', () => {
    const { props } = renderStrip();

    const notPrevented = fireEvent.mouseDown(tab('a.md'), { button: 0 });
    fireEvent(
      tab('a.md'),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }),
    );

    expect(notPrevented).toBe(true);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('opens files from the plus button', async () => {
    const { props, user } = renderStrip();

    await user.click(screen.getByRole('button', { name: 'Open files' }));

    expect(props.onNew).toHaveBeenCalledOnce();
  });

  describe('keyboard', () => {
    it('moves to the next tab with the right arrow, and brings it on screen', async () => {
      const { props, user } = renderStrip();
      tab('b.md').focus();

      await user.keyboard('{ArrowRight}');

      expect(tab('c.md')).toHaveFocus();
      expect(props.onActivate).toHaveBeenCalledExactlyOnceWith('tab-3');
    });

    it('moves to the previous tab with the left arrow', async () => {
      const { props, user } = renderStrip();
      tab('b.md').focus();

      await user.keyboard('{ArrowLeft}');

      expect(tab('a.md')).toHaveFocus();
      expect(props.onActivate).toHaveBeenCalledExactlyOnceWith('tab-1');
    });

    it('goes round from the last tab to the first, and from the first to the last', async () => {
      const { props, user } = renderStrip({ activeId: 'tab-3' });
      tab('c.md').focus();

      await user.keyboard('{ArrowRight}');
      expect(tab('a.md')).toHaveFocus();

      await user.keyboard('{ArrowLeft}');
      expect(tab('c.md')).toHaveFocus();
      expect(vi.mocked(props.onActivate).mock.calls).toEqual([['tab-1'], ['tab-3']]);
    });

    it('goes to the first and last tab with Home and End', async () => {
      const { props, user } = renderStrip();
      tab('b.md').focus();

      await user.keyboard('{End}');
      expect(tab('c.md')).toHaveFocus();
      await user.keyboard('{Home}');
      expect(tab('a.md')).toHaveFocus();

      expect(vi.mocked(props.onActivate).mock.calls).toEqual([['tab-3'], ['tab-1']]);
    });

    it('closes the tab with Delete, and moves the focus to the one next to it', async () => {
      const { props, user } = renderStrip();
      tab('b.md').focus();

      await user.keyboard('{Delete}');

      expect(props.onClose).toHaveBeenCalledExactlyOnceWith('tab-2');
      expect(tab('c.md')).toHaveFocus();
    });

    it('moves the focus to the tab before when the last tab is closed', async () => {
      const { props, user } = renderStrip({ activeId: 'tab-3' });
      tab('c.md').focus();

      await user.keyboard('{Delete}');

      expect(props.onClose).toHaveBeenCalledExactlyOnceWith('tab-3');
      expect(tab('b.md')).toHaveFocus();
    });

    it('leaves a key alone when a modifier is held, so that Alt+Left still means Back', async () => {
      const { props, user } = renderStrip();
      tab('b.md').focus();

      await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
      await user.keyboard('{Control>}{ArrowRight}{/Control}');
      await user.keyboard('{Shift>}{Delete}{/Shift}');

      expect(tab('b.md')).toHaveFocus();
      expect(props.onActivate).not.toHaveBeenCalled();
      expect(props.onClose).not.toHaveBeenCalled();
    });

    it('does not take other keys', async () => {
      const { props, user } = renderStrip();
      tab('b.md').focus();

      await user.keyboard('x');

      expect(props.onActivate).not.toHaveBeenCalled();
    });
  });

  it('brings the tab on screen into view', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { view, props } = renderStrip({ activeId: 'tab-1' });
    scroll.mockClear();

    view.rerender(<TabStrip {...props} activeId="tab-3" />);

    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll.mock.contexts[0]).toBe(tab('c.md'));
    scroll.mockRestore();
  });

  it('brings the tab on screen into view again when it was moved along the row', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const [first, second, third] = TABS as [TabInfo, TabInfo, TabInfo];
    const { view, props } = renderStrip({ activeId: 'tab-1' });
    scroll.mockClear();

    view.rerender(<TabStrip {...props} tabs={[second, third, first]} activeId="tab-1" />);

    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll.mock.contexts[0]).toBe(tab('a.md'));
    scroll.mockRestore();
  });

  it('does not scroll the row when nothing about the tab on screen has changed', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { view, props } = renderStrip({ activeId: 'tab-1' });
    scroll.mockClear();

    view.rerender(<TabStrip {...props} />);
    view.rerender(<TabStrip {...props} activeId="tab-1" />);

    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it('turns the wheel into sideways scrolling when the row is wider than the window', () => {
    renderStrip();
    const row = screen.getByRole('tablist');
    Object.defineProperty(row, 'scrollWidth', { value: 900, configurable: true });
    Object.defineProperty(row, 'clientWidth', { value: 300, configurable: true });

    fireEvent.wheel(row, { deltaY: 40 });

    expect(row.scrollLeft).toBe(40);
  });

  it('leaves the wheel alone when every tab fits', () => {
    renderStrip();
    const row = screen.getByRole('tablist');
    Object.defineProperty(row, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(row, 'clientWidth', { value: 300, configurable: true });

    fireEvent.wheel(row, { deltaY: 40 });

    expect(row.scrollLeft).toBe(0);
  });

  describe('dragging a tab to another place', () => {
    it('moves a tab dropped on the right half of another to just after it', () => {
      const { props } = renderStrip();
      const transfer = createTransfer();

      fireEvent.dragStart(wrapperOf('a.md'), transfer);
      fireEvent.drop(wrapperOf('c.md'), { ...transfer, clientX: 5 });

      expect(props.onMove).toHaveBeenCalledExactlyOnceWith('tab-1', 2);
    });

    it('moves a tab dropped on the left half of another to just before it', () => {
      const { props } = renderStrip();
      const transfer = createTransfer();

      fireEvent.dragStart(wrapperOf('c.md'), transfer);
      fireEvent.drop(wrapperOf('a.md'), { ...transfer, clientX: 0 });

      expect(props.onMove).toHaveBeenCalledExactlyOnceWith('tab-3', 0);
    });

    it('moves nothing when a tab is dropped back where it was', () => {
      const { props } = renderStrip();
      const transfer = createTransfer();

      fireEvent.dragStart(wrapperOf('b.md'), transfer);
      fireEvent.drop(wrapperOf('b.md'), { ...transfer, clientX: 5 });
      fireEvent.dragStart(wrapperOf('b.md'), transfer);
      fireEvent.drop(wrapperOf('c.md'), { ...transfer, clientX: 0 });

      expect(props.onMove).not.toHaveBeenCalled();
    });

    it('shows where the tab would go while it is over another one, and stops when it is let go', () => {
      renderStrip();
      const transfer = createTransfer();

      fireEvent.dragStart(wrapperOf('a.md'), transfer);
      expect(wrapperOf('a.md')).toHaveAttribute('data-dragging', 'true');

      fireEvent.dragOver(wrapperOf('c.md'), { ...transfer, clientX: 5 });
      expect(wrapperOf('c.md')).toHaveAttribute('data-drop', 'after');

      fireEvent.dragOver(wrapperOf('c.md'), { ...transfer, clientX: 0 });
      expect(wrapperOf('c.md')).toHaveAttribute('data-drop', 'before');

      fireEvent.dragEnd(wrapperOf('a.md'), transfer);
      expect(wrapperOf('c.md')).not.toHaveAttribute('data-drop');
      expect(wrapperOf('a.md')).toHaveAttribute('data-dragging', 'false');
    });

    describe('which half of a tab it is over', () => {
      /** A tab that is 80 wide and starts 100 from the left of the window, as jsdom has no layout. */
      function placed(name: string) {
        const wrapper = wrapperOf(name);
        wrapper.getBoundingClientRect = () =>
          ({ left: 100, width: 80, right: 180, top: 0, bottom: 30, height: 30 }) as DOMRect;
        return wrapper;
      }

      it.each([
        ['well inside the left half', 110, 'before'],
        ['just short of the middle', 139, 'before'],
        ['exactly in the middle', 140, 'before'],
        ['just past the middle', 141, 'after'],
        ['well inside the right half', 175, 'after'],
      ])('takes %s of a tab for the %s side of it', (_label, clientX, side) => {
        renderStrip();
        const transfer = createTransfer();
        fireEvent.dragStart(wrapperOf('a.md'), transfer);
        const target = placed('c.md');

        fireEvent.dragOver(target, { ...transfer, clientX });

        expect(target).toHaveAttribute('data-drop', side);
      });

      it.each([
        ['left', 120, 1],
        ['right', 170, 2],
      ])('drops a tab on the %s half of another where that half says', (_label, clientX, to) => {
        const { props } = renderStrip();
        const transfer = createTransfer();
        fireEvent.dragStart(wrapperOf('a.md'), transfer);

        fireEvent.drop(placed('c.md'), { ...transfer, clientX });

        expect(props.onMove).toHaveBeenCalledExactlyOnceWith('tab-1', to);
      });
    });

    it('clears what it shows when a tab is dropped, though the drag never reports that it ended', () => {
      renderStrip();
      const transfer = createTransfer();
      fireEvent.dragStart(wrapperOf('a.md'), transfer);
      fireEvent.dragOver(wrapperOf('c.md'), { ...transfer, clientX: 5 });
      expect(wrapperOf('c.md')).toHaveAttribute('data-drop', 'after');

      fireEvent.drop(wrapperOf('c.md'), { ...transfer, clientX: 5 });

      expect(wrapperOf('c.md')).not.toHaveAttribute('data-drop');
      expect(wrapperOf('a.md')).toHaveAttribute('data-dragging', 'false');
    });

    it('clears what it shows when something that is not one of the tabs is dropped', () => {
      renderStrip();
      const transfer = createTransfer();
      fireEvent.dragStart(wrapperOf('a.md'), transfer);
      fireEvent.dragOver(wrapperOf('c.md'), { ...transfer, clientX: 5 });
      const other = createTransfer();
      other.dataTransfer.setData(TAB_DRAG_TYPE, 'tab-999');

      fireEvent.drop(wrapperOf('c.md'), { ...other, clientX: 5 });

      expect(wrapperOf('c.md')).not.toHaveAttribute('data-drop');
      expect(wrapperOf('a.md')).toHaveAttribute('data-dragging', 'false');
    });

    it('does not mark the tab that is being dragged as a place to drop', () => {
      renderStrip();
      const transfer = createTransfer();

      fireEvent.dragStart(wrapperOf('a.md'), transfer);
      fireEvent.dragOver(wrapperOf('a.md'), { ...transfer, clientX: 5 });

      expect(wrapperOf('a.md')).not.toHaveAttribute('data-drop');
    });

    it('lets a tab be dropped on another by cancelling the drag over it', () => {
      renderStrip();
      const transfer = createTransfer();

      fireEvent.dragStart(wrapperOf('a.md'), transfer);
      const notPrevented = fireEvent.dragOver(wrapperOf('c.md'), transfer);

      expect(notPrevented).toBe(false);
    });

    it('leaves a drag of something else alone', () => {
      const { props } = renderStrip();
      const transfer = createTransfer();
      transfer.dataTransfer.setData('Files', '');

      const notPrevented = fireEvent.dragOver(wrapperOf('c.md'), { ...transfer, clientX: 5 });
      fireEvent.drop(wrapperOf('c.md'), { ...transfer, clientX: 5 });

      expect(notPrevented).toBe(true);
      expect(wrapperOf('c.md')).not.toHaveAttribute('data-drop');
      expect(props.onMove).not.toHaveBeenCalled();
    });

    it('ignores a dropped id that is not one of the tabs', () => {
      const { props } = renderStrip();
      const transfer = createTransfer();
      transfer.dataTransfer.setData(TAB_DRAG_TYPE, 'tab-999');

      fireEvent.drop(wrapperOf('c.md'), { ...transfer, clientX: 5 });

      expect(props.onMove).not.toHaveBeenCalled();
    });

    it('can be dragged', () => {
      renderStrip();
      expect(wrapperOf('a.md')).toHaveAttribute('draggable', 'true');
    });
  });
});
