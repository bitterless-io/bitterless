---
id: app-icon-refresh
scope: Bitterless application icon and logo assets
status: done
depends-on: []
---

# Application icon refresh

## Objective

Replace the legacy Bitterless application artwork with the approved hand-drawn bored-cat design:
Royal Blue linework, the orange solid rocket mark on the laptop, and a clean light background.

## Context

- `docs/INDEX.md`
- `docs/design/colors.md`
- Approved source artwork:
  `/Users/ral/.codex/generated_images/019f6537-daa6-7fe1-82a5-aacf20228f31/exec-1518c115-1e5b-4327-8f5c-789b0cd2bfd7.png`

The main ink uses `#4E5882`, the light background uses `#F3F5FC`, and the solid rocket is the
menu-active accent orange `#C2410C`.

## Path

- `build/icon.png`
- `build/icon.icns`
- `build/icon.ico`
- `doc/app_icons/`
- `doc/icon.png`
- `doc/logo1024.png`
- `doc/logo_dev.png`

Do not change tray artwork.

## Asset contract

- `doc/logo1024.png` is the opaque 1024 x 1024 square master with no rounded-corner mask.
- `doc/logo_dev.png` uses the same square artwork and retains a visible `DEV` treatment.
- `build/icon.png`, `doc/icon.png`, and every file under `doc/app_icons/` use the same artwork with
  transparent rounded corners.
- `build/icon.icns` and `build/icon.ico` are regenerated from `build/icon.png`.
- Preserve the existing filenames and standard app-icon dimensions.
- Do not introduce any new palette color beyond the documented Royal Blue palette and accent
  orange, except alpha transparency.

## Verification

- Confirm every PNG has its filename-implied square dimensions.
- Confirm `doc/logo1024.png` is 1024 x 1024 and fully opaque to all four corners.
- Confirm every rounded PNG has an alpha channel, transparent corners, and opaque center content.
- Confirm `build/icon.icns` contains the 1024 x 1024 representation.
- Confirm `build/icon.ico` contains the existing 16, 24, 32, 48, 64, 128, and 256 pixel entries.
- Visually compare the square master and rounded build icon against the approved source.
- Confirm tray images and unrelated dirty-worktree files are unchanged by this task.
