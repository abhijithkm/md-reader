import { describe, expect, it } from 'vitest';
import { matchShortcut, type KeyInput } from './shortcuts';

function key(name: string, modifiers: Partial<KeyInput> = {}): KeyInput {
  return {
    key: name,
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...modifiers,
  };
}

describe('matchShortcut', () => {
  it.each([
    ['Ctrl+O', key('o', { ctrlKey: true }), 'open'],
    ['Ctrl+O with Caps Lock', key('O', { ctrlKey: true }), 'open'],
    ['Ctrl+= (the plus key without Shift)', key('=', { ctrlKey: true }), 'zoomIn'],
    ['Ctrl+Shift+= (plus)', key('+', { ctrlKey: true, shiftKey: true }), 'zoomIn'],
    ['Ctrl+numpad plus', key('+', { ctrlKey: true, code: 'NumpadAdd' }), 'zoomIn'],
    ['Ctrl+-', key('-', { ctrlKey: true }), 'zoomOut'],
    ['Ctrl+Shift+- (underscore)', key('_', { ctrlKey: true, shiftKey: true }), 'zoomOut'],
    ['Ctrl+numpad minus', key('-', { ctrlKey: true, code: 'NumpadSubtract' }), 'zoomOut'],
    ['Ctrl+0', key('0', { ctrlKey: true }), 'resetZoom'],
    ['Ctrl+W', key('w', { ctrlKey: true }), 'closeTab'],
    ['Ctrl+Shift+W', key('w', { ctrlKey: true, shiftKey: true }), 'closeWindow'],
    ['Ctrl+Tab', key('Tab', { ctrlKey: true }), 'nextTab'],
    ['Ctrl+Shift+Tab', key('Tab', { ctrlKey: true, shiftKey: true }), 'previousTab'],
    ['Ctrl+Page Down', key('PageDown', { ctrlKey: true }), 'nextTab'],
    ['Ctrl+Page Up', key('PageUp', { ctrlKey: true }), 'previousTab'],
    ['Ctrl+Shift+Page Down', key('PageDown', { ctrlKey: true, shiftKey: true }), 'moveTabRight'],
    ['Ctrl+Shift+Page Up', key('PageUp', { ctrlKey: true, shiftKey: true }), 'moveTabLeft'],
    ['F5', key('F5'), 'reload'],
    ['Ctrl+R', key('r', { ctrlKey: true }), 'reload'],
    ['Alt+Left', key('ArrowLeft', { altKey: true }), 'back'],
  ] as const)('%s', (_label, input, action) => {
    expect(matchShortcut(input)).toBe(action);
  });

  it.each([
    ['a plain letter', key('o')],
    ['Left arrow alone', key('ArrowLeft')],
    ['Ctrl+Shift+O', key('o', { ctrlKey: true, shiftKey: true })],
    ['Tab alone', key('Tab')],
    ['Alt+Tab', key('Tab', { altKey: true })],
    ['Ctrl+Alt+Tab', key('Tab', { ctrlKey: true, altKey: true })],
    ['Ctrl+Windows+Tab', key('Tab', { ctrlKey: true, metaKey: true })],
    ['Page Down alone', key('PageDown')],
    ['Alt+O', key('o', { altKey: true })],
    ['Ctrl+Alt+O (AltGr on many keyboards)', key('o', { ctrlKey: true, altKey: true })],
    ['Ctrl+Alt+Left', key('ArrowLeft', { ctrlKey: true, altKey: true })],
    ['the Windows key with O', key('o', { metaKey: true })],
    ['Ctrl+Windows+W', key('w', { ctrlKey: true, metaKey: true })],
    ['Ctrl+F', key('f', { ctrlKey: true })],
    ['Shift+F5', key('F5', { shiftKey: true })],
  ])('ignores %s', (_label, input) => {
    expect(matchShortcut(input)).toBeUndefined();
  });
});
