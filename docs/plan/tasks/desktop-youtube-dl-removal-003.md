---
id: desktop-youtube-dl-removal-003
scope: remove an unused download helper whose postinstall depends on the GitHub Releases API
status: done
depends-on: []
verify: focused desktop package audit test, dependency/source search, diff check, independent review
---

# Remove unused youtube-dl-exec

## Objective

Remove `youtube-dl-exec` and its orphaned standalone helper so dependency installation no longer
downloads yt-dlp or consumes the unauthenticated GitHub API quota.

## Context

- `docs/issues/youtube-dl-exec-postinstall-rate-limit.md`
- `docs/issues/desktop-package-includes-build-only-dependencies.md`

## Path

- `package.json`
- `yarn.lock`
- `scripts/ytdl.js`
- `scripts/package/desktopPackage.audit.cjs`
- `scripts/package/desktopPackageAudit.test.mjs`
- this task, its issue, plan/index entries, and review artifact

## Contract

- Remove only the direct `youtube-dl-exec` development dependency and lockfile records made
  unreachable by that removal.
- Delete `scripts/ytdl.js`, its sole project consumer.
- Remove the obsolete audit banned-package entry and the test expectation that requires the package
  to remain a development dependency.
- Do not replace it with another downloader, add a global executable requirement, or modify the new
  Maestro external-tools inventory.
- Preserve the current release version and every unrelated dirty-worktree change, especially nearby
  external-tools package/audit edits.
- Do not run lifecycle scripts, Electron/E2E, packaging, signing, notarization, publication, or
  external-tool initialization.

## Verification

- update `yarn.lock` without lifecycle scripts;
- search source, package manifest, and lockfile for remaining dependency references;
- `yarn test:desktop-package-audit`;
- `git diff --check` on task-owned paths;
- independent source review for P0-P2 regressions and unrelated-change loss.

## Delivery

- Removed `youtube-dl-exec` from `devDependencies`, deleted the orphaned `scripts/ytdl.js`, and
  removed its two obsolete package-audit bookkeeping entries.
- Updated `yarn.lock` offline with lifecycle scripts disabled. Independent review proved that the
  33 deleted records were orphan-only and that the remaining 1,417-record graph has no unresolved
  selector.
- Preserved the existing external-tools, release-channel, package-audit, and Preview version changes
  in the dirty worktree.
- `yarn test:desktop-package-audit` passed 25/25; residual dependency/source search and task-scoped
  `git diff --check` passed.
- [Independent review 1](../reviews/desktop-youtube-dl-removal-003-1.md) passed with no P1, P2, or P3
  finding.
- Install lifecycle, network, Electron/E2E, package/sign/notarize/publish, and external-tool
  initialization were intentionally not run.
