# Changelog

All notable changes to MD Reader are recorded in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Automatic updates. The installed app looks on GitHub for a newer version about 15 seconds after it starts and every six hours while it is open (and 15 minutes after a check that failed), downloads it in the background (only what changed, when it can), and installs it when you close the app; **Restart now** does it at once. No administrator rights are needed and settings are kept. The start screen has an **Updates** section with the version, **Check for updates** and **Turn off automatic updates**, and a one-time notice explains the check. The portable executable only reports that a newer version exists. Copies of 1.0.0 have no updater and are updated by hand once.
- Release checks for the update files: `npm run verify:release` now checks that `latest.yml` names the installer with its size and SHA-512 and holds nothing this app does not use (a staged rollout, a minimum system version, administrator rights), that the installer's `.blockmap` is there, and that the package's update configuration points at this repository only. The release workflow attaches `latest.yml` and the blockmap to the release, and `SHA256SUMS.txt` lists them too.
- `scripts/check-version.mjs` refuses a pre-release label other than `beta.N` or `alpha.N`: installed copies are carried on to the final release only from those, so a copy on `1.2.0-rc.1` would never see `1.2.0`. A unit test runs it on the version in `package.json`, so a bad label is found before a tag is pushed, not after.
- `update.log` in `%APPDATA%\MD Reader`: a small log (under about 200 KB, local only) of what the updater did and why, for the day an update does not arrive. A packaged app has no console, so the update library's own messages would otherwise be lost.
- CI and the release workflow try the whole update flow against a feed that the runner serves, and the installer test installs once more the way the updater does, from the updater's own folder. A test of the packaged app starts a check with every request sent to a proxy that refuses it, and checks that it fails cleanly and is logged.
- The end-to-end tests refuse an empty `MDREADER_EXE`, which would have started the development build in place of the installed app and passed.

### Changed

- The README, the architecture notes and the sample document no longer say the app never uses the network: it contacts GitHub to look for updates, and one button turns that off. There is still no account and no telemetry.
- The installer keeps the copy of itself that electron-builder stores for updates (about 100 MB in `%LOCALAPPDATA%\md-reader-updater`), so that an update downloads only what changed. The updater also keeps the last installer it downloaded there until the next update replaces it, so the folder can hold about 200 MB. Uninstalling removes it.
- `settings.json` has two more values, for the update choices. Files written by 1.0.0 are read as before.

### Security

- Updates come from one fixed repository, over HTTPS. What a release offers is checked before it is downloaded: one installer with a plain file name (so it cannot point outside the release), a SHA-512, a plain version number, no administrator rights and no web installer. Each download is checked against the SHA-512 in `latest.yml`; an older version never replaces a newer one; release notes are never shown; and the page takes no part in choosing, downloading or installing an update. The release's tag must be `v` followed by the version it offers. A request that gets no answer for a minute is given up on, and so is a chain of more than ten redirects, which neither Electron nor the update library does by itself. A download that keeps failing is tried again after 15 minutes, then an hour, then every six hours. Switching updating off stops a check or a download that is under way, which the library's own cancellation does not (it only fails the promise and lets the file go on arriving).
- The random id of the installation that the update library would send with every request is replaced by a fixed word, so no request tells one installation from another. The library still keeps the id in `%APPDATA%\MD Reader\.updaterId`; it is never sent.
- The builds are still not code-signed, so the app cannot check who built an update: whoever can publish a release on the repository can update every installed copy. `docs/RELEASING.md` says how to keep that safe, and what signing would add.

## [1.0.0] - 2026-10-22

The first release.

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

[Unreleased]: https://github.com/abhijithkm/md-reader/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/abhijithkm/md-reader/releases/tag/v1.0.0
