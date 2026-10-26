import { AppLogo } from './AppLogo';
import { UpdatesPanel, type UpdatesPanelProps } from './UpdatesPanel';

export interface EmptyStateProps {
  onOpen: () => void;
  /** Omitted where the Windows Settings page does not exist. */
  onOpenDefaultApps?: () => void;
  /** Omitted in a build that cannot update. */
  updates?: UpdatesPanelProps;
}

const SHORTCUTS: readonly (readonly [keys: string, action: string])[] = [
  ['Ctrl+O', 'Open a file'],
  ['Ctrl+Plus / Ctrl+Minus', 'Zoom in and out'],
  ['Ctrl+0', 'Reset zoom'],
  ['F5', 'Reload the document'],
  ['Ctrl+W', 'Close the window'],
];

/**
 * The page shown before a document is opened. It is set like a document (the markdown-body class
 * gives it the type and the marks in the margin), so the first page and the ones after it match.
 */
export function EmptyState({ onOpen, onOpenDefaultApps, updates }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-page markdown-body">
        <AppLogo size={48} />
        <h1 id="empty-title">Open a Markdown file</h1>
        <p className="empty-lead">
          Drag a .md or .markdown file onto this window, or choose one to start reading.
        </p>
        <div className="empty-actions">
          <button type="button" className="button button-primary" onClick={onOpen}>
            Open file
          </button>
        </div>

        <section aria-labelledby="shortcuts-title">
          <h2 id="shortcuts-title">Keyboard</h2>
          <dl className="shortcut-list">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="shortcut-row">
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </section>

        {onOpenDefaultApps !== undefined && (
          <section className="empty-default" aria-labelledby="default-app-title">
            <h2 id="default-app-title">Make MD Reader the default app for Markdown</h2>
            <p>
              Then a double-click on any .md file opens it here. In Windows, open Settings › Apps ›
              Default apps, search for .md and choose MD Reader. Do the same for .markdown.
            </p>
            <button type="button" className="button" onClick={onOpenDefaultApps}>
              Open Default apps settings
            </button>
          </section>
        )}

        {updates !== undefined && <UpdatesPanel {...updates} />}
      </div>
    </div>
  );
}
