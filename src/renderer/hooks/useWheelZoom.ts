import { useEffect, useRef, type RefObject } from 'react';

// A mouse wheel notch reports about 100; a touchpad pinch sends many tiny values.
const STEP_THRESHOLD = 50;

/**
 * Ctrl + mouse wheel zooms the document. The listener must be non-passive so it
 * can cancel the event; otherwise Chromium would also try to zoom the page.
 */
export function useWheelZoom(
  ref: RefObject<HTMLElement | null>,
  onStep: (direction: 'in' | 'out') => void,
): void {
  const latest = useRef(onStep);
  useEffect(() => {
    latest.current = onStep;
  });

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    let accumulated = 0;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return;
      event.preventDefault();

      accumulated += event.deltaY;
      if (Math.abs(accumulated) < STEP_THRESHOLD) return;
      latest.current(accumulated < 0 ? 'in' : 'out');
      accumulated = 0;
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, [ref]);
}
