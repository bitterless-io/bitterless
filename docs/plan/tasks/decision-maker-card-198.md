---
id: decision-maker-card-198
scope: user-facing "decision maker" wording (no Jev outside Settings), theme-blue borderless approval card, readable action label + element thumbnail on the card
status: done
depends-on: [builtin-wait-197]
---

Paired with `micromeet-cowork` `docs/plan/tasks/decision-maker-card-001.md`. Bitterless style: semicolons in new files, `for…of`, static alias imports; Less with flat BEM; colours via Arco `--primary-*` vars.

# Decision maker wording + theme-blue approval card

## Objective

Implement `docs/features/decision-maker-naming-and-approval-card.md` (#1–#4):

- Replace every user- or model-visible `Jev` / `jev` in runtime strings with "decision maker" (#2 table), except the three Settings → Decision texts.
  Code identifiers, file names, log scopes and API params (`jev-latest`) stay.
- Restyle the approval card, its answer sheet and the ask_user decision card waiting accents to the theme blue (#3); drop their borders;
  keep the expired (grey) state, structure, copy, `name` attributes and BEM classes.
- Element thumbnail (#4.1): the gate attaches a clipped screenshot of the target element (max edge 240 px, JPEG, ≤ 2 s, fail-open) to the approval
  request; the confirm sheet and the timeline card (also after Answered) show it inside a 120×120 aspect-fit box. Never sent to the decision maker.
- Gate label (#4 / issue `approval-card-shows-selector-instead-of-button-text.md`): the gate reads a dedicated label
  (aria-label → visible text → value → title, 120 chars) instead of `readText`; `readText` itself must not change.

## Context

- `docs/features/decision-maker-naming-and-approval-card.md` (contract)
- `docs/issues/approval-card-shows-selector-instead-of-button-text.md`
- overmind `areas/agent-runtime/chat/audit-report/20260924-121036-12d3vuybr8oemuezgfot-review.md` (P2-01 evidence)

## Path
- `src/main/maestro/capture/debuggerCapture.ts` — extract the element-crop logic of `captureElementShot` into a shared helper the gate can call (max edge 240 px, 2 s cap)
- the operator-ask payload type (`agentDecisionRegistry` request + the card model) — optional `image` data URL

- `src/main/maestro/drive/uiActGate.ts` (reason wording + label read)
- `src/main/maestro/drive/replayEngine.ts` (a `readLabel` next to `readText`, if that is where the gate reads from)
- `src/main/decision/jevDecision.service.ts` (failure messages)
- `src/main/maestro/drive/snapshotSegment.ts` (segment notes)
- `src/renderer/maestro/control/src/task/ChatConfirm.less`, `ChatConfirmSheet.less`, `DecisionRecord.less` (+ their `.vue` only if a class must change)
- tests under `tests/maestro/` (new + updated)

## Carried over from Cowork review 1 (2026-09-24)

Apply from the start: gate screenshots use `captureBeyondViewport: false` (recording path unchanged) and a late shot never runs after the 2 s timeout;
no label + no image → the card shows the selector; reasons carry failure type + HTTP status only; guard allowlist keyed by value + location and
scanning `src/shared` + i18n; answered cards at 70% opacity. F3 / F4 colours (Ral decided: all theme blue) — also turn the other amber "waiting" accents blue: status row wait tone, session-list / header pending dots, TaskPart hint (drop its border), MessageItem `act` tag.

## Verification

- #5 unit tests + a source guard (no `Jev` in main / control-renderer string literals except the Settings texts).
- Existing decision-sheet / approval tests still pass (update assertions that pinned amber / warning classes).
- `yarn typecheck`, `yarn check:i18n` if a user-visible string moves into i18n. No E2E.

## Close-out (2026-09-24)

- Review 1: **pass**, nothing blocking — `docs/plan/reviews/decision-maker-card-198-1.md`.
  - Zero regressions against base: 150 test files, 54 guards, ESLint and the i18n check are all unchanged.
  - The recording thumbnail's CDP parameters are byte-identical, checked with 30 inputs.
  - The Chromium probe gives `false` → 0 resizes, and 120×120 aspect-fit.
- F1: lead decided that a partly visible target gets a crop of its visible part. It is in the contract #4.1; Cowork follows in `decision-maker-card-002`.
- F2: contract note added.
- F4: raw relay text through `jev.judge`. Contract #3 now applies the message table to `judge()`; it goes to the `decision-helper-199` fix round.
- F5 / F6 → `decision-maker-card-202`. F7: statuses updated.
- For the #5 human look:
  - F3: BL's greyish blue leaves "waiting on you" and "running" one shade apart (#4e5882 vs #606b9d).
  - A never-shown agent tab must give no image, not a blank one.
