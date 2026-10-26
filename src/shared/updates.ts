/**
 * Where new versions are published. Must equal `publish` in electron-builder.yml, which is what
 * the installed app reads at run time; tests/builder-config.test.ts checks that they agree.
 */
export const UPDATE_SOURCE = { owner: 'abhijithkm', repo: 'md-reader' } as const;

/** Why a build never looks for updates. */
export type UpdateUnavailableReason = 'development' | 'disabled';

/**
 * What the page is told about updating. Versions and links are made by the main process; the page
 * only shows them, and never supplies one.
 */
export type UpdateState =
  /** This build cannot update: a development build, or updates were disabled from outside. */
  | { status: 'unavailable'; reason: UpdateUnavailableReason }
  /** The user switched automatic updates off. */
  | { status: 'off' }
  | { status: 'idle' }
  | { status: 'checking' }
  /** A check the user asked for found nothing newer. */
  | { status: 'current' }
  | { status: 'downloading'; version: string; percent: number }
  /** Downloaded; it installs when the app closes, or at once if the user restarts. */
  | { status: 'ready'; version: string }
  /** A newer version exists but this build cannot install it itself (the portable executable). */
  | { status: 'available'; version: string; releaseUrl: string }
  | { status: 'error' };

const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,40})?$/;

/** True only for a plain version number such as 1.2.3 or 1.2.3-beta.1, whatever a server claims. */
export function isUpdateVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION.test(value);
}

/** The GitHub page of a release. `version` must already have passed `isUpdateVersion`. */
export function releasePageUrl(version: string): string {
  return `https://github.com/${UPDATE_SOURCE.owner}/${UPDATE_SOURCE.repo}/releases/tag/v${version}`;
}
