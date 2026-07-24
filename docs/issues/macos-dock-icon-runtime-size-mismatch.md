# macOS Dock Icon Changes Size When Bitterless Opens

Status: in progress

## Symptom

The closed Bitterless Dock tile uses the expected default icon size, but opening the application
replaces it with a visibly different-sized icon.

## Root cause

The bundle default comes from `build/icon.icns`. GUI startup then calls `app.dock.setIcon` with a
packaged PNG. The ICNS and PNG carry the same pixels, but macOS normalizes a bundle application icon
and a runtime PNG override differently, so the running tile does not preserve the default visual
bounds.

## Resolution contract

- Keep `build/icon.icns` as the explicit macOS bundle icon.
- Remove the macOS GUI runtime PNG override and its now-unused packaged resource.
- Keep the ICNS source and packaged-structure release gates.
- Add a source contract test that rejects any reintroduced `app.dock.setIcon` call.
- Do not launch, sign, notarize, or publish as part of this task; Ral owns final visual verification.

Delivery: [desktop-mac-dock-icon-size-006](../plan/tasks/desktop-mac-dock-icon-size-006.md)
