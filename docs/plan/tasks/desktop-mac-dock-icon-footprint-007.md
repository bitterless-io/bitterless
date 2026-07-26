---
id: desktop-mac-dock-icon-footprint-007
scope: normalize the macOS Dock icon visual footprint without shrinking the Windows icon
status: implemented; owner verification pending
depends-on: [desktop-mac-dock-icon-size-006]
---

# macOS Dock Icon Visual Footprint

## Objective

Match the visual footprint of standard macOS Dock icons by adding the platform safe area to the
generated ICNS while retaining the approved Bitterless artwork and the existing Windows ICO size.

## Context

- `docs/features/desktop-app-icon.md`
- `docs/issues/macos-dock-icon-runtime-size-mismatch.md`
- `docs/issues/macos-dock-icon-visual-footprint.md`

## Path

- `scripts/convertIcon.js`
- `scripts/convert_icon.sh`
- `scripts/package/desktopAppIcon.test.mjs`
- `build/icon.icns`
- `docs/features/desktop-app-icon.md`
- `docs/issues/macos-dock-icon-visual-footprint.md`

## Required behavior

- Generate macOS ICNS artwork at an 824/1024 visual span, centered with transparent margins.
- Apply the same proportional safe area to every ICNS representation.
- Continue generating Windows ICO entries directly from the full `build/icon.png` source.
- Keep `build/icon.png` unchanged as the canonical editable artwork.
- Keep runtime Dock overrides absent.
- Make the legacy shell conversion entry delegate derived-asset generation to the maintained Node
  converter.
- Preserve unrelated working-tree changes, especially package version metadata.

## Verification

- `node scripts/convertIcon.js`
- `yarn test:desktop-app-icon`
- `yarn test:desktop-package-audit`
- `git diff --check`
- Pixel inspection proves the 1024px ICNS alpha bounds are exactly 824 x 824 at inset 100, while
  the 256px ICO remains a direct resize of `build/icon.png`.
- No Electron launch or recording; Ral verifies the next local or packaged Dock icon visually.

## Delivery evidence

- The regenerated ICNS 1024px alpha bounds are exactly `x=100..923`, `y=100..923`, producing the
  required centered 824 x 824 visual footprint.
- All PNG-backed ICNS representations from 32px through 1024px match the proportionally scaled
  safe-area source pixel for pixel.
- The Windows 256px ICO representation remains a direct resize of unchanged `build/icon.png`.
- The icon source gate passes 5/5 and the complete desktop package audit passes 20/20.
- Targeted ESLint, Node syntax, shell syntax, and `git diff --check` pass.
- Electron launch and recording remain intentionally unrun; Ral owns final Dock visual verification.
