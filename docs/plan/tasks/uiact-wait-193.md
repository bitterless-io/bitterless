---
id: uiact-wait-193
scope: shared timerHelper + ui_act hover (wait / wait_for dropped 2026-09-24)
status: done
depends-on: []
---

Paired with `micromeet-cowork` `docs/plan/tasks/uiact-wait-001.md`. Bitterless style: semicolons, `for…of` (no `forEach`), static alias imports.
The maestro alias boundary guard must allow `@shared/timerHelper/` (feature doc #1).

# ui_act: hover + timerHelper

## Objective

Implement `docs/features/ui-act-wait-hover-jev.md` **#1 and #2** as revised on 2026-09-24:

- `src/shared/timerHelper/timer.helper.ts` exporting `timerHelper = { delay }` (async/await, negative/NaN → 0).
  Replace the local `wait()` in the drive `replayEngine.ts` and `humanMouse.ts` with it; do not touch other files' local sleep/delay,
  and do not replace sleeps inside page-injected scripts (the page has no timerHelper).
- One new `ui_act` action: `hover` (`ref` or `selector`) — locate with the same `locateTarget` as click, move the human pointer
  onto the target, **no press**; not located → `ok:false`, error starting with `hover target not located`, batch stops.
- **No `wait` and no `wait_for`** (Ral 2026-09-24: timed waits are a generic built-in `wait` tool — browser-downloads #6.7;
  「Wait for 先不要保留了」). Both are unknown actions to the parser. Remove any code/tests/description already written for them.
- BJ3 (`uiActGate.ts`) makes zero Jev calls for `hover`.
- `ui_act` tool description: add `hover`; add "use the same tab_id as the snapshot you read"; keep the example JSON valid;
  update the "no valid actions" error text.

## Context

- `docs/features/ui-act-wait-hover-jev.md` (contract — #1, #2, #2.3–#2.5)
- `docs/issues/ui-act-selector-miss-diagnosis.md` (keep the existing result shape)

## Path

- `src/shared/timerHelper/timer.helper.ts` (new)
- `src/main/maestro/drive/replayEngine.ts` (extract `locateTarget` from `clickStep`, add `hoverStep`), `src/main/maestro/drive/humanMouse.ts`
- `src/main/maestro/drive/requestExec.helper.ts` — `parseAgentUiActions`
- `src/main/maestro/drive/requestExec.service.ts` — `toolUiAct` result handling / error text only
- `src/main/maestro/drive/uiActGate.ts` — only if types require it
- `src/main/maestro/windows/main/maestroWindow.controller.ts` — `ui_act` description
- `scripts/maestro/_harness.mjs` — `hostAliasPrefixAllowlist` gains `@shared/timerHelper/`
- `tests/maestro/uiActWaitHover.test.mjs` (new; name kept for continuity)
- `tests/skillScopes/execution.test.mjs` — one line mapping the real timerHelper (review 1 F4)

## Verification

- Unit tests from #6 that belong to #1/#2: timerHelper; parsing (`hover` accepted, `wait` / `wait_for` rejected);
  hover moves without pressing; hover not-located stops the batch; BJ3 zero calls for hover.
- Existing `tests/maestro/uiAct*.test.mjs` still pass (report pre-existing failures separately).
- `yarn typecheck` (changed files must have 0 diagnostics). No E2E.
