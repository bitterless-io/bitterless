---
id: release-preview-channel-007-1
target: working-tree-2026-08-31-dev-next
compared_with: release-preview-channel-007
---

# Verdict

**CHANGES REQUIRED. No P1 finding; one blocking P2 finding and two non-blocking TS-1 findings.**

The Preview backend/channel split, local data roots, generated Builder identity, updater feed,
Windows shell guard, dedicated artwork, publication ordering, and first-publication OSS behavior all
pass focused source and Node verification. Windows AppUserModelID is still applied after the first
`BrowserWindow` is created, so the Preview OS identity is not established at the required startup
boundary.

# Findings

## P1 — blocking

None.

## P2 — blocking: Preview AppUserModelID is applied after the hidden SQLite window exists

Locations:

- `src/main/app.main.ts:463-470`
- `src/main/app.main.ts:499-518`
- `src/main/startup/guiStartup.service.ts:30-66`

`runSqliteFirstGuiStartup()` invokes `startCoreSqlite()` at line 38 before it invokes
`initializeForegroundRuntime()` at line 63. The former immediately reaches
`sqliteWindowHelper.create()` at `app.main.ts:467`; the latter does not call
`electronApp.setAppUserModelId(runtimeProfile.appId)` until `app.main.ts:518`.

The hidden SQLite renderer is therefore the first Windows `BrowserWindow`, but it is created before
the Preview AppUserModelID is installed. That violates the Task 007 contract that application and
OS-owned identity be established before services/windows initialize, and leaves the first window
eligible to inherit the default/Stable Windows identity rather than
`io.bitterless.desktop.preview`.

Move the AppUserModelID assignment to the early profile/bootstrap lane, before any
`BrowserWindow`, session-owned foreground service, or single-instance startup can be created. Add a
source-order test that proves the assignment precedes `startCoreSqliteRenderer()`; the current test
only proves that a call exists somewhere in `app.main.ts`.

## P3 — non-blocking: Preview updater tests push one test file past the 800-line limit

Location: `tests/update/updatePolling.test.mjs:1-839`

Rule: `TS-1`.

The file was 790 lines at `HEAD`; the two new release-channel tests add 49 lines and make it 839
lines. Move the `updateChannel.service` coverage into a focused `updateChannel.test.mjs` file.

## P3 — non-blocking: the modified publisher remains above the 800-line limit

Location: `scripts/publish.js:1-1099`

Rule: `TS-1`.

The file already exceeded the limit at `HEAD` and this change grows it from 973 to 1,099 lines.
Extract the new release-channel identity/manifest/artifact helpers into a focused module when fixing
Task 007; publication orchestration should remain in `publish.js`.

# Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Preview uses production API with a distinct channel | `release_preview` is exactly `VITE_ENV=prod`, `VITE_MODE=release`, `VITE_RELEASE_CHANNEL=preview`, and reuses the production core URL. Runtime resolution rejects every other Preview tuple. | pass |
| App name, app ID, and local persistence isolation | The first import bootstraps `Bitterless_PREVIEW`, `io.bitterless.desktop.preview`, and explicit `userData`/`sessionData` roots before other application modules evaluate. SQLite, Chromium partitions, logs, Codex auth/models, MCP, plugins, window state, and feature stores derive from those roots. | pass, except AppUserModelID timing below |
| Windows AppUserModelID initialization | The runtime value is correct, but it is assigned only after the hidden SQLite `BrowserWindow` is created. | **fail — P2** |
| Builder generated only from template | `scripts/before.js` reads `electron-builder.tmp.yml`, emits Preview app/product/icon/output identity, and writes artifacts under `dist/preview`; the focused fixture verifies the generated YAML and NSIS file. | pass |
| One-step platform publication | All three `publish_preview:*` aliases install frozen dependencies, bump version/code, build the current worktree, and publish the exact Preview platform without Git pull/reset/restore. | pass |
| First Preview publication and release ordering | Read-only `--preflight-only` reached the real OSS Preview ARM prefix, treated missing `version_info.json` as a valid first publication, and exited before build/sign/upload. Existing downgrade/version-reuse tests pass. | pass |
| Artifact discovery and manifest-last publication | Preview uses `dist/preview`; exact package/channel/Builder/installer identity gates run before finalization/upload; artifacts upload before `version_info.json`, with refresh afterward. | pass |
| Update feed and cross-channel rejection | Manifest and generic updater feed resolve to the same exact `preview/<platform>` directory; mismatched channel, platform, download URL, installer URL, nested path, and missing Preview metadata are rejected. | pass |
| Windows Stable shell ownership | Generated Preview install/uninstall macros contain no Stable `Software\\Classes\\*\\shell\\OnlyPreview` mutation; Stable generation retains the existing registration path. | pass |
| Dedicated Preview artwork | PNG/ICNS/ICO match each other, Stable SHA-256 is pinned, only the reserved badge area changes, transparent footprint is unchanged, and visual inspection shows a legible `PREVIEW` badge. | pass |
| Stable and Development compatibility | Exact five-profile matrix, Stable/Dev Builder defaults, legacy Stable manifest acceptance within the exact Stable directory, and existing package aliases pass focused tests. | pass |
| Diagnostics and type contract | Runtime diagnostics/log records include sanitized app ID/channel/profile and `typecheck:node` passes. | pass |

