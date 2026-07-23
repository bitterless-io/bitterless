# Desktop Application Icon

Status: implemented; owner verification pending

## Ownership

`build/icon.png` is the single editable Bitterless application-icon source. Derived platform files
are build inputs, not independent designs:

```text
build/icon.png
    +-- build/icon.icns -> macOS bundle icon
    +-- build/icon.ico  -> Windows executable/installer icon
    +-- packaged app.png -> macOS runtime Dock refresh
```

## macOS contract

- Electron Builder names `build/icon.icns` explicitly in the macOS configuration.
- The packaged application contains the canonical PNG under its allowlisted icon resources.
- GUI startup calls `app.dock.setIcon` with the current PNG before Home is created. Helper modes keep
  their prohibited activation policy and never receive a Dock icon.
- Development resolves the PNG from the project `build/` directory. Packaged execution resolves
  only the copied resource path and never reaches outside the application bundle.
- Runtime icon refresh is a cache-correction layer; the `.app` bundle must still carry the correct
  ICNS so Finder, Launchpad, installers, and update metadata agree with the Dock.

## Packaging gate

The macOS ARM package must contain a non-empty ICNS representation and the runtime PNG before it can
be published. `signedBuild` runs the canonical-source test before Electron Builder, then the
registered `afterPack` audit validates the packaged PNG structure and bundle ICNS structure before
signing or upload. Icon failure is checked without launching Electron.
