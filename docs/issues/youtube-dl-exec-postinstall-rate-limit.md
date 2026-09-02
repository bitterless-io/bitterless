# Unused youtube-dl-exec blocks dependency installation

Status: Fixed

## Observed behavior

`yarn install` fails inside `youtube-dl-exec@3.1.5` because its postinstall requests
`https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest` without authentication and the shared
outbound IP has exhausted GitHub's anonymous API quota.

The package is a direct `devDependency`. Its only source consumer is the standalone
`scripts/ytdl.js` helper, which is not exposed by a Yarn command and is not part of the desktop
runtime. The desktop package audit already classifies `youtube-dl-exec` as forbidden inside the
application bundle.

## Required behavior

- Remove the unused `youtube-dl-exec` dependency and its lockfile entry.
- Delete the orphaned `scripts/ytdl.js` helper rather than leaving a script that fails at runtime.
- Remove audit/test bookkeeping that exists only to classify the package as a build-only
  dependency.
- Preserve every unrelated package, release version, external-tools change, and current-worktree
  edit.
- A clean dependency install must no longer execute the `youtube-dl-exec` postinstall or contact the
  yt-dlp GitHub Releases API because of this package.

## Acceptance

- No non-delivery source, manifest, or lockfile references `youtube-dl-exec`.
- `scripts/ytdl.js` no longer exists.
- The focused desktop package audit test and `git diff --check` pass.
- Electron/E2E, packaging, signing, notarization, publication, and external-tool initialization are
  not run for this removal.

Implementation task:
[desktop-youtube-dl-removal-003](../plan/tasks/desktop-youtube-dl-removal-003.md).

## Resolution

- Removed the direct `youtube-dl-exec` development dependency and deleted its only consumer,
  `scripts/ytdl.js`.
- Regenerated `yarn.lock` offline with lifecycle scripts disabled. Independent lock-graph review
  confirmed that all 33 removed records were reachable only through `youtube-dl-exec`; every
  remaining selector resolves.
- Removed the obsolete desktop audit classification and dev-dependency expectation while preserving
  the existing external-tools and Preview release changes.
- The desktop package audit passed 25/25, dependency/source search and task diff checks passed, and
  [review 1](../plan/reviews/desktop-youtube-dl-removal-003-1.md) found no P1, P2, or P3 issue.
- Install lifecycle, network, Electron/E2E, package/sign/notarize/publish, and external-tool
  initialization were intentionally not run.