# Verification

| Check | Result |
|---|---|
| `yarn test:runtime-profile` | PASS, 9/9 |
| `yarn test:desktop-auto-update` | PASS, 19/19 |
| `yarn test:desktop-app-icon` | PASS, 5/5 |
| `yarn test:desktop-package-audit` | PASS, 24/24 |
| `yarn test:sqlite-migrations` | PASS, 28/28 |
| `yarn typecheck:node` | PASS |
| `node --check` for Preview publisher/build helpers | PASS |
| `node scripts/publish.js --env preview --platform mac_arm --preflight-only` | PASS; real Preview ARM manifest absent, first publication allowed; no build/sign/upload |
| scoped `git diff --check` | PASS |
| Electron E2E | Not run — prohibited unless Ral explicitly requests it |
| Real build/package/sign/notarize/upload | Not run — explicitly excluded from this independent review |

# Code Review rule scan

The functional P2 above comes from Task 007's explicit startup-order contract. The standard
`$code-review` scan found only the two `TS-1` items already listed; it found no newly added `TS-2`
function declaration. Frontend and backend rule groups do not apply to this task-owned file set.

| # | File | Rule findings |
|---|---|---:|
| 1 | `package.json` | 0 |
| 2 | `env.rig.json5` | 0 |
| 3 | `electron.vite.config.ts` | 0 |
| 4 | `electron-builder.tmp.yml` | 0 |
| 5 | `build/installer.tmp.nsh` | 0 |
| 6 | `scripts/before.js` | 0 |
| 7 | `scripts/convertIcon.js` | 0 |
| 8 | `scripts/environment/assertRuntimeProfile.cjs` | 0 |
| 9 | `scripts/environment/runWithRuntimeProfile.cjs` | 0 |
| 10 | `scripts/environment/runtimeProfile.config.cjs` | 0 |
| 11 | `scripts/environment/runtimeProfile.test.mjs` | 0 |
| 12 | `scripts/package/previewIcon.generate.cjs` | 0 |
| 13 | `scripts/package/desktopAppIcon.test.mjs` | 0 |
| 14 | `scripts/package/desktopPackage.audit.cjs` | 0 |
| 15 | `scripts/package/desktopPackageAudit.test.mjs` | 0 |
| 16 | `scripts/publish.js` | 1 (`TS-1`) |
| 17 | `scripts/sqlite-migrations/release-hook.test.mjs` | 0 |
| 18 | `src/main/app.main.ts` | 0 |
| 19 | `src/main/diagnostics/applicationDiagnostics.service.ts` | 0 |
| 20 | `src/main/diagnostics/diagnosticEnvironment.service.ts` | 0 |
| 21 | `src/main/env.d.ts` | 0 |
| 22 | `src/main/environment/runtimeProfile.runtime.ts` | 0 |
| 23 | `src/main/environment/runtimeProfile.service.ts` | 0 |
| 24 | `src/main/logging/log.setup.ts` | 0 |
| 25 | `src/main/logging/logSanitizer.service.ts` | 0 |
| 26 | `src/main/updateHelper/update.service.ts` | 0 |
| 27 | `src/main/updateHelper/update.type.ts` | 0 |
| 28 | `src/main/updateHelper/updateChannel.service.ts` | 0 |
| 29 | `src/shared/diagnostics/applicationDiagnostics.contract.ts` | 0 |
| 30 | `tests/update/updatePolling.test.mjs` | 1 (`TS-1`) |
| 31 | `tests/e2e/e2eRuntimeMode.ts` | 0 |

# Conclusion

Do not run the real Preview package publication yet. Fix AppUserModelID ordering and rerun the same
focused verification first. The two line-count findings are non-blocking release hygiene, but both
are directly attributable to or expanded by this task and should be resolved while the release
channel boundary is still localized.
