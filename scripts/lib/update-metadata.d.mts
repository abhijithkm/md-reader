export interface UpdateFileInput {
  version: string;
  installerName: string;
  /** SHA-512 of the installer, base64. */
  installerSha512: string;
  installerSize: number;
  blockmapExists: boolean;
  /** latest.yml as parsed, or undefined when there is none. */
  metadata: unknown;
}

/**
 * Problems with latest.yml, the file an installed copy reads to learn what the newest version is
 * and how to check its download. Empty when it matches the installer.
 */
export function checkUpdateFile(input: UpdateFileInput): string[];

export interface AppUpdateConfigInput {
  /** resources/app-update.yml as parsed, or undefined when there is none. */
  appUpdate: unknown;
  source: { owner: string; repo: string };
  /** The folder the installer script removes on uninstall. */
  updaterFolder: string;
}

/**
 * Problems with the configuration inside the package that says where updates come from. Empty
 * when it points at the one repository and uses no setting this app does not use.
 */
export function checkAppUpdateConfig(input: AppUpdateConfigInput): string[];
