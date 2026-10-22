import { AppLogo } from './AppLogo';

export interface EmptyStateProps {
  onOpen: () => void;
  /** Omitted where the Windows Settings page does not exist. */
  onOpenDefaultApps?: () => void;
}

const SHORTCUTS: readonly (readonly [keys: string, action: string])[] = [
  ['Ctrl+O', 'Open a file'],
  ['Ctrl+Plus / Ctrl+Minus', 'Zoom in and out'],
  ['Ctrl+0', 'Reset zoom'],
  ['F5', 'Reload the document'],
  ['Ctrl+W', 'Close the window'],
];

export function EmptyState({ onOpen, onOpenDefaultApps }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <AppLogo size={72} />
      <h1 id="empty-title">Open a Markdown file</h1>
      <p className="empty-lead">
        Drag a .md or .markdown file onto this window, or choose one to start reading.
      </p>
      <button type="button" className="button button-primary" onClick={onOpen}>
        Open file
      </button>

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
    </div>
  );
}
