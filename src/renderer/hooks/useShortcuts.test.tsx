import { fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { useShortcuts, type ShortcutHandlers } from './useShortcuts';

function createHandlers(): { [K in keyof ShortcutHandlers]: Mock<() => void> } {
  return {
    open: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    close: vi.fn(),
    reload: vi.fn(),
    back: vi.fn(),
  };
}

describe('useShortcuts', () => {
  it.each([
    ['open', { key: 'o', ctrlKey: true }],
    ['zoomIn', { key: '=', ctrlKey: true }],
    ['zoomOut', { key: '-', ctrlKey: true }],
    ['resetZoom', { key: '0', ctrlKey: true }],
    ['close', { key: 'w', ctrlKey: true }],
    ['reload', { key: 'F5' }],
    ['back', { key: 'ArrowLeft', altKey: true }],
  ] as const)('runs %s and stops the browser handling the key', (action, init) => {
    const handlers = createHandlers();
    renderHook(() => {
      useShortcuts(handlers);
    });

    const notPrevented = fireEvent.keyDown(window, init);

    expect(handlers[action]).toHaveBeenCalledOnce();
    expect(notPrevented).toBe(false);
  });

  it('leaves other keys alone', () => {
    const handlers = createHandlers();
    renderHook(() => {
      useShortcuts(handlers);
    });

    const notPrevented = fireEvent.keyDown(window, { key: 'f', ctrlKey: true });

    expect(notPrevented).toBe(true);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('always calls the latest handlers', () => {
    const first = createHandlers();
    const second = createHandlers();
    const { rerender } = renderHook(
      ({ handlers }) => {
        useShortcuts(handlers);
      },
      { initialProps: { handlers: first } },
    );

    rerender({ handlers: second });
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });

    expect(first.open).not.toHaveBeenCalled();
    expect(second.open).toHaveBeenCalledOnce();
  });

  it('stops listening when the page goes away', () => {
    const handlers = createHandlers();
    const { unmount } = renderHook(() => {
      useShortcuts(handlers);
    });

    unmount();
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });

    expect(handlers.open).not.toHaveBeenCalled();
  });
});
