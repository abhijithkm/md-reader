import { Info, X } from 'lucide-react';

export type UpdateNoticeContent =
  /**
   * The one-time explanation of what the automatic check does. `installs` is false for a copy that
   * cannot replace itself (the portable executable), which only reports newer versions.
   */
  | { kind: 'intro'; installs: boolean }
  | { kind: 'ready'; version: string }
  /** A newer version exists that this copy cannot install itself (the portable executable). */
  | { kind: 'available'; version: string };

export interface UpdateNoticeProps {
  notice: UpdateNoticeContent;
  onKeepOn: () => void;
  onTurnOff: () => void;
  onRestart: () => void;
  onOpenPage: () => void;
  onDismiss: () => void;
}

function messageFor(notice: UpdateNoticeContent): string {
  switch (notice.kind) {
    case 'intro':
      return notice.installs
        ? 'MD Reader checks GitHub for new versions and installs them when you close the app. It sends no information from your documents or settings.'
        : 'MD Reader checks GitHub for new versions and tells you when one is available. It sends no information from your documents or settings.';
    case 'ready':
      return `MD Reader ${notice.version} is ready. It installs when you close the app.`;
    case 'available':
      return `MD Reader ${notice.version} is available.`;
  }
}

/** A message under the toolbar about updating. It never takes focus and never blocks reading. */
export function UpdateNotice({
  notice,
  onKeepOn,
  onTurnOff,
  onRestart,
  onOpenPage,
  onDismiss,
}: UpdateNoticeProps) {
  return (
    <div className="notice notice-info" role="status" aria-label="Update notice">
      <Info size={18} strokeWidth={1.75} />
      <span className="notice-message">{messageFor(notice)}</span>

      <div className="notice-actions">
        {notice.kind === 'intro' && (
          <>
            <button type="button" className="button" onClick={onKeepOn}>
              OK
            </button>
            <button type="button" className="button" onClick={onTurnOff}>
              Turn off
            </button>
          </>
        )}
        {notice.kind === 'ready' && (
          <button type="button" className="button" onClick={onRestart}>
            Restart now
          </button>
        )}
        {notice.kind === 'available' && (
          <button type="button" className="button" onClick={onOpenPage}>
            Open download page
          </button>
        )}
      </div>

      {notice.kind !== 'intro' && (
        <button
          type="button"
          className="icon-button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
        >
          <X size={18} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
