---
id: ref-tab-binding-200
scope: bind snapshot epochs and refs to the tab that produced them; name the right tab_id on mismatch; report where an action landed
status: pending
depends-on: [decision-helper-199]
---

Paired with `micromeet-cowork` `docs/plan/tasks/ref-tab-binding-001.md`.

# ui_act refs bound to their tab

## Objective

Implement `docs/issues/ui-act-refs-not-bound-to-tab.md` (修法 table): main-process global epoch counter per snapshot with a tab registry;
`ui_act` names the owning tab when `snapshot` belongs to another tab, never prints the live epoch in the stale error; success results carry the
acting `tab_id`, page title and URL path (no query string). `snapshot` stays optional; skill scripts unaffected.

## Context

- `docs/issues/ui-act-refs-not-bound-to-tab.md`
- overmind `areas/agent-runtime/chat/audit-report/20260924-121036-12d3vuybr8oemuezgfot-review.md` P1-01

## Path

- `src/main/maestro/capture/` walker + capture (epoch stamping), `src/main/maestro/drive/requestExec.service.ts` + `requestExec.helper.ts` (validation + result), `src/main/maestro/drive/replayEngine.ts` (`readEpoch`)
- tests under `tests/maestro/`

## Verification

- The issue's 验收 unit tests; existing uiAct* tests; `yarn typecheck`. No E2E.
