import { useCallback, useEffect, useRef, useState } from 'react';
import type { MdReaderApi } from '../../shared/ipc';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { resolveTheme, type ResolvedTheme } from '../../shared/theme';
import { DEFAULT_ZOOM, nextZoom } from '../../shared/zoom';

export interface SettingsController {
  /** False until the saved settings have been read; the page waits to avoid a theme flash. */
  loaded: boolean;
  settings: Settings;
  resolvedTheme: ResolvedTheme;
  toggleTheme: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  /** Switches the background check for new versions on or off. */
  setAutomaticUpdates: (enabled: boolean) => void;
  /** Remembers that the one-time explanation of updates was read; `turnOff` also switches them off. */
  dismissUpdateNotice: (turnOff: boolean) => void;
  /** Whether the tabs that are open come back the next time the app starts. */
  setRestoreTabs: (enabled: boolean) => void;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function useSystemPrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: { matches: boolean }): void => {
      setDark(event.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  return dark;
}

/**
 * Theme and zoom. Changes apply immediately and are saved in the background;
 * if saving fails the change simply lasts for this session.
 */
export function useSettings(
  bridge: Pick<MdReaderApi, 'getSettings' | 'updateSettings'>,
): SettingsController {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [loaded, setLoaded] = useState(false);
  const systemPrefersDark = useSystemPrefersDark();
  const latest = useRef(settings);

  useEffect(() => {
    let cancelled = false;
    bridge.getSettings().then(
      (saved) => {
        if (cancelled) return;
        latest.current = saved;
        setSettings(saved);
        setLoaded(true);
      },
      () => {
        if (!cancelled) setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const resolvedTheme = resolveTheme(settings.theme, systemPrefersDark);
  useEffect(() => {
    document.documentElement.dataset['theme'] = resolvedTheme;
  }, [resolvedTheme]);

  const update = useCallback(
    (patch: Partial<Settings>): void => {
      latest.current = { ...latest.current, ...patch };
      setSettings(latest.current);
      bridge.updateSettings(patch).catch(() => undefined);
    },
    [bridge],
  );

  const toggleTheme = useCallback((): void => {
    update({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' });
  }, [update, resolvedTheme]);

  const zoomBy = useCallback(
    (direction: 'in' | 'out'): void => {
      const next = nextZoom(latest.current.zoom, direction);
      if (next !== latest.current.zoom) update({ zoom: next });
    },
    [update],
  );
  const zoomIn = useCallback(() => {
    zoomBy('in');
  }, [zoomBy]);
  const zoomOut = useCallback(() => {
    zoomBy('out');
  }, [zoomBy]);
  const resetZoom = useCallback((): void => {
    if (latest.current.zoom !== DEFAULT_ZOOM) update({ zoom: DEFAULT_ZOOM });
  }, [update]);

  const setAutomaticUpdates = useCallback(
    (enabled: boolean): void => {
      update({ automaticUpdates: enabled });
    },
    [update],
  );
  const dismissUpdateNotice = useCallback(
    (turnOff: boolean): void => {
      update(
        turnOff ? { automaticUpdates: false, updateNoticeSeen: true } : { updateNoticeSeen: true },
      );
    },
    [update],
  );

  const setRestoreTabs = useCallback(
    (enabled: boolean): void => {
      update({ restoreTabs: enabled });
    },
    [update],
  );

  return {
    loaded,
    settings,
    resolvedTheme,
    toggleTheme,
    zoomIn,
    zoomOut,
    resetZoom,
    setAutomaticUpdates,
    dismissUpdateNotice,
    setRestoreTabs,
  };
}
