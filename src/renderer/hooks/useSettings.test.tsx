import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/settings';
import { useSettings } from './useSettings';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  delete document.documentElement.dataset['theme'];
});

const DEFAULTS: Settings = {
  theme: 'system',
  zoom: 1,
  automaticUpdates: true,
  updateNoticeSeen: false,
  restoreTabs: true,
};

/** Controls what the operating system reports for prefers-color-scheme. */
function mockSystemTheme(dark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
  };
  window.matchMedia = vi.fn(() => query as unknown as MediaQueryList);
  return {
    change(next: boolean) {
      query.matches = next;
      listeners.forEach((listener) => {
        listener({ matches: next });
      });
    },
  };
}

function createBridge(initial: Settings = DEFAULTS) {
  return {
    getSettings: vi.fn(() => Promise.resolve(initial)),
    updateSettings: vi.fn((patch: Partial<Settings>) => Promise.resolve({ ...initial, ...patch })),
  };
}

async function renderLoaded(bridge = createBridge()) {
  const view = renderHook(() => useSettings(bridge));
  await waitFor(() => {
    expect(view.result.current.loaded).toBe(true);
  });
  return { ...view, bridge };
}

describe('useSettings', () => {
  it('starts from the settings the app saved last time', async () => {
    const { result } = await renderLoaded(createBridge({ ...DEFAULTS, theme: 'dark', zoom: 1.5 }));
    expect(result.current.settings).toEqual({ ...DEFAULTS, theme: 'dark', zoom: 1.5 });
  });

  it('falls back to the defaults when the saved settings cannot be read', async () => {
    const bridge = createBridge();
    bridge.getSettings.mockRejectedValueOnce(new Error('unavailable'));

    const { result } = await renderLoaded(bridge);

    expect(result.current.settings).toEqual(DEFAULTS);
  });

  describe('theme', () => {
    it('marks the page with the resolved theme', async () => {
      mockSystemTheme(false);
      await renderLoaded(createBridge({ ...DEFAULTS, theme: 'dark' }));
      expect(document.documentElement.dataset['theme']).toBe('dark');
    });

    it('follows the operating system while the preference is "system"', async () => {
      const system = mockSystemTheme(true);
      const { result } = await renderLoaded();
      expect(result.current.resolvedTheme).toBe('dark');
      expect(document.documentElement.dataset['theme']).toBe('dark');

      act(() => {
        system.change(false);
      });

      expect(result.current.resolvedTheme).toBe('light');
      expect(document.documentElement.dataset['theme']).toBe('light');
    });

    it('ignores operating system changes once a theme was chosen', async () => {
      const system = mockSystemTheme(true);
      const { result } = await renderLoaded(createBridge({ ...DEFAULTS, theme: 'dark' }));

      act(() => {
        system.change(false);
      });

      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('toggles an explicit theme to the other one and saves it', async () => {
      mockSystemTheme(false);
      const { result, bridge } = await renderLoaded(createBridge({ ...DEFAULTS, theme: 'dark' }));

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.settings.theme).toBe('light');
      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({ theme: 'light' });
    });

    it('toggles away from what the operating system currently shows', async () => {
      mockSystemTheme(true);
      const { result, bridge } = await renderLoaded();

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.resolvedTheme).toBe('light');
      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({ theme: 'light' });
    });
  });

  describe('zoom', () => {
    it('steps up and down through the zoom levels and saves each step', async () => {
      const { result, bridge } = await renderLoaded();

      act(() => {
        result.current.zoomIn();
      });
      expect(result.current.settings.zoom).toBe(1.1);

      act(() => {
        result.current.zoomIn();
      });
      expect(result.current.settings.zoom).toBe(1.25);

      act(() => {
        result.current.zoomOut();
      });
      expect(result.current.settings.zoom).toBe(1.1);

      expect(bridge.updateSettings.mock.calls).toEqual([
        [{ zoom: 1.1 }],
        [{ zoom: 1.25 }],
        [{ zoom: 1.1 }],
      ]);
    });

    it('resets to 100%', async () => {
      const { result, bridge } = await renderLoaded(createBridge({ ...DEFAULTS, zoom: 2 }));

      act(() => {
        result.current.resetZoom();
      });

      expect(result.current.settings.zoom).toBe(1);
      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({ zoom: 1 });
    });

    it('does nothing at the largest and smallest zoom', async () => {
      const largest = await renderLoaded(createBridge({ ...DEFAULTS, zoom: 3 }));
      act(() => {
        largest.result.current.zoomIn();
      });
      expect(largest.bridge.updateSettings).not.toHaveBeenCalled();

      const smallest = await renderLoaded(createBridge({ ...DEFAULTS, zoom: 0.5 }));
      act(() => {
        smallest.result.current.zoomOut();
      });
      expect(smallest.bridge.updateSettings).not.toHaveBeenCalled();
    });
  });

  describe('automatic updates', () => {
    it('are on until the user switches them off', async () => {
      const { result } = await renderLoaded();
      expect(result.current.settings.automaticUpdates).toBe(true);
    });

    it('switch off and on again, and each choice is saved', async () => {
      const { result, bridge } = await renderLoaded();

      act(() => {
        result.current.setAutomaticUpdates(false);
      });
      expect(result.current.settings.automaticUpdates).toBe(false);

      act(() => {
        result.current.setAutomaticUpdates(true);
      });
      expect(result.current.settings.automaticUpdates).toBe(true);

      expect(bridge.updateSettings.mock.calls).toEqual([
        [{ automaticUpdates: false }],
        [{ automaticUpdates: true }],
      ]);
    });

    it('remember that the explanation was read', async () => {
      const { result, bridge } = await renderLoaded();

      act(() => {
        result.current.dismissUpdateNotice(false);
      });

      expect(result.current.settings.updateNoticeSeen).toBe(true);
      expect(result.current.settings.automaticUpdates).toBe(true);
      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({ updateNoticeSeen: true });
    });

    it('switch off in the same step when the user declines the explanation', async () => {
      const { result, bridge } = await renderLoaded();

      act(() => {
        result.current.dismissUpdateNotice(true);
      });

      expect(result.current.settings.updateNoticeSeen).toBe(true);
      expect(result.current.settings.automaticUpdates).toBe(false);
      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({
        automaticUpdates: false,
        updateNoticeSeen: true,
      });
    });
  });

  describe('reopening the tabs', () => {
    it('is on until the user switches it off', async () => {
      const { result } = await renderLoaded();
      expect(result.current.settings.restoreTabs).toBe(true);
    });

    it('switches off and on again, and each choice is saved', async () => {
      const { result, bridge } = await renderLoaded();

      act(() => {
        result.current.setRestoreTabs(false);
      });
      expect(result.current.settings.restoreTabs).toBe(false);

      act(() => {
        result.current.setRestoreTabs(true);
      });
      expect(result.current.settings.restoreTabs).toBe(true);

      expect(bridge.updateSettings.mock.calls).toEqual([
        [{ restoreTabs: false }],
        [{ restoreTabs: true }],
      ]);
    });
  });

  it('keeps the change on screen even if saving it fails', async () => {
    mockSystemTheme(false);
    const bridge = createBridge({ ...DEFAULTS, theme: 'dark' });
    bridge.updateSettings.mockRejectedValue(new Error('disk full'));
    const { result } = await renderLoaded(bridge);

    act(() => {
      result.current.toggleTheme();
    });
    await Promise.resolve();

    expect(result.current.settings.theme).toBe('light');
  });
});
