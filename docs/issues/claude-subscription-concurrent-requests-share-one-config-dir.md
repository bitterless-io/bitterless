# Concurrent requests can run two CLI children against one config directory

Status: fixed; owner verification pending

> Not yet registered in `docs/INDEX.md`: another session is mid-edit on that file, and staging it
> would sweep unrelated in-progress entries into this commit. Add the entry when that work settles.

## Observed behavior

`ClaudeAccountRouter.lease` counts in-flight requests per account but never blocks on them
(`src/main/claudeSubscription/claudeAccount.router.ts`):

```ts
this.#active.set(selected.id, this.activeRequests(selected.id) + 1);
```

`#isEligible` gates on `enabled`, `hasAccountContext`, maintenance, `needsLogin` and cooldown —
**not** on whether the account is already serving a request. `#selectLeastActive` only *prefers* a
quieter account; with one usable account and two concurrent requests, both leases are granted for
that account and two `claude -p` children run against the same `CLAUDE_CONFIG_DIR`.

The CLI rewrites `.claude.json` in that directory on every run, so the two children race on it.

This is not hypothetical. On 2026-08-26 `~/.claude/.claude.json` went from 50,659 bytes to a
309-byte fresh-install stub — losing `userID`, `projects` and `hasCompletedOnboarding` — while a
second process was using the same directory. It was recovered from `~/.claude/backups/`. The
directory in that incident was the shared default slot rather than a pool slot, but the mechanism is
identical and the pool makes it reachable through ordinary concurrent traffic.

The damage is silent from the service's point of view: the request that wins still succeeds, so
nothing is logged as a failure. The account simply appears logged out later.

## Required behavior

- At most one CLI child runs against a given config directory at a time.
- Concurrency across *different* accounts is unaffected — serialising the pool would defeat its
  purpose.
- A request prefers an idle account over waiting; it waits only when every eligible account is busy.
- Releasing a lease promptly admits a waiting request.
- Existing validation is not weakened: an account that became ineligible while a request waited is
  re-checked, not admitted on stale state.

## Approach

Filter the eligible set down to idle accounts before selecting. When none are idle, await the next
release and re-run the whole selection, so eligibility, maintenance, cooldown and context validity
are all re-evaluated rather than carried across the wait.

Sticky routing by `prompt_cache_key` is preserved but demoted: a busy sticky account no longer wins
its binding, because holding a conversation on one account is a cache optimisation and correctness
outranks it. The binding is not discarded — the next request on that key returns to it once free.

An unbounded wait is accepted deliberately. A lease that is never released is a defect, and the two
places that take one release in `finally`; the executor additionally has its own timeout. Turning a
leaked lease into a thrown error here would hide that defect while making a healthy pool fail under
load, and the previous behaviour it would be "protecting" is the corruption itself.

## Acceptance

- Two concurrent requests with a single eligible account result in two sequential executor calls,
  never two in flight at once.
- Two concurrent requests with two eligible accounts run in parallel, one per account.
- A request queued behind a busy account proceeds once that account is released.
- A queued request does not run against an account that became ineligible while it waited.

## Entry points

- `src/main/claudeSubscription/claudeAccount.router.ts` — `lease`, `#selectLeastActive`,
  `#decrementActive`

## Outcome

Fixed 2026-08-27.

- `lease()` narrows the eligible set to accounts with zero active requests before selecting. When
  none are idle it awaits the next release and re-runs selection from the top, so eligibility,
  maintenance, cooldown and context validity are all re-evaluated rather than carried across.
- Idleness is re-checked at the synchronous grant point as well. The selection filter alone is not
  enough: `getExecutionContext` and `listRoutingAccounts` are awaited in between, and that window is
  exactly where a concurrent lease could take the account. The second check waits rather than
  excluding, because the account is healthy and merely busy.
- `#decrementActive` wakes waiters when an account reaches zero. All waiters are woken, not one:
  each re-runs full selection, and choosing a single winner up front would decide on stale state.
- A busy sticky account no longer wins its binding for that request. The binding itself survives.

**Verified the tests actually catch the defect**, rather than only passing alongside the fix: with
the idle filter and grant-point re-check reverted, `one account never serves two requests at once`
fails (98 → 97 pass); restoring them returns 98/98.

| Test | Asserts |
|---|---|
| `one account never serves two requests at once` | the second request is queued while the first is held open, and peak overlap is 1 |
| `two accounts still serve two requests in parallel` | peak overlap is 2 — serialisation is per account, not across the pool |

Verified: `node tests/claudeSubscription/run-tests.mjs` — 98/98. `yarn typecheck:node`; ESLint clean
on both touched files after formatting; `git diff --check`. No Electron E2E was run.

Not verified against real concurrent CLI children: the local registry has one usable account and
the proof is at the router level.

## Related

- `docs/issues/claude-subscription-failover-stops-after-two-accounts.md` — the same lease loop
- Prototype: `areas/agent-runtime/sub2api/demo/src/accounts.mjs` (`withSlotLock`) in the overmind
  workspace
- Design record: `areas/agent-runtime/sub2api/index.html` `#7.0`, PQ-7
