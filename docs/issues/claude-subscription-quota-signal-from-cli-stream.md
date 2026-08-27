# Quota decisions are guessed from error text instead of Anthropic's own signal

Status: fixed; owner verification pending

> Not yet registered in `docs/INDEX.md`: another session was mid-edit on that file when this landed,
> and staging it would have swept unrelated in-progress entries into this commit. Add the entry when
> that work settles.

## Observed behavior

`ClaudeCliExecutor` runs the CLI with `--output-format json` and decides whether an account is out
of quota by pattern-matching the diagnostic text
(`src/main/claudeSubscription/claudeCli.executor.ts`, `throwClassifiedExecutionError`):

```
/usage[ _-]?limit|out of usage credits|hit (?:your|the) limit|rate_limit_error|resets? at/iu
```

Two defects follow from having no authoritative signal.

**A healthy account can be cooled down.** The pattern includes `rate_limit_error`, which is the
error *code* Anthropic returns for several conditions that are not quota exhaustion. Any such
failure is classified as `ClaudeUsageLimitError`, which `isClaudeRoutingFailure` treats as a
routing failure, so `claudeSubscription.service.ts:600` puts the account into cooldown and routing
moves on. With a pool, this walks through every account in turn and reports "all accounts are out
of quota" when none of them are.

**The cooldown window is invented.** `extractResetAt` scrapes a 10–13 digit timestamp out of the
error text; when it finds nothing the account is cooled for a fixed default. The account is
therefore held out of rotation for a window unrelated to the real reset.

## Root cause

The CLI does report Anthropic's rate-limit state — but only in its streaming output, which the
current `--output-format json` invocation never produces. Verified 2026-08-27 (`claude` 2.1.220,
account `~/.claude2`), running the argv `buildClaudeExecutionArguments` produces with the output
format swapped:

```json
{"type":"rate_limit_event","rate_limit_info":{
  "status":"allowed","resetsAt":1787812200,"rateLimitType":"five_hour",
  "overageStatus":"rejected","overageDisabledReason":"org_level_disabled",
  "isUsingOverage":false}}
```

`status` separates a real quota stop from every other failure, and `resetsAt` is the real reset
time. Neither has to be inferred.

The structured decision contract survives the switch — this was the blocking unknown:

| Flags | Lines of stdout | `rate_limit_event` | `structured_output` |
|---|---|---|---|
| `--output-format json` (current) | 1 | absent | present |
| `--output-format stream-json --verbose --include-partial-messages` | 28 | present | present |
| `--output-format stream-json --verbose` | 12 | present | present |
| `--output-format stream-json` (no `--verbose`) | — | CLI refuses: `requires --verbose` |

The last row is a hard constraint: under `--print`, `stream-json` requires `--verbose`. The third
row is the leanest form that carries the signal, and `--include-partial-messages` is unnecessary
because nothing here consumes token deltas.

The terminal `result` event carries everything the current parser reads — `is_error`, `subtype`,
`api_error_status`, `structured_output`, `result`, `usage`, `modelUsage` — so the envelope contract
is unchanged. `tool_call` decisions were confirmed to survive as well:
`{"action":"tool_call","tool_name":"shell","arguments":"{\"command\":\"ls /tmp\"}"}`.

## Required behavior

- Execution runs with `--output-format stream-json --verbose`; stdout is parsed as NDJSON and the
  terminal `result` event is used as the envelope.
- When `rate_limit_info` is present it is authoritative:
  - `status` other than `allowed` → `ClaudeUsageLimitError`, carrying `resetsAt` as the reset.
  - `status` of `allowed` → the failure is **not** a usage limit, even if the diagnostic text
    matches the legacy pattern. This is the fix for cooling a healthy account.
- When `rate_limit_info` is absent the existing text classification still applies, so an older or
  differently-behaving CLI degrades to today's behaviour rather than losing classification.
- `ClaudeExecutionResult` exposes the observed rate-limit state so callers can record it.
- A non-quota failure does not place the account in cooldown.

