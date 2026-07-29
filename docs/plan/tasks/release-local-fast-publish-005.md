---
id: release-local-fast-publish-005
scope: macOS ARM fast publish from the current local working tree
status: in-progress
depends-on: [release-fast-publish-dependency-sync-003, release-notarization-retry-004]
---

# Local-source macOS ARM fast publish

## Objective

Make `yarn fast_publish:mac_arm` publish the current local working tree without automatically
pulling or otherwise mutating Git state.

## Context

- `docs/features/sqlite-migration-release-gate.md`
- `docs/issues/fast-publish-stale-native-dependencies.md`
- `docs/plan/tasks/release-fast-publish-dependency-sync-003.md`
- `package.json`
- `scripts/sqlite-migrations/release-hook.test.mjs`

## Implementation contract

- Remove `node scripts/git_pull.js` from `fast_publish:mac_arm`.
- Do not replace it with `git pull`, fetch, reset, stash, checkout, or any other implicit Git
  operation.
- Treat the current local working tree and local `yarn.lock` as the exact release input.
- Preserve strict fail-fast ordering:
  `yarn install --frozen-lockfile` → `patch.js` → signing-debug `build:mac_arm` →
  `publish:mac_arm`.
- Preserve the existing automatic version/version-code preparation, Electron `40.10.6`, SQLite
  `12.11.1`, notarization retry hook, and DMG publication flow.
- Do not change the macOS Intel shortcut or delete `scripts/git_pull.js`; this task is scoped only to
  macOS ARM fast publish.

## Path

- `docs/INDEX.md`
- `docs/features/sqlite-migration-release-gate.md`
- `docs/issues/fast-publish-stale-native-dependencies.md`
- `docs/plan/README.md`
- `docs/plan/tasks/release-fast-publish-dependency-sync-003.md`
- `docs/plan/tasks/release-local-fast-publish-005.md`
- `package.json`
- `scripts/sqlite-migrations/release-hook.test.mjs`

## Verification

- Source inspection proves the exact local-only command and absence of `git_pull.js` from
  `fast_publish:mac_arm`.
- Source inspection confirms `fast_publish:mac_intel` and `scripts/git_pull.js` remain unchanged.
- Per owner request, do not run tests, install, patch, build, signing, notarization, upload,
  publication, or `yarn fast_publish:mac_arm`.
- The owner performs the release-path verification with `yarn fast_publish:mac_arm`.
