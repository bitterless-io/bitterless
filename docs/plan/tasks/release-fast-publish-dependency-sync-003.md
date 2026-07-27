---
id: release-fast-publish-dependency-sync-003
scope: Electron 40 runtime pin and macOS ARM fast-publish locked dependency synchronization
status: implemented; owner verification pending
depends-on: [release-fast-publish-version-code-002]
---

# Fast publish locked dependency synchronization

## Objective

Keep the desktop runtime on Electron `40.10.6` with
`better-sqlite3-multiple-ciphers@12.11.1`, and make `yarn fast_publish:mac_arm` synchronize those
locked dependencies before it changes release metadata or starts the signed build.

## Context

- `docs/issues/fast-publish-stale-native-dependencies.md`
- `docs/features/sqlite-migration-release-gate.md`
- `docs/issues/browser-identity-inconsistent-across-embedded-views.md`
- `docs/plan/tasks/release-fast-publish-version-code-002.md`
- `docs/plan/tasks/pin-electron-sqlite-compatibility.md`
- `package.json`
- `yarn.lock`
- `scripts/sqlite-migrations/release-hook.test.mjs`

## Implementation contract

- Pin Electron exactly to `40.10.6` and SQLite exactly to `12.11.1` in both manifest and lockfile.
- Remove the `node-abi@4.33.0` resolution that was required only by the reverted Electron 43 change.
- Preserve source synchronization as the first operation.
- Run `yarn install --frozen-lockfile` immediately after synchronization.
- Run `patch.js` only after the dependency install succeeds, followed by the existing signing-debug
  macOS ARM build and production publication.
- Keep every boundary fail-fast with `&&`.
- Do not change `electron-builder.tmp.yml` or its generated output for this dependency-state issue.
- Do not execute a real build, signing, notarization, upload, or CDN refresh during verification.

## Path

- `docs/features/sqlite-migration-release-gate.md`
- `docs/issues/browser-identity-inconsistent-across-embedded-views.md`
- `docs/issues/fast-publish-stale-native-dependencies.md`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `docs/plan/tasks/release-fast-publish-dependency-sync-003.md`
- `docs/plan/tasks/pin-electron-sqlite-compatibility.md`
- `package.json`
- `scripts/sqlite-migrations/release-hook.test.mjs`
- `yarn.lock`

## Verification

- The focused source contract proves pull → frozen install → patch → build → publish ordering.
- Manifest and lockfile source checks prove Electron `40.10.6`, SQLite `12.11.1`, and no forced
  `node-abi@4.33.0` resolution.
- `yarn test:sqlite-migrations`
- `git diff --check`
- Independent review before merge.
- In the primary workspace only: frozen-lockfile install, Yarn integrity check, installed-version
  checks, and native-binding architecture inspection.

## Completion — 2026-07-27

- Electron is restored to exact `40.10.6`; SQLite remains upgraded to exact `12.11.1`; the
  Electron 43-only `node-abi@4.33.0` resolution is gone from manifest and lockfile.
- `fast_publish:mac_arm` now runs pull → frozen install → patch → signing-debug build → publish in
  strict fail-fast order.
- The focused release-hook suite passed 14/14 and `git diff --check` passed. No install, build,
  packaging, signing, notarization, upload, or publication was run in the isolated verification
  worktree.
- After merge, the primary workspace frozen-lockfile install and Yarn integrity check passed.
  Installed Electron `40.10.6` loaded SQLite `12.11.1` through its arm64 native binding under ABI
  143 and opened an in-memory database successfully.
- Independent review passed without P1, P2, or P3 finding; see
  [`release-fast-publish-dependency-sync-003-1`](../reviews/release-fast-publish-dependency-sync-003-1.md).
- Owner verification remains the final signed macOS ARM fast-publish run.
