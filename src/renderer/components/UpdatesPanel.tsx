import type { ReactNode } from 'react';
import type { UpdateState } from '../../shared/updates';

export interface UpdatesPanelProps {
  /** Any state except `unavailable`: a build that cannot update shows no panel at all. */
  state: Exclude<UpdateState, { status: 'unavailable' }>;
  /** The version of the running app, once known. */
  version: string | undefined;
  /** False for the portable executable, which only reports a newer version and never installs it. */
  installs: boolean;
  onCheck: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onRestart: () => void;
  onOpenPage: (url: string) => void;
}

function describeState(
  state: UpdatesPanelProps['state'],
  version: string | undefined,
  installs: boolean,
): string {
  switch (state.status) {
    case 'off':
      return 'Automatic updates are off.';
    case 'idle':
      return installs ? 'Automatic updates are on.' : 'Automatic update checks are on.';
    case 'checking':
      return 'Checking for updates…';
    case 'current':
      return version === undefined
        ? 'MD Reader is up to date.'
        : `MD Reader ${version} is up to date.`;
    case 'downloading':
      return `Downloading MD Reader ${state.version}…`;
    case 'ready':
      return `MD Reader ${state.version} is ready. It installs when you close the app.`;
    case 'available':
      return `MD Reader ${state.version} is available.`;
    case 'error':
      return 'MD Reader could not check for or download an update. Try again later.';
  }
}

/** The version, what updating is doing, and the few things the reader can do about it. */
export function UpdatesPanel({
  state,
  version,
  installs,
  onCheck,
  onSetEnabled,
  onRestart,
  onOpenPage,
}: UpdatesPanelProps) {
  // Switching on and switching off are one button in two states. Under one key React keeps the same
  // element when the words change, so keyboard focus stays where it was.
  const turnOff = (
    <button
      key="on-off"
      type="button"
      className="button"
      onClick={() => {
        onSetEnabled(false);
      }}
    >
      Turn off automatic updates
    </button>
  );
  // The same button, under the same key, through a check and what follows it: pressing it with the
  // keyboard leaves focus where it was. While a check or a download runs it does nothing.
  const check = (label: string, busy = false) => (
    <button
      key="check"
      type="button"
      className="button"
      aria-disabled={busy ? 'true' : undefined}
      onClick={busy ? undefined : onCheck}
    >
      {label}
    </button>
  );

  let actions: ReactNode;
  switch (state.status) {
    case 'off':
      actions = (
        <button
          key="on-off"
          type="button"
          className="button"
          onClick={() => {
            onSetEnabled(true);
          }}
        >
          Turn on automatic updates
        </button>
      );
      break;
    case 'idle':
      actions = [check('Check for updates'), turnOff];
      break;
    case 'checking':
    case 'downloading':
      actions = [check('Check for updates', true), turnOff];
      break;
    case 'current':
    case 'error':
      actions = [check('Check again'), turnOff];
      break;
    case 'ready':
      actions = [
        <button key="restart" type="button" className="button" onClick={onRestart}>
          Restart now
        </button>,
        turnOff,
      ];
      break;
    case 'available':
      actions = [
        <button
          key="open-page"
          type="button"
          className="button"
          onClick={() => {
            onOpenPage(state.releaseUrl);
          }}
        >
          Open download page
        </button>,
        turnOff,
      ];
      break;
  }

  return (
    <section className="empty-updates" aria-labelledby="updates-title">
      <h2 id="updates-title">Updates</h2>
      <p className="empty-updates-line">
        {version !== undefined && (
          <span className="empty-updates-version">{`Version ${version}`}</span>
        )}
        <span>
          {/* Announced when it changes. The percentage is not, or a download would be read out at every step. */}
          <span aria-live="polite">{describeState(state, version, installs)}</span>
          {state.status === 'downloading' && (
            <span className="empty-updates-percent">{` ${state.percent}%`}</span>
          )}
        </span>
      </p>
      <div className="empty-updates-actions">{actions}</div>
    </section>
  );
}
