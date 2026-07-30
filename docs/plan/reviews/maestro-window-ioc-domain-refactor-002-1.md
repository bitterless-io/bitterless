# maestro-window-ioc-domain-refactor-002 — Review 1

- Date: 2026-07-30
- Scope: current working tree, compared with
  `HEAD:src/main/maestro/windows/maestroWindow.helper.ts`,
  `docs/plan/tasks/maestro-window-ioc-refactor-001.md`,
  `docs/plan/tasks/maestro-window-ioc-domain-refactor-002.md`,
  `docs/features/maestro-window-ioc.md`,
  `docs/plan/reviews/maestro-window-ioc-refactor-001-1.md`, and Micromeet Cowork's
  `apps/cowork/src/main/windows/main` reference.

## Findings

### 1. P2 · resolved — the IoC lifecycle guard had two silent-green paths

- Design:
  `docs/plan/tasks/maestro-window-ioc-domain-refactor-002.md:32-40,50-52`;
  `docs/features/maestro-window-ioc.md:48-59,64-70`.
- Guard:
  `scripts/maestro/check-ioc-composition.mjs:127-143,155-199`;
  `scripts/maestro/check-capture-persistence.mjs:155-175`.
- Correct implementation:
  `src/main/maestro/windows/main/maestroWindow.controller.ts:275-299,1611-1625`;
  `src/main/maestro/agent/maestroAgent.service.ts:180-186,297-325,911-915`.
- Original evidence:
  1. The create-order assertion compared
     `indexOf('this.agentService.activate()') < indexOf('this.ensureServices()')` without first
     requiring the activate index to be non-negative. Deleting `agentService.activate()` made the
     left side `-1`, so the assertion still passed while `ensureServices()` remained present.
  2. The guards asserted that shutdown called `resetWindowScopedViews()`, but did not inspect that
     helper's body. Removing `browserView.reset()` or `workbenchView.reset()` from the helper left
     the composition, capture-persistence, workspace, and integration guards green.
- Impact:
  after one shutdown, `MaestroAgentService.shuttingDown` stays true unless `activate()` runs, so the
  next create reaches `ensureAgents()` and throws from `assertAgentRuntimeActive()`. Missing browser
  or workbench reset instead carries stale tab/view or visibility state into the next window.
- Resolution:
  `check-ioc-composition` now requires both create-order indices to be non-negative before comparing
  them, bounds `resetWindowScopedViews()`, requires exactly one reset for all four services, requires
  exactly one clear for the five active window/session mirrors, and requires shutdown to invoke the
  bounded reset exactly once.
- Reverification:
  `check-ioc-composition` and `check-capture-persistence` both pass after the fix; the focused
  `typecheck:node` and `git diff --check` rerun also pass.

The current source keeps both lifecycle paths correct, and the repaired automated gate now rejects
the corresponding regressions.

### 2. P2 · resolved — controller lost the `clipText` import used by browser-interception approval

- Runtime seam:
  `src/main/maestro/drive/requestExec.service.ts:215`;
  `src/main/maestro/windows/main/maestroWindow.controller.ts:1402-1414`.
- Fixed import:
  `src/main/maestro/windows/main/maestroWindow.controller.ts:14`.
- Evidence:
  a focused real TypeScript diagnostic found that the extracted controller still called
  `clipText(...)` while no longer importing it. The normal no-check typecheck and esbuild production
  build accepted the unbound identifier, but approving a new `browser_intercept` rule would reach
  `confirmBrowserInterceptionRule()` and throw a runtime `ReferenceError` before the approval dialog
  completed.
- Resolution:
  the controller now statically imports `clipText` from `capture/traceTimeline`. The related
  `RequestExecService` validation branch now uses `check.ok === false`, restoring discriminated-union
  narrowing without changing runtime behavior. The approval-history guard now bounds the
  interception-confirmation method and requires both the static import and the `clipText` call.
- Reverification:
  the focused IoC, capture, browser-exec workflow, and approval guards, `typecheck:node`, and
  `git diff --check` pass after the repair.

No unresolved P1 or P2 behavior regression remains in the reviewed implementation.

## Behavior and architecture evidence

