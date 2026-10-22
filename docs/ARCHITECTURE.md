# Architecture

MD Reader is an Electron application with a React renderer. The design follows from one rule: **a Markdown file is untrusted input**. Everything that touches the disk, the operating system or the network happens in the main process, behind validation, and the page can only ask for a small, fixed set of things.

```text
Windows: Explorer, Open with, the command line, a second launch
       │
       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Main process (Node.js)                                                     │
│   index.ts        lifecycle, single instance, custom protocols             │
│   AppController   which document is shown; the request queue               │
│   documents.ts    reads files, decodes text, enforces the size limit       │
│   settings-store  theme and zoom in settings.json                          │
│   policies        links, local paths, images, external URLs, IPC senders   │
└────────────────────────────────────────────────────────────────────────────┘
       ▲
       │ validated IPC, app://, mdreader-local://
       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Preload (sandboxed)                                                        │
│   exposes window.mdReader: 13 fixed functions, never ipcRenderer           │
└────────────────────────────────────────────────────────────────────────────┘
       ▲
       │ contextBridge
       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Renderer (React, no Node.js)                                               │
│   App: Toolbar, DocumentView (MarkdownRenderer), StatusBar, EmptyState     │
│   hooks: settings, document history, shortcuts, drop target, wheel zoom    │
└────────────────────────────────────────────────────────────────────────────┘
```

## Source layout

| Folder           | Role                                                                                                                                                                                                                        |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/`      | The main process. Plain modules with injected dependencies, so almost all of it is unit-tested without Electron. `index.ts` is the only file that wires Electron objects together.                                          |
| `src/preload/`   | One file: the bridge exposed to the page.                                                                                                                                                                                   |
| `src/renderer/`  | The React app. `markdown/` holds the rendering pipeline; `hooks/` the state (settings, document history, shortcuts, drop target, wheel zoom); `components/` the UI; `styles/` plain CSS with design tokens for both themes. |
| `src/shared/`    | Code and types used by more than one process: the IPC contract (`ipc.ts`), settings, zoom, the Content Security Policy, text statistics, theme colours. No Electron or DOM imports.                                         |
| `build/`         | Application and document icons (SVG sources and generated `.ico`/`.png`) and `installer.nsh`, the extra installer script.                                                                                                   |
| `scripts/`       | Icon generation and the release tooling: version check, checksums, release verification, and the installer test that runs on CI.                                                                                            |
| `tests/`, `e2e/` | Cross-cutting tests and the end-to-end tests. Unit tests sit next to the code they test (`*.test.ts`).                                                                                                                      |

## Processes

### Main process

- **Lifecycle (`index.ts`).** Takes the single-instance lock. A second launch hands its command line to the running instance (`second-instance` event) and exits. Registers the two custom schemes, builds the window, and waits for pending settings writes before quitting. The application menu is removed.
- **`AppController`.** Decides which document the one window shows. A file named at launch, by a second launch or by the operating system is held in an `OpenRequestQueue` until the page reports it is listening, then pushed to it; when requests overlap, only the newest is shown. It remembers the path of the document on screen, because links and local images are resolved and checked relative to it, and the paths of the documents it has shown, so that Back (`reopen`) accepts only those. It has no Electron dependency.
- **`documents.ts`.** Reads a file and returns an `OpenOutcome` (`opened`, `failed` or `canceled`). Every problem a user can meet (missing, a folder, wrong type, permission, locked, too large, invalid path) is a `failed` outcome with a message fit to display; nothing is thrown. The size limit is 5 MiB. `text-decoding.ts` decodes UTF-8 (with or without a byte-order mark), UTF-16 with a byte-order mark, and falls back to Windows-1252.
- **`settings-store.ts`.** `settings.json` in the user data folder holds the theme and zoom level. It is read synchronously once (the window needs it before it is created), written atomically (temporary file, then rename), serialized so the newest value always wins, and a damaged file falls back to defaults.
- **Link and path policy.** `link-resolution.ts` turns a clicked link into a Markdown file the app may open; `local-path-policy.ts` decides whether a path taken from document content may be touched at all; `symlink-policy.ts` finds where a file really is, part by part and without following links, so that a symbolic link or junction cannot lead to a network share; `external-links.ts` decides which URLs may leave the app; `certificates.ts` makes sure no client certificate is ever presented to a server; `renderer-location.ts` picks the page to load (a packaged app ignores `ELECTRON_RENDERER_URL`).

### Preload

`src/preload/index.ts` exposes `window.mdReader` with `contextBridge`. It is typed by `MdReaderApi` in `src/shared/ipc.ts` and consists of fixed functions: app info, get and update settings, the open dialog, open a dropped file, go back to a document that was already shown, open a link, reload, subscribe to documents opened from outside, open an external link, open the Windows Default apps settings, and close the window. The path of a dropped file is read inside the preload script, from the `File` object (`webUtils.getPathForFile`), which only a real drop can supply, so the page never names a path itself. The preload script never hands out `ipcRenderer`.

### Renderer

- `App.tsx` composes the hooks and components. It renders nothing until the saved settings have arrived, so a dark theme never flashes light.
- `useDocument` keeps the current document and the history behind Back. It accepts only the newest of overlapping requests and restores the scroll position after a reload or Back.
- `MarkdownRenderer` is described below. `DocumentView` owns the scroll container, wheel zoom and the word, line and reading-time statistics (counted with `Intl.Segmenter`, 200 words per minute).
- Styling is plain CSS. `tokens.css` defines the light and dark palettes; `tests/contrast.test.ts` reads it and checks WCAG contrast for the text and interface colours of both.

## Opening a file

1. **At launch:** `findLaunchFile` (`cli.ts`) takes the first positional argument (skipping Chromium switches, resolving relative paths against the working directory, accepting `file:` URLs) and the controller queues it.
2. **Second launch:** the new process exits, the running one receives `second-instance`, brings its window to the front and queues the file.
3. **When the page is ready:** the page subscribes with `onDocumentOpened` and calls `notifyReady`; the queue delivers the pending request; the controller reads the file and sends the outcome to the page.
4. **From the page** (Open dialog, drag and drop, link click, reload) the same service answers through an IPC call. A dropped file's path is read by the preload script from the `File` object and sent on; Back (`reopenDocument`) names a document by path, and the main process accepts only paths it has itself shown. In both cases the main process validates the path again.

## Custom protocols

- **`app://md-reader/`** serves the built renderer from `out/renderer`. A custom scheme gives the page a real origin for the Content Security Policy and means the page has no `file://` privileges. The handler allows `GET` only, decodes and resolves the path, and refuses anything outside the renderer folder.
- **`mdreader-local://image/?u=<file URL>`** serves the images a document references. The main process validates the request: the path must pass the local path policy, have an image extension (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG), and be at most 25 MB. Responses carry `nosniff` and a restrictive CSP of their own.

