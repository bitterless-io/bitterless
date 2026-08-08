---
id: onlypreview-standalone-only-002-1
status: pass
reviewed_task: onlypreview-standalone-only-002
target: 13f14f5450bba26fe74e4888428596abd034f746
base: 2a7bca8ab464202acecfb1626a0b50c64432f12b
date: 2026-08-08
review_type: independent-source-contract-and-runtime
---

# Verdict

**PASS. No P1, P2, or P3 finding was identified.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Contract Assessment

- Omni's shared ID allowlist and display-URL map contain exactly `todo`, `eyesOnAgents`,
  `translator`, and `motto`; the Control selector and Main runtime registry expose the same four
  applications. The generic mini-app view still receives `--mode=omni`, while the cell state,
  creation, cleanup, and teardown code has no OnlyPreview capability or host branch
  (`src/shared/omni/omni.types.ts:12`, `:43`; `src/renderer/omni/omniControl/src/components/OmniPane.vue:34`;
  `src/main/windows/omniWindow.helper.ts:117`, `:609`, `:747`, `:1023`). A production-source search
  across the Omni shared, Main, and renderer surfaces found no `onlypreview` reference.
- A persisted `miniAppId: 'onlypreview'` reaches the shared `parseOmniMiniAppId` through the leaf
  parser and is rejected as unsupported. Main's unchanged restore path catches that parser failure,
  installs the default browser tree, and records/replays recovery state; the focused contract test
  executes both direct and persisted-leaf rejection (`src/shared/omni/omni.types.ts:50`, `:193`;
  `src/main/windows/omniWindow.helper.ts:1066`; `tests/motto/mottoIntegration.test.mjs:14`).
- `OnlyPreviewHostKind` is limited to `standalone | settings`. The preload exposes host token, host
  id, entry mode, and platform without a container mode; Main no longer passes a generic
  `--mode=` argument to OnlyPreview. The Shell retains only the empty native Preview host and its
  bounds observer, with no embedded `PreviewSurface`, `isOmni`, or renderer-local Preview-store
  branch (`src/shared/onlypreview/onlyPreview.types.ts:6`;
  `src/preload/onlypreview/onlypreview.preload.type.ts:1`;
  `src/preload/onlypreview/onlypreview.preload.ts:15`;
  `src/main/windows/onlyPreviewWindow.helper.ts:61`;
  `src/renderer/onlypreview/shell/src/App.vue:226`, `:398`;
  `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:120`, `:253`, `:490`).
- The standalone graph still creates one `BaseWindow`, adds separate Shell and Preview
  `WebContentsView`s in order, shares one content host, clamps native Preview bounds, closes both
  child webContents, and creates an isolated settings-only `BrowserWindow`. Every OnlyPreview
  renderer remains sandboxed with context isolation, Node integration disabled, web security, and
  exact-target navigation fencing (`src/main/windows/onlyPreviewWindow.helper.ts:161`, `:203`,
  `:324`, `:338`, `:360`, `:375`). The Electron acceptance exercised both native views, exact
  geometry and shortcuts, immutable text/selectable PDF/image/audio/video previews, and the
  singleton persisted Settings flow.
- The Home card/emitter/XPC launch, OS open router and argv paths, file associations, window-state
  keys, capability/result-envelope boundary, containment/index/classifier services, revocable
  streaming protocol, Monaco/PDF rendering, auth/quit cleanup, i18n/log policy, and all three build
  entries remain present. Their implementation files were unchanged relative to the base except
  for the standalone-window argument cleanup reviewed above; the focused Node suite and production
  build re-exercised the relevant integration and security gates.
- Current feature and analysis documents consistently describe OnlyPreview as standalone-only and
  Omni as a four-app runtime (`docs/features/onlypreview.md:74`, `:393`;
  `docs/features/omni-miniapp-cells.md:5`, `:62`, `:93`;
  `docs/features/README.md:48`; `docs/features/window-state-persistence.md:18`). Between base and
  target, `docs/plan/tasks` / `docs/plan/reviews` changed only by adding the new follow-up task; no
  historical task or review was modified.

# Verification

- `node --test tests/onlypreview/*.test.mjs tests/motto/mottoIntegration.test.mjs` — pass, 32/32.
- `yarn test:omni-layout` — pass, 9/9.
- `yarn typecheck:node` — pass.
- `yarn check:renderer-i18n` — pass.
- Targeted `yarn eslint --quiet` over all 14 changed TS/Vue/MJS source and test files — pass.
- `yarn build` — pass; emits `out/preload/onlypreview.js`, all three OnlyPreview renderer HTML
  entries, and all four remaining Omni mini-app preload/renderer entries.
- `yarn test:e2e:onlypreview` — pass, 3/3 Electron tests.
- `git diff --check 2a7bca8..HEAD` — pass.
- Base/target commit, branch, changed-file scope, forbidden-reference searches, preserved launch and
  security paths, and documentation contract — independently inspected.

# Known Baselines

- No failing repository baseline was encountered.
- The Node test run reports the existing module-type inference warning because the package does not
  declare `type: module`; the affected package metadata was not changed by this task.
- The build reports existing Vite advisory warnings for mixed static/dynamic imports and the empty
  `omniCellContent` preload chunk. The E2E runner reports the existing `NO_COLOR` / `FORCE_COLOR`
  warning. All are non-failing and originate outside this task's diff.
- Signed packaged macOS/Windows association registration and the complete platform codec matrix were
  not run; `docs/features/onlypreview.md` explicitly retains those as packaged manual verification,
  separate from this source/build/Electron acceptance.