| Subject | Evidence | Result |
|---|---|---|
| IoC construction | Ten services have explicit `@inject(Symbol.for(Service.name))` constructor parameters, one controller `setState(this)` call, and one shared `iocHelper.bind` entry; no extracted service imports the controller or another leaf service | pass |
| Create order | Agent runtime activation precedes lazy agent resolution; top-level window precedes pinned browser/control/workbench child-view creation; four readiness promises gate `whenReady`; AI-CRMS reveal and custom startup tab remain ordered as in HEAD | pass |
| Shutdown order | scheduler stop → agent disposal → demo stop → capture flush/persist → browser/control/workbench teardown → auth detach → window destroy → workspace and lazy-service reset | pass |
| Tabs/debugger/views | pinned tab, warm/cold cap, spare prewarm, active `operationView`/`capture`/`replayEngine` mirrors, capture-target switch before mirror repoint, debugger suspend/resume, `TabInfo.debuggerAttached`, close/reorder/restore, and redundant-bounds suppression match HEAD | pass |
| Capture persistence | start clears prior edited evidence, stop persists raw trace records, config-store load/sync/clear format is unchanged, thumbnails remain broadcast-only, and capture events remain gated by target tab plus active capture | pass |
| Workspace | workspace refs and path-safety/tool bodies moved to `WorkspaceFileService`; session refs reset on shutdown; controller keeps only XPC/tool facades | pass |
| Integration | target/mapping/recorded-site/migration implementations moved to `IntegrationService` plus pure recorded-site helpers; scheduler callbacks retain controller coordination; no implementation duplicate remains in the controller | pass |
| Skills | generation/validation/import/export/replay and trainer helpers route through `SkillService`; registry/generator lazy bootstrap and result shapes remain unchanged | pass |
| Request execution | browser/API request execution, replay, interception state, approval calls, and new-tab note behavior moved to `RequestExecService`; mutable interception state has one owner; the controller approval facade now imports its `clipText` dependency | pass |
| Agent | agent caches, hydration, attachments/media, model targeting, activity/stream broadcasts, approval history, cancellation, and shutdown disposal moved to `MaestroAgentService`; no controller import or controller-owned duplicate mutable state remains | pass |
| XPC contract | both handler diffs change only the helper import path; handler method names and delegations, singleton name `maestroWindowHelper`, return types, and broadcast channels remain unchanged | pass |
| Cowork structural comparison | controller + native-view/domain leaf services use the same `CommonService<State>`/single bind composition and no reverse controller import; Bitterless capture/session/persistence behavior remains authoritative | pass |

The controller's 400-line `buildPiTools` method remains cross-domain tool-catalog composition rather
than a duplicate domain implementation. This is comparable to the Cowork reference, but it is also
the clearest next extraction point for bringing the controller below the project quality limit.

## >800-line quality marks

`wc -l` was run over the complete current `src/` tree. `TS-1` applies to code files; the binary WAV
row is listed only because a literal whole-tree `wc -l` reports it above 800 and is not a source-code
violation. `src/main/maestro/integration/recordedSite/rowMapping.ts` is exactly **800** lines, so it
does **not** exceed the limit and is intentionally absent from the over-limit tables.

### Maestro

| File | Lines | Origin | Follow-up split |
|---|---:|---|---|
| `src/main/maestro/windows/main/maestroWindow.controller.ts` | 1648 | new in this refactor | Extract tool-catalog assembly first, then group narrow domain facades. |
| `src/main/maestro/agent/maestroAgent.service.ts` | 1597 | new in this refactor | Separate session/hydration orchestration from media, policy, and approval-history concerns. |
| `src/main/maestro/windows/main/maestroBrowserView.service.ts` | 1350 | new in this refactor | Separate tab/view lifecycle from injected-button, context-menu, and listener wiring. |
| `src/main/maestro/capture/debuggerCapture.ts` | 1330 | existing | Split CDP attach/identity, recording bridge, snapshot, and network event adapters. |
| `src/main/maestro/drive/replayEngine.ts` | 1310 | existing | Split UI action, browser-command, API replay, and request-body/header transforms. |
| `src/renderer/maestro/workbench/src/workbench.store.ts` | 1262 | existing | Split capture editing/persistence from display/filter state. |
| `src/main/maestro/skills/skillGenerator.service.ts` | 1262 | existing | Split prompt assembly, recipe inference, API classification, and document rendering. |
| `src/main/maestro/integration/integration.service.ts` | 1192 | new in this refactor | Split recorded-site orchestration from migration/report and mapping tool adapters. |
| `src/main/maestro/skills/skillRegistry.service.ts` | 1022 | existing | Split storage/import-export from portable-doc generation and parsing helpers. |
| `src/shared/maestro/coach.api.ts` | 993 | existing | Split public contracts by stable domain while preserving the XPC surface. |
| `src/renderer/maestro/control/src/store/message.store.ts` | 936 | existing | Split composer/attachment flow from session/message persistence. |
| `src/renderer/maestro/workbench/src/views/WorkbenchRecordingView.vue` | 810 | existing | Move recording-view business flow into focused stores/components. |

