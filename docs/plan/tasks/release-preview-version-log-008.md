---
id: release-preview-version-log-008
scope: restore the existing-remote Preview preflight branch after release helper extraction
status: done
depends-on: [release-preview-channel-007]
verify: focused pure Node release-hook tests, syntax checks, diff check, independent source review
---

# Restore Preview release-version preflight logging

## Objective

Remove the `releaseVersionCode is not defined` crash from Preview publication without weakening the
remote release-order guard or repeating the already-completed version bump.

## Context

- `docs/issues/preview-publish-version-log-helper-missing.md`
- `docs/features/desktop-release-channels.md`
- `docs/features/sqlite-migration-release-gate.md`
- `docs/plan/tasks/release-preview-channel-007.md`

## Path

- `scripts/release/releaseChannel.cjs`
- `scripts/publish.js`
- `scripts/sqlite-migrations/release-hook.test.mjs`
- this task, its issue, indexes, and review artifact

## Contract

- Export the existing `releaseVersionCode()` helper from `releaseChannel.cjs` and import that exact
  helper into `publish.js`; do not duplicate version-field normalization.
- Export `assertNoRemoteDowngrade()` only to enable a side-effect-free focused regression test.
- The regression must use a fake client's `get()` response, verify the exact manifest object key,
  and prove the valid local/remote version codes reach the success log.
- Do not change version-order policy, release channels, artifact discovery, upload order, network
  configuration, or publishing credentials.
- Preserve the current `package.json` bump to version `0.0.80` and version code `260901100018`.
- Preserve unrelated current-worktree changes.

## Verification

- `node --test scripts/sqlite-migrations/release-hook.test.mjs`
- `node --check scripts/publish.js`
- `node --check scripts/release/releaseChannel.cjs`
- `git diff --check`
- independent review for P0-P2 release-safety defects;
- do not invoke `publish_preview:*`, build, Electron/E2E, signing, notarization, upload, CDN, or
  network operations.

## Delivery

- Exported/imported the existing release-version normalizer and used it for local release ordering;
  no duplicate fallback or relaxed comparison was introduced.
- Exported `assertNoRemoteDowngrade()` for a focused fake-client regression covering the exact
  existing Preview manifest and success-log branch.
- Preserved the user's already-completed `0.0.80 / 260901100018` bump; task 008 did not touch
  `package.json` or execute another bump.
- After task implementation, an operator reran the one-step alias. It advanced `package.json` to
  `0.0.81 / 260901100557` and passed the previously crashing preflight branch before entering the
  build; this subsequent mutation was not made by task 008.
- The focused release-hook suite passed 29/29, both release scripts passed `node --check`, and
  `git diff --check` passed.
- [Independent review 1](../reviews/release-preview-version-log-008-1.md) approved the repair with
  no P0-P2 finding. No build, publish, signing, notarization, network, Electron, or E2E ran.
