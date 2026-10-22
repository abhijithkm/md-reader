import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MdReaderApi } from '../shared/ipc';
import { DocumentView, type DocumentStats } from './components/DocumentView';
import { DropOverlay } from './components/DropOverlay';
import { EmptyState } from './components/EmptyState';
import { NoticeBar } from './components/NoticeBar';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { useDocument } from './hooks/useDocument';
import { useDropTarget } from './hooks/useDropTarget';
import { useSettings } from './hooks/useSettings';
import { useShortcuts } from './hooks/useShortcuts';
import type { LinkActions } from './markdown/MarkdownRenderer';

const LINK_FAILED = 'That link could not be opened.';
const SETTINGS_FAILED = 'Windows Settings could not be opened.';

interface CountedStats {
  /** Identifies the document the numbers belong to, so stale numbers are never shown. */
  key: string;
  value: DocumentStats;
}

export function App({ bridge }: { bridge: MdReaderApi }) {
  const settings = useSettings(bridge);
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
