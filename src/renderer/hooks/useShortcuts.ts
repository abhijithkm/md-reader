import { useEffect, useRef } from 'react';
import { matchShortcut, type ShortcutAction } from '../shortcuts';

export type ShortcutHandlers = Record<ShortcutAction, () => void>;

/**
 * Keyboard shortcuts for the whole window. The app has no menu bar, so the page
 * handles them itself, and claims the keys so Chromium's own behaviour (such as
 * zooming the whole interface) does not also run.
 */
export function useShortcuts(handlers: ShortcutHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = matchShortcut(event);
      if (action === undefined) return;
      event.preventDefault();
      latest.current[action]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
