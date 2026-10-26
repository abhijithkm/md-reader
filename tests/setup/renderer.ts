import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// findBy* and waitFor give up after one second by default. Rendering Markdown in jsdom on a busy
// or slow machine (a shared CI runner) can take longer, so allow more time before failing.
// Passing tests are not slower for it.
configure({ asyncUtilTimeout: 5000 });

// jsdom does not implement matchMedia; the theme code asks for the OS preference.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }),
  });
}

// jsdom has no DragEvent. It is a mouse event that carries a data transfer, which is all that tests
// of dragging need, and without it a drag event built by the testing library has no pointer position.
if (typeof window !== 'undefined' && typeof window.DragEvent !== 'function') {
  class DragEventStandIn extends MouseEvent {
    readonly dataTransfer: DataTransfer | null;

    constructor(type: string, init: DragEventInit = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer ?? null;
    }
  }
  Object.defineProperty(window, 'DragEvent', {
    writable: true,
    configurable: true,
    value: DragEventStandIn,
  });
}

// jsdom does not implement scrollIntoView.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = vi.fn();
}
