---
id: release-packaged-update-feed-url-109
scope: give every packaged app-update.yml the exact channel/platform updater directory from one shared mapping
status: pending
depends-on: [release-preview-channel-007]
verify: yarn test:desktop-auto-update && yarn test:desktop-package-audit && node --check scripts/package/desktopPackage.audit.cjs && git diff --check
---

# Write the real updater feed into every package

## Objective

Replace the `https://example.com/auto-updates` placeholder in every packaged `app-update.yml` with
the exact updater directory for that package's channel and platform, from a mapping shared with the
runtime updater, without changing how an actual update is authorized.

## Context

- `docs/issues/packaged-update-feed-url-placeholder.md`
- `docs/features/desktop-release-channels.md`
- `docs/features/desktop-auto-update.md`
- `src/main/updateHelper/updateChannel.service.ts`

## Path

- `scripts/release/releaseChannel.cjs`
- `scripts/package/desktopPackage.audit.cjs`
- `electron-builder.tmp.yml`
- `tests/update/updateChannel.test.mjs`
- `scripts/package/desktopPackageAudit.test.mjs`
- feature, issue, plan, and index documents

## Contract

- Put the release base URL and the channel/platform → directory mapping in `releaseChannel.cjs`, and
  prove by test that it produces the same strings as `resolveUpdateDirectory()` in
  `src/main/updateHelper/updateChannel.service.ts`. The runtime file stays the behavioral authority;
  packaging must not fork the value.
- Resolve the platform token in the `afterPack` hook from the packed target: `darwin`+`arm64` →
  `mac_arm`, `darwin`+`x64` → `mac_intel`, `win32`+`x64` → `win64`. Throw on any other target — no
  default, no fallback.
- Rewrite `app-update.yml` in place in `afterPack`, which runs before macOS code signing, so the
  resource is signed in its final state. Handle both layouts: `<app>.app/Contents/Resources/` on
  macOS and `resources/` on Windows.
- Preserve `provider: generic` and the existing `updaterCacheDirName`, including Preview's distinct
  cache directory. Change only the `url`.
- Extend the existing package audit to reject a package whose `app-update.yml` is missing, whose
  host is not the release host, or whose directory does not match the selected channel and platform.
  Fail closed before signing.
- Leave `electron-builder.tmp.yml` `publish.provider` as `generic`. If its `url` is kept as a
  build-time value, it must be the release host — never a placeholder domain.
- Do not change `UpdateService`, `setFeedURL()`, the manifest assertions, polling, or the
  install path. The verified manifest stays the authority for an actual update.
- Do not modify or discard unrelated dirty-worktree changes.

## Verification

- Fixture: `afterPack` rewrites `app-update.yml` to the exact directory for each of `mac_arm`,
  `mac_intel`, and `win64`, on both resource layouts, for all three channels.
- Fixture: an unsupported platform/arch combination throws.
- Equality test: packaging mapping and base URL match
  `src/main/updateHelper/updateChannel.service.ts`.
- Audit test: placeholder host, wrong channel directory, wrong platform directory, and missing file
  are each rejected.
- `yarn test:desktop-auto-update`, `yarn test:desktop-package-audit`, `node --check` on the modified
  packaging script, and `git diff --check`.
- Do not invoke package builds, signing, notarization, publication, network operations, Electron,
  Playwright, or E2E.

## Owner Verification

- After the next package run, read `Contents/Resources/app-update.yml` inside the produced bundle
  and confirm it names that channel and platform.
- Confirm an update still downloads and installs normally on the produced package.
