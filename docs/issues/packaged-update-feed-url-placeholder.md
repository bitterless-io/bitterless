# Packaged app-update.yml points at a placeholder host

Status: proposed

## Observed behavior

`electron-builder.tmp.yml` declares the updater feed as a placeholder:

```yaml
publish:
  provider: generic
  url: https://example.com/auto-updates
```

`scripts/before.js` rewrites `appId`, `productName`, the output directory, the executable name, the
icons, and the artifact stem when it generates `electron-builder.yml`, but never the publish URL.
Every package of every channel therefore ships that placeholder. The installed macOS ARM Preview
`0.0.82` carries:

```yaml
provider: generic
url: https://example.com/auto-updates
updaterCacheDirName: bitterless_preview-updater
```

Updates work today only because `UpdateService.checkAndDownloadUpdate()` calls
`autoUpdater.setFeedURL()` with the verified manifest's `downloadUrl` immediately before every
`autoUpdater.checkForUpdates()`. `app-update.yml` is the value `electron-updater` uses whenever that
assignment has not happened.

`example.com` is IANA-reserved and cannot be registered by a third party, so this is not an active
hijack risk. It is a correctness and resilience defect: the packaged updater configuration does not
describe the release it belongs to, `autoInstallOnAppQuit` is enabled, and any future code path that
reaches the updater without first passing `fetchManifest()` silently targets a dead host instead of
being stopped by the channel assertions.

The runtime already owns the correct mapping — `resolveUpdateDirectory(releaseChannel, platform)`
resolves `https://assets.terncloud.com/bitterless/distro/<channel>/<platform>` — but packaging has
no access to it and duplicates nothing, so the packaged value is simply wrong.

## Required behavior

- Every packaged `app-update.yml` names the exact updater directory for that package's channel and
  platform: `https://assets.terncloud.com/bitterless/distro/<channel>/<platform>`.
- The channel/platform → directory mapping has one source of truth shared by the runtime updater and
  the packaging scripts. The runtime constant and the packaged value are proven equal by test, not
  by convention.
- Packaging resolves the platform token from the packed target the same way the runtime does:
  `darwin`+`arm64` → `mac_arm`, `darwin`+`x64` → `mac_intel`, `win32`+`x64` → `win64`. An
  unsupported target is refused, not silently defaulted.
- The rewrite happens in the existing `afterPack` hook, which runs before macOS code signing, so the
  packaged resource is signed in its final state.
- Runtime behavior is unchanged: `setFeedURL()` from the verified manifest remains the authority for
  an actual update, and a manifest failing the channel assertions still blocks the download.
- Packaging fails closed when a produced package carries a placeholder host or a feed URL belonging
  to another channel or platform.

## Acceptance

- A pure Node fixture proves the `afterPack` step rewrites `app-update.yml` to the exact
  channel/platform directory for `mac_arm`, `mac_intel`, and `win64`, on both the macOS
  `Contents/Resources` and the Windows `resources` layout.
- A test proves the packaging mapping and base URL equal the runtime values in
  `src/main/updateHelper/updateChannel.service.ts`.
- A guard test proves a package whose `app-update.yml` host is not the release host, or whose
  directory does not match the selected channel and platform, is rejected.
- `yarn test:desktop-auto-update` and `yarn test:desktop-package-audit` pass.
- `provider: generic` and `updaterCacheDirName` stay unchanged, and the Preview cache directory
  remains distinct from Stable's.
- No build, signing, notarization, upload, CDN refresh, Electron, or E2E runs during verification.

Implementation task:
[release-packaged-update-feed-url-109](../plan/tasks/release-packaged-update-feed-url-109.md).
