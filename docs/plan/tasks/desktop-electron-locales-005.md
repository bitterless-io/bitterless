---
id: desktop-electron-locales-005
scope: packaged Electron Chromium locale allowlist
status: in-progress
depends-on: []
---

# Desktop Electron locale allowlist

## Objective

Limit packaged Electron Chromium locale resources to Simplified Chinese, Traditional Chinese,
Japanese, English, Indonesian, Korean, and French so other locale packs are removed before macOS
code signing.

## Context

- `docs/INDEX.md`
- `docs/features/sqlite-migration-release-gate.md`
- `docs/issues/desktop-package-includes-build-only-dependencies.md`
- `electron-builder.tmp.yml`

## Implementation contract

- Configure Electron Builder's locale allowlist with the exact Electron locale identifiers
  `zh_CN`, `zh_TW`, `ja`, `en`, `id`, `ko`, and `fr`.
- Keep the allowlist in `electron-builder.tmp.yml`, which is the source used by `scripts/before.js`,
  and keep the checked-in generated `electron-builder.yml` synchronized.
- Preserve every existing signing, notarization, package audit, binary, and resource setting.
- Add a focused source test that rejects missing, extra, duplicated, or reordered locales in both
  Builder configuration files.

## Path

- `docs/plan/README.md`
- `docs/plan/tasks/desktop-electron-locales-005.md`
- `electron-builder.tmp.yml`
- `electron-builder.yml`
- `scripts/package/desktopPackageAudit.test.mjs`

## Verification

- Confirm Electron `40.10.6` contains every allowlisted macOS `.lproj/locale.pak` source directory.
- Run the focused desktop package test suite.
- Regenerate `electron-builder.yml` through `scripts/before.js` and prove it matches the template's
  exact locale allowlist.
- Run `git diff --check`.
