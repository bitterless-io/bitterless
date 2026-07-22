# Desktop package includes build-only dependencies

Status: Fixed

## Symptom

The macOS arm64 `0.0.35` application bundle produced during release was about 1.1 GiB. Its
`Resources/app.asar` was about 743 MiB and the archive's `node_modules` entries represented about
771 MiB of unpacked content. This is outside the intended desktop release shape: the application
bundle should remain within hundreds of MiB and `app.asar` should remain near 100–200 MiB.

The release was cancelled before notarization, upload, or CDN refresh.

## Cause

Electron Builder treats root production dependencies and Yarn workspace packages as runtime
package inputs. Bitterless currently declares renderer-only and build-only libraries as production
dependencies even though Electron Vite has already compiled those libraries into renderer assets.
The archive therefore contains duplicate source packages such as Monaco, Arco, Tabler icons, and
the renderer tokenizer. It also contains the `@micromeet/cli` workspace even though release builds
already compile that CLI into a standalone binary under `Resources/maestro-tools`.

## Fix contract

- Keep in `dependencies` every package that built Main or Preload output imports or loads at
  runtime, including dynamic imports and native modules.
- Move renderer-only, build-only, and test-only direct packages to `devDependencies`; they remain
  available to Electron Vite but must not be copied as production Node modules.
- Bundle selected pure-JavaScript Main/Preload libraries through Electron Vite when that preserves
  their runtime contract. Keep native addons, browser/runtime locators, and complex lazy agent
  runtimes external; package-size reduction must not come from removing a required runtime module.
- Exclude the `@micromeet/cli` workspace package from `app.asar`. Its platform binary under
  `Resources/maestro-tools` remains the sole packaged runtime copy.
- Run a deterministic Electron Builder `afterPack` audit before code signing. Fail packaging when
  `app.asar` exceeds 220 MiB, the complete unpacked application exceeds 650 MiB, or known
  renderer/build-only package roots are present in the archive.
- Keep the size audit callable independently so an unsigned directory build can prove the final
  artifact shape before a signed release is retried.
- Do not upload, notarize, or refresh CDN content after an audit failure.

## Acceptance

- A production-configured macOS arm64 directory build passes the package audit.
- `app.asar` is no larger than 220 MiB and the unpacked `.app` is no larger than 650 MiB.
- The audit proves that banned renderer/build-only roots and `@micromeet/cli` are absent.
- Main/Preload external-runtime checks, production build, and existing release gates still pass.

## Resolution — 2026-07-22

Renderer/build-only packages now remain development dependencies, selected pure-JavaScript
Main/Preload libraries are bundled, source maps and the duplicate CLI workspace are excluded, and
`protobufjs` is an explicit production dependency for the Lark Connector preload. The `afterPack`
audit parses packaged Main/Preload JavaScript to prove every literal external package root exists,
then enforces the content and byte limits before signing.

A clean committed macOS arm64 package passed at 209.75 MiB for `app.asar` and 544.70 MiB for the
application. Independent review found no remaining P1, P2, or P3 finding. See
[`desktop-package-size-002-2`](../plan/reviews/desktop-package-size-002-2.md).