In development, the page comes from the Vite dev server instead, and the Content Security Policy is relaxed only for what Vite needs.

## Markdown pipeline

`react-markdown` with these plugins, in this order (`src/renderer/markdown/pipeline.ts`):

1. `remark-gfm`: tables, task lists, strikethrough, autolinks, footnotes.
2. `rehype-raw`, only when the text contains something that looks like HTML. It parses inline HTML, which is the slowest step for large documents.
3. `rehype-sanitize` with GitHub's allow-list, with its URL schemes narrowed: links may be `http`, `https`, `mailto` and `file` (relative links become `file:` URLs); images may be `https`, `data` and `file`. `<picture>` and `<source>` are removed, because the addresses in a `srcset` would bypass the image checks (the `<img>` inside is kept).
4. Heading ids (`slugs.ts`), GitHub-style, shared across the pieces of a long document. They run after the sanitizer, which would otherwise prefix them.
5. `rehype-highlight` with `detect: false` and `ignoreMissing: true`: only languages named on the fence are highlighted. The set is highlight.js's common languages plus PowerShell, batch, Dockerfile, HTTP and nginx. Just before it, `highlight-limits.ts` takes the language off a block with a line over 1,000 characters or more than 200,000 characters in all, so it is shown as plain text: highlight.js takes time quadratic in the length of a line (minutes for a 200 KB line).

React components then take over the elements that need decisions: links (`links.ts` classifies a link as an anchor, an external URL, a local file or blocked; a click never navigates the page), images (`images.ts` chooses local, remote `https`, inline `data:` or blocked, and failed images become a text placeholder), tables (wrapped so wide ones scroll), and task-list checkboxes (display only).

### Long documents

