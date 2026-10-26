import { ArrowLeft, FolderOpen, Minus, Moon, Plus, RefreshCw, RotateCcw, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ResolvedTheme } from '../../shared/theme';
import { DEFAULT_ZOOM, formatZoom, MAX_ZOOM, MIN_ZOOM } from '../../shared/zoom';

export interface ToolbarProps {
  fileName: string | undefined;
  filePath: string | undefined;
  zoom: number;
  theme: ResolvedTheme;
  canGoBack: boolean;
  canReload: boolean;
  onOpen: () => void;
  onBack: () => void;
  onReload: () => void;
  onToggleTheme: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

const EPSILON = 1e-6;
const ICON = { size: 18, strokeWidth: 1.75 } as const;

/** The name of the folder that holds the file, which tells apart documents that share a name. */
function folderName(filePath: string | undefined): string | undefined {
  if (filePath === undefined) return undefined;
  return filePath
    .split(/[\\/]/)
    .filter((part) => part !== '')
    .at(-2);
}

interface IconButtonProps {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** An icon-only button. The label names it for assistive technology; the tooltip adds the shortcut. */
function IconButton({ label, shortcut, disabled = false, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={shortcut === undefined ? label : `${label} (${shortcut})`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Toolbar({
  fileName,
  filePath,
  zoom,
  theme,
  canGoBack,
  canReload,
  onOpen,
  onBack,
  onReload,
  onToggleTheme,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: ToolbarProps) {
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  const folder = folderName(filePath);

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        {canGoBack && (
          <IconButton label="Back" shortcut="Alt+Left" onClick={onBack}>
            <ArrowLeft {...ICON} />
          </IconButton>
        )}
        <button
          type="button"
          className="button"
          aria-label="Open file"
          title="Open file (Ctrl+O)"
          onClick={onOpen}
        >
          <FolderOpen {...ICON} />
          <span className="button-label">Open</span>
        </button>
        <IconButton label="Reload" shortcut="F5" disabled={!canReload} onClick={onReload}>
          <RefreshCw {...ICON} />
        </IconButton>
      </div>

      <div className="toolbar-title">
        <span className="toolbar-name" title={filePath}>
          {fileName ?? 'MD Reader'}
        </span>
        {folder !== undefined && (
          <span className="toolbar-folder" title={filePath}>
            {folder}
          </span>
        )}
      </div>

      <div className="toolbar-group">
        <IconButton label={`Switch to ${nextTheme} theme`} onClick={onToggleTheme}>
          {theme === 'light' ? <Moon {...ICON} /> : <Sun {...ICON} />}
        </IconButton>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="toolbar-group toolbar-zoom" role="group" aria-label="Zoom">
          <IconButton
            label="Zoom out"
            shortcut="Ctrl+Minus"
            disabled={zoom <= MIN_ZOOM + EPSILON}
            onClick={onZoomOut}
          >
            <Minus {...ICON} />
          </IconButton>
          <span className="zoom-value" role="status">
            {formatZoom(zoom)}
          </span>
          <IconButton
            label="Zoom in"
            shortcut="Ctrl+Plus"
            disabled={zoom >= MAX_ZOOM - EPSILON}
            onClick={onZoomIn}
          >
            <Plus {...ICON} />
          </IconButton>
          <IconButton
            label="Reset zoom"
            shortcut="Ctrl+0"
            disabled={Math.abs(zoom - DEFAULT_ZOOM) < EPSILON}
            onClick={onResetZoom}
          >
            <RotateCcw {...ICON} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
