---
id: release-preview-channel-007-2
target: working-tree-2026-08-31-dev-next
compared_with: release-preview-channel-007-1
---

# Verdict

**PASS. No P1, P2, or P3 finding.**

All three Review 1 findings are resolved. Preview AppUserModelID is now assigned in the first-import
runtime bootstrap before any Main startup body or hidden `BrowserWindow` can run. Preview updater
tests and publication helpers are split into focused files, leaving every reviewed TypeScript/
JavaScript file within the 800-line limit while preserving the publisher's public test exports and
release behavior.

# Findings

None.

# Review 1 resolution

| Prior finding | Resolution | Result |
|---|---|---|
| P2: AppUserModelID followed hidden SQLite window creation | `runtimeProfile.bootstrap.ts` applies the profile and immediately calls `electronApp.setAppUserModelId(profile.appId)`. This module remains byte-zero's first import in `app.main.ts`; the later Main call was removed. The source-order test now requires this placement. | resolved |
| P3 / TS-1: `tests/update/updatePolling.test.mjs` at 839 lines | Release-channel tests moved to `tests/update/updateChannel.test.mjs`; the package test alias runs both files. `updatePolling.test.mjs` is now 794 lines. | resolved |
| P3 / TS-1: `scripts/publish.js` at 1,099 lines | Release-channel configuration, artifact discovery/validation, upload-manifest construction, and build-identity gates moved to `scripts/release/releaseChannel.cjs`. `publish.js` is now 786 lines and the helper is 363 lines. Existing exports used by release tests remain available. | resolved |

# Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Preview uses production API with a distinct release channel | `release_preview` remains exactly `VITE_ENV=prod`, `VITE_MODE=release`, `VITE_RELEASE_CHANNEL=preview`, with the production core endpoint. Invalid Preview tuples fail closed. | pass |
| Early application and persistence identity | The first Main import applies `Bitterless_PREVIEW`, `io.bitterless.desktop.preview`, explicit `userData`/`sessionData`, then AppUserModelID before the application module body, single-instance lock, SQLite window, logging consumers, or foreground windows. | pass |
| Generated package identity | `scripts/before.js` still generates Builder and NSIS output only from the templates, with Preview product/app IDs, dedicated icons, `dist/preview`, and no Stable Explorer registration mutation. | pass |
| One-step platform publication | `publish_preview:mac_arm`, `publish_preview:mac_intel`, and `publish_preview:win` still perform frozen install, patch/version-code advance, current-worktree Preview build, identity audit, and exact-channel publication without Git operations. | pass |
| Publication safety | Extracted helpers retain exact artifact/update-metadata validation, package/dist/channel checks, Preview installer metadata, manifest-last ordering, downgrade/version-reuse gates, and Stable/Dev compatibility. | pass |
| Automatic update isolation | Preview metadata and generic feed remain pinned to the exact `preview/<platform>` directory; cross-channel/platform/installer redirects fail closed. Stable legacy metadata remains accepted only in the exact Stable directory. | pass |
| Artwork and Windows coexistence | Dedicated Preview PNG/ICNS/ICO remain pixel-consistent with unchanged Stable footprint; Preview NSIS does not register or remove Stable's `OnlyPreview` Explorer action. | pass |
| Diagnostics and types | Runtime profile/app ID/release channel remain represented in diagnostics and sanitized logging; Node type checking passes. | pass |

# Verification

| Check | Result |
|---|---|
| `yarn test:runtime-profile` | PASS, 9/9 |
| `yarn test:desktop-auto-update` | PASS, 19/19 across the split polling/channel suites |
| `yarn test:desktop-app-icon` | PASS, 5/5 |
| `yarn test:desktop-package-audit` | PASS, 24/24 |
| `yarn test:sqlite-migrations` | PASS, 28/28; extracted publisher exports and release behavior covered |
| `yarn typecheck:node` | PASS |
| `node --check` for `publish.js`, `releaseChannel.cjs`, `before.js`, and Preview icon generator | PASS |
| `node scripts/publish.js --env preview --platform mac_arm --preflight-only` | PASS; real Preview ARM manifest is absent, first publication allowed; no bump/build/sign/upload |
| scoped `git diff --check` | PASS |
| Code-review `TS-1` scan | PASS; task-owned JS/TS maximum is 794 lines |
| Code-review `TS-2` scan | PASS; no newly added eligible `function` declaration |
| Electron E2E | Not run — prohibited unless Ral explicitly requests it |
| Real build/package/sign/notarize/upload | Not run — explicitly excluded from this independent review |

# Code Review file list

| # | File | Problem count |
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
| 16 | `scripts/publish.js` | 0 |
| 17 | `scripts/release/releaseChannel.cjs` | 0 |
| 18 | `scripts/sqlite-migrations/release-hook.test.mjs` | 0 |
| 19 | `src/main/app.main.ts` | 0 |
| 20 | `src/main/diagnostics/applicationDiagnostics.service.ts` | 0 |
| 21 | `src/main/diagnostics/diagnosticEnvironment.service.ts` | 0 |
| 22 | `src/main/env.d.ts` | 0 |
| 23 | `src/main/environment/runtimeProfile.bootstrap.ts` | 0 |
| 24 | `src/main/environment/runtimeProfile.runtime.ts` | 0 |
| 25 | `src/main/environment/runtimeProfile.service.ts` | 0 |
| 26 | `src/main/logging/log.setup.ts` | 0 |
| 27 | `src/main/logging/logSanitizer.service.ts` | 0 |
| 28 | `src/main/updateHelper/update.service.ts` | 0 |
| 29 | `src/main/updateHelper/update.type.ts` | 0 |
| 30 | `src/main/updateHelper/updateChannel.service.ts` | 0 |
| 31 | `src/shared/diagnostics/applicationDiagnostics.contract.ts` | 0 |
| 32 | `tests/update/updatePolling.test.mjs` | 0 |
| 33 | `tests/update/updateChannel.test.mjs` | 0 |
| 34 | `tests/e2e/e2eRuntimeMode.ts` | 0 |

# Conclusion

**Approved for the parent release workflow.** Source, focused tests, type checking, and the real
read-only Preview OSS preflight provide no remaining reason to block the requested macOS ARM
build/sign/notarize/upload proof.
