# maestro-window-ioc-refactor-001 — Review 1

- Date: 2026-07-30
- Scope: current working tree, compared with `HEAD:src/main/maestro/windows/maestroWindow.helper.ts`,
  `docs/plan/tasks/maestro-window-ioc-refactor-001.md`, the Maestro IoC feature contract, and
  Micromeet Cowork's `apps/cowork/src/main/windows/main` reference.

## Findings

### 1. P2 · blocking — capture guard does not protect the new BrowserView → controller event seam

- Design: `docs/plan/tasks/maestro-window-ioc-refactor-001.md:36-38`;
  `docs/features/maestro-window-ioc.md:69-70`.
- Guard: `scripts/maestro/check-capture-gating.mjs:17-18,53-54`.
- Implementation seam: `src/main/maestro/windows/main/maestroBrowserView.service.ts:311-318`.
- Evidence: the guard checks the controller's `onCapturedEvent` body and the
  `DebuggerCapture` capture predicate independently, but never asserts that the callback forwards
  each event through `this._state.onCapturedEvent(event, owner.id)`. Removing the forwarding call at
  line 315 leaves this guard green.
- Impact: capture can remain visibly “started” while no debugger event reaches controller
  persistence/broadcasting, and the affected guard would silently accept the regression.

### 2. P2 · blocking — startup guard no longer verifies that the controller invokes the extracted startup flow

- Design: `docs/features/maestro-window-ioc.md:64-70`.
- Guard: `scripts/maestro/check-startup-settings.mjs:64,73-74`.
- Implementation seam: `src/main/maestro/windows/main/maestroWindow.controller.ts:806-822`;
  `src/main/maestro/windows/main/maestroBrowserView.service.ts:176-185`.
- Evidence: the guard reads only the BrowserView service. Removing
  `await this.browserView.openStartupTabIfNeeded()` at controller line 819 still passes. Its negative
  demo-fallback assertion is likewise limited to the service, so a fallback added to the
  controller's readiness chain would evade the check.
- Impact: persisted custom startup tabs could stop opening, or startup behavior could change, while
  the moved source guard remains green.

### 3. P2 · blocking — debugger guard misses the controller delegation and can match the wrong `TabInfo`

- Design: `docs/plan/tasks/maestro-window-ioc-refactor-001.md:36-38`;
  `docs/features/maestro-window-ioc.md:67-70`.
- Guard: `scripts/maestro/check-debugger-toggle.mjs:19-31`.
- Implementation seams: `src/main/maestro/windows/main/maestroWindow.controller.ts:868-870`;
  `src/main/maestro/windows/main/maestroBrowserView.service.ts:851-866`.
- Evidence: the guard checks handler → controller and the service implementation but does not read
  the controller, so a stale/no-op `setTabDebugger` facade still passes. Its whole-file
  `debuggerAttached` check can also be satisfied by the unrelated `tabsOpenedThisTurn` value at
  BrowserView line 663 after the actual `tabInfo()` broadcast field at line 865 is removed.
- Impact: the renderer can receive stale debugger state or the XPC facade can stop toggling the
  service while the guard reports success.

### 4. P2 · blocking — no guard covers the core IoC composition introduced by this task

- Design: `docs/plan/tasks/maestro-window-ioc-refactor-001.md:32-37`;
  `docs/features/maestro-window-ioc.md:48-59`.
- Guard entrypoint: `scripts/maestro/check-maestro.mjs:8-17`.
- Implementation seams: `src/main/maestro/windows/main/maestroWindow.controller.ts:643-657,756-766,5626-5629`.
- Evidence: none of the 37 Maestro checks asserts the four explicit constructor injections, the
  single `setState(this)` call per service, controller creation of all three view services, or their
  registrations in `iocHelper.bind`. Removing a service from `services`, omitting `setState`, or
  orphaning a `create()` call still typechecks/builds and can leave the string-based service guards
  green.
- Impact: the central runtime contract of the refactor can fail at module evaluation or first
  service access without any automated gate detecting the broken composition.

### 5. P3 · non-blocking — the first split still leaves two files above the 800-line quality limit

- Code: `src/main/maestro/windows/main/maestroWindow.controller.ts:1-7620`;
  `src/main/maestro/windows/main/maestroBrowserView.service.ts:1-1350`.
- Evidence: `wc -l` reports 7,620 and 1,350 lines respectively.
- Impact: both files remain above `code-review` rule TS-1. This does not block this native-view-only
  round because task requirement 6 explicitly keeps the remaining domains on the controller, but
  it should be resolved by the planned domain-service follow-up.

No blocking user-visible behavior regression was found in the current implementation itself.
Compared with HEAD, the four-way readiness barrier, `showOnReady = false`, pinned AI-CRMS boot,
active `operationView`/`capture`/`replayEngine` repointing and capture-target switch order,
`MAX_WARM` protections, tab CRUD/context menus/injected buttons, Control/Workbench load-error
propagation, and close/shutdown reset behavior are preserved.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Controller move/class/singleton | `maestroWindow.controller.ts:627-658,5626-5629`; both XPC imports point to the new module | pass |
| Browser/control/workbench ownership | `maestroBrowserView.service.ts:139-1015`; `maestroControlView.service.ts:17-72`; `maestroWorkbenchView.service.ts:26-111` | pass |
| IoC state/injection/bind invariants | local state interfaces; explicit `@inject` at controller lines 643-651; one `setState` each at 654-657; one bind list at 5626-5629; no service imports controller | pass in source, automated coverage blocked by Finding 4 |
| Keep remaining domains on controller | capture, integration, skill, workspace, and agent methods remain on `MaestroWindowController`; only narrow view-state delegators moved | pass for this round |
| XPC/runtime compatibility | XPC diffs change only import paths; singleton and broadcast strings remain; HEAD-to-current method review found no moved-flow semantic drift | pass in source |
| Guards follow moved code without silent green | all 20 modified guards use strict reads of existing new files; Findings 1-4 identify uncovered moved seams | blocked |

## Gates

| Gate | Result | Evidence |
|---|---|---|
| `yarn typecheck:node` | pass | completed successfully |
| `yarn build` | pass | main, preload, and renderer production builds completed successfully |
| `yarn check:maestro` | baseline failure before task guards | existing alias-boundary violations in unchanged Maestro files stop `check-maestro.mjs:13` before its 37-check loop |
| 20 directly affected guards | 17 pass; 3 baseline failures | `check-agent-runtime` lacks the already-required installed `pi-ai/dist/providers/openai-completions.js`; `check-artifact-generation` requires `exceljs`/`docx` in dependencies although HEAD has neither; `check-embedded-host` stops at the same unchanged alias boundary |
| Owner runtime smoke | not run | explicitly reserved for owner handoff |

## Conclusion

**blocked**

The implementation's reviewed behavior matches the native-view split contract, but requirement 7's
“no silently green moved guard” condition is not met. Findings 1-4 need guard coverage before this
round is deliverable; the owner runtime smoke remains the final post-fix handoff step.

## Follow-up

Findings 1-4 were resolved by the domain split and guard hardening tracked in
`maestro-window-ioc-domain-refactor-002`. The final independent review is
`docs/plan/reviews/maestro-window-ioc-domain-refactor-002-1.md`, whose conclusion is
**pass — owner runtime smoke pending**.
