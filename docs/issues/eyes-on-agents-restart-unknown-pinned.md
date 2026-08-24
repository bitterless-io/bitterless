# A Restarted Working Thread Stays Pinned With No Visible Reason

Status: fixed with option A; owner verification pending

Repair: the owner chose **A**. `showUnreadDot` is now `isUnread && !isActiveRuntime`
([task 066](../plan/tasks/eyes-on-agents-unknown-dot-session-path-066.md)), so an authority-lost
unread row renders the dot and its unread-tier position is explained. Options C and D remain open if
the deeper persistence behavior is ever worth changing.

## Symptom

Restart the app while a session is working. The card loses its loading indicator — correctly — but
stays at the very top of the Focus list, looking identical to an ordinary read card. Nothing on it
explains why it is up there.

## Root cause

Two different fields drive the two halves of what you see, and only one of them is reset at boot.

1. **A turn start writes the unread bit together with the active state.** The runtime-event update
   sets `is_unread = CASE WHEN ? IN ('working','waiting_approval','waiting_input') THEN 1 ELSE
   is_unread END` (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:996-1000`). On disk the row is
   `runtime_state='working'`, `status_source='codex_hook'`, `is_unread=1`.
2. **Process death writes nothing**, so that row survives verbatim.
3. **At boot the hook statuses are invalidated** — a fresh process was never listening, so
   `invalidateCodexHookStatuses` runs
   (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:1509-1519`). Its `SET` list is
   `runtime_state='unknown'`, `active_flags_json='[]'`, `active_turn_id=NULL`,
   `status_source='discovery'`, `status_observed_at`, `updated_at` — and **no `is_unread`**. The
   latent unread marker is deliberately preserved; the spinner's inputs are not.
4. **The snapshot derives the same downgrade anyway.** `getSnapshot` replaces the stored state with
   `effectiveEyesOnAgentsRuntimeState(...)` (`src/main/eyesOnAgents/eyesOnAgents.service.ts:845-852`),
   which turns any active state into `unknown` without live authority
   (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:362-376`). `isUnread` passes through
   un-recomputed.
5. **The renderer then promotes the row without marking it.** `attentionRank` gives `unknown` no rank
   of its own and falls through to `if (thread.isUnread) return 3`
   (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:14-20`), and rank dominates the
   comparator absolutely. But the spinner needs an active state (`isActiveRuntime`) and the unread dot
   needs a **terminal** one (`showUnreadDot` → `isEyesOnAgentsTerminal`,
   `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue:169-176`); `unknown` is neither
   (`contract.ts:37-41`).

So `isUnread=true` + `runtimeState='unknown'` satisfies the promotion predicate while failing **both**
indicator predicates. That intersection is exactly the reported card.

**Which half is the defect.** Not the hidden spinner: dropping stale active evidence when authority is
gone is correct and deliberate. Not the unread bit: that is the latent marker other tasks depend on.
The defect is the *inconsistency* — a row can be promoted to the unread tier by a flag that nothing
renders for while it is `unknown`. The owner's "still pinned" is the **unread tier**, not a leftover
working tier.

**And it does not always self-heal.** The designed cure is the content-free newest-turn recovery,
whose candidate shape matches this row exactly (`recoveryCandidate` requires
`statusSource === 'discovery'`, `runtimeState === 'unknown'`, `is_unread === 1`, no active turn,
`dao.ts:462-469`). It needs the managed App Server. With auto-connect off, startup never calls
`ensureAppServerConnected`, and the ten-second poll returns early at
`if (!this.dependencies.appServer.isConnected() && !this.autoConnectEnabled) return false;`
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:986`, repeated at `:990`). The row then stays
`unknown` + unread indefinitely. The refresh and recovery queries are also Codex-only
(`dao.ts:1123`, `dao.ts:1140`), so a Claude row has no equivalent repair at all.

## Repair options

| option | change | tradeoff |
|---|---|---|
| **A — show the dot for any non-active unread row** | `showUnreadDot = isUnread && !isActiveRuntime`, so `unknown` unread finally renders something | one predicate, one line; explains the rank honestly; but it stops distinguishing "completed, unread" from "state lost, unread", and contradicts today's documented "unknown never shows this dot" |
| **B — give `unknown` its own quiet mark** | a distinct muted glyph in the same title status slot | keeps completed-unread and authority-lost visually separate; costs one more visual state to learn |
| **C — demote `unknown` out of the unread tier** | an explicit rank between unread and ordinary, or straight to ordinary | removes the unexplained pinning entirely; but a genuinely running task that Bitterless merely cannot see any more sinks out of sight, which is what tasks 027/034 fought against |
| **D — make the repair reachable** | resolve `unknown` rows at startup even with auto-connect off | attacks the persistence rather than the presentation; needs a connection, so it means connecting on demand — a behavior change of its own, and no Claude equivalent exists |

A and B are presentation-only and safe. C changes attention semantics. D is the deepest and is
orthogonal — it could land later regardless of which of A/B/C is chosen.

Diagnosed with a four-lane read-only workflow plus three adversarial refutation passes; the two
load-bearing citations (the `is_unread`-omitting invalidation and the auto-connect early return) were
then re-read by hand before writing this.
