import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MdReaderApi } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import { fileNameOf } from '../shared/tabs';
import type { UpdateState } from '../shared/updates';
import { DocumentView, type DocumentStats } from './components/DocumentView';
import { DropOverlay } from './components/DropOverlay';
import { EmptyState } from './components/EmptyState';
import { NoticeBar } from './components/NoticeBar';
import { StatusBar } from './components/StatusBar';
import { TAB_PANEL_ID, TabStrip, tabButtonId } from './components/TabStrip';
import { TabUnavailable } from './components/TabUnavailable';
import { Toolbar } from './components/Toolbar';
import { UpdateNotice, type UpdateNoticeContent } from './components/UpdateNotice';
import { useDropTarget } from './hooks/useDropTarget';
import { useSettings } from './hooks/useSettings';
import { useShortcuts } from './hooks/useShortcuts';
import { useUpdates } from './hooks/useUpdates';
import { useWorkspace } from './hooks/useWorkspace';
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
  const workspace = useWorkspace(bridge, { getScrollTop });
  const { document: current, activeTab, tabs, activeId, problem } = workspace;
  const { openFile, openDropped, openLink, reload, goBack, report } = workspace;

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

  // The window is named after the tab on screen, also while its document is still being read.
  const activeName = activeTab === undefined ? undefined : fileNameOf(activeTab.path);
  const title = activeName === undefined ? 'MD Reader' : `${activeName} — MD Reader`;
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
      openLocal: (fileUrl, options) => {
        void openLink(fileUrl, options);
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
    (files: File[]) => {
      void openDropped(files);
    },
    [openDropped],
  );
  const { dragging } = useDropTarget(handleDrop);

  /** F5 reads the document again, or, for a tab whose file could not be read, tries once more. */
  const refresh = (): void => {
    if (current !== undefined) void reload();
    else if (problem !== undefined) workspace.retry();
  };

  useShortcuts({
    open: () => {
      void openFile();
    },
    zoomIn: settings.zoomIn,
    zoomOut: settings.zoomOut,
    resetZoom: settings.resetZoom,
    closeTab: () => {
      if (activeId !== undefined) workspace.closeTab(activeId);
      // The last tab goes with the window, as in a text editor; with none open only the window is left.
      if (tabs.length <= 1) void bridge.closeWindow();
    },
    closeWindow: () => {
      void bridge.closeWindow();
    },
    reload: refresh,
    back: () => {
      void goBack();
    },
    nextTab: workspace.nextTab,
    previousTab: workspace.previousTab,
    moveTabLeft: () => {
      workspace.moveActiveTab(-1);
    },
    moveTabRight: () => {
      workspace.moveActiveTab(1);
    },
  });

  // Wait for the saved theme and the open tabs before painting anything, so that a dark theme never
  // flashes light and the start page never flashes before the tabs of the last run.
  if (!settings.loaded || !workspace.ready) return null;

  let content: ReactNode = null;
  if (current !== undefined) {
    content = (
      <DocumentView
        document={current}
        zoom={settings.settings.zoom}
        scrollRequest={workspace.scrollRequest}
        scrollRef={scrollRef}
        actions={actions}
        onStats={handleStats}
        onZoomStep={(direction) => {
          if (direction === 'in') settings.zoomIn();
          else settings.zoomOut();
        }}
        onScrollTop={workspace.noteScrolled}
      />
    );
  } else if (activeTab === undefined) {
    content = (
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
    );
  } else if (problem !== undefined) {
    content = (
      <TabUnavailable
        name={fileNameOf(activeTab.path)}
        message={problem}
        onRetry={workspace.retry}
        onClose={() => {
          workspace.closeTab(activeTab.id);
        }}
      />
    );
  }

  return (
    <div className="app">
      <Toolbar
        fileName={activeName}
        filePath={activeTab?.path}
        zoom={settings.settings.zoom}
        theme={settings.resolvedTheme}
        canGoBack={workspace.canGoBack}
        canReload={current !== undefined || problem !== undefined}
        onOpen={() => {
          void openFile();
        }}
        onBack={() => {
          void goBack();
        }}
        onReload={refresh}
        onToggleTheme={settings.toggleTheme}
        onZoomIn={settings.zoomIn}
        onZoomOut={settings.zoomOut}
        onResetZoom={settings.resetZoom}
        restoreTabs={settings.settings.restoreTabs}
        onSetRestoreTabs={settings.setRestoreTabs}
      />
      {tabs.length > 0 && (
        <TabStrip
          tabs={tabs}
          activeId={activeId}
          onActivate={workspace.activateTab}
          onClose={workspace.closeTab}
          onMove={workspace.moveTab}
          onNew={() => {
            void openFile();
          }}
        />
      )}
      <NoticeBar notice={workspace.notice} onDismiss={workspace.dismissNotice} />
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
      <main className="app-main" aria-busy={workspace.loading}>
        {activeTab === undefined ? (
          content
        ) : (
          <div
            className="tab-panel"
            role="tabpanel"
            id={TAB_PANEL_ID}
            aria-labelledby={tabButtonId(activeTab.id)}
          >
            {content}
          </div>
        )}
      </main>
      <StatusBar
        {...(current !== undefined
          ? { name: current.name, path: current.path, sizeBytes: current.sizeBytes }
          : activeTab !== undefined && activeName !== undefined
            ? { name: activeName, path: activeTab.path }
            : {})}
        {...(stats === undefined ? {} : { stats })}
      />
      {dragging && <DropOverlay />}
    </div>
  );
}
