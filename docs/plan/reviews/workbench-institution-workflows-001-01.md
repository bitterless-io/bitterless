# Independent Workflow and Skill scope review

- Task: workbench-institution-workflows-001
- Date: 2026-09-16
- Reviewed source: `74598b31604fa17e7a9ece9a522a7c3111bdd974` (merged dev/next); Workflow corrections through `853371ad`, Skills checkpoint `91d47d38`.
- Reviewer: Cowork Workflow implementation worker; did not author the Bitterless implementation. Reviewer-authored execution regressions: `86e911e1` and `51ce4a13`.
- Result: **pass**. No remaining blocking contract finding or new code-review rule violation. The inherited TS-1 findings below are explicitly outside this task's refactor scope.

## File list

| # | File | Rule findings |
|---|---|---|
| 1 | `docs/INDEX.md` | 0 |
| 2 | `docs/features/workbench-institution-workflows.md` | 0 |
| 3 | `docs/plan/README.md` | 0 |
| 4 | `docs/plan/tasks/workbench-institution-workflows-001.md` | 0 |
| 5 | `examples/institution-workflow/README.md` | 0 |
| 6 | `examples/institution-workflow/workflow.json` | 0 |
| 7 | `examples/institution-workflow/workflow.ts` | 0 |
| 8 | `package.json` | 0 |
| 9 | `src/main/agent/workflowEngine/hostIntegration.ts` | 0 |
| 10 | `src/main/agent/workflowEngine/loader.ts` | 0 |
| 11 | `src/main/agent/workflowEngine/supervisor.ts` | 0 |
| 12 | `src/main/auth/customerSession.service.ts` | 0 |
| 13 | `src/main/workflowLibrary/assetScope.service.ts` | 0 |
| 14 | `src/main/workflowLibrary/workflowLibrary.service.ts` | 0 |
| 15 | `src/main/workflowLibrary/workflowLibraryRuntime.ts` | 0 |
| 16 | `src/main/workflowLibrary/workflowLibraryRuntimeProvider.ts` | 0 |
| 17 | `src/main/workflowLibrary/workflowPackageStorage.ts` | 0 |
| 18 | `src/main/xpc/workflowLibrary.handler.ts` | 0 |
| 19 | `src/main/xpc/xpc.helper.ts` | 0 |
| 20 | `src/renderer/common/i18n/en.ts` | 1 (inherited) |
| 21 | `src/renderer/common/i18n/zh.ts` | 1 (inherited) |
| 22 | `src/renderer/maestro/control/src/workflow.command.ts` | 0 |
| 23 | `src/renderer/maestro/workbench/src/components/WorkflowFlow.less` | 0 |
| 24 | `src/renderer/maestro/workbench/src/components/WorkflowFlow.vue` | 0 |
| 25 | `src/renderer/maestro/workbench/src/views/WorkbenchWorkflowsView.less` | 0 |
| 26 | `src/renderer/maestro/workbench/src/views/WorkbenchWorkflowsView.vue` | 0 |
| 27 | `src/renderer/maestro/workbench/src/workbench.router.ts` | 0 |
| 28 | `src/renderer/maestro/workbench/src/workbench.store.ts` | 1 (inherited) |
| 29 | `src/renderer/maestro/workbench/src/workflowGraph.ts` | 0 |
| 30 | `src/renderer/maestro/workbench/src/workflowLibrary.store.ts` | 0 |
| 31 | `src/shared/agentWorkflow.api.ts` | 0 |
| 32 | `src/shared/maestro/coach.api.ts` | 1 (inherited) |
| 33 | `src/shared/sharedWorkflowDemo.ts` | 0 |
| 34 | `src/shared/workflowLibrary.type.ts` | 0 |
| 35 | `src/shared/workflowPackage.ts` | 0 |
| 36 | `tests/workflowHost/hostIntegration.test.cjs` | 0 |
| 37 | `tests/workflowHost/workflowActivity.test.cjs` | 0 |
| 38 | `tests/workflowLibrary/library.test.mjs` | 0 |
| 39 | `tests/workflowLibrary/tsconfig.json` | 0 |
| 40 | `tests/workflowLibrary/tsconfig.web.json` | 0 |
| 41 | `tests/workflowLibrary/ui.test.mjs` | 0 |
| 42 | `tests/workflowLibrary/visual.fixture.ts` | 0 |
| 43 | `tests/workflowLibrary/visual.mjs` | 0 |
| 44 | `tests/workflowLibrary/xpc.fixture.ts` | 0 |
| 45 | `src/main/agent/maestroAgent.service.ts` | 1 (inherited) |
| 46 | `src/main/agent/runtime/agentPrompt.ts` | 0 |
| 47 | `src/main/maestro/drive/replayEngine.ts` | 1 (inherited) |
| 48 | `src/main/maestro/drive/requestExec.service.ts` | 1 (inherited) |
| 49 | `src/main/maestro/drive/skillScript.ts` | 0 |
| 50 | `src/main/maestro/skills/skill.service.ts` | 0 |
| 51 | `src/main/maestro/skills/skillFileAccess.service.ts` | 0 |
| 52 | `src/main/maestro/skills/skillGenerator.service.ts` | 1 (inherited) |
| 53 | `src/main/maestro/skills/skillRegistry.service.ts` | 1 (inherited) |
| 54 | `src/main/maestro/skills/skillScope.context.ts` | 0 |
| 55 | `src/main/maestro/skills/skillScope.storage.ts` | 0 |
| 56 | `src/main/maestro/windows/main/maestroWindow.controller.ts` | 1 (inherited) |
| 57 | `src/main/maestro/windows/main/workspaceFile.service.ts` | 0 |
| 58 | `src/main/maestro/xpc/coach.handler.ts` | 0 |
| 59 | `src/renderer/maestro/workbench/src/components/SkillScopeControl.less` | 0 |
| 60 | `src/renderer/maestro/workbench/src/components/SkillScopeControl.vue` | 0 |
| 61 | `src/renderer/maestro/workbench/src/skillScope.messages.ts` | 0 |
| 62 | `src/renderer/maestro/workbench/src/views/WorkbenchRecordingView.vue` | 1 (inherited) |
| 63 | `src/renderer/maestro/workbench/src/views/WorkbenchSkillsView.vue` | 0 |
| 64 | `tests/skillScopes/scope.test.mjs` | 0 |
| 65 | `tests/skillScopes/tsconfig.node.json` | 0 |
| 66 | `tests/skillScopes/tsconfig.web.json` | 0 |
| 67 | `tests/skillScopes/execution.test.mjs` | 0 |

