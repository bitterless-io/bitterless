---
id: eyes-on-agents-working-recovery-027-2
status: pass
reviewed_task: eyes-on-agents-working-recovery-027
date: 2026-07-27
review_type: re-delivery-after-source-loss
---

# Verdict

**PASS. One P3 was confirmed and fixed; no finding remains open.**

Round 2 exists because the source the earlier
[review](eyes-on-agents-working-recovery-027-1.md) accepted is not in the repository.
`git log --all -S 'app_server_turn' -- src` finds it in no reachable ref and the sibling worktrees
are clean, so task 027 was re-implemented from the issue and task contracts.

# Reported defect and root cause

A Codex task is visibly working and sits in Focus, but its card shows no working spinner, and
neither the ten-second poll nor labelled `Refresh` repairs it.

A Hook listener lifetime boundary invalidates Hook-owned active rows to `discovery + unknown` with
`active_turn_id = NULL` while preserving unread — correct, since stale working must not survive a
listener gap. But Codex never replays `UserPromptSubmit` for a turn that started before the new
listener, and the content-free newest-turn request was gated on
`statusSource === 'codex_hook' && runtime ∈ active && activeTurnId !== null`
(`src/preload/sqlite/dao/eyesOnAgents.dao.ts:656`, consumed at
`src/main/eyesOnAgents/eyesOnAgents.service.ts:1785`). Once invalidation cleared that identity the
gate could never be satisfied again, so nothing ever asked Codex what the newest turn was and the
row stayed `unknown + unread` indefinitely.

# Contract conformance

