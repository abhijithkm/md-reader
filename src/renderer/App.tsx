import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MdReaderApi } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import type { UpdateState } from '../shared/updates';
import { DocumentView, type DocumentStats } from './components/DocumentView';
import { DropOverlay } from './components/DropOverlay';
import { EmptyState } from './components/EmptyState';
import { NoticeBar } from './components/NoticeBar';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { UpdateNotice, type UpdateNoticeContent } from './components/UpdateNotice';
import { useDocument } from './hooks/useDocument';
import { useDropTarget } from './hooks/useDropTarget';
import { useSettings } from './hooks/useSettings';
import { useShortcuts } from './hooks/useShortcuts';
import { useUpdates } from './hooks/useUpdates';
import type { LinkActions } from './markdown/MarkdownRenderer';

const LINK_FAILED = 'That link could not be opened.';
const SETTINGS_FAILED = 'Windows Settings could not be opened.';

interface ChosenUpdateNotice {
  /** Changes with the message, so a dismissed message stays away only until the next one. */
  key: string;
  content: UpdateNoticeContent;
}

/**
 * Which message about updating to show, if any: the explanation until it has been read, then a
 * downloaded update, then a newer version that this copy cannot install itself.
 */
function chooseUpdateNotice(
  state: UpdateState | undefined,
  settings: Settings,
  dismissed: string | undefined,
  installs: boolean | undefined,
): ChosenUpdateNotice | undefined {
  if (state === undefined || state.status === 'unavailable') return undefined;
  if (!settings.updateNoticeSeen && settings.automaticUpdates) {
    // What this copy does with a new version is part of the explanation, so wait until it is known
    // rather than say something that may be wrong.
    return installs === undefined
      ? undefined
      : { key: 'intro', content: { kind: 'intro', installs } };
  }
  if (state.status === 'ready' || state.status === 'available') {
    const key = `${state.status}:${state.version}`;
    if (key === dismissed) return undefined;
    return { key, content: { kind: state.status, version: state.version } };
  }
  return undefined;
}

interface CountedStats {
  /** Identifies the document the numbers belong to, so stale numbers are never shown. */
  key: string;
  value: DocumentStats;
}

export function App({ bridge }: { bridge: MdReaderApi }) {
  const settings = useSettings(bridge);
  const updates = useUpdates(bridge);
  const [dismissedUpdate, setDismissedUpdate] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLElement | null>(null);
  const getScrollTop = useCallback(() => scrollRef.current?.scrollTop ?? 0, []);
  const documents = useDocument(bridge, { getScrollTop });
  const { document: current, openFile, openDropped, openLink, reload, goBack, report } = documents;

  // Word and line counts arrive after rendering; show them only for the document they describe.
  const [counted, setCounted] = useState<CountedStats | undefined>(undefined);
  const statsKey =
    current === undefined
      ? undefined
      : `${current.path}|${current.modifiedMs}|${current.sizeBytes}`;
  const handleStats = useCallback(
    (value: DocumentStats) => {
      if (statsKey !== undefined) setCounted({ key: statsKey, value });
    },
    [statsKey],
  );
  const stats = counted !== undefined && counted.key === statsKey ? counted.value : undefined;

  const title = current === undefined ? 'MD Reader' : `${current.name} — MD Reader`;
  useEffect(() => {
    window.document.title = title;
  }, [title]);

  const actions = useMemo<LinkActions>(
    () => ({
      openExternal: (url) => {
        bridge.openExternal(url).then(
          (opened) => {
            if (!opened) report(LINK_FAILED);
          },
          () => {
            report(LINK_FAILED);
          },
        );
      },
      openLocal: (fileUrl) => {
        void openLink(fileUrl);
      },
    }),
    [bridge, openLink, report],
  );

  const updateNotice = chooseUpdateNotice(
    updates.state,
    settings.settings,
    dismissedUpdate,
    updates.installsUpdates,
  );
  const updatesPanel =
    updates.state === undefined || updates.state.status === 'unavailable'
      ? undefined
      : {
          state: updates.state,
          version: updates.version,
          installs: updates.installsUpdates ?? true,
          onCheck: updates.checkNow,
          onSetEnabled: settings.setAutomaticUpdates,
          onRestart: updates.restartNow,
          onOpenPage: actions.openExternal,
        };

  const handleDrop = useCallback(
    (file: File) => {
      void openDropped(file);
    },
    [openDropped],
  );
  const { dragging } = useDropTarget(handleDrop);

  useShortcuts({
    open: () => {
      void openFile();
    },
    zoomIn: settings.zoomIn,
    zoomOut: settings.zoomOut,
    resetZoom: settings.resetZoom,
    close: () => {
      void bridge.closeWindow();
    },
    reload: () => {
      if (current !== undefined) void reload();
    },
    back: () => {
      void goBack();
    },
  });

  // Wait for the saved theme before painting anything, so a dark theme never flashes light.
  if (!settings.loaded) return null;

  return (
    <div className="app">
      <Toolbar
        fileName={current?.name}
        filePath={current?.path}
        zoom={settings.settings.zoom}
        theme={settings.resolvedTheme}
        canGoBack={documents.canGoBack}
        canReload={current !== undefined}
        onOpen={() => {
          void openFile();
        }}
        onBack={() => {
          void goBack();
        }}
        onReload={() => {
          void reload();
        }}
        onToggleTheme={settings.toggleTheme}
        onZoomIn={settings.zoomIn}
        onZoomOut={settings.zoomOut}
        onResetZoom={settings.resetZoom}
      />
      <NoticeBar notice={documents.notice} onDismiss={documents.dismissNotice} />
      {updateNotice !== undefined && (
        <UpdateNotice
          key={updateNotice.key}
          notice={updateNotice.content}
          onKeepOn={() => {
            settings.dismissUpdateNotice(false);
          }}
          onTurnOff={() => {
            settings.dismissUpdateNotice(true);
          }}
          onRestart={updates.restartNow}
          onOpenPage={() => {
            if (updates.state?.status === 'available')
              actions.openExternal(updates.state.releaseUrl);
          }}
          onDismiss={() => {
            setDismissedUpdate(updateNotice.key);
          }}
        />
      )}
      <main className="app-main" aria-busy={documents.loading}>
        {current === undefined ? (
          <EmptyState
            onOpen={() => {
              void openFile();
            }}
            onOpenDefaultApps={() => {
              bridge.openDefaultAppsSettings().catch(() => {
                report(SETTINGS_FAILED);
              });
            }}
            {...(updatesPanel === undefined ? {} : { updates: updatesPanel })}
          />
        ) : (
          <DocumentView
            document={current}
            zoom={settings.settings.zoom}
            scrollRequest={documents.scrollRequest}
            scrollRef={scrollRef}
            actions={actions}
            onStats={handleStats}
            onZoomStep={(direction) => {
              if (direction === 'in') settings.zoomIn();
              else settings.zoomOut();
            }}
          />
        )}
      </main>
      <StatusBar
        {...(current === undefined
          ? {}
          : { name: current.name, path: current.path, sizeBytes: current.sizeBytes })}
        {...(stats === undefined ? {} : { stats })}
      />
      {dragging && <DropOverlay />}
    </div>
  );
}
