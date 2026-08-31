---
id: release-preview-channel-007
scope: independent Preview desktop identity, persistence, updater, artwork, and three-platform publication
status: completed
depends-on: [release-oss-multipart-upload-006]
verify:
  - yarn test:runtime-profile
  - yarn test:desktop-auto-update
  - yarn test:desktop-app-icon
  - yarn test:desktop-package-audit
  - yarn test:sqlite-migrations
  - yarn test:maestro-cli-channel
  - yarn typecheck:node
  - yarn publish_preview:mac_arm
---

# Preview desktop release channel

## Objective

Create a Preview package that uses production APIs while remaining a distinct installed application,
local persistence root, icon, artifact set, and automatic-update channel. Provide full current-source
publish commands for macOS ARM, macOS Intel, and Windows x64, then prove the macOS ARM channel with a
real signed/notarized publication.

## Context

- `docs/plan/analysis/desktop-preview-release-channel.md`
- `docs/features/desktop-release-channels.md`
- `docs/features/desktop-auto-update.md`
- `docs/features/desktop-app-icon.md`
- `docs/features/sqlite-migration-release-gate.md`

## Implementation contract

- Add an explicit release-channel environment value without adding `preview` to `VITE_ENV`.
- Add `release_preview`, keep its API at prod, and establish Preview app/data/updater identity before
  persistent or OS-owned services initialize.
- Generate builder config from `electron-builder.tmp.yml`; do not hand-maintain generated
  `electron-builder.yml`.
- Keep Preview build artifacts under `dist/preview` and validate profile/channel identity before any
  upload.
- Exclude the complete generated-release root `dist` and transient root `tmp` from Electron Builder
  application files, regardless of whether the active channel writes to `dist` or a nested output
  such as `dist/preview`; historical Stable, Preview, other release artifacts, and temporary files
  must never enter `app.asar`.
- Prevent Preview Windows install/uninstall from overwriting Stable's global Explorer integration.
- Produce dedicated Preview PNG/ICNS/ICO assets from the canonical app artwork.
- Add `publish_preview:mac_arm`, `publish_preview:mac_intel`, and `publish_preview:win` as complete
  build-and-publish commands without Git pull/reset/restore.
- Publish to `distro/preview/<platform>`, add exact installer metadata, and retain manifest-last
  atomic ordering and existing downgrade/version-code gates.
- Require Preview update metadata to remain in its exact channel/platform directory.
- Keep Stable's Maestro CLI shim and credential contract under `~/.micromeet`, while placing the
  Preview shim, CRMS/Sys credentials, shared key, and legacy session below
  `${app.getPath('userData')}/cowork/cli`.
- Ignore inherited `MICROMEET_CLI_PATH` in Preview and use only its bundled CLI; Stable retains its
  executable override behavior.
- Force Preview's realm-specific CRMS/Sys, generic credential, legacy-session, and executable path
  variables in both Main and spawned CLI environments. Preview must not read, write, remove, or
  fall back to Stable CLI state.
- Apply Preview environment isolation before fallible filesystem work, propagate initialization
  failure, and mark Maestro runtime initialization complete only after successful CLI setup so a
  failed first attempt can retry safely.
- Keep Stable and Development behavior backward compatible.

## Path

- `package.json`
- `env.rig.json5`
- `scripts/environment/`
- `scripts/before.js`
- `scripts/publish.js`
- `scripts/package/`
- `electron-builder.tmp.yml`
- `build/installer.tmp.nsh`
- `build/icon-preview.*`
- `src/main/environment/`
- `src/main/updateHelper/`
- `src/main/maestro/cli/`
- `src/main/maestro/integration/integrationRunner.service.ts`
- `src/shared/diagnostics/`
- `src/**/env.d.ts`
- focused source tests

## Verification

1. Run focused non-E2E profile, updater, icon, package-audit, migration, Maestro CLI channel-
   isolation, and Node type checks.
2. Generate Preview config/artifacts and inspect appId, productName, appName, data roots, updater URL,
   output directory, installer behavior, and icon identity.
3. Capture the three public Stable manifest hashes.
4. Run `yarn publish_preview:mac_arm` from the current `dev/next` worktree.
5. Verify the public Preview manifest, updater YAML, installer, blockmap, version/hash/size, signing,
   notarization, and stapling.
6. Recompute Stable manifest hashes and require an exact match.

## Completion evidence — 2026-08-31

- `yarn publish_preview:mac_arm` completed from the current local `dev/next` source and published
  Preview `0.0.79` with version code `260831132610`.
- The packaged app and DMG passed signing verification, Apple notarization returned `Accepted`, and
  stapling validation passed for both artifacts.
- The public `preview/mac_arm/version_info.json` SHA-256 is
  `9f86e3c314e589e76aa47d242e5f5af697a19f436695a4e5b3e0df9a5f534f13`; its manifest, updater YAML,
  installer, and blockmap were verified through the public CDN.
- The three Stable manifest SHA-256 values remained unchanged after the Preview publication:
  `mac_arm` `74f5200f402fd3c6f80a828885cd11c71ff81854ed2a02a117c44aeb85d9c487`,
  `mac_intel` `0ec376aaee703e2e858a6958da81665ea6e639bb3b86000f2dc3b41bc3d585dd`, and
  `win64` `3cd8e6356a7dea905bccc5db4c7b5e75616639234b6b44bbef1c109dac7ae26c`.
- Focused non-E2E release checks and the final independent review passed. Electron E2E was not run
  because this desktop project excludes unrequested E2E launches.
- This release proof published only macOS ARM. The macOS Intel and Windows commands, identities,
  storage paths, and OSS/update-channel contracts are implemented and source-verified, but no
  Preview Intel or Windows artifact has been published yet.
