# Desktop release channels

Status: implemented

## Channel matrix

| Channel | API environment | Build mode | Product | Local data root | Updater directory |
|---|---|---|---|---|---|
| Stable | prod | release | Bitterless | `Bitterless` | `distro/prod/<platform>` |
| Preview | prod | release | Bitterless Preview | `Bitterless_PREVIEW` | `distro/preview/<platform>` |
| Development release | dev | release | Bitterless DEV | `Bitterless_DEV` | `distro/dev/<platform>` |
| Debug prod | prod | debug | Bitterless DEBUG PROD | `Bitterless_DEBUG_PROD` | no release publication |
| Debug dev | dev | debug | Bitterless DEBUG DEV | `Bitterless_DEBUG_DEV` | no release publication |

The backend environment and release channel are independent. Preview is not a backend environment.

## Preview identity and persistence

- macOS bundle/application ID and Windows AppUserModelId: `io.bitterless.desktop.preview`.
- Display product: `Bitterless Preview`.
- Runtime application/data identity: `Bitterless_PREVIEW`.
- Preview owns its userData/sessionData, SQLite, cookies, Web Storage, logs, Codex/Claude auth,
  models, plugins, MCP endpoint, hook outboxes, window state, and installation identity.
- Preview's bundled Maestro CLI owns its shim, encrypted CRMS and Sys credentials, shared local
  credential key, and legacy-session compatibility file below
  `${app.getPath('userData')}/cowork/cli`. It ignores inherited `MICROMEET_CLI_PATH`, uses only its
  bundled executable, and must neither inspect nor mutate Stable's external `~/.micromeet` tree.
  Every Preview-owned CLI child receives forced `MICROMEET_CRMS_CREDENTIAL_FILE`,
  `MICROMEET_SYS_CREDENTIAL_FILE`, `MICROMEET_CREDENTIAL_FILE`, `MICROMEET_SESSION_FILE`, and
  `MICROMEET_CLI_PATH` values from the Preview boundary, even when the parent shell exported global
  overrides. Stable keeps the existing external `~/.micromeet` contract and honors its executable,
  realm-specific, and generic credential overrides.
- Preview establishes those environment paths before fallible directory, shim, permission, or
  cleanup work. Initialization failure propagates to startup, leaves the forced local environment
  in place, and remains retryable; Maestro must not continue with inherited global paths.
- Preview must never register or remove the Stable-only Windows Explorer `OnlyPreview` action.
- The Preview package uses dedicated app icons with a visible `PREVIEW` mark.

## Update and distribution

The release channel selects both metadata layers:

1. `version_info.json` from the exact channel/platform directory.
2. Electron updater YAML and artifacts from the same `downloadUrl` directory.

Preview refuses a manifest that redirects to Stable or Development. Manifest fields `channel`,
`platform`, and `installerUrl` are part of the public download contract; artifacts remain uploaded
before the flat manifest so website and updater readers never observe a half-published release.

All channel outputs live below the generated-release root `dist`. Electron Builder must exclude that
entire root plus the transient root `tmp` from application files even when the current output is a
nested directory such as `dist/dev` or `dist/preview`; no existing DMG, ZIP, blockmap, updater
metadata, unpacked package, temporary file, initialized `external_tools` inventory, or legacy
`prebuilt` download cache may be embedded in `app.asar`.

The local artifact lanes are also channel-isolated: Stable owns `dist/`, Development release owns
`dist/dev/`, and Preview owns `dist/preview/`. `before.js`, Electron Builder, package audit,
artifact discovery, and publication must resolve the same selected lane. A Development build must
never replace Stable's `version_info.json` or make Stable publication observe `channel: dev`.

## Operator commands

```text
yarn publish:mac_arm
yarn publish:mac_intel
yarn publish:win
yarn publish_preview:mac_arm
yarn publish_preview:mac_intel
yarn publish_preview:win
```

These are one-step build-and-publish commands for the current local source. Stable aliases select a
production build before inspecting `dist/`; Preview aliases select a Preview build before inspecting
`dist/preview/`. They do not pull or restore Git state. Platform aliases must not silently publish a
previously built artifact from any channel.

## Verification boundary

Automated checks cover runtime profiles, package identity, local-data path selection, updater feed
selection/rejection, output isolation, manifest artifact metadata, publish ordering, and dedicated
icons. The macOS ARM release proof additionally verifies signing, notarization, public manifest,
updater YAML, installer/blockmap, and unchanged Stable manifest hashes. Electron E2E is excluded.

## Initial Preview publication

The channel was first proven publicly on 2026-08-31 with macOS ARM Preview `0.0.79`
(`versionCode` `260831132610`). The app and DMG were signed, notarized with an `Accepted` result, and
passed stapling validation. The public Preview ARM manifest SHA-256 is
`9f86e3c314e589e76aa47d242e5f5af697a19f436695a4e5b3e0df9a5f534f13`; all three Stable manifest
hashes remained unchanged.

This is deliberately not a claim that all three Preview artifacts are published. macOS Intel and
Windows have complete build/publish commands and isolated channel contracts, but their public
Preview manifests and installers remain absent until those commands are run on suitable release
hosts.
