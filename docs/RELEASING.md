# Releasing

Releases are built, tested and published by GitHub Actions ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) when a version tag is pushed. Nothing is published from a developer machine, and the workflow needs no secrets: it uses the `GITHUB_TOKEN` that GitHub provides to every run.

## How a release works

1. You choose a version, update `package.json` and the changelog, and push the commit to `main`.
2. When CI is green, you tag that commit `v<version>` and push the tag.
3. The **Release** workflow starts. Its `build` job (on Windows, with read-only permissions):
   - refuses to continue unless the tag is `v` plus exactly the version in `package.json`;
   - installs from the lockfile, then runs lint, format check, type-check, unit tests and build;
   - tries the whole update flow against a feed that the runner itself serves (find, download, check the hash, announce, switch off, give up on a feed that stops answering);
   - builds the installer and the portable executable, and runs `npm run verify:release` on them, which includes checking that `latest.yml` names the installer with its size and SHA-512, that the block map is there, and that the update configuration points at this repository only;
   - runs the end-to-end tests against the packaged app, and starts the portable executable with a document to check that it opens it;
   - builds an older installer (version 0.0.1), installs the new installer over it, then installs it once more the way the updater does (from the updater's folder, with `--updated /S`), checks the result, runs the end-to-end tests against the **installed** app, then uninstalls and checks that nothing is left behind;
   - writes `SHA256SUMS.txt` and stores the release files (the installer, its `.blockmap`, the portable executable, `latest.yml` and the checksums) as a workflow artifact.
4. Only if all of that succeeded does the `publish` job run (on Linux, the only job with write permission). It checks the files against the checksums and creates the GitHub Release with `gh release create`, with generated release notes, for the tag that was pushed. A version containing a hyphen (such as `1.1.0-beta.1`) is marked as a pre-release; its label must be `beta.N` (or `alpha.N`), and the first step refuses any other (see [Pre-releases](#pre-releases)).

The release contains `MDReader-Setup-<version>.exe` (the installer, the main download), `MDReader-Portable-<version>.exe`, `SHA256SUMS.txt`, and two files that installed copies read to update themselves: `latest.yml` and `MDReader-Setup-<version>.exe.blockmap`. A person downloading does not need those two. `SHA256SUMS.txt` lists the hash of every file but itself, so the `publish` job checks all four.

## Before you release

- `main` is green on the **CI** workflow.
- You have run the [manual Windows checklist](TESTING.md#manual-windows-test-checklist) on a clean machine, at least for the first release and whenever the installer, the file associations or file opening changed. A dry run (below) gives you the installer to test.
- You know the repository and branch you are about to push to. The release is built from the tagged commit, so tag the commit you tested.
- **For the first release with an updater (1.1.0), two pre-releases come first.** Release `1.1.0-beta.1`, install it on a clean machine, release `1.1.0-beta.2`, and see beta.1 update itself to beta.2 ([the checklist](TESTING.md#updates)). It is the only way to try downloading from GitHub and installing when the app closes, which no automated test can do. Do not release `1.1.0` before that works. If beta.1 does not update itself, `update.log` in its `%APPDATA%\MD Reader` folder says why.
- **Decide about code signing before `1.1.0`** (see [Code signing](#code-signing)). Until the builds are signed, whoever can publish a release can run a program on every installed copy: read [Keeping updates safe](#keeping-updates-safe) and set up what it asks for.

## Release steps

**1. Choose the version** ([Semantic Versioning](https://semver.org/): breaking change, feature, fix) and set it in `package.json` and `package-lock.json` without letting npm commit or tag:

```bash
npm version 1.1.0-beta.1 --no-git-tag-version
```

(1.0.0 was the first release. The next, the first with an updater, is 1.1.0: it goes out as `1.1.0-beta.1`, then `1.1.0-beta.2`, then `1.1.0`. A pre-release label must be `beta.N`.)

**2. Update [`CHANGELOG.md`](../CHANGELOG.md).** For a pre-release leave it as it is. For a final release, rename the `## [Unreleased]` heading to `## [1.1.0] - YYYY-MM-DD`, add a new, empty `## [Unreleased]` section above it, and change the links at the bottom of the file: `[Unreleased]` compares from the new tag (`.../compare/v1.1.0...HEAD`), and the new version gets a line of its own (`[1.1.0]: .../releases/tag/v1.1.0`).

**3. Commit.** Make sure the Git author name and email are the ones you want in the public history (`git config user.name`, `git config user.email`), then:

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release 1.1.0-beta.1"
```

**4. Check the Git state before pushing anything:**

```bash
git status
git branch --show-current
git remote -v
git log --oneline origin/main..HEAD
```

You should be on `main`, with a clean working tree, and the remote should be `github.com/abhijithkm/md-reader`. The last command lists exactly the commits you are about to publish.

**5. Push the commit and wait for CI:**

```bash
git push origin main
```

Open the Actions tab and wait for the **CI** workflow to pass on that commit.

**6. Tag the commit that passed and push the tag:**

```bash
git tag -a v1.1.0-beta.1 -m "MD Reader 1.1.0-beta.1"
git show v1.1.0-beta.1 --stat
git push origin v1.1.0-beta.1
```

`git show` should name the commit you just pushed. Pushing the tag is what starts the release. Do not push all tags at once (`git push --tags`).

**7. Watch the Release workflow** in the Actions tab. If the tag does not match `package.json`, it stops in its first step and publishes nothing.

**8. Check the result.** On the Releases page the release should list five files: the installer, its `.blockmap`, the portable executable, `latest.yml` and `SHA256SUMS.txt`. The notes should mention that the build is unsigned, and a pre-release shows the Pre-release label. Open `latest.yml` (a small text file): it names the installer and the version. Download the installer, compare `Get-FileHash -Algorithm SHA256` with `SHA256SUMS.txt`, and install it on a clean machine.

## Dry run

To build and test everything without publishing, open **Actions > Release > Run workflow**, choose a branch, and run it. The workflow does every step of the `build` job (the tag check is replaced by a check of the version in `package.json`) and skips `publish`, because that job only runs for tags. Download the `md-reader-release` artifact from the run to try the installer. Do this before the first release, and whenever you change the workflow, the installer or the packaging: it is the only way to exercise the workflow itself.

## Pre-releases

Use a version such as `1.1.0-beta.1` in `package.json` and tag `v1.1.0-beta.1`. The release is published with the pre-release flag, so it is not shown as the latest release.

The label must be `beta.N` (or `alpha.N`), and `scripts/check-version.mjs` refuses anything else. That is not a matter of taste: the update library carries a copy that is a pre-release on only to releases with the same label, and to the final release only from `alpha` and `beta`. A copy on `1.2.0-rc.1` would see other `rc` releases and never `1.2.0`.

## Updates

Installed copies update themselves from the releases of this repository, so every release is also an update for everyone who has MD Reader installed. What that means for you:

- **How a copy finds the new version.** A copy that is not a pre-release asks GitHub for the newest release that is not marked as a pre-release. A copy that is a beta reads the list of all releases and takes the newest beta or final one. Either way it reads `latest.yml` from the release's files, checks what is offered, and downloads the installer named there, checking it against the SHA-512 in that file. So `latest.yml` and the installer must both be attached to the release, and they must agree. The workflow builds them together, `npm run verify:release` checks that `latest.yml` names the installer with its real size and SHA-512 and holds nothing this app does not use (a staged rollout, a minimum system version, administrator rights, a web installer) and that the block map is attached (only that it is there: its content is not examined), and `gh release create` makes the release public only after every file is uploaded.
- **Never delete or replace a published release, its tag or its files.** A copy that is checking for updates, or is halfway through a download, would fail. Fix a bad release by publishing a higher version. Editing the release notes, or the pre-release flag, is fine.
- **A stop-gap for a bad release.** Editing the release to tick "Set as a pre-release" makes copies that have not updated yet stop seeing it as the latest release. It does not help copies that already downloaded it: they install it when they close the app. Nor does it help copies that already updated; they get the fix with the next version. Check that GitHub still lets you change that flag if you turned release immutability on.
- **Trying the whole update path.** A pre-release is offered only to copies that are pre-releases themselves, so it can be used to try updating safely: release `X.Y.Z-beta.1`, install it, release `X.Y.Z-beta.2`, and watch the first one update itself, as in the [manual checklist](TESTING.md#updates). electron-builder names the update file `latest.yml` for every version; a beta copy looks for `beta.yml` first and falls back to `latest.yml`, so no extra file is needed. When you then release `X.Y.Z`, the beta copies move on to it.
- **The first release with an updater is 1.1.0.** Copies of 1.0.0 have no updater and are updated by hand once.
- **Not code-signed.** The updater checks the hash in `latest.yml`, but with no certificate it cannot check who built the file. The publishing account and the release workflow are therefore the only thing between an attacker and every installed copy: see [Keeping updates safe](#keeping-updates-safe).

## If something goes wrong

Never delete or move a tag or a release that has been pushed, and never force-push. Move forward instead.

- **The workflow failed before `publish`:** nothing was published. If the cause was temporary (a runner problem, a flaky download), use **Re-run failed jobs** on the run. Otherwise fix the problem on `main` and release a new version (for example 1.0.2). The failed tag stays where it is.
- **`publish` failed or stopped half way** (for example an upload failed): `gh release create` creates the release as a draft, uploads the files, and only then publishes it, so a failure leaves a **draft** under Releases that nobody can see. Do not delete it. Download the `md-reader-release` artifact from the workflow run, add what is missing with `gh release upload <tag> <file>` (without `--clobber`, so a file is never replaced), check that all five files are there (the installer, its `.blockmap`, the portable executable, `latest.yml` and `SHA256SUMS.txt`) and the hashes against `SHA256SUMS.txt`, and publish it with `gh release edit <tag> --draft=false`. Or release a new version.
- **A bad release went out:** release a fixed version and edit the notes of the bad one to point to it.

## Code signing

The releases are **not code-signed**: no certificate is configured, the README says so, and Windows SmartScreen warns on first run. To sign in the future you need a code-signing certificate or a cloud signing service, the corresponding `win` signing options in `electron-builder.yml` (see the electron-builder documentation for Windows code signing), the certificate or credentials stored as GitHub Actions secrets and passed only to the `Build the installer and the portable executable` step, and a check in `scripts/verify-release.mjs` that fails when the output is not signed. Update the README at the same time. `tests/builder-config.test.ts` currently asserts that the configuration contains no signing settings, so it will need to change with them.

**Signing and updates.** With a signed build, electron-builder writes the publisher name into the `app-update.yml` inside the package: by default the common name of the certificate, or the name set in `win.signtoolOptions.publisherName` (`win.azureSignOptions.publisherName` for Azure signing), as long as `win.verifyUpdateCodeSignature` is left on, which is its default. Installed copies then check the signature of every downloaded update against that name before they run it. An attacker who only controls a release can then no longer make them run an unsigned file, which is the whole risk described in [Keeping updates safe](#keeping-updates-safe). `scripts/lib/update-metadata.mjs` and its tests currently reject `publisherName`, because this app has none, so they change with it.

## Keeping updates safe

Every installed copy runs whatever the newest release of this repository contains. The builds are not code-signed, so the only thing an installed copy checks is the hash in `latest.yml`, which comes from the same release. Whoever can publish a release can therefore run a program on every computer that has automatic updates on. Treat the ability to publish as the keys to those computers:

- **Control who can start a release.** A tag matching `v*` starts the release workflow, so restrict creating them (see the ruleset below), and keep the list of people with write access to the repository as short as possible.
- **Ask for a second look before publishing.** Put the `publish` job in a GitHub Environment (for example `release`) with yourself as required reviewer, and every release waits for a click after the build has passed. This needs a small change to `release.yml` and is not made yet.
- **Protect the account.** Use a passkey or two-factor authentication, and treat a change to `.github/workflows`, `electron-builder.yml`, `package.json` (scripts and dependencies) or the lockfile as a change to what runs on users' computers.
- **Never rename, transfer or delete the repository or the account while copies are installed.** They look for updates at `github.com/abhijithkm/md-reader`. A name that is freed can be registered by someone else, who would then be where every installed copy gets its updates. GitHub redirects a renamed repository, but do not rely on that. If the project has to move, publish a last release that points to the new place first.
- **Watch the dependencies.** Dependabot alerts are a repository setting (Settings > Advanced Security): they warn about known vulnerabilities in the dependencies whether or not `.github/dependabot.yml` exists, so switch them on. That file only decides which ecosystems get pull requests that update them, and it currently covers GitHub Actions only. Adding the `npm` ecosystem would also open pull requests for the pinned dependencies, `electron-updater` among them. It is not added yet.
- **Sign the builds** when a certificate is available (see [Code signing](#code-signing)): that is the one measure that does not depend on the account staying safe.

## Recommended repository settings

- **Protect release tags.** Settings > Rules > Rulesets: a ruleset for tags matching `v*` that restricts creation, deletion and updates to you. It makes "never move or delete a tag" a rule instead of a habit, and keeps anyone else from starting a release.
- **Protect the account that publishes.** It is the trust root of every update: use a passkey or two-factor authentication, keep the list of people who can push tags short, and review any change to `.github/workflows` before it reaches `main`.
- **Release immutability.** If your repository offers it, turn it on: once a release is published, its tag and its files can no longer be changed or deleted. (Drafts, such as one left by a failed `publish`, stay editable.)
- **Protect `main`.** Require the **CI** workflow to pass before merging.
- **Actions permissions.** Leave the default workflow permission at "Read repository contents"; the release workflow asks for write access only in its `publish` job.
- **Security.** Enable private vulnerability reporting, which the README points reporters to.
