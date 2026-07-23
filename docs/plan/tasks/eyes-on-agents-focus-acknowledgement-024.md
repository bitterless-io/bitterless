---
id: eyes-on-agents-focus-acknowledgement-024
scope: preserve Hook working authority and let Open acknowledge the current Focus observation
status: implemented; owner verification pending
depends-on: [eyes-on-agents-tiered-all-polling-019, eyes-on-agents-focus-read-all-021]
---

# EyesOnAgents Working Authority and Focus Acknowledgement

## Objective

Stop independent App Server metadata reads from overwriting Codex Desktop Hook state, and make a
successful Open dismiss the currently observed active task until genuinely newer lifecycle evidence
arrives. Do not add or infer a paused state.

## Required behavior

- The tiered ten-second refresh may update title, provider activity, and the separately authorized
  last user question, but never runtime state or Focus evidence.
- `UserPromptSubmit` always records `working`, a new status observation time, and unread attention.
- Focus remains derived from unread plus active evidence that has not already been acknowledged:

  ```text
  current active attention = active runtime
                          AND (last_opened_at is absent
                               OR status_observed_at is newer than last_opened_at)

  in Focus = current active attention OR is_unread
  ```

- After the deep link succeeds, Open records `last_opened_at` and clears unread. The currently
  observed active row leaves Focus.
- A later active Hook/lifecycle event advances `status_observed_at`, sets unread, and returns the row
  to Focus.
- `Read all` keeps its existing rule: it never acknowledges active rows and never writes Open time.
- No TTL, private transcript/rollout scan, or guessed `paused` state is allowed.

## Expected paths

- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/analysis/eyes-on-agents.md`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`

## Verification

- A newer Hook `working` event survives tiered metadata refresh.
- Open removes the current working row from Focus only after deep-link success.
- A later `UserPromptSubmit` restores working unread Focus.
- Failed Open leaves Focus and unread unchanged.
- Existing Stop/idle, Read all, page-size, concurrency, and silent-refresh behavior remains covered.
- No Electron UI run; Ral owns final runtime verification.

## Delivery evidence

- EyesOnAgents core and repository regression suites pass.
- App Server, Hook bridge/delivery, and Project resolver suites pass.
- The repository proof covers Hook working -> Open acknowledgement -> metadata-only refresh -> a
  later Hook turn restoring unread Focus.
- No Electron UI run; Ral owns final runtime verification.
