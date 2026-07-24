---
id: release-fast-publish-version-code-002
scope: macOS ARM fast-publish version-code preparation
status: done
depends-on: []
---

# Fast publish version-code preparation

## Objective

Make `yarn fast_publish:mac_arm` run the existing patch preparation after source sync and before
packaging so both the patch version and `version_code` advance automatically.

## Context

- `docs/INDEX.md`
- `docs/features/sqlite-migration-release-gate.md`
- `docs/issues/macos-dmg-notarization-upload-timeout.md`
- `scripts/patch.js`
- `scripts/publish.js`

## Implementation contract

- Reuse `scripts/patch.js` unchanged so it increments `version` and `_version`, generates the local
  `YYMMDDHHmmss` `version_code`, removes legacy `versionCode`, and rejects non-increasing values.
- `fast_publish:mac_arm` runs source synchronization first, patch preparation second, the existing
  signing-debug build third, and publication last.
- Fail before build when patch preparation fails.
- Do not execute a real build, signing, notarization, upload, or CDN refresh during verification.

## Path

- `docs/features/sqlite-migration-release-gate.md`
- `docs/plan/README.md`
- `docs/plan/tasks/release-fast-publish-version-code-002.md`
- `package.json`
- `scripts/sqlite-migrations/release-hook.test.mjs`

## Verification

- Source contract proves `fast_publish:mac_arm` orders pull, version-code preparation, build, and
  publish correctly while retaining build-stage-only `electron-osx-sign` debug output.
- `yarn test:sqlite-migrations`
- `git diff --check`

## Completion — 2026-07-24

- `fast_publish:mac_arm` now runs `git_pull.js`, the existing `patch.js`, the signing-debug macOS
  ARM build, and publication in strict fail-fast order.
- Existing patch preparation advances both the patch version and `version_code`; an invalid or
  non-increasing code stops before build.
- The focused release-hook suite passed 13/13 twice, including independent review. No real build,
  signing, notarization, upload, or CDN refresh was run.
- Independent review passed with no P1, P2, or P3 finding; see
  [`release-fast-publish-version-code-002-1`](../reviews/release-fast-publish-version-code-002-1.md).

## Regression recovery — 2026-07-24

The release branch retained this completed task and review but later contained the old
`fast_publish:mac_arm` command and matching old source test. Reopen the task and restore the
documented `git_pull.js` → `patch.js` → signing-debug build → publish chain. The recovery is
complete only after a new independent review and merge into `release/2604`, because the shortcut's
initial `git_pull.js` discards uncommitted local repairs.

Recovery commit `5e8f0a3` restored the contract and exact source test. Independent regression review
passed with no P1, P2, or P3 finding, and the focused release-hook suite passed 13/13; see
[`release-fast-publish-version-code-002-2`](../reviews/release-fast-publish-version-code-002-2.md).
