---
id: release-preview-mac-arm-auto-cut-115
scope: Restore one-step patch bump for the canonical macOS ARM Preview publisher
status: implemented; owner publication verification pending
depends-on: [release-cross-channel-version-identity-108]
verify: node --test scripts/sqlite-migrations/release-hook.test.mjs && node --check scripts/publish.js && git diff --check
---

# Make Preview macOS ARM publish cut the release

## Objective

Make `yarn publish_preview:mac_arm` increment `0.0.84` to the next patch and version code before it
builds/publishes, while retaining one identity across Preview platforms.

## Context

- `docs/features/desktop-release-channels.md`
- `docs/issues/preview-mac-arm-publish-does-not-cut-version.md`
- `docs/issues/cross-channel-release-version-identity-collision.md`
- `docs/plan/tasks/release-cross-channel-version-identity-108.md`

## Path

- `package.json`
- `scripts/sqlite-migrations/release-hook.test.mjs`
- release feature/issue/index documents

## Contract

- Add the existing `scripts/publish.js --bump` option only to `publish_preview:mac_arm`, before its
  existing `--build` execution.
- Keep `publish_preview` delegated to macOS ARM, making both ordinary aliases one-step cut/build/
  publish commands.
- Keep Preview Intel/Windows non-bumping so they reuse the macOS ARM cut identity; retain
  `release:cut` for explicit non-ARM-first/multi-platform operation.
- Do not change `scripts/patch.js`, release ordering, cross-channel identity guards, artifact
  selection, signing/notarization/upload/CDN behavior, or any channel path.
- Preserve the current package identity during implementation. Tests inspect source only and do not
  invoke the publisher or patch script.
- Preserve unrelated `package.json` edits, including the current runtime-profile `name` change.

## Verification

- Update the release-hook package-script guard for exactly one canonical Preview auto-cut.
- Run the focused pure Node release-hook suite and syntax check.
- Run `git diff --check`.
- Do not run patch, build, publish, signing, notarization, upload, CDN refresh, Electron, or E2E.

## Owner verification

- Confirm `package.json` remains `0.0.84` immediately after this code change.
- Run `yarn publish_preview:mac_arm`; confirm the command logs the patch bump to `0.0.85` before
  migration audit/build and publishes Preview metadata/artifacts with that identity.
- Confirm the installed Preview `0.0.84` detects `0.0.85` through its normal update feed.

## Delivery

- Added the existing `--bump` flag only to the canonical macOS ARM Preview publisher and kept it
  before `--build`.
- Kept the generic alias, locked install, Preview Intel/Windows, all Stable/development publishers,
  `release:cut`, release guards, and channel/artifact behavior unchanged.
- Updated the package-script guard to assert exactly one Preview auto-cut and no other platform
  publisher bump.
- Release-hook tests passed 37/37; `node --check scripts/publish.js` and `git diff --check` passed.
  No patch, build, publish, network, Electron, or E2E command ran; local version remains `0.0.84`.
- [Independent review 1](../reviews/release-preview-mac-arm-auto-cut-115-1.md) passed with no P0-P3
  finding.
