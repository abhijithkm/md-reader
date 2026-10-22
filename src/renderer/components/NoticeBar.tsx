import { CircleAlert, Info, X } from 'lucide-react';
import type { Notice } from '../hooks/useDocument';

export interface NoticeBarProps {
  notice: Notice | undefined;
  onDismiss: () => void;
}

/** A message under the toolbar. Errors are announced immediately; information waits its turn. */
export function NoticeBar({ notice, onDismiss }: NoticeBarProps) {
  if (notice === undefined) return null;

  const isError = notice.kind === 'error';
  return (
    <div
      key={notice.id}
      className={`notice ${isError ? 'notice-error' : 'notice-info'}`}
      role={isError ? 'alert' : 'status'}
    >
      {isError ? (
        <CircleAlert size={18} strokeWidth={1.75} />
      ) : (
        <Info size={18} strokeWidth={1.75} />
      )}
      <span className="notice-message">{notice.message}</span>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={onDismiss}
      >
        <X size={18} strokeWidth={1.75} />
      </button>
    </div>
  );
}