The four new over-limit files are non-blocking quality debt for this behavior-preserving extraction,
but they remain `TS-1` violations and should be the next Maestro decomposition targets.

### Non-Maestro

| File | Lines | Origin |
|---|---:|---|
| `src/main/eyesOnAgents/eyesOnAgents.service.ts` | 2516 | existing |
| `src/preload/sqlite/todoistSync/todoistSync.repository.ts` | 1812 | existing |
| `src/main/mcp/mcpBridge.server.ts` | 1516 | existing |
| `src/renderer/coin/src/App.less` | 1514 | existing style source |
| `src/preload/sqlite/dao/eyesOnAgents.dao.ts` | 1496 | existing |
| `src/main/coin/data/memeAnalysis.normalize.ts` | 1333 | existing |
| `src/renderer/common/i18n/zh.ts` | 1200 | existing; modified elsewhere in the working tree |
| `src/renderer/common/i18n/en.ts` | 1199 | existing; modified elsewhere in the working tree |
| `src/main/windows/omniWindow.helper.ts` | 1194 | existing |
| `src/renderer/todo/src/store/todo.store.ts` | 1025 | existing |
| `src/renderer/coin/src/views/analysis/coinWorkspace.store.ts` | 1019 | existing |
| `src/main/modelProvider/modelProvider.service.ts` | 901 | existing |
| `src/shared/coin/coinAnalysis.type.ts` | 874 | existing |
| `src/main/coin/data/coinData.service.ts` | 803 | existing |

These are pre-existing, out-of-scope quality debts. Future work should split each at its own business
boundary rather than mixing their cleanup into the Maestro refactor.

### Non-code whole-tree result

| File | `wc -l` | Treatment |
|---|---:|---|
| `src/renderer/common/assets/sound/success.wav` | 901 | Binary asset; not a `TS-1` or source-splitting finding. |

## Gates

| Gate | Result | Evidence |
|---|---|---|
| `yarn typecheck:node` | pass | `tsc --noEmit --noCheck -p tsconfig.node.json --composite false` completed successfully; strict TypeScript was intentionally not run |
| `yarn build` | pass | main, preload, and renderer production builds completed successfully |
| `git diff --check` | pass | no whitespace errors |
| Focused real TypeScript diagnostic | resolved finding | exposed the missing controller `clipText` import; the temporary diagnostic config was removed after the localized repair |
| All 38 Maestro guards, run individually | 35 pass; 3 baseline failures | IoC composition, capture gating/persistence, startup, debugger, workspace, integration, skill, request, and agent seams pass |
| `check-agent-runtime` | baseline failure | installed package lacks the already-required `@earendil-works/pi-ai/dist/providers/openai-completions.js` file |
| `check-artifact-generation` | baseline failure | package manifest still does not declare the guard-required `exceljs`/`docx` dependencies |
| `check-embedded-host` | baseline failure | unchanged Maestro alias-boundary violations |
| `yarn check:maestro` | baseline failure before 38-check loop | stops at the same alias-boundary gate |
| Owner runtime smoke | pending | reserved for Ral: open/reopen Maestro, switch/open/close tabs, toggle debugger and Workbench, start/stop one capture, and send one Maestro message |

## Conclusion

**pass — owner runtime smoke pending**

The implementation itself preserves the reviewed HEAD behavior and completes the intended IoC
ownership split without a remaining P1/P2 runtime regression. The lifecycle-guard defect and the
missing browser-interception approval import found during review are fixed and reverified. Ral's
owner runtime smoke remains the final required handoff gate.
