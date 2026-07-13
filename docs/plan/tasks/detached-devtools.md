---
status: completed
verify:
  - yarn build
---

# Detached Development Tools

## Goal

Keep the main window usable at a minimum size of `800x600` and open every development DevTools
instance in a detached window instead of consuming application window space.

## Contract

- The main `BrowserWindow` keeps `minWidth: 800` and `minHeight: 600`.
- Every `webContents.openDevTools` call uses `mode: 'detach'`.
- Release-mode guards remain unchanged, so DevTools are not newly enabled in production builds.
