# Changelog

All notable changes to MD Reader are recorded in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Everything below is the first release, 1.0.0. When it is tagged, this heading becomes `## [1.0.0] - YYYY-MM-DD` and a new empty `## [Unreleased]` section goes above it (see [docs/RELEASING.md](docs/RELEASING.md)).

### Added

- Reading Markdown: headings, emphasis, lists, task lists, GitHub Flavored Markdown tables, strikethrough, footnotes, block quotes, horizontal rules, links and images, in any Unicode script. Fenced code blocks are syntax-highlighted. Safe inline HTML (`<details>`, `<kbd>`, images, tables) renders; scripts, event handlers, frames, forms and styles are removed.
- Relative images and links resolve against the document's folder. Links to other Markdown files open in the same window, with Back (`Alt+Left`); `#heading` links scroll; web and mail links open in the default browser.
- Opening files from the Open dialog (`Ctrl+O`), by double-click or Open with in Explorer, by drag and drop, and from the command line (`MDReader.exe "C:\Documents\README.md"`). A second launch hands its file to the running window, and a file requested while the window is still starting is held until it is ready.
- Documents up to 5 MiB, in UTF-8, UTF-16 (with a byte-order mark) or Windows-1252. Long documents render progressively, so the window stays responsive.
- Light and dark themes that follow Windows until chosen, zoom from 50% to 300% (toolbar, `Ctrl+Plus`, `Ctrl+Minus`, `Ctrl+0`, `Ctrl` + mouse wheel), reload with `F5`, close with `Ctrl+W`. Theme and zoom are remembered.
- A start screen with an Open button, the keyboard shortcuts and a shortcut to Windows' Default apps settings. A status bar with file name, size, word count, reading time and line count. Clear, specific messages for files that are missing, unreadable, too large or not Markdown.
- A per-user installer (no administrator rights) that registers `.md` and `.markdown` files, adds MD Reader to Open with and to Settings > Default apps, and creates Start menu and Desktop shortcuts. A portable executable. Both are 64-bit and not code-signed.
- Security by design: context isolation, sandbox and no Node.js in the page; a private `app://` origin; a strict Content Security Policy; validated messages between the page and the main process, with no path the page can name for itself (a dropped file's path comes from the drop, and Back is limited to documents already shown); allow-listed external links; refusal of network shares, device names and NTFS alternate data streams in document paths, also when they are reached through a symbolic link or junction; no client certificate is ever presented to a server; and Electron's runtime hardening switched on in the packaged app.
- Protection against files made to hang or crash the window: documents that nest quotes or lists absurdly deep are shown as plain text, very long code lines are not syntax-highlighted, the chunking of long documents runs in linear time, and a part of a document that cannot be drawn is replaced by a message while the rest is shown.
- Automated checks: unit and integration tests, end-to-end tests that drive the real application (also run against the packaged and the installed application), tests of the installer configuration and of the release scripts and workflows, and a contrast check of both themes.
- GitHub Actions: CI on Windows for every push and pull request, and a release workflow that builds, tests, installs and uninstalls the installer, writes `SHA256SUMS.txt` and publishes a GitHub Release when a `v*` tag is pushed.
