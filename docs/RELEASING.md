# Releasing

Releases are built, tested and published by GitHub Actions ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) when a version tag is pushed. Nothing is published from a developer machine, and the workflow needs no secrets: it uses the `GITHUB_TOKEN` that GitHub provides to every run.

## How a release works

1. You choose a version, update `package.json` and the changelog, and push the commit to `main`.
2. When CI is green, you tag that commit `v<version>` and push the tag.
3. The **Release** workflow starts. Its `build` job (on Windows, with read-only permissions):
   - refuses to continue unless the tag is `v` plus exactly the version in `package.json`;
   - installs from the lockfile, then runs lint, format check, type-check, unit tests and build;
   - builds the installer and the portable executable, and runs `npm run verify:release` on them;
   - runs the end-to-end tests against the packaged app, and starts the portable executable with a document to check that it opens it;
   - builds an older installer (version 0.0.1), installs the new installer over it, checks the result, runs the end-to-end tests against the **installed** app, then uninstalls and checks that nothing is left behind;
   - writes `SHA256SUMS.txt` and stores the three files as a workflow artifact.
4. Only if all of that succeeded does the `publish` job run (on Linux, the only job with write permission). It checks the files against the checksums and creates the GitHub Release with `gh release create`, with generated release notes, for the tag that was pushed. A version containing a hyphen (such as `1.1.0-beta.1`) is marked as a pre-release.

The release contains `MDReader-Setup-<version>.exe` (the installer, the main download), `MDReader-Portable-<version>.exe` and `SHA256SUMS.txt`.

## Before you release

- `main` is green on the **CI** workflow.
- You have run the [manual Windows checklist](TESTING.md#manual-windows-test-checklist) on a clean machine, at least for the first release and whenever the installer, the file associations or file opening changed. A dry run (below) gives you the installer to test.
- You know the repository and branch you are about to push to. The release is built from the tagged commit, so tag the commit you tested.

## Release steps

**1. Choose the version** ([Semantic Versioning](https://semver.org/): breaking change, feature, fix) and set it in `package.json` and `package-lock.json` without letting npm commit or tag:

```bash
npm version 1.0.1 --no-git-tag-version
```

(The first release is 1.0.0, which is already in `package.json`.)

**2. Update [`CHANGELOG.md`](../CHANGELOG.md).** Rename the `## [Unreleased]` heading to `## [1.0.1] - YYYY-MM-DD` and add a new, empty `## [Unreleased]` section above it.

**3. Commit.** Make sure the Git author name and email are the ones you want in the public history (`git config user.name`, `git config user.email`), then:

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release 1.0.1"
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
git tag -a v1.0.1 -m "MD Reader 1.0.1"
git show v1.0.1 --stat
git push origin v1.0.1
```

`git show` should name the commit you just pushed. Pushing the tag is what starts the release. Do not push all tags at once (`git push --tags`).

**7. Watch the Release workflow** in the Actions tab. If the tag does not match `package.json`, it stops in its first step and publishes nothing.

**8. Check the result.** On the Releases page the release should list the installer, the portable executable and `SHA256SUMS.txt`, and the notes should mention that the build is unsigned. A pre-release shows the Pre-release label. Download the installer, compare `Get-FileHash -Algorithm SHA256` with `SHA256SUMS.txt`, and install it on a clean machine.

## Dry run

To build and test everything without publishing, open **Actions > Release > Run workflow**, choose a branch, and run it. The workflow does every step of the `build` job (the tag check is replaced by a check of the version in `package.json`) and skips `publish`, because that job only runs for tags. Download the `md-reader-release` artifact from the run to try the installer. Do this before the first release, and whenever you change the workflow, the installer or the packaging: it is the only way to exercise the workflow itself.

## Pre-releases

Use a version such as `1.1.0-beta.1` in `package.json` and tag `v1.1.0-beta.1`. The release is published with the pre-release flag, so it is not shown as the latest release.

## If something goes wrong

Never delete or move a tag or a release that has been pushed, and never force-push. Move forward instead.

- **The workflow failed before `publish`:** nothing was published. If the cause was temporary (a runner problem, a flaky download), use **Re-run failed jobs** on the run. Otherwise fix the problem on `main` and release a new version (for example 1.0.2). The failed tag stays where it is.
- **`publish` failed or stopped half way** (for example an upload failed): `gh release create` creates the release as a draft, uploads the files, and only then publishes it, so a failure leaves a **draft** under Releases that nobody can see. Do not delete it. Download the `md-reader-release` artifact from the workflow run, add what is missing with `gh release upload <tag> <file>` (without `--clobber`, so a file is never replaced), check the list against `SHA256SUMS.txt`, and publish it with `gh release edit <tag> --draft=false`. Or release a new version.
- **A bad release went out:** release a fixed version and edit the notes of the bad one to point to it.

## Code signing

The releases are **not code-signed**: no certificate is configured, the README says so, and Windows SmartScreen warns on first run. To sign in the future you need a code-signing certificate or a cloud signing service, the corresponding `win` signing options in `electron-builder.yml` (see the electron-builder documentation for Windows code signing), the certificate or credentials stored as GitHub Actions secrets and passed only to the `Build the installer and the portable executable` step, and a check in `scripts/verify-release.mjs` that fails when the output is not signed. Update the README at the same time. `tests/builder-config.test.ts` currently asserts that the configuration contains no signing settings, so it will need to change with them.

## Recommended repository settings

- **Protect release tags.** Settings > Rules > Rulesets: a ruleset for tags matching `v*` that restricts deletion and updates. It makes "never move or delete a tag" a rule instead of a habit.
- **Release immutability.** If your repository offers it, turn it on: once a release is published, its tag and its files can no longer be changed or deleted. (Drafts, such as one left by a failed `publish`, stay editable.)
- **Protect `main`.** Require the **CI** workflow to pass before merging.
- **Actions permissions.** Leave the default workflow permission at "Read repository contents"; the release workflow asks for write access only in its `publish` job.
- **Security.** Enable private vulnerability reporting, which the README points reporters to.
