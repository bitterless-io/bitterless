# Desktop Preview release-channel analysis

Status: approved for implementation

## Problem

The existing `dev|prod` release switch carries three meanings at once: backend API environment,
desktop build identity, and OSS/updater channel. A Preview app must still call production APIs, so
adding `preview` to `VITE_ENV` would either select a nonexistent backend environment or silently
reuse Stable updater and persistence behavior.

The existing publisher also discovers artifacts from one `dist` directory by version and extension.
A Stable and Preview package with the same semantic version can therefore be uploaded to the wrong
channel. On Windows, the global `OnlyPreview` Explorer action is currently owned by a fixed registry
key, so a second product identity could overwrite or remove the Stable registration.

## Decision

Introduce `VITE_RELEASE_CHANNEL=dev|prod|preview` as an independent axis. Preview uses:

| Concern | Preview contract |
|---|---|
| Runtime profile | `release_preview` |
| Backend | `VITE_ENV=prod` |
| Release channel | `VITE_RELEASE_CHANNEL=preview` |
| App identity | `io.bitterless.desktop.preview` / `Bitterless Preview` |
| Data identity | `Bitterless_PREVIEW` userData/sessionData root |
| Build output | `dist/preview` |
| Update feed | `bitterless/distro/preview/<platform>` |
| Windows shell integration | Do not claim/erase Stable's global registration |
| Artwork | Dedicated PNG/ICNS/ICO with a visible `PREVIEW` mark |

The updater must derive both `version_info.json` and its generic provider feed from the release
channel, and must reject any manifest whose `downloadUrl` is not the exact expected channel/platform
directory.

## Publisher contract

`publish_preview:mac_arm`, `publish_preview:mac_intel`, and `publish_preview:win` are full current-
worktree release commands. Each command performs frozen dependency validation, version/build-code
advance, Preview remote-order preflight, `release_preview` build, signing/notarization when supported,
manifest-last upload, and exact Preview CDN refresh. It must not pull, reset, restore, commit, or
switch branches.

The Preview manifest remains compatible with the desktop updater and adds explicit public artifact
metadata for website consumers:

```json
{
  "channel": "preview",
  "platform": "mac_arm",
  "downloadUrl": "https://assets.terncloud.com/bitterless/distro/preview/mac_arm",
  "installerUrl": "https://assets.terncloud.com/bitterless/distro/preview/mac_arm/Bitterless-Preview-0.0.79.dmg"
}
```

Stable publication must emit the same additive fields so the website never guesses a filename.
Existing updater fields and metadata filenames remain unchanged.

## Isolation boundary

Changing the application name before any directory, Keychain, SQLite, Chromium session, logging,
Codex auth, MCP, or window-state initialization makes their roots derive from
`Bitterless_PREVIEW`. Stable persistence is never imported or read. Logging/diagnostics must expose
the release channel and resolved directories without exposing secret values.

Maestro's bundled CLI is an explicit part of this boundary. Stable retains its external
`~/.micromeet` command-line contract and inherited executable/credential overrides. Preview resolves
its CLI root to `${app.getPath('userData')}/cowork/cli`; the generated shim,
`credentials/crms.json`, `credentials/sys.json`, shared `credentials/.credential-key-v2`, and
`session.json` all remain below that directory. Preview never reads, writes, or removes a file below
`~/.micromeet`, ignores inherited `MICROMEET_CLI_PATH`, and selects only its bundled executable. It
prepends its own shim directory to the embedded runtime PATH and forces realm-specific CRMS/Sys,
generic credential, legacy session, and CLI executable environment values for Main and every
bundled-CLI child. Exact realm variables therefore win before the CLI's generic/default fallback,
while the forced Preview-local generic value prevents a global fallback if a future command omits a
realm-specific lookup.

Preview applies this environment boundary before any fallible filesystem operation. Directory,
permission, shim, bundled-executable, or cleanup failure rejects Maestro initialization instead of
being logged and swallowed. The caller marks runtime initialization complete only after CLI setup
and the remaining one-time registrations succeed; a CLI failure is safe to retry and cannot leave
inherited global `MICROMEET_*` paths active.

Server data is intentionally not isolated: signing into the same production account can synchronize
the same account data, because Preview uses the production API by requirement.

## Release safety

- First publication may find no remote Preview manifest; that is an empty channel, not a failure.
- Every publish validates package/runtime/channel identity before build artifacts are uploaded.
- Artifacts and updater YAML are uploaded before `version_info.json`.
- Stable manifest hashes are captured before the Preview test and must remain identical afterward.
- macOS ARM is the real release proof on this host. Intel and Windows receive source/build contract
  coverage; Windows remains unsigned until an inventoried signing resource exists.
- No Electron E2E is part of this delivery.

## Sources

- `scripts/publish.js`
- `scripts/before.js`
- `scripts/environment/runtimeProfile.config.cjs`
- `src/main/environment/runtimeProfile.service.ts`
- `src/main/maestro/cli/micromeetCliPath.service.ts`
- `src/main/maestro/cli/micromeetCli.service.ts`
- `src/main/maestro/integration/integrationRunner.service.ts`
- `src/main/updateHelper/update.service.ts`
- `electron-builder.tmp.yml`
- `build/installer.tmp.nsh`
- `../../ops/bitterless/ops.yml`
