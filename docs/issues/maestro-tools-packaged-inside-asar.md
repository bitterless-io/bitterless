# Maestro external tools are cached inside app.asar

Status: implemented; owner initialization/package verification pending

## Observed behavior

The macOS Preview package stages AnyDoc and Ouch into `Resources/maestro-tools`, but their download
cache under repository-root `prebuilt/` is also selected for `app.asar`. The duplicate native
payload pushes the archive above the desktop package-audit limit. Bun, ripgrep, and fd are not
prepared as stable, platform-pinned Maestro resources at all.

Packaging currently downloads AnyDoc and Ouch on demand. That makes an otherwise local release
depend on current network availability and lets the same source revision consume different remote
artifacts on different runs.

## Required behavior

- Keep one repository-local, gitignored external-tool store with exactly three tracked platform
  directories: `external_tools/mac_arm`, `external_tools/mac_intel`, and `external_tools/win`.
  Each directory retains only `.gitkeep` in Git; initialized files and manifests stay untracked.
- Provide one Yarn command that initializes all three platform directories with the pinned Bun,
  ripgrep, fd, Ouch, and AnyDoc artifacts.
- Keep initialization as the only network-capable phase. A macOS ARM, macOS Intel, or Windows
  package must fail closed with an actionable initialization instruction when its local tools are
  missing, stale, structurally invalid, or changed after initialization.
- Stage only the selected target into `build/maestro-tools`, alongside the separately built
  Micromeet CLI. Electron Builder must copy that directory to `Resources/maestro-tools`.
- Keep every external-tool source/cache directory out of `app.asar`; only the selected staged copy
  may enter the application bundle as an external resource.
- Preserve the existing Linux package path until Linux gets an explicitly supported external-tools
  inventory; this change owns only the three requested targets.

## Acceptance

- A source-only regression proves the tracked directory/ignore contract, pinned tool inventory,
  offline stage behavior, manifest/hash validation, target filename isolation, builder resource
  mapping, and macOS signing-list coverage.
- The supported package scripts invoke the Micromeet CLI build first and the offline external-tool
  stage second; they do not call the legacy network-capable AnyDoc/Ouch preparation scripts.
- `electron-builder.tmp.yml` excludes both `external_tools/**` and legacy `prebuilt/**` from
  `app.asar`.
- Focused Node tests, script syntax checks, `git diff --check`, and an independent P0-P2 review pass.
- Tool initialization, Electron packaging, signing, notarization, publishing, Electron launch, and
  E2E remain for the owner after this code-only delivery.

Implementation task:
[maestro-external-tools-094](../plan/tasks/maestro-external-tools-094.md).

## Resolution

- Added the tracked `external_tools/{mac_arm,mac_intel,win}` shells and ignored every initialized
  payload while retaining their `.gitkeep` files.
- Added `yarn external-tools:init`, with fixed versions plus archive and extracted-payload digests
  for Bun, ripgrep, fd, Ouch, and AnyDoc. Each valid existing platform is reused; a replacement is
  built and validated in temporary directories before the old platform is swapped out.
- macOS and Windows packaging now builds the Micromeet CLI first, then validates and stages exactly
  one initialized target without network access. Generic unpack dispatches those hosts to the same
  offline path while preserving the established Linux AnyDoc/Ouch preparation path.
- Electron Builder excludes both source/cache roots from `app.asar`, retains the
  `build/maestro-tools -> Resources/maestro-tools` resource mapping, and explicitly signs every
  macOS executable/native entry.
- External-tool fixtures passed 10/10, the desktop package/icon audit passed 25/25, focused source
  and syntax checks passed, and [review 1](../plan/reviews/maestro-external-tools-094-1.md) approved
  the result with no unresolved P0-P2 finding.
- Initialization, a real desktop package, Electron/E2E, signing, notarization, and publication were
  intentionally not run. Ral owns those post-delivery checks, beginning with
  `yarn external-tools:init`.