## Rule findings by file

### 20. src/renderer/common/i18n/en.ts

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 20.1 | 1–1220 | TS-1 | P3, non-blocking: 1220 lines; already 1164 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

### 21. src/renderer/common/i18n/zh.ts

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 21.1 | 1–1190 | TS-1 | P3, non-blocking: 1190 lines; already 1134 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

### 28. src/renderer/maestro/workbench/src/workbench.store.ts

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 28.1 | 1–1117 | TS-1 | P3, non-blocking: 1117 lines; already 1077 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

### 32. src/shared/maestro/coach.api.ts

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 32.1 | 1–1107 | TS-1 | P3, non-blocking: 1107 lines; already 1097 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

### 45. src/main/agent/maestroAgent.service.ts

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 45.1 | 1–2273 | TS-1 | P3, non-blocking: 2273 lines; already 2255 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

### 47. src/main/maestro/drive/replayEngine.ts

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 47.1 | 1–1345 | TS-1 | P3, non-blocking: 1345 lines; already 1333 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

### 48. src/main/maestro/drive/requestExec.service.ts

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 48.1 | 1–866 | TS-1 | P3, non-blocking: 866 lines; already 854 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

### 52. src/main/maestro/skills/skillGenerator.service.ts

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 52.1 | 1–1266 | TS-1 | P3, non-blocking: 1266 lines; already 1262 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

### 53. src/main/maestro/skills/skillRegistry.service.ts

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 53.1 | 1–1033 | TS-1 | P3, non-blocking: 1033 lines; already 1010 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

### 56. src/main/maestro/windows/main/maestroWindow.controller.ts

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 56.1 | 1–1951 | TS-1 | P3, non-blocking: 1951 lines; already 1944 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

### 62. src/renderer/maestro/workbench/src/views/WorkbenchRecordingView.vue

| # | Line | Rule | Finding | Recommendation |
|---|---|---|---|---|
| 62.1 | 1–812 | TS-1 | P3, non-blocking: 812 lines; already 810 lines before this task. | Preserve this bounded change; split during separately scoped maintenance. |

TS-2: no new standalone function declaration requiring conversion. The changed test integration helper retains its existing declaration style. FE-1/FE-2: business orchestration remains in stores; graph interaction is a reusable component. No BE rule is defined by the review skill.

