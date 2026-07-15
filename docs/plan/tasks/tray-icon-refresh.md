---
id: tray-icon-refresh
scope: Bitterless macOS and Windows system tray icons
status: done
depends-on: [app-icon-refresh]
---

# System tray icon refresh

## Objective

Replace the legacy macOS tray image with a simple bored-cat head and give Windows its own cat-head
tray icon instead of reusing the full application icon.

## Context

- `docs/INDEX.md`
- `docs/design/colors.md` — System tray icons
- `docs/plan/tasks/app-icon-refresh.md`

## Path

- `doc/bitterless-tray-mac.png`
- `doc/bitterless-tray-win.png`
- `build/tray-mac@2x.png`
- `build/tray-win.ico`
- `src/main/tray/tray.helper.ts`
- `electron-builder.tmp.yml`
- `electron-builder.yml`

Do not modify the application icon family (`build/icon.*`, `doc/icon.png`, `doc/logo*.png`, or
`doc/app_icons/`).

## Asset contract

- Use one shared, simple bored-cat-head geometry: pointed ears, rounded cheeks, half-lidded eyes,
  tiny nose, and flat mouth. No body, hand, laptop, rocket, text, or background tile.
- Use bold filled geometry and negative-space facial details so the face remains readable at 16px.
- `doc/bitterless-tray-mac.png` is a 208x208 RGBA documentation master with a black core and
  transparent background.
- `build/tray-mac@2x.png` is an 80x80 RGBA derivative with the same geometry; macOS continues to
  call `setTemplateImage(true)` and resize it to 16x16.
- `doc/bitterless-tray-win.png` is a 208x208 RGBA documentation master with a `#4E5882` core and
  transparent background.
- `build/tray-win.ico` contains 16, 20, 24, 32, 40, 48, 64, and 256px RGBA representations of the
  Windows master.
- Windows development and release runtime paths use `tray-win.ico`, never the application
  `icon.ico`.
- Both builder configs copy `tray-mac@2x.png` and `tray-win.ico` to
  `app.asar.unpacked/icons/` for release builds.

## Verification

- Visually inspect both masters and enlarged 16px previews on light and dark surfaces.
- Confirm both PNG masters and the macOS runtime PNG have alpha, transparent corners, and non-empty
  cat-head coverage.
- Confirm the Windows ICO contains exactly the required representations.
- Confirm `tray.helper.ts` selects `tray-win.ico` on Windows in both development and release.
- Confirm `electron-builder.tmp.yml` and `electron-builder.yml` package both runtime tray assets.
- Run `yarn typecheck:node`.
- Confirm no application icon asset changed as part of this task.
