export type ShortcutAction =
  'open' | 'zoomIn' | 'zoomOut' | 'resetZoom' | 'close' | 'reload' | 'back';

/** The parts of a keyboard event the shortcuts depend on. */
export interface KeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * Maps a key press to an app action, or undefined when the key is not ours.
 *
 * Deliberately strict about modifiers: on Windows AltGr is reported as
 * Ctrl+Alt and is used to type characters, and combinations that add Shift or
 * the Windows key belong to the system or to other programs.
 */
export function matchShortcut(input: KeyInput): ShortcutAction | undefined {
  const { key, ctrlKey, altKey, shiftKey, metaKey } = input;
  if (metaKey) return undefined;

  if (altKey) {
    return !ctrlKey && !shiftKey && key === 'ArrowLeft' ? 'back' : undefined;
  }
  if (!ctrlKey) {
    return key === 'F5' && !shiftKey ? 'reload' : undefined;
  }

  switch (key.toLowerCase()) {
    case 'o':
      return shiftKey ? undefined : 'open';
    case 'w':
      return shiftKey ? undefined : 'close';
    case 'r':
      return shiftKey ? undefined : 'reload';
    case '0':
      return shiftKey ? undefined : 'resetZoom';
    // "+" is Shift+"=" on many keyboards, so Shift is allowed for the zoom keys.
    case '=':
    case '+':
      return 'zoomIn';
    case '-':
    case '_':
      return 'zoomOut';
    default:
      return undefined;
  }
}
