export type ShortcutAction =
  | 'open'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'closeTab'
  | 'closeWindow'
  | 'reload'
  | 'back'
  | 'nextTab'
  | 'previousTab'
  | 'moveTabLeft'
  | 'moveTabRight';

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
    // Ctrl+W closes the tab, as in a browser; with Shift it closes the window.
    case 'w':
      return shiftKey ? 'closeWindow' : 'closeTab';
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
    // Through the tabs, and with Shift the other way round. Page Up and Page Down do the same, and
    // with Shift they carry the tab along instead.
    case 'tab':
      return shiftKey ? 'previousTab' : 'nextTab';
    case 'pagedown':
      return shiftKey ? 'moveTabRight' : 'nextTab';
    case 'pageup':
      return shiftKey ? 'moveTabLeft' : 'previousTab';
    default:
      return undefined;
  }
}
