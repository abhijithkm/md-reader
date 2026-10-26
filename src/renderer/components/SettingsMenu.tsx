import { Settings as SettingsIcon } from 'lucide-react';

export interface SettingsMenuProps {
  /** Whether the tabs that are open come back the next time MD Reader starts. */
  restoreTabs: boolean;
  onSetRestoreTabs: (enabled: boolean) => void;
}

const MENU_ID = 'settings-menu';

/**
 * The gear in the toolbar and the small menu it opens. The menu is a native popover, so the browser
 * opens and closes it, keeps it above the page, closes it on Escape or a click outside it, and gives
 * the focus back to the gear; the page only says what is in it.
 */
export function SettingsMenu({ restoreTabs, onSetRestoreTabs }: SettingsMenuProps) {
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Settings"
        title="Settings"
        popoverTarget={MENU_ID}
      >
        <SettingsIcon size={18} strokeWidth={1.75} />
      </button>
      <div id={MENU_ID} popover="auto" role="group" aria-label="Settings" className="settings-menu">
        <div className="settings-row">
          <div className="settings-text">
            <span id="restore-tabs-label" className="settings-label">
              Reopen tabs when MD Reader starts
            </span>
            <span id="restore-tabs-hint" className="settings-hint">
              Remembers which files are open, in a small file on this computer.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={restoreTabs}
            aria-labelledby="restore-tabs-label"
            aria-describedby="restore-tabs-hint"
            onClick={() => {
              onSetRestoreTabs(!restoreTabs);
            }}
          >
            <span className="switch-thumb" aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  );
}