The Markdown parser slows down more than linearly on documents with very many small blocks (a 1 MB changelog took 12 seconds in one piece), and it works in one uninterrupted stretch. `chunks.ts` therefore splits documents over 64 KiB into pieces of about 32 KiB, cutting only where the result cannot change: at the start of a heading or, in a long stretch without one, a paragraph; never inside a code fence, an HTML comment, a `<pre>` block or an open block-level HTML element such as `<details>`. Link reference definitions are repeated in every piece. A document with footnotes is never split, because footnotes are numbered across the whole text. `MarkdownRenderer` shows one piece per turn of the event loop, so the first screen appears at once and the window stays responsive; `onComplete` fires when the last piece is on screen, and only then are the scroll position restored, anchors followed and statistics counted.

### Hostile files

A few kilobytes can make a parser do enormous work: quotes nested thousands of levels deep (`> > > …`) cost time that grows with the square of the depth and overflow the stack, and a single 200 KB line of code takes highlight.js minutes. The 5 MiB limit does not help against costs like these, so there are three layers:

- `nesting.ts` looks at the start of every line and, if a document stacks more than 100 quote marks or list markers on one line or indents a line more than 400 columns, `MarkdownRenderer` shows the text as plain text with a notice instead of formatting it. Real documents never come near these limits.
- The costs that remain are kept linear: the patterns in `chunks.ts` cannot rescan a line from every `<`, and only a bounded amount of link definitions is repeated into each piece.
- Every piece of a document is drawn inside a `RenderBoundary`, so if the parser still throws, a message replaces that piece and the rest is shown. The whole app sits in another boundary that shows `CrashNotice` with a Reload button, so a failure can never leave a blank window with no way out.

## Security model

