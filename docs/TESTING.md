# Testing

MD Reader is tested at several levels. All but the last run automatically; the last is a checklist for a person on a real Windows machine.

| Level                                                                | Command                                                     | What it shows                                                                                    | Runs on                                       |
| :------------------------------------------------------------------- | :---------------------------------------------------------- | :----------------------------------------------------------------------------------------------- | :-------------------------------------------- |
| Static checks                                                        | `npm run lint`, `npm run typecheck`, `npm run format:check` | Strict TypeScript, ESLint (type-aware), consistent formatting                                    | local, CI                                     |
| Unit and integration tests                                           | `npm test`                                                  | Every module and React component, the build configuration, the release scripts and the workflows | local, CI                                     |
| End-to-end tests                                                     | `npm run test:e2e`                                          | The real Electron app, driven over the Chrome DevTools Protocol with Playwright                  | local, CI                                     |
| The same end-to-end tests against the packaged and the installed app | `MDREADER_EXE=<path to MDReader.exe>`                       | That what users get starts and behaves like the development build                                | local (packaged), CI (packaged and installed) |
| Installer test                                                       | `scripts/installer-test.ps1`                                | A real install, upgrade and uninstall, and the registry and shortcuts they leave                 | CI only (see below)                           |
| Portable smoke test                                                  | `scripts/portable-smoke.ps1 -Portable <exe>`                | The portable executable starts and opens a document named on the command line                    | local, CI                                     |
| Manual checklist                                                     | [below](#manual-windows-test-checklist)                     | What automation cannot see: Explorer, Settings, SmartScreen, scaling, assistive technology       | a person                                      |

## Running the tests

```bash
npm run check          # lint, typecheck, unit tests and build
npm test               # unit and integration tests only
npm run test:e2e       # end-to-end tests against the development build
```

The end-to-end tests launch the application through the installed Electron, so they need `npm run build` first, and Electron must be downloaded (`npm run dev` does that on first use, or run `npx install-electron`). To run them against a packaged build instead, point `MDREADER_EXE` at it:

```powershell
npm run pack
$env:MDREADER_EXE = "$PWD\release\win-unpacked\MDReader.exe"
npm run test:e2e
```

Each test starts the app with its own empty profile folder (`--user-data-dir`), which also isolates the single-instance lock, so tests never touch your real settings or an MD Reader you have open. To regenerate the README screenshots from the real app, in PowerShell: `$env:MDREADER_SCREENSHOTS = '1'; npm run test:e2e -- screenshots`.

## What is covered

| Behaviour                                                                                                                                           | Tests                                                                                                                                                                                                                                 |
| :-------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Markdown rendering: headings, lists, task lists, tables, code, quotes, rules, footnotes, `<details>`, heading ids                                   | `src/renderer/markdown/MarkdownRenderer.test.tsx`, `pipeline.test.ts`, `slugs.test.ts`, `anchors.test.ts`; end-to-end in `e2e/documents.e2e.test.ts`                                                                                  |
| Long documents are split safely and stay responsive                                                                                                 | `src/renderer/markdown/chunks.test.ts`; `MarkdownRenderer.test.tsx`, which checks that a document rendered in pieces equals the same document rendered at once; the "about a megabyte" end-to-end test, which watches for long tasks  |
| Paths with spaces, Unicode and shell-special characters                                                                                             | `src/main/cli.test.ts`, `src/main/documents.test.ts`; the end-to-end "even with spaces and unicode in its path" test                                                                                                                  |
| Missing, unreadable, locked, oversized or non-Markdown files get a clear message                                                                    | `src/main/documents.test.ts`, `src/main/app-controller.test.ts`; end-to-end tests for a missing file, a non-Markdown file and a too-large file                                                                                        |
| Text encodings (UTF-8, byte-order marks, UTF-16, Windows-1252)                                                                                      | `src/main/text-decoding.test.ts`                                                                                                                                                                                                      |
| Opening from the command line, from the dialog, by drag and drop, by link, and reload                                                               | `src/main/cli.test.ts`, `src/main/app-controller.test.ts`, `src/renderer/hooks/useDropTarget.test.tsx`, `useDocument.test.tsx`; end-to-end tests including a real file drop                                                           |
| A second launch is handed to the running window; files requested before the page is ready are queued                                                | `src/main/app-controller.test.ts`, `src/main/open-queue.test.ts`; end-to-end tests that start a second process                                                                                                                        |
| Theme and zoom persistence, damaged settings files                                                                                                  | `src/shared/settings.test.ts`, `zoom.test.ts`, `src/main/settings-store.test.ts`, `src/renderer/hooks/useSettings.test.tsx`; `e2e/settings.e2e.test.ts`, which restarts the app and checks the window is painted in the saved theme   |
| Unsafe HTML, links and images                                                                                                                       | `pipeline.test.ts`, `links.test.ts`, `images.test.ts`, `src/main/external-links.test.ts`, `local-path-policy.test.ts`, `link-resolution.test.ts`, `local-image-protocol.test.ts`; end-to-end "removes everything that could run code" |
| The page's isolation: CSP, IPC origin and payload checks, no Node.js in the page, no network requests                                               | `src/shared/csp.test.ts`, `src/main/ipc.test.ts`, `ipc-guard.test.ts`, `app-protocol.test.ts`; `e2e/app.e2e.test.ts` and the Content Security Policy and network tests in `e2e/documents.e2e.test.ts`                                 |
| A compromised page cannot name paths: a dropped file's path comes from the drop, and Back is limited to documents already shown                     | `src/main/app-controller.test.ts`, `ipc.test.ts`, `src/renderer/hooks/useDocument.test.tsx`, `App.test.tsx`; the end-to-end drop and Back tests                                                                                       |
| Symbolic links and junctions cannot lead to a network share or a device                                                                             | `src/main/symlink-policy.test.ts`, and the symbolic-link cases in `local-image-protocol.test.ts` and `documents.test.ts`                                                                                                              |
| No client certificate is presented to a server                                                                                                      | `src/main/certificates.test.ts`                                                                                                                                                                                                       |
| Hostile files cannot hang or blank the window: nesting limit, highlighting limits, linear-time chunking, error boundaries, the recovery screen      | `src/renderer/markdown/nesting.test.ts`, `highlight-limits.test.ts`, `chunks.test.ts`, `MarkdownRenderer.test.tsx`, `MarkdownRenderer.boundary.test.tsx`, `src/renderer/components/RenderBoundary.test.tsx`, `CrashNotice.test.tsx`   |
| The window's security preferences and the page it loads                                                                                             | `tests/window-preferences.test.ts`, `src/main/renderer-location.test.ts`                                                                                                                                                              |
| Relative images and links resolve against the document, not the app                                                                                 | `images.test.ts`, `local-image-protocol.test.ts`, `src/shared/local-image-url.test.ts`; end-to-end "relative images and links"                                                                                                        |
| Keyboard shortcuts, including that AltGr is not mistaken for Ctrl+Alt                                                                               | `src/renderer/shortcuts.test.ts`, `useShortcuts.test.tsx`; end-to-end zoom and Alt+Left tests                                                                                                                                         |
| Accessible names, focus and status messages of the interface                                                                                        | The component tests under `src/renderer/components/`, `src/renderer/App.test.tsx`                                                                                                                                                     |
| Text and interface colours meet WCAG contrast in both themes                                                                                        | `tests/contrast.test.ts`                                                                                                                                                                                                              |
| Packaged startup                                                                                                                                    | The whole end-to-end suite against `release\win-unpacked\MDReader.exe` (CI and Release workflows); `npm run verify:release`                                                                                                           |
| Installer configuration and file associations (per-user, no elevation, ProgIDs, Default apps entries, uninstall cleanup, icons)                     | `tests/builder-config.test.ts`; then for real by `scripts/installer-test.ps1`                                                                                                                                                         |
| Release content: archive contents, fuses, version information, signing status, installer manifests                                                  | `tests/asar-policy.test.ts`; `scripts/verify-release.mjs`                                                                                                                                                                             |
| Release scripts and workflows (version and tag match, checksums, pinned actions, least-privilege permissions, ordering of checks before publishing) | `tests/release-scripts.test.ts`, `tests/workflows.test.ts`                                                                                                                                                                            |

## The installer test (CI only)

`scripts/installer-test.ps1` runs in the Release workflow on a fresh Windows runner:

1. **Install:** installs an older build (version 0.0.1, built for this purpose), then installs the new version over it, silently. It then checks that there is exactly one MD Reader entry in Apps & features with the new version; that it is installed under the user's profile; that `MDReader.exe`, the uninstaller and the application archive exist; that the Start menu and Desktop shortcuts exist and point at the program; that `.md` and `.markdown` are registered to `MDReader.md` and `MDReader.markdown`, with an open command that uses the installed program, and an icon that exists; and that the "Open with" and Settings > Default apps registrations are present.
2. The workflow then runs the **end-to-end tests against the installed program**.
3. **Uninstall:** runs the installed uninstaller and checks that the program, the shortcuts and every registration are gone, that the `.md` and `.markdown` defaults no longer point at MD Reader, and that the user's data folder is kept.

The script changes the current user's file associations, so it refuses to run unless the `CI` environment variable is `true` (or `-AllowLocal` is passed). It is not run on development machines. To try it yourself, use a disposable Windows 10/11 virtual machine or a spare user account, never your main account:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\installer-test.ps1 -Phase Install -Installer release\MDReader-Setup-1.0.0.exe -AllowLocal
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\installer-test.ps1 -Phase Uninstall -AllowLocal
```

## Manual Windows test checklist

Run this on a clean Windows 10 or 11 machine (a virtual machine is ideal) before the first release, and again after any change to the installer, the file association registration, or how files are opened. Use a standard (non-administrator) user for the install steps. Note the Windows build and the MD Reader version you tested.

### Preparation

- [ ] Get the installer from the release (or the workflow artifact) and check its hash: `Get-FileHash -Algorithm SHA256 .\MDReader-Setup-<version>.exe` equals the line in `SHA256SUMS.txt`.
- [ ] Prepare test files in a folder whose name has spaces, for example `C:\Test Docs\`:
  - `Ünïcode ファイル.md`, a short document with Unicode text;
  - `sample.md` (copy `docs/sample.md`), plus `other.md` and an `images` folder with `pic.png`, with `sample.md` linking to `other.md` and showing `images/pic.png` and `../pic.png`;
  - `notes.markdown`, a UTF-16 file saved from Notepad, and a plain `readme.txt`;
  - `big.md` of about 2 MB: `1..60000 | ForEach-Object { "- item $_ with some **bold** text" } | Set-Content big.md`, and a file over 5 MB.

### Install

- [ ] Run the installer. There is no administrator prompt. SmartScreen shows its warning once; **More info > Run anyway** lets it continue.
- [ ] MD Reader starts when the installer finishes. A Start menu and a Desktop shortcut exist.
- [ ] Settings > Apps > Installed apps lists "MD Reader" with the right version, once.
- [ ] The program is under `%LOCALAPPDATA%\Programs`.

### Opening files

- [ ] **Ctrl+O** shows the Open dialog filtered to Markdown files; open `Ünïcode ファイル.md`.
- [ ] Right-click a `.md` file > Open with: MD Reader is in the list (Choose another app if needed) and opens the file.
- [ ] Settings > Apps > Default apps: search `.md`, choose MD Reader; do the same for `.markdown`. Both file types now show the MD Reader document icon in Explorer (restart Explorer if the icon is stale).
- [ ] Double-click `sample.md` in Explorer: it opens in MD Reader.
- [ ] With MD Reader open and showing `sample.md`, double-click `Ünïcode ファイル.md`: the same window shows the new document and comes to the front. Repeat with the window minimized.
- [ ] Drag a `.md` file from Explorer onto the window: a drop overlay appears, then the document opens. Drag `readme.txt`: a message explains it is not Markdown.
- [ ] From a command prompt in another folder: `MDReader.exe "C:\Test Docs\Ünïcode ファイル.md"` and with a relative path.
- [ ] If you can: open a file from a USB drive and from a network share. The document and its relative images load.
- [ ] Open the UTF-16 file and `notes.markdown`: text is readable.

### Rendering and links

- [ ] `sample.md`: headings, task list (checked and unchecked), numbered and bulleted lists, the table, both code blocks highlighted, the block quote, the horizontal rule, the footnote, the collapsible section.
- [ ] Both images show. Rename `pic.png` and press F5: a "not found" placeholder appears and nothing else breaks.
- [ ] Click the link to `other.md`: it opens in the same window. **Alt+Left** returns to `sample.md` at the same scroll position. A `#heading` link scrolls.
- [ ] Click an `https://` link: it opens in the default browser, not in MD Reader. A `mailto:` link opens the mail program.
- [ ] A document with `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `<iframe src="https://example.com">` and `[x](javascript:alert(1))`: nothing runs, no dialog appears, the page is intact and the unsafe link is plain text.
- [ ] A link to `file:///C:/Windows/System32/cmd.exe`, to `\\server\share\x.md` and to `readme.txt`: refused with a message; nothing launches.
- [ ] `big.md` stays responsive (you can scroll and zoom while it finishes). The file over 5 MB is refused with a message that names its size.
- [ ] A document that is one line of `> ` repeated 5,000 times: it appears at once as plain text with a notice about nesting, and the window stays responsive. A code block with a single 5,000-character line appears at once without colours.
- [ ] Drag a `.md` file from a network share (`\\server\share`) onto the window: it opens, because dropping it is your choice. A link inside a document to a file on a _different_ share is refused.

### Interface

- [ ] The theme button switches light and dark. Close and reopen: the theme is remembered, and a dark window does not flash white on start. (Before you press it, the app follows the Windows theme: change that in Settings > Personalization > Colors and check.)
- [ ] Zoom with the toolbar, **Ctrl+Plus**, **Ctrl+Minus**, **Ctrl+0** and **Ctrl** + mouse wheel. Close and reopen: the zoom is remembered.
- [ ] Edit the open file in Notepad, save, press **F5**: the change appears and your place is kept.
- [ ] **Ctrl+W** closes the window and the app exits.
- [ ] Make the window as narrow as it goes: no horizontal scrolling of the page, the toolbar still fits, wide tables and code scroll inside their own frame.
- [ ] Display scaling at 150% and 200%, and a second monitor with a different scale: text is sharp and nothing is clipped.
- [ ] A Windows contrast theme (Settings > Accessibility > Contrast themes): everything stays legible.
- [ ] With Narrator or NVDA: toolbar buttons are announced by name, the zoom level is announced when it changes, and document headings, links and tables can be navigated.

### Upgrade and uninstall

- [ ] Install the previous release (or an older build), set the theme and zoom, then run the new installer. There is still one entry in Apps & features, with the new version; the theme and zoom are kept; double-clicking `.md` still opens MD Reader.
- [ ] Uninstall from Settings > Apps. The program and both shortcuts are gone. Double-clicking a `.md` file now asks which program to use. `%APPDATA%\MD Reader` is still there (delete it by hand for a clean slate).
- [ ] Install again: it works, and the file types can be chosen again.

### Portable

- [ ] Run `MDReader-Portable-<version>.exe` from a folder with spaces in its name, passing a file on the command line: it opens. `HKEY_CURRENT_USER\Software\Classes\.md` is not changed by it.

### Offline and security spot checks

- [ ] Disconnect from the network: the app starts, documents render, and a remote `https` image shows a placeholder instead of an error dialog.
- [ ] In the installed app, **F12** and **Ctrl+Shift+I** do nothing (developer tools are off).
- [ ] Run `MDReader.exe` with a non-Markdown file, and drag an `.exe` onto the window: a message appears and nothing runs.

## What cannot be automated here

- SmartScreen and Explorer's behaviour, the Settings app, icon caches, scaling and contrast themes, and assistive technology: the manual checklist covers these.
- Installing on the machine that develops the app: see above. The installer test on CI is the automated substitute.
- The GitHub workflows themselves can only be exercised by GitHub. Their structure is checked by `tests/workflows.test.ts`; the first real run is the dry run described in [RELEASING.md](RELEASING.md#dry-run).
