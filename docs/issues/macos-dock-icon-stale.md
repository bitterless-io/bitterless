# macOS Dock Shows a Stale Bitterless Icon

Status: superseded by the runtime-size fix

## Symptom

Starting the current macOS application can show an earlier icon in the Dock even though
`build/icon.png` contains the current Bitterless artwork.

## Root cause

- The builder configuration relies on implicit icon discovery instead of naming the macOS icon,
  making the bundle contract unnecessarily ambiguous even though the current ICNS pixels match the
  canonical PNG.
- Main does not refresh the Dock tile from a bundled current PNG, so macOS can retain an older
  cached Dock image during development or after an update.

## Resolution contract

- `build/icon.png` remains the canonical artwork source.
- macOS packaging explicitly uses `build/icon.icns`, regenerated deterministically from the PNG
  (the current regeneration is byte-identical).
- The runtime PNG refresh originally added here was removed after it proved to be normalized at a
  different visual size than the bundle icon. The explicit bundle ICNS is now the sole Dock source;
  its packaged audit prevents release with a missing icon.

Delivery: [desktop-mac-dock-icon-004](../plan/tasks/desktop-mac-dock-icon-004.md)

Follow-up: [desktop-mac-dock-icon-size-006](../plan/tasks/desktop-mac-dock-icon-size-006.md)
