---
id: eyes-on-agents-active-focus-read-semantics-028-2
status: pass
reviewed_task: eyes-on-agents-active-focus-read-semantics-028
date: 2026-07-27
review_type: re-delivery-after-source-loss
---

# Verdict

**PASS. No P1, P2, or P3 finding survived verification.**

Round 2 exists because the source Round 1 passed on 2026-07-25 is not in the repository. Round 1
reviewed an uncommitted working tree ("The working tree contains concurrent unrelated edits") and
only its documentation artifacts were committed. At `release/2604` HEAD `b47be1d`,
`git log --all -S` finds no commit in any reachable ref that ever contained `isEyesOnAgentsTerminal`,
the two-argument `isEyesOnAgentsFocused`, or the `IN ('idle', 'failed', 'ended')` allowlist, and the
three sibling worktrees are clean. Task 028 was therefore re-implemented from the issue and task
contracts, independently of the lost tree.

# Reported defect and root cause

Ral reported that a Codex task in `working` left the Focus column the moment `Open in Codex`
succeeded.

`isEyesOnAgentsFocused` gated active membership on an acknowledgement comparison:

```text
in Focus = is_unread
        OR (active runtime AND (last_opened_at is absent
                                OR status_observed_at > last_opened_at))
```

`markOpened` writes `last_opened_at = now` and previously cleared `is_unread` unconditionally, so
both disjuncts turned false in the same transaction — `status_observed_at` is the time of the last
accepted lifecycle observation and is always older than that write. The row was not hidden by a
filter, a sort, or a stale snapshot: a persisted Open timestamp had become a durable input to a
visibility rule, which is why the effect survived refresh. This is the acknowledgement semantics
introduced by [eyes-on-agents-focus-acknowledgement-024](../tasks/eyes-on-agents-focus-acknowledgement-024.md)
and ruled wrong by
[eyes-on-agents-active-focus-read-semantics](../../issues/eyes-on-agents-active-focus-read-semantics.md).

# Contract Assessment

- Focus is `active runtime OR unread`. `isEyesOnAgentsFocused(runtimeState, isUnread)` drops both
  timestamp parameters, and the arity itself is asserted so the gate cannot be reintroduced silently
  (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:290`, `scripts/eyes-on-agents/core.test.mjs:171`).
- Open evidence hides nothing. `markOpened` still writes `last_opened_turn_id` and `last_opened_at`
  for every existing row and clears `is_unread` only through the positive terminal allowlist; active
  and `unknown` rows keep their latent marker
  (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:1229`, `scripts/eyes-on-agents/repository.test.mjs:593`).
- `Read all` uses the same allowlist in one mutation, skips archived rows, and changes neither
  runtime nor `last_opened_*`; the added `unknown` fixture proves it is not cleared
  (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:1241`, `scripts/eyes-on-agents/repository.test.mjs:1985`).
- Renderer eligibility reuses `isEyesOnAgentsTerminal` rather than re-deriving a negative active list
  (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:90`,
  `scripts/eyes-on-agents/ui-source.test.mjs:757`).
- Focus is derived in memory. `eyes_on_agents_thread` has no `is_focused` column
  (`src/preload/sqlite/dao/eyesOnAgents.table.ts:30`); the renderer now derives the column from the
  shared predicate over the snapshot instead of the transported `isFocused` flag
  (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:78`), while Main publishes the same
  predicate over the effective runtime state, so the producers cannot diverge
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:555`).
- No elapsed-time inference, polling interval, optimistic runtime state, or Electron UI change was
  introduced. `performRefreshPollingTick` and `effectiveEyesOnAgentsRuntimeState` are untouched.
- Divergence from Round 1: this delivery does not relabel the `ended` runtime state to
  `Interrupted` / `已中断`. That locale change is outside task 028's Expected paths, its source is
  lost, and `en.ts:382` / `zh.ts:383` still read `Ended` / `已结束`. It is left for whichever task
  actually owns it.

# Adversarial review

Four independent lenses — contract semantics, SQLite data layer, renderer/reactivity/build, and test
and documentation truth — raised fifteen findings. Each was routed to a separate verifier instructed
to refute by default; all fifteen were refuted against the real source.

| Theme | Why it did not survive |
|---|---|
| An `unknown` unread row is stranded in Focus with no acknowledgement path (raised by three lenses, once as P1) | Verbatim the commissioned contract: task 028 requires that active and `unknown` rows "retain latent unread attention so an authority gap cannot remove a possibly running task", and the issue keeps `unknown` visible until Hook delivery or the ten-second refresh resolves it. A resolved state is then acknowledgeable. |
| Discovery and invalidation write paths could strand state | Both statements are outside the diff — the DAO has exactly three hunks (`toThread`, `markOpened`, `markAllRead`) — and neither touches `is_unread`. |
| `Read all` can be enabled for `failed`/`ended` rows that show no unread dot | Pre-existing and byte-identical at HEAD; the `idle`-only dot is a prior task's decision, and this change strictly narrows the mismatch by removing `unknown` from the eligible set. |
| `isFocused` means two things across producers | The two-place derivation predates the diff; both sites now call the same two-argument predicate, so no observable divergence exists. |
| Issue Symptom still describes `Read all` clearing active rows | Untouched pre-existing prose; the Symptom records the report while the Resolution contract binds, and it specifies the terminal allowlist. |
| Superseded 024/021 records should be rewritten | Task files are as-delivered records; 028's Expected paths exclude 024, and `docs/issues/eyes-on-agents-working-focus-stale.md` plus `docs/INDEX.md` now carry the explicit supersession note. |
| Redundant-coverage requests (service-level projection test, mutation hardening) | Coverage preferences against hypothetical future regressions; one verifier reproduced the mutations on an isolated copy and confirmed the delivered source is correct. |

# Verification

- `yarn test:eyes-on-agents` — PASS (core, project resolver, repository, App Server, bridge and
  durable hook delivery, project filter, 35 UI/activation source tests).
- `yarn typecheck:node` — PASS.
- `yarn build` — PASS; `electron-vite build` bundles the renderer's new
  `@shared/eyesOnAgents/eyesOnAgents.contract` import.
- `yarn typecheck:web` — 83 pre-existing errors, none in `src/renderer/eyesOnAgents`; reproduced
  identically on a clean tree.
- `yarn typecheck:eyes-on-agents:core` — existing baseline failure in untouched
  `src/shared/eyesOnAgents/codexHookBridge.contract.ts:274` and `:292`.
- `yarn typecheck:eyes-on-agents:ui` — existing baseline alias-resolution failure in untouched
  `src/renderer/eyesOnAgents/src/contextBridge/eyesOnAgentsEnv.bridge.ts:1`.
- `git diff --check` — PASS.

# Verification Boundary

Source- and non-Electron-test based. Per the task contract, Ral retains the live Electron acceptance
check. This delivery is uncommitted; given that Round 1's reviewed source was lost the same way, it
should be committed before the tree is switched or reset.
