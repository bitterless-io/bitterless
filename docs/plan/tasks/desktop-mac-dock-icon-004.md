---
id: desktop-mac-dock-icon-004
scope: make the canonical Bitterless icon current in the macOS bundle and Dock
status: implemented; owner verification pending
depends-on: [desktop-package-size-002]
---

# macOS Bundle and Dock Icon

## Objective

Make builder icon selection explicit, prove its generated artwork matches the canonical PNG, and
refresh the Dock tile from the packaged canonical artwork before Home opens.

## Required behavior

- Keep `build/icon.png` as the canonical source and regenerate `build/icon.icns` from it; an
  already-current byte-identical result is valid.
- Explicitly configure the macOS builder icon.
- Copy the canonical PNG to an allowlisted packaged icon resource.
- Apply the icon only for the macOS GUI runtime; helper modes remain Dock-free.
- An invalid development icon must not block Home. A production package must fail its source or
  package audit before signing/upload when required icon artifacts are absent or empty.
- Preserve existing signing, notarization, SQLite migration audit, native-module audit, and package
  size gates.

## Expected paths

- `docs/features/desktop-app-icon.md`
- `electron-builder.tmp.yml`
- generated `electron-builder.yml`
- `build/icon.icns`
- `build/icon.ico`
- `src/main/app.main.ts`
- package source/audit tests

## Verification

- Static checks prove explicit ICNS selection, packaged PNG inclusion, and macOS-only Dock refresh.
- Extracting the regenerated ICNS yields non-empty current artwork.
- The production macOS ARM build passes the SQLite and desktop-package gates, signing, notarization,
  and publication verification.
- No Electron UI run; Ral verifies the Dock after installing or starting the release.

## Delivery evidence

- The source icon test passes 4/4 checks, including signed-build gate ordering and pixel equality.
- The desktop package audit passes 18/18 checks and rejects missing/empty packaged macOS icons.
- SQLite migration audit and its 11 release-hook checks pass.
- Packaging and publication were cancelled at Ral's direction; no artifact was produced or uploaded.