| Required behavior | Evidence | Verdict |
|---|---|---|
| Recovery candidate is only a non-archived, unread, `discovery + unknown` row with no active turn and a concrete watermark | `getThreadRefreshPages` emits `recoveryCandidate` under exactly those five conditions (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:666`), asserted in `scripts/eyes-on-agents/ui-source.test.mjs` and proven in `scripts/eyes-on-agents/repository.test.mjs`. | Pass |
| One newest-turn request serves either a recovery or a terminal candidate | `recoveryCandidate` is computed only when `activeTurn === null` in both the DAO and the service (`src/main/eyesOnAgents/eyesOnAgents.service.ts:1762`); the two branches share a single `readLatestThreadTurn` call. | Pass |
| Supervisor projects only ID, status, `startedAt`, `completedAt` and rejects turn items | `src/main/eyesOnAgents/codexAppServer.supervisor.ts:486-529`, asserted in `scripts/eyes-on-agents/app-server.test.mjs`. | Pass |
| `inProgress` recovers only with a real turn ID and a non-future persisted start time | `recoveredTurnFromLatest` (`src/main/eyesOnAgents/eyesOnAgents.service.ts:361`); terminal, id-less, start-less and future-dated evidence covered in `scripts/eyes-on-agents/core.test.mjs`. | Pass |
| Explicit patch validated at the shared boundary | `parseEyesOnAgentsThreadRefreshPatch` accepts `recoveredTurn` only with `source: 'app_server_turn'`, and rejects a patch carrying both `terminalTurn` and `recoveredTurn`. | Pass |
| Atomic apply only against the exact candidate, rejecting an already-completed turn | Full compare-and-set in `src/preload/sqlite/dao/eyesOnAgents.dao.ts`; seven rejection cases proven against real SQLite in `scripts/eyes-on-agents/repository.test.mjs`. | Pass |
| `app_server_turn` stays separate from process-local `app_server`; inventory and reconnect preserve it | Guard arm added to every replacement `CASE` in the discovery upsert; `invalidateAppServerStatuses` already targeted `app_server` exactly. Both proven in the repository suite. | Pass |
| Real Hook evidence supersedes recovered evidence | Unchanged watermark rule in `applyRuntimeEvent`; proven by a Hook takeover regression. | Pass |
| Terminal reconciliation extended to recovered rows with source in the guard | `expectedStatusSource` added to the patch and to the terminal CAS; a `codex_hook` expectation against an `app_server_turn` row is proven to be a no-op. | Pass |
| Paging, cancellation fencing, silent polling, field-level writes, manual Refresh order unchanged | No change to `performRefreshThreadPages` / `refreshThreadBatch` control flow; the existing paging, overlap, teardown and manual-Refresh regressions still pass. | Pass |
| Stop contract for terminal turns without `completedAt` unchanged | `terminalTurnFromLatest` still requires a persisted completion time. | Pass |

## Divergence from the lost implementation

This delivery does not relabel the `ended` runtime state to `Interrupted` / `已中断`. That locale
change is outside 027's Expected paths, its source is lost, and `en.ts` / `zh.ts` still read
`Ended` / `已结束`. It is left for whichever task owns it.

## Superseded clause

Both the task and the issue originally required a "concurrent Open" to make delayed recovery a
no-op. Under
[eyes-on-agents-active-focus-read-semantics](../../issues/eyes-on-agents-active-focus-read-semantics.md)
Open no longer acknowledges an `unknown` row, so an opened-but-unresolved task is precisely the case
this repair exists for. Both documents now record that supersession, and the CAS deliberately does
not fence on `last_opened_at`.

# Adversarial review

Four lenses — compare-and-set safety, provider-data trust, pipeline integration, and test and
documentation truth — raised fifteen findings; each was routed to an independent verifier instructed
to refute by default.

**Confirmed (1, fixed):** the canonical `EyesOnAgentsStatusSource` fence in
`docs/integrations/eyes-on-agents.md` still listed three members while the schema table 61 lines
earlier and the shipped type listed four — a self-contradiction this delivery introduced. Fixed by
widening the fence and stating where `app_server_turn` sits in the authority order.

**Refuted (14).** The recurring themes and why they did not survive:

| Theme | Why it did not survive |
|---|---|
| A recovered row can stay `working` forever with no invalidation or expiry path | Three exits are always reachable: exact-ID terminal reconciliation (the row is promoted to a terminal candidate on the very next selection, proven in the repository suite), any newer Hook event, and archive. The absence of a *time-based* expiry is the explicit contract — Codex emits no running heartbeat. |
| Writing the provider `startedAt` moves `status_observed_at` backwards and weakens the freshness fence | The fence for the recovered turn is identity plus SQLite compare-and-set, not the watermark; a delayed event for a completed turn is separately blocked by `last_completed_turn_id`. A lower watermark only makes real Hook evidence win sooner, which is the required precedence. |
| `startedAt: 0` is accepted and installs a 1970 watermark | `parseProviderTurnTimestamp` bounds the future because a past start time is legitimate for exactly the case being repaired; a `0` value still requires a real turn ID and still yields to any Hook event. |
| Recovery candidacy never expires, so every unread `unknown` row re-requests every poll | True and intended: those rows are the population being repaired, they are bounded by the existing hot/cold page size, and one request per selected task is unchanged. |
| Reconciled terminal state is erased by the next full sync | The discovery upsert preserves `app_server_turn`, and once reconciled the row is an ordinary terminal row governed by the pre-existing watermark rules. |
| Several coverage requests (deletable guards, unexercised boundary validation, duplicate-request assertion) | Mutation-hardening preferences rather than defects; two were nonetheless acted on — the `app_server_turn` render branch now has explicit connected/disconnected coverage. |

# Verification

- `yarn test:eyes-on-agents` — PASS (core, project resolver, repository, App Server, bridge and
  durable hook delivery, project filter, 35 UI/source assertions).
- `yarn typecheck:node` — PASS. `yarn build` — PASS.
- `yarn typecheck:web` — byte-identical to a clean tree.
- `yarn typecheck:eyes-on-agents:core` / `:ui` — only the pre-existing `rawInput: unknown` errors in
  unchanged `codexHookBridge.contract.ts` and the unresolved `@preload/*` path in
  `eyesOnAgentsEnv.bridge.ts`.
- `git diff --check` — PASS.

# Verification Boundary

Source- and non-Electron-test based. Ral retains the live Electron acceptance check.

A concurrent session destroyed this delivery's uncommitted working tree mid-review; it was recovered
from a merge autostash and committed immediately. Both 027 and 028 had previously been lost the same
way. Land work in a commit before switching, merging, or resetting this tree.
