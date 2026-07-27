---
id: release-fast-publish-dependency-sync-003
scope: macOS ARM fast-publish locked dependency synchronization
status: in-progress
depends-on: [release-fast-publish-version-code-002]
---

# Fast publish locked dependency synchronization

## Objective

Make `yarn fast_publish:mac_arm` synchronize installed dependencies from the committed Yarn lockfile
before it changes release metadata or starts the signed build.

## Context

- `docs/issues/fast-publish-stale-native-dependencies.md`
- `docs/features/sqlite-migration-release-gate.md`
- `docs/plan/tasks/release-fast-publish-version-code-002.md`
- `package.json`
- `scripts/sqlite-migrations/release-hook.test.mjs`

## Implementation contract

- Preserve source synchronization as the first operation.
- Run `yarn install --frozen-lockfile` immediately after synchronization.
- Run `patch.js` only after the dependency install succeeds, followed by the existing signing-debug
  macOS ARM build and production publication.
- Keep every boundary fail-fast with `&&`.
- Do not change `electron-builder.tmp.yml` or its generated output for this dependency-state issue.
- Do not execute a real build, signing, notarization, upload, or CDN refresh during verification.

## Path

- `docs/features/sqlite-migration-release-gate.md`
- `docs/issues/fast-publish-stale-native-dependencies.md`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `docs/plan/tasks/release-fast-publish-dependency-sync-003.md`
- `package.json`
- `scripts/sqlite-migrations/release-hook.test.mjs`

## Verification

- The focused source contract proves pull → frozen install → patch → build → publish ordering.
- `yarn test:sqlite-migrations`
- `git diff --check`
- Independent review before merge.
- In the primary workspace only: frozen-lockfile install, Yarn integrity check, installed-version
  checks, and native-binding architecture inspection.

