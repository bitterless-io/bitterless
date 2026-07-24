---
id: desktop-mac-dock-icon-size-006
scope: keep the macOS Dock icon at the bundle-default visual size while Bitterless is running
status: done
depends-on: [desktop-mac-dock-icon-004]
---

# macOS Dock Icon Runtime Size Consistency

## Objective

Make the explicit bundle ICNS the sole macOS Dock icon source so opening Bitterless does not replace
the correctly sized default tile with a differently normalized runtime PNG.

## Context

- `docs/features/desktop-app-icon.md`
- `docs/issues/macos-dock-icon-stale.md`
- `docs/issues/macos-dock-icon-runtime-size-mismatch.md`
- `docs/plan/tasks/desktop-mac-dock-icon-004.md`

## Path

- `src/main/app.main.ts`
- `electron-builder.tmp.yml`
- generated `electron-builder.yml`
- `scripts/package/desktopAppIcon.test.mjs`
- `scripts/package/desktopPackage.audit.cjs`
- `scripts/package/desktopPackageAudit.test.mjs`
- `docs/features/desktop-app-icon.md`
- `docs/issues/macos-dock-icon-runtime-size-mismatch.md`
- `docs/plan/tasks/desktop-mac-dock-icon-size-006.md`

## Required behavior

- Do not call `app.dock.setIcon` during macOS GUI startup.
- Remove `app.png` from `extraResources`; `electron-builder.tmp.yml` remains the source and the
  generated `electron-builder.yml` must match it.
- Keep explicit `mac.icon: build/icon.icns` configuration and the packaged ICNS audit.
- Remove runtime-PNG-only audit logic and fixtures without weakening unrelated desktop package
  gates.
- Preserve helper activation policy, startup ordering, signing, notarization, SQLite migration,
  native-module, and package-size behavior.
- Preserve unrelated working-tree changes, especially package version metadata.

## Verification

- `yarn test:desktop-app-icon`
- `yarn test:desktop-package-audit`
- `git diff --check`
- Source review proves no runtime Dock override remains and both builder YAML files match.
- No Electron launch, package, signing, notarization, or publication; Ral verifies the visual Dock
  behavior with the next local package.

## Delivery evidence

- The runtime `app.dock.setIcon` override and packaged `app.png` resource are absent.
- The canonical source gate passes 4/4 and rejects any reintroduced runtime Dock override.
- The desktop package audit passes 19/19 and still rejects missing or empty bundle ICNS resources.
- Independent review passed after the documentation index was aligned with the bundle-only contract.
- Electron launch, packaging, signing, notarization, and publication remain intentionally unrun;
  Ral owns final visual verification with the next local package.
