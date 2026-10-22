import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/settings';
import { useSettings } from './useSettings';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  delete document.documentElement.dataset['theme'];
});

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

function createBridge(initial: Settings = { theme: 'system', zoom: 1 }) {
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
    const { result } = await renderLoaded(createBridge({ theme: 'dark', zoom: 1.5 }));
    expect(result.current.settings).toEqual({ theme: 'dark', zoom: 1.5 });
  });

  it('falls back to the defaults when the saved settings cannot be read', async () => {
    const bridge = createBridge();
    bridge.getSettings.mockRejectedValueOnce(new Error('unavailable'));

    const { result } = await renderLoaded(bridge);

    expect(result.current.settings).toEqual({ theme: 'system', zoom: 1 });
  });

  describe('theme', () => {
    it('marks the page with the resolved theme', async () => {
      mockSystemTheme(false);
      await renderLoaded(createBridge({ theme: 'dark', zoom: 1 }));
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
      const { result } = await renderLoaded(createBridge({ theme: 'dark', zoom: 1 }));

      act(() => {
        system.change(false);
      });

      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('toggles an explicit theme to the other one and saves it', async () => {
      mockSystemTheme(false);
      const { result, bridge } = await renderLoaded(createBridge({ theme: 'dark', zoom: 1 }));

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
      const { result, bridge } = await renderLoaded(createBridge({ theme: 'system', zoom: 2 }));

      act(() => {
        result.current.resetZoom();
      });

      expect(result.current.settings.zoom).toBe(1);
      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({ zoom: 1 });
    });

    it('does nothing at the largest and smallest zoom', async () => {
      const largest = await renderLoaded(createBridge({ theme: 'system', zoom: 3 }));
      act(() => {
        largest.result.current.zoomIn();
      });
      expect(largest.bridge.updateSettings).not.toHaveBeenCalled();

      const smallest = await renderLoaded(createBridge({ theme: 'system', zoom: 0.5 }));
      act(() => {
        smallest.result.current.zoomOut();
      });
      expect(smallest.bridge.updateSettings).not.toHaveBeenCalled();
    });
  });

  it('keeps the change on screen even if saving it fails', async () => {
    mockSystemTheme(false);
    const bridge = createBridge({ theme: 'dark', zoom: 1 });
    bridge.updateSettings.mockRejectedValue(new Error('disk full'));
    const { result } = await renderLoaded(bridge);

    act(() => {
      result.current.toggleTheme();
    });
    await Promise.resolve();

    expect(result.current.settings.theme).toBe('light');
  });
});
