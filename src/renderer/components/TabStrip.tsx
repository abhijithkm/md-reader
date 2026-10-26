import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { TabInfo } from '../../shared/tabs';
import { dropIndex, labelTabs } from '../tab-labels';

/** The one panel that the tabs control: its content is whatever the tab on screen shows. */
export const TAB_PANEL_ID = 'document-panel';

/** What a tab carries while it is dragged along the row. */
export const TAB_DRAG_TYPE = 'application/x-mdreader-tab';

/** The id of the button that is the tab itself, for the panel to name itself after. */
export const tabButtonId = (tabId: string): string => `${tabId}-button`;

export interface TabStripProps {
  tabs: readonly TabInfo[];
  activeId: string | undefined;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
  /** The plus button: choose files to open, each in a tab of its own. */
  onNew: () => void;
}

interface DropMark {
  id: string;
  after: boolean;
}

const ICON = { size: 14, strokeWidth: 2 } as const;

/** Whether the pointer is over the right half of the element, which is where a dragged tab goes after it. */
function overRightHalf(event: { clientX: number; currentTarget: Element }): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX > box.left + box.width / 2;
}

/**
 * The row of tabs, one for each open document. It follows the tab pattern for assistive technology:
 * one stop in the tab order, the arrow keys to move between tabs, and Delete to close one. A tab can
 * also be closed with the middle button or its cross, and dragged to another place in the row.
 */
export function TabStrip({ tabs, activeId, onActivate, onClose, onMove, onNew }: TabStripProps) {
  const labels = labelTabs(tabs);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [dragged, setDragged] = useState<string | undefined>(undefined);
  const [mark, setMark] = useState<DropMark | undefined>(undefined);

  // The row can be longer than the window, so the tab on screen is brought into view: when it
  // changes, when a tab opens or closes before it, and when it is moved along the row.
  const activeIndex = tabs.findIndex((tab) => tab.id === activeId);
  useEffect(() => {
    if (activeId === undefined) return;
    buttons.current.get(activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, activeIndex, tabs.length]);

  const goTo = (index: number): void => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (tab === undefined) return;
    buttons.current.get(tab.id)?.focus();
    onActivate(tab.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    // Alt+Left is Back and Ctrl+Arrow belongs to the document: only the plain keys are ours.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    switch (event.key) {
      case 'ArrowRight':
        goTo(index + 1);
        break;
      case 'ArrowLeft':
        goTo(index - 1);
        break;
      case 'Home':
        goTo(0);
        break;
      case 'End':
        goTo(tabs.length - 1);
        break;
      case 'Delete': {
        const id = tabs[index]?.id;
        if (id === undefined) return;
        // The tab that is closed is about to go, so the focus moves to the one next to it.
        const neighbour = tabs[index + 1] ?? tabs[index - 1];
        if (neighbour !== undefined) buttons.current.get(neighbour.id)?.focus();
        onClose(id);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  const endDrag = (): void => {
    setDragged(undefined);
    setMark(undefined);
  };

  return (
    <div className="tab-strip">
      <div
        className="tab-list"
        role="tablist"
        aria-label="Open documents"
        onWheel={(event) => {
          // A mouse wheel only turns up and down; in a row that is wider than the window it also
          // moves the row.
          const row = event.currentTarget;
          if (event.deltaY !== 0 && row.scrollWidth > row.clientWidth)
            row.scrollLeft += event.deltaY;
        }}
      >
        {labels.map((label, index) => {
          const active = label.id === activeId;
          const reachable = active || (activeId === undefined && index === 0);
          return (
            <div
              key={label.id}
              role="presentation"
              className="tab"
              data-active={active}
              data-dragging={dragged === label.id}
              data-drop={
                mark?.id === label.id && dragged !== label.id
                  ? mark.after
                    ? 'after'
                    : 'before'
                  : undefined
              }
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(TAB_DRAG_TYPE, label.id);
                event.dataTransfer.effectAllowed = 'move';
                setDragged(label.id);
              }}
              onDragEnd={endDrag}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                const after = overRightHalf(event);
                setMark((current) =>
                  current?.id === label.id && current.after === after
                    ? current
                    : { id: label.id, after },
                );
              }}
              onDrop={(event) => {
                // The id comes from the page, so it only counts if it is one of the tabs.
                const from = tabs.findIndex(
                  (tab) => tab.id === event.dataTransfer.getData(TAB_DRAG_TYPE),
                );
                const after = overRightHalf(event);
                endDrag();
                const moved = tabs[from];
                if (moved === undefined) return;
                event.preventDefault();
                const to = dropIndex(from, index, after);
                if (to !== from) onMove(moved.id, to);
              }}
            >
              <button
                ref={(element) => {
                  if (element === null) buttons.current.delete(label.id);
                  else buttons.current.set(label.id, element);
                }}
                type="button"
                role="tab"
                id={tabButtonId(label.id)}
                className="tab-label"
                aria-selected={active}
                aria-controls={active ? TAB_PANEL_ID : undefined}
                tabIndex={reachable ? 0 : -1}
                title={label.path}
                onClick={() => {
                  onActivate(label.id);
                }}
                onKeyDown={(event) => {
                  handleKeyDown(event, index);
                }}
                onMouseDown={(event: MouseEvent) => {
                  // The middle button would start scrolling the page; here it closes the tab.
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1) return;
                  event.preventDefault();
                  onClose(label.id);
                }}
              >
                <span className="tab-name">{label.name}</span>
                {label.folder !== undefined && <span className="tab-folder">{label.folder}</span>}
              </button>
              <button
                type="button"
                className="tab-close"
                tabIndex={-1}
                aria-label={`Close ${label.name}${label.folder === undefined ? '' : ` in ${label.folder}`}`}
                title="Close tab (Ctrl+W)"
                onClick={() => {
                  onClose(label.id);
                }}
              >
                <X {...ICON} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="icon-button tab-new"
        aria-label="Open files"
        title="Open files (Ctrl+O)"
        onClick={onNew}
      >
        <Plus size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