| Threat                                                                                   | Measure                                                                                                                                                                                                                              | Where                                                                                                        |
| :--------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| Script in the document runs                                                              | HTML is sanitized; the CSP allows only the app's own script (no inline script, no `eval`) and has `connect-src 'none'`                                                                                                               | `pipeline.ts`, `shared/csp.ts`                                                                               |
| The page reaches Node.js or the disk                                                     | `contextIsolation`, `sandbox`, no `nodeIntegration`; a fixed preload API; no `webview`s                                                                                                                                              | `main/window.ts`, `preload/index.ts`                                                                         |
| A compromised page abuses IPC                                                            | Every handler checks the sender's origin and validates its payload; unknown settings keys are rejected                                                                                                                               | `main/ipc.ts`, `main/ipc-guard.ts`, `shared/settings.ts`                                                     |
| A link launches something                                                                | Only `http`, `https` and `mailto` leave the app; no credentials in URLs; a `mailto:` address may not contain quotes, spaces, pipes or similar characters; the destination is a constant for the Default apps page                    | `main/external-links.ts`, `main/ipc.ts`                                                                      |
| A link or image reads arbitrary files                                                    | Only Markdown files open via links, only image files are served; paths from documents pass the local path policy                                                                                                                     | `main/link-resolution.ts`, `main/local-image-protocol.ts`                                                    |
| A compromised page reads other files through IPC                                         | The page never names a path: a dropped file's path is read in the preload script from the `File` object, and Back is limited to documents the main process itself showed                                                             | `preload/index.ts`, `main/app-controller.ts`, `main/ipc.ts`                                                  |
| A symbolic link or junction in a document's folder points at a network share or a device | Each part of the path is examined without following links, and every link target is checked with the path policy before anything beyond it is touched; applies to images and to documents opened from links                          | `main/symlink-policy.ts`                                                                                     |
| A document learns who the reader is through a client certificate                         | The app never presents one                                                                                                                                                                                                           | `main/certificates.ts`                                                                                       |
| A hostile file hangs or blanks the window                                                | Absurd nesting is shown as plain text; very long code lines are not highlighted; the chunking patterns are linear; each piece of a document is drawn inside an error boundary                                                        | `markdown/nesting.ts`, `markdown/highlight-limits.ts`, `markdown/chunks.ts`, `components/RenderBoundary.tsx` |
| The window is pointed at a page of an attacker's choosing                                | A packaged app ignores `ELECTRON_RENDERER_URL`                                                                                                                                                                                       | `main/renderer-location.ts`                                                                                  |
| A document leaks credentials through a network share                                     | UNC paths are refused unless the open document is on the same share; device paths (`\\.\`, `CON`, `NUL`, `COM1`…) and NTFS alternate data streams are refused                                                                        | `main/local-path-policy.ts`                                                                                  |
| Navigation away from the app, pop-ups, downloads, permission prompts                     | `will-navigate` and `will-redirect` are cancelled for untrusted origins, `window.open` is denied, downloads are blocked, every permission request is denied                                                                          | `main/window.ts`                                                                                             |
| Tampering with the packaged app                                                          | Fuses: `RunAsNode`, `NODE_OPTIONS` and `--inspect` off; `OnlyLoadAppFromAsar` and embedded ASAR integrity validation on; cookie encryption on; no extra `file://` privileges. Developer tools exist only in development builds       | `electron-builder.yml`, `main/window.ts`; checked by `scripts/verify-release.mjs`                            |
| Supply chain                                                                             | No runtime dependencies are shipped (everything is bundled at build time); CI installs from the lockfile with `npm ci`; workflow actions are pinned to commit SHAs; the release job is the only one that can write to the repository | `.github/workflows`                                                                                          |

The `app://` and `mdreader-local://` handlers, the CSP and the IPC handlers each have unit tests, and the end-to-end suite checks the result in the real app: hostile HTML is stripped and the page stays intact, inline script and `eval` are blocked by the CSP, and no network request is made while a document is shown.

## Windows integration

- **Identity.** `app.setAppUserModelId('io.github.abhijithkm.mdreader')` equals the `appId` in `electron-builder.yml`, so taskbar grouping and the installer's shortcuts agree (`tests/builder-config.test.ts` guards this).
- **File types.** `fileAssociations` in `electron-builder.yml` makes the NSIS installer register the ProgIDs `MDReader.md` and `MDReader.markdown` (description "Markdown Document", the document icon, and an open command) and point `.md` and `.markdown` at them. `build/installer.nsh` adds the "Open with" registration (`Applications\MDReader.exe`) and the Settings > Default apps entry (`Software\AbhijithKM\MDReader\Capabilities` plus a `RegisteredApplications` value named `AbhijithKM.MDReader`; both carry the publisher name so that uninstalling cannot remove another program's entries), and writes the open commands again with the program path in quotes (electron-builder leaves it unquoted, which is ambiguous when the user's profile folder has a space in its name). All of it is under `HKEY_CURRENT_USER`, because the install is per user.
- **What the installer does not do.** It never writes Windows' protected `UserChoice` key, so it cannot override a program the user has already chosen for `.md` or `.markdown`; that choice is made in Settings. Where nobody has chosen, the per-user registration above is what makes MD Reader open the type. Both facts are explained to users in the README. Electron's `app.setAsDefaultProtocolClient` is not used: it is for URL protocols, not file extensions.
- **Uninstall.** Removes the ProgIDs, the "Open with" and capability registrations, the shortcuts and the program. It clears the `.md` and `.markdown` defaults only if they are still MD Reader's, and not during an upgrade. User settings in `%APPDATA%\MD Reader` are kept.
- **Run as the user.** Both executables request `asInvoker`; nothing asks for elevation. `scripts/verify-release.mjs` reads this from the manifests of the built files.

## Build and packaging

- `electron-vite` builds three targets into `out/`: main and preload as CommonJS (a sandboxed preload must be CommonJS) and the renderer as a Vite bundle.
- `electron-builder` packs `out/**` and `package.json` into `app.asar` (the archive holds six files: the three compiled bundles, the renderer's stylesheet and page, and `package.json`; `scripts/verify-release.mjs` fails the build if anything else, such as source, tests, dependencies or source maps, gets in), keeps only the `en-US` Chromium locale, and builds the NSIS installer and the portable executable for x64. `publish` is `null`: electron-builder never uploads anything.
- Version information, the icon and the fuses are written into the executable at packaging time. No code-signing certificate is configured, so the output is unsigned.

## Decisions worth knowing

- **A custom scheme instead of `file://`** for the page, so the CSP has a real origin and the page has no file privileges.
- **Chunked rendering instead of a worker or virtualization**: it keeps the plain DOM (so find-in-page, text selection and anchors work as in a browser) while bounding the cost of any single step.
- **One window, one document.** It keeps the state model small and the security surface smaller; the history behind Back is the only multi-document concept.
- **No auto-update and no telemetry.** The app never connects to the network by itself. Updating means running a newer installer.
- **Settings are two values.** A bigger store would need migrations; two validated fields do not.