## Approach

Keep the change inside the executor. `claudeSubscription.service.ts:600` already passes
`error.resetAt` to `markCooldown`, so putting the authoritative value into the error fixes the
cooldown window without touching the router or the service.

The legacy regex is kept rather than deleted: it is the fallback when no event is observed. It is
demoted, not trusted — the event wins whenever it exists.

## Acceptance

- The argv from `buildClaudeExecutionArguments` contains `--output-format stream-json` and
  `--verbose`, and no longer contains `--output-format json`.
- A streamed run whose `result` event reports success returns the same decision and usage envelope
  as before, and additionally exposes `rate_limit_info`.
- A failure whose diagnostic matches the legacy pattern while `rate_limit_info.status` is `allowed`
  raises a non-routing error, and the account is not cooled down.
- A failure whose `rate_limit_info.status` is not `allowed` raises `ClaudeUsageLimitError` whose
  `resetAt` equals `resetsAt * 1000`, in preference to any timestamp in the text.
- Multi-line NDJSON stdout no longer breaks envelope parsing.

## Entry points

- `src/main/claudeSubscription/claudeCli.executor.ts` — `buildClaudeExecutionArguments`,
  `parseClaudeExecutionResult`, `throwClassifiedExecutionError`, `extractResetAt`
- `src/main/claudeSubscription/claudeSubscription.service.ts:600` — cooldown call site (unchanged)

## Outcome

Fixed 2026-08-27.

- `buildClaudeExecutionArguments` now emits `--output-format stream-json --verbose`.
- `parseClaudeExecutionResult` reads stdout as NDJSON via a new `readClaudeStream`, taking the
  terminal `result` event as the envelope and capturing `rate_limit_event` on the way. Unparsable
  lines are skipped rather than fatal, so a diagnostic banner cannot destroy a complete result.
- `throwClassifiedExecutionError` takes the observed state and prefers it: not `allowed` →
  `ClaudeUsageLimitError` with `resetsAt * 1000`; `allowed` → explicitly *not* a usage limit. The
  legacy regex now runs only when no event was observed, so an older CLI degrades to prior behaviour.
- `ClaudeExecutionResult` gained an optional `rateLimit`, so callers can record real quota state.
- No router or service change was needed: `claudeSubscription.service.ts:600` already forwards
  `error.resetAt` to `markCooldown`, so the authoritative reset flows through unchanged.

The fake CLI fixture was the thing hiding this class of bug — it emitted a single object with no
`type`, unlike the real CLI. It now writes the true NDJSON shape (`system` → optional
`rate_limit_event` → `result`) and gained `rate-limit-allowed` and `rate-limit-exceeded` modes.

Verified:

- **Live API** (`claude` 2.1.220, account `~/.claude2`): ran the argv the patched builder produces
  and fed the real 8-line stdout through the same parsing logic — envelope found,
  `api_error_status: null`, `structured_output` `{"action":"final","text":"READY"}`, usage present,
  and `rate_limit_info` `{"status":"allowed","resetsAt":1787812200,"rateLimitType":"five_hour"}`.
- `node tests/claudeSubscription/run-tests.mjs` — 94/94, including a new test asserting the argv,
  the success-path exposure, the healthy-account-not-cooled case, and reset precedence.
- `yarn typecheck:node`; ESLint on all three touched files (the two remaining prettier warnings in
  `fake-claude-cli.mjs` and `claudeCli.executor.ts:283` are pre-existing — confirmed by running
  `prettier --check` against the `HEAD` copies — and were left alone); `git diff --check`.
- No Electron E2E was run.

Still unexercised through the running app: the loopback server and router path, because the local
registry has zero accounts.

## Related

- `docs/issues/claude-subscription-decision-schema-rejected.md` — the 400 that had to be fixed
  before any of this could be observed
- Prototype: `areas/agent-runtime/sub2api/demo/src/claude.mjs` in the overmind workspace
- Design record: `areas/agent-runtime/sub2api/index.html` `#7.2.0`