## Contract findings resolved before acceptance

- Workflow startup repeated stop/disposal admission after the final asynchronous path authorization; a stop during that await now prevents supervisor launch.
- Missing installed entry files no longer suppress same-revision repair; unrelated Shared installations and previous immutable revisions remain intact.
- Branch alternatives now retain parallel ranks in a graph with a return loop; all edges remain drawn and return paths stay below the cards. Fit handles graph changes/resizing and respects subsequent manual zoom.
- Skills replay performs current authorization before reading/executing and around individual steps. Logout during a step prevents later side effects.
- Training repeats the scope fence before archiving or overwriting; logout and same-account generation changes leave existing files intact.
- Script API calls recheck cancellation after awaited approval; revoked calls do not reach the network.
- General file tools canonicalize both managed root and target, reject foreign institution paths and aliases, and recheck context after the complete result. Search cannot return private hits collected before logout during a later read.
- Shared/institution/Needs scope filters and new dark-theme controls were independently rendered; ambiguous legacy content has an explicit assignment path without deleting its source.

## Source integration traced

- Authoritative customer session → live account/institution authorization → institution-scoped API → credential-free signed archive download → bounded ZIP/manifest validation → immutable files and atomic activation → renderer store → static graph. No package preview imports executable TypeScript.
- Qualified Workflow/Skill references preserve same-name identities. Institution directories include the literal institution ID below backend/account namespace. Agent catalogs, contract/script/replay calls, managed paths and generic file read/list/search use the same scope boundary.
- Shared canonical demo/local imports and known builtin Skills remain available logged out. Unassigned legacy recording/import bytes remain preserved, excluded from Agent execution, and can be explicitly copied to Shared or the current authorized institution. Scope is host-owned rather than accepted from imported frontmatter.
- Context changes invalidate catalog/renderer responses and Agent state; polling remains bounded at 60 seconds. Active execution files are retained while stale managed references cannot start another run.

## Final verification on 74598b31

| Command | Result |
|---|---|
| `yarn test:workflow-library` | 18/18 pass |
| `yarn test:skill-scopes` | 17/17 pass: 8 provenance/storage plus 9 independent real-consumer regressions |
| `node --test tests/workflowHost/hostIntegration.test.cjs` | 17/17 pass |
| `yarn typecheck:workflow-library` | Strict Node/Vue pass |
| `yarn typecheck:skill-scopes` | Strict Node/Vue pass |
| `yarn tsc -p tests/workflowEngine/tsconfig.json` | Pass |
| `yarn electron-vite build` | Complete Main/Preload/Renderer production-mode build pass, 23.14 seconds |
| `node tmp/skill-review/render.mjs` | Actual Skills view and reusable scope control pass: desktop light/dark, narrow dark, logged-out Shared |

Build used the existing synthetic release_prod profile containing public endpoint/mode values only. It did not run Rig, signing, publication, migration or a running-app restart. `package.json` version_code remains `260916170618`; tracked worktree was clean after build. Existing Main package/update readers map `version_code` to runtime `versionCode`; no legacy package `versionCode` is present. Emitted sqlite/trench preload bundles contain `260916170618`. Final build log: private `/tmp/bl-combined-final-build.log`.

Independent images are private verification artifacts under overmind `tmp/workflow-share/verification/bl-skills-screenshots/` (desktop-light, desktop-dark, narrow-dark, logged-out-shared). Final desktop-dark was inspected again. Workflow real-component images are under the worktree's `tmp/workflow-visual/` (desktop/narrow light/dark and branch-loop); the corrected branch/loop image was inspected after 853371ad. Fixtures are only in test harnesses and never production fallback.

## Verification limits

- Focused strict type checks pass; this report does not claim the whole legacy repository is type-clean. Existing aggregate diagnostics/OOM limitations are recorded in the task and `docs/issues/typecheck-is-a-false-green.md`.
- The earlier broader engine/UI/host run passed 152 executed tests with one known hardcoded cross-repository parity case excluded because it targets the original Cowork release checkout rather than this isolated implementation. The final host-focused suite above has no skipped tests.
- The independent 31-case adversarial ZIP fixture set and the canonical sample's real Kimchi execution were verified earlier in this delivery; both implementations preserve the same sample bytes. Desktop distribution and live end-user login acceptance were not performed in this review. Cloud release/sample publication and final remote synchronization remain release-coordinator responsibilities.
