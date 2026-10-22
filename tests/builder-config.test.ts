import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface BuilderConfig {
  appId: string;
  productName: string;
  executableName: string;
  files: string[];
  publish?: unknown;
  electronFuses: Record<string, boolean>;
  win: { target: { target: string; arch: string[] }[]; requestedExecutionLevel?: string };
  nsis: { oneClick?: boolean; perMachine?: boolean; artifactName: string; include?: string };
  portable: { artifactName: string };
  fileAssociations: { ext: string; name: string; description: string; icon?: string }[];
  [key: string]: unknown;
}

const root = process.cwd();
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');

const config = parse(read('electron-builder.yml')) as BuilderConfig;
const pkg = JSON.parse(read('package.json')) as {
  name: string;
  productName: string;
  version: string;
  main: string;
  dependencies?: Record<string, string>;
};
const installerScript = read('build/installer.nsh');
const mainSource = read('src/main/index.ts');

describe('application identity', () => {
  it('uses a stable reverse-DNS application id', () => {
    expect(config.appId).toBe('io.github.abhijithkm.mdreader');
  });

  it('gives the main process the same taskbar identity as the installer shortcuts', () => {
    const match = /APP_USER_MODEL_ID\s*=\s*'([^']+)'/.exec(mainSource);
    expect(match?.[1]).toBe(config.appId);
  });

  it('is called MD Reader and runs as MDReader.exe', () => {
    expect(config.productName).toBe('MD Reader');
    expect(pkg.productName).toBe('MD Reader');
    expect(config.executableName).toBe('MDReader');
  });

  it('has a semantic version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});

describe('release artifacts', () => {
  it('builds a 64-bit installer and a 64-bit portable executable, and nothing else', () => {
    expect(config.win.target).toEqual([
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ]);
  });

  it('names the installer and the portable build predictably and distinguishably', () => {
    expect(config.nsis.artifactName).toBe('MDReader-Setup-${version}.exe');
    expect(config.portable.artifactName).toBe('MDReader-Portable-${version}.exe');
  });

  it('installs per user and never asks for administrator rights', () => {
    expect(config.nsis.perMachine).toBe(false);
    expect(config.win.requestedExecutionLevel).toBe('asInvoker');
  });

  it('is never published or code-signed from the configuration', () => {
    expect(config.publish ?? null).toBeNull();
    for (const key of [
      'certificateFile',
      'certificatePassword',
      'certificateSubjectName',
      'signtoolOptions',
      'azureSignOptions',
    ]) {
      expect(config.win, key).not.toHaveProperty(key);
    }
  });
});

describe('file associations', () => {
  it('registers .md and .markdown as Markdown Documents with their own ProgIDs', () => {
    expect(
      config.fileAssociations.map(({ ext, name, description }) => [ext, name, description]),
    ).toEqual([
      ['md', 'MDReader.md', 'Markdown Document'],
      ['markdown', 'MDReader.markdown', 'Markdown Document'],
    ]);
  });

  it('lists the same ProgIDs under Default apps, so Windows Settings offers MD Reader for both', () => {
    for (const { ext, name } of config.fileAssociations) {
      expect(installerScript).toContain(
        `"Software\\AbhijithKM\\MDReader\\Capabilities\\FileAssociations" ".${ext}" "${name}"`,
      );
    }
    expect(installerScript).toContain(
      '"Software\\RegisteredApplications" "AbhijithKM.MDReader" "Software\\AbhijithKM\\MDReader\\Capabilities"',
    );
  });

  it('removes what it registered when it is uninstalled', () => {
    expect(installerScript).toContain(
      'DeleteRegKey SHELL_CONTEXT "Software\\AbhijithKM\\MDReader"',
    );
    expect(installerScript).toContain(
      'DeleteRegValue SHELL_CONTEXT "Software\\RegisteredApplications" "AbhijithKM.MDReader"',
    );
  });

  it('keeps its own registry entries under the publisher name, so uninstalling cannot delete another product with a similar name', () => {
    // Writing and, on uninstall, deleting a key named just "MDReader" would also remove the data of
    // any other program that chose that name.
    expect(installerScript).not.toMatch(/"Software\\MDReader/);
    expect(installerScript).not.toMatch(/RegisteredApplications" "MDReader"/);
  });

  it('only gives up the .md and .markdown defaults on uninstall when they are still its own', () => {
    for (const { ext, name } of config.fileAssociations) {
      expect(installerScript).toMatch(
        new RegExp(
          String.raw`ReadRegStr \$0 SHELL_CONTEXT "Software\\Classes\\\.${ext}" ""\s+\$\{If\} \$0 == "${name}"`,
        ),
      );
    }
  });

  it('quotes the program path in the command that opens each type, so a profile folder with spaces works', () => {
    // electron-builder writes these commands with the path unquoted; customInstall runs after
    // that and writes them again, quoted.
    for (const { name } of config.fileAssociations) {
      expect(installerScript).toContain(
        `WriteRegStr SHELL_CONTEXT "Software\\Classes\\${name}\\shell\\open\\command" "" '"$appExe" "%1"'`,
      );
    }
  });

  it('removes the copy of the installer that electron-builder keeps for an updater this app does not have', () => {
    // The copy is about 100 MB. electron-builder names the folder after the package name.
    const updaterFolder = `${pkg.name.toLowerCase()}-updater`;
    expect(installerScript).toContain('Delete "$LOCALAPPDATA\\${APP_INSTALLER_STORE_FILE}"');
    expect(installerScript).toContain(`RMDir /r "$LOCALAPPDATA\\${updaterFolder}"`);
  });

  it('points each association at an icon that exists', () => {
    for (const { icon } of config.fileAssociations) {
      expect(icon).toBeDefined();
      expect(existsSync(path.join(root, 'build', icon ?? ''))).toBe(true);
    }
  });

  it('does not use protocol registration, which is not how Markdown files are associated', () => {
    expect(config).not.toHaveProperty('protocols');
    expect(mainSource).not.toContain('setAsDefaultProtocolClient');
  });
});

describe('package contents', () => {
  it('ships only the built output', () => {
    expect(config.files).toContain('out/**/*');
    expect(config.files).toContain('package.json');
    expect(config.files.some((pattern) => /^(src|e2e|tests|docs|scripts)\b/.test(pattern))).toBe(
      false,
    );
    expect(pkg.main).toBe('./out/main/index.js');
  });

  it('has no runtime dependencies to bundle: everything is compiled into the output', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it('turns off the Electron features a Markdown reader does not need, and verifies its own code', () => {
    expect(config.electronFuses).toEqual({
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
    });
  });
});

describe('icons', () => {
  function readIco(file: string) {
    const bytes = readFileSync(path.join(root, 'build', file));
    const count = bytes.readUInt16LE(4);
    const images = Array.from({ length: count }, (_unused, index) => {
      const entry = 6 + index * 16;
      const width = bytes.readUInt8(entry) || 256;
      const size = bytes.readUInt32LE(entry + 8);
      const offset = bytes.readUInt32LE(entry + 12);
      return { width, size, offset, data: bytes.subarray(offset, offset + size) };
    });
    return { bytes, type: bytes.readUInt16LE(2), reserved: bytes.readUInt16LE(0), images };
  }

  it.each(['icon.ico', 'file-icon.ico'])(
    '%s is a complete Windows icon with every common size',
    (file) => {
      const ico = readIco(file);

      expect(ico.reserved).toBe(0);
      expect(ico.type).toBe(1);
      expect(ico.images.map((image) => image.width)).toEqual([16, 24, 32, 48, 64, 128, 256]);
      for (const image of ico.images) {
        expect(image.offset + image.size).toBeLessThanOrEqual(ico.bytes.length);
        expect([...image.data.subarray(0, 8)]).toEqual([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
      }
    },
  );

  it('icon.png is 512 pixels square', () => {
    const png = readFileSync(path.join(root, 'build', 'icon.png'));
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
  });
});
