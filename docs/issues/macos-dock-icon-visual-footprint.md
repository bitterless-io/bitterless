# macOS Dock Icon Is Visually Oversized

Status: implemented; owner verification pending

## Symptom

The Bitterless icon occupies more of its Dock tile than standard macOS application icons and looks
visibly larger beside them, even though the source image and ICNS representation are both square.

## Root cause

The visible alpha bounds of `build/icon.png` fill all 1024 x 1024 pixels, and the ICNS currently
copies those pixels without a macOS-specific safe area. Local system icons such as Notes, Music,
and Weather occupy 206 x 206 pixels inside a 256 x 256 representation, equivalent to an
824 x 824 footprint on the 1024 x 1024 icon canvas.

This is separate from the earlier runtime size mismatch: the application already leaves the Dock
icon to the bundle ICNS, but that bundle artwork itself is oversized.

## Resolution contract

- Keep `build/icon.png` as the single editable artwork source and preserve its full-size Windows
  ICO rendering.
- Center the source artwork at 824 x 824 inside every 1024 x 1024-equivalent macOS ICNS canvas,
  leaving a transparent 100-pixel safe area on each side at the largest representation.
- Keep the bundle ICNS as the sole Dock icon source; do not restore `app.dock.setIcon`.
- Route maintained icon conversion through the same deterministic generator so alternate scripts
  cannot silently recreate a full-bleed ICNS.
- Add a pixel-level source gate for the macOS alpha footprint and Windows canonical-image parity.
- Ral performs final visual verification in the Dock; no app recording is required.

Delivery: [desktop-mac-dock-icon-footprint-007](../plan/tasks/desktop-mac-dock-icon-footprint-007.md)
