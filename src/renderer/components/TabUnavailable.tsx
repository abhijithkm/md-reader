export interface TabUnavailableProps {
  /** The file name the tab was for. */
  name: string;
  /** Why it could not be read, in words fit to show. */
  message: string;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * What a tab shows when its document cannot be read: a tab that was open the last time, whose file has
 * been moved or deleted since, for instance. The tab stays, so that the reader can see which file it
 * was, and either try again (the file may be on a drive that is not connected yet) or close it. It is
 * set like the start page, so that it looks like a page of the app and not like a fault.
 */
export function TabUnavailable({ name, message, onRetry, onClose }: TabUnavailableProps) {
  return (
    <div className="empty-state">
      <div className="empty-page markdown-body">
        <h1>{name}</h1>
        <p role="alert">{message}</p>
        <div className="empty-actions">
          <button type="button" className="button button-primary" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close tab
          </button>
        </div>
      </div>
    </div>
  );
}
