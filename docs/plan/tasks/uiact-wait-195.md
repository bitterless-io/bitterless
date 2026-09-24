---
id: uiact-wait-195
scope: Jev on by default (insert-if-absent), BJ3 passes when unauthenticated, settings scope text
status: pending
depends-on: [uiact-wait-194, decision-helper-199]
---

Paired with `micromeet-cowork` `docs/plan/tasks/uiact-wait-003.md`. Bitterless style: semicolons, `for…of` (no `forEach`), i18n via `i18nHelper`.

# Jev default on

## Objective

Implement `docs/features/ui-act-wait-hover-jev.md` **#4**:

- `ConfigDao.insertIfAbsent({ domain, key, options })` — `INSERT … ON CONFLICT DO NOTHING`, returns `{ ok }`; add it to
  `ConfigApi`.
- `isJevEnabled()`: `get` → if null, `insertIfAbsent(true)` then `get` again → `row?.options === true`. A stored
  `false` is never overwritten; an unreachable store still reads as off.
- Setting → Decision store `load()` calls the same `insertIfAbsent` before reading.
- `uiActGate.ts`: `reason === 'unauthenticated'` passes like `off`; other failures unchanged.
- Settings `scope` line (`zh.ts` + `en.ts`): effective for BJ1, BJ3,
  BJ4 (post-action readiness); BJ2 / BJ5 not wired.
- Add a dated correction to `docs/features/setting-decision-section.md` ("默认关" → default on, link the feature doc).
- Add the feature + this plan to `docs/INDEX.md` (feature entry already added by the orchestrator — update its status).

## Context

- `docs/features/ui-act-wait-hover-jev.md` (#4)
- `docs/features/setting-decision-section.md` (current default-off rationale)

## Path

- `src/preload/maestro/sqlite/config.dao.ts`, `src/shared/maestro/config.api.ts`
- `src/main/decision/jevDecision.service.ts`
- `src/main/maestro/drive/uiActGate.ts`
- `src/renderer/home/src/views/setting/components/DecisionSetting/decisionSetting.store.ts`, `DecisionSetting.vue`
- `src/renderer/common/i18n/zh.ts`, `src/renderer/common/i18n/en.ts` (`setting.decision.scope`, via i18nHelper)
- `tests/maestro/jevDefaultOn.test.mjs` (new)
- `docs/features/setting-decision-section.md`, `docs/INDEX.md`

## Verification

- Unit tests from #6 for the switch (no row → true; stored false stays off; null store → off) and BJ3
  (`unauthenticated` passes without `askOperator`; `network` still asks).
- `yarn typecheck`. No E2E.
