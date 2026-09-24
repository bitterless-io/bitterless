---
id: uiact-wait-194
scope: Jev inside ui_act — BJ4 post-action readiness NOTE (wait_for until dropped 2026-09-24)
status: pending
depends-on: [uiact-wait-193, builtin-wait-197, decision-helper-199]
---

Paired with `micromeet-cowork` `docs/plan/tasks/uiact-wait-002.md`. Bitterless style: semicolons, `for…of`, static alias imports.

# ui_act: Jev readiness check (BJ4)

## Objective

Implement `docs/features/ui-act-wait-hover-jev.md` **#3.1** (BJ4 only — `until` was dropped together with `wait_for`):

- `readPageSummary()` (one `Runtime.evaluate`: title + first 1500 chars of whitespace-normalised `body.innerText`
  + interactive element count). It must **not** walk the snapshot tree or touch `data-coach-ref`.
- After a fully successful batch whose last action is `click` / `submit`, following the existing 700 ms popup wait: loop Jev noul
  `ready` (> 0.7 = ready) with 1000 ms `timerHelper.delay` beats inside an 8000 ms budget; fail-open when Jev is off /
  unauthenticated / errors; append the NOTE lines from #3.1 before the new-tabs note. Never changes `ok`, never stops the batch.
- Runs against the call's target tab (#2.5). Use `jevJudge` from `decision/jevDecision.service.ts`; no second Jev client.

## Context

- `docs/features/ui-act-wait-hover-jev.md` (#2.5, #3.1)
- overmind `areas/agent-runtime/decision/browser-use.html` BJ4 and `jev-browser-probe.mjs` B4 (question wording)

## Path

- `src/main/maestro/drive/requestExec.service.ts` (BJ4, NOTE)
- `src/main/maestro/drive/replayEngine.ts` (`readPageSummary`)
- `tests/maestro/uiActJevReadiness.test.mjs` (new)

## Verification

- Jev stubbed: 0.05 → 0.9 gives "judged ready"; always 0.05 gives the 8 s NOTE; off gives no NOTE and no extra wait;
  last action `hover` / `fill` gives no BJ4 call.
- `yarn typecheck`. No E2E.
