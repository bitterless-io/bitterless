# Desktop Application Icon

Status: in progress

## Ownership

`build/icon.png` is the single editable Bitterless application-icon source. Derived platform files
are build inputs, not independent designs:

```text
build/icon.png
    +-- build/icon.icns -> macOS bundle icon
    +-- build/icon.ico  -> Windows executable/installer icon
```

## macOS contract

- Electron Builder names `build/icon.icns` explicitly in the macOS configuration.
- The bundle ICNS is the sole macOS application and Dock icon source. GUI startup must not call
  `app.dock.setIcon`: a runtime PNG override is normalized differently by macOS and makes the icon
  change visible size when the application opens.
- The running application must therefore retain the same visible icon bounds as its closed Dock
  tile. Helper modes keep their prohibited activation policy and remain Dock-free.
- Finder, Launchpad, installers, update metadata, and both closed and running Dock states all use
  the same ICNS artwork.

## Packaging gate

The macOS ARM package must contain a non-empty ICNS representation before it can be published.
`signedBuild` runs the canonical-source test before Electron Builder, then the registered
`afterPack` audit validates the bundle ICNS structure before signing or upload. The source gate also
rejects a reintroduced runtime Dock override. Icon failure is checked without launching Electron.
