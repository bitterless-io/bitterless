# Request failover gives up after two accounts, however many are usable

Status: fixed; owner verification pending

> Not yet registered in `docs/INDEX.md`: another session is mid-edit on that file, and staging it
> would sweep unrelated in-progress entries into this commit. Add the entry when that work settles.

## Observed behavior

`ClaudeResponsesRuntime.execute` retries a routing failure exactly once
(`src/main/claudeSubscription/claudeResponses.server.ts`):

```ts
for (let attempt = 0; attempt < 2; attempt += 1) {
  …
  if (attempt === 1) throw error;
}
```

With three or more accounts in the pool, a request whose first two accounts are both out of quota
fails — even when a third account is idle and has full quota. The pool silently behaves as if it
had two members.

The rest of the loop is already built for unbounded failover: `excluded` accumulates every account
that failed, `router.lease(cacheKey, excluded)` refuses those accounts, and it raises
`ClaudeNoEligibleAccountError` once nothing eligible is left. The fixed `2` is the only thing
stopping it.

## Required behavior

- A request tries every eligible account at most once before failing.
- Exhausting the pool still surfaces the *original* failure — the usage-limit or authentication
  error that caused the last exclusion — not a generic one.
- A non-routing error (a bad request, a decision defect) still fails immediately without consuming
  another account's quota on the same broken request.
- The loop cannot spin: it must terminate even if the router misbehaves.

## Approach

Drop the attempt counter and let the loop end on its own condition. Each iteration either returns,
rethrows a non-routing error, or adds exactly one account to `excluded`; because `lease()` refuses
excluded accounts, the loop is bounded by the size of the pool and ends with
`ClaudeNoEligibleAccountError`, which the existing handler converts back into the prior failure.

No arbitrary retry ceiling is added. "At most one attempt per eligible account" is already a bound,
and a second numeric cap would only bite in a pool large enough that the first bound stopped
mattering — which is not a real configuration here.

One guard is added for the case the bound relies on: if `lease()` ever returns an account already
in `excluded`, that is a router defect, and the runtime treats it as exhaustion rather than looping
forever.

The cost is latency: a pool where every account is exhausted now spends one CLI start-up per
account before failing, instead of two. That is the correct trade — a slow correct answer beats a
fast wrong failure, and the pool is small.

## Acceptance

- With three accounts where the first two raise usage limits, the request succeeds on the third.
- With three accounts where all three raise usage limits, the request fails with the usage-limit
  error, and all three accounts were attempted and cooled down.
- A non-routing failure on the first account fails the request immediately, leaving the remaining
  accounts untouched and uncooled.
- Sticky routing by `prompt_cache_key` still applies to the first attempt.

## Entry points

- `src/main/claudeSubscription/claudeResponses.server.ts` — `ClaudeResponsesRuntime.execute`

## Outcome

Fixed 2026-08-27.

- The counted loop became `for (;;)`, ending on `ClaudeNoEligibleAccountError` from `lease()`, and
  the `if (attempt === 1) throw error` line is gone.
- Added the guard the bound relies on: a lease that returns an already-excluded account releases and
  breaks instead of spinning.
- No retry ceiling was introduced, and no router or service change was needed.

**An existing test asserted the defect as intent** — `runtime performs at most one retry even when
more accounts exist` pinned `executor.calls === 2` with three accounts. It was replaced rather than
adjusted, since the behaviour it protected is the bug. Three tests now cover the contract:

| Test | Asserts |
|---|---|
| `runtime tries every eligible account before failing` | 3 calls, 3 cooldowns, and three *distinct* accounts — not one account retried |
| `runtime reaches a healthy account behind two exhausted ones` | the third account answers; only the two exhausted ones are cooled |
| `a non-routing failure does not consume a second account` | 1 call, 0 cooldowns |

Verified: `node tests/claudeSubscription/run-tests.mjs` — 96/96. `yarn typecheck:node`; ESLint clean
on both touched files; `git diff --check`. No Electron E2E was run.

Not verified against a real pool: the local registry has one usable account, so multi-account
failover is proven by the fake executor only.

## Related

- `docs/issues/claude-subscription-quota-signal-from-cli-stream.md` — makes the usage-limit
  classification that drives failover trustworthy in the first place
- Design record: `areas/agent-runtime/sub2api/index.html` `#7.1` (D2)
