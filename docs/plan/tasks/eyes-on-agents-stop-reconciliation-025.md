---
id: eyes-on-agents-stop-reconciliation-025
scope: reconcile stale Hook working state from a metadata-only terminal-turn poll
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-acknowledgement-024, eyes-on-agents-tiered-all-polling-019]
---

# EyesOnAgents Stop Reconciliation

## Objective

Let the existing ten-second hot/cold polling cycle eventually replace a stale Hook `working` state
after Codex manually stops a turn. Preserve Hook authority while a turn is still running, keep the
completion unread, and do not add or infer a paused state.

## Required behavior

- `thread/read.status` remains process-local metadata and must never overwrite Codex Desktop Hook
  runtime evidence.
- Only rows that are currently active and Hook-owned are eligible for terminal reconciliation.
- For an eligible row, request at most the newest turn through `thread/turns/list` with
  `itemsView: notLoaded`, descending order, and limit one. Bitterless must not request, receive, log,
  render, or retain turn items, messages, reasoning, tool calls, replies, or attachments; the
  supervisor projects only turn ID, status, and completion time.
- Opt into the experimental App Server API during initialization; no fallback may silently change
  the request to `thread/read(includeTurns: true)` or a content-bearing history read.
- `inProgress`, an empty page, a malformed response, or a failed request changes no runtime state.
- `completed`, `interrupted`, or `failed` is accepted only when it proves the current persisted
  active turn: require the exact active turn ID and a non-null persisted completion timestamp. Rows
  without an exact provider turn ID or completion record remain unchanged. Do not order-compare the
  second-precision completion time with the millisecond Hook observation.
- Apply terminal evidence atomically against the current SQLite row. A newer/replaced active turn,
  non-Hook source, archived row, or already-terminal row makes the patch a no-op.
- Keep the original active observation watermark instead of inventing a poll-time timestamp. Reject
  delayed active lifecycle events whose exact turn ID is already recorded as completed, while a
  different newer turn ID remains free to become working.
- Reconciled `completed` becomes `idle`, `interrupted` becomes `ended`, and `failed` becomes
  `failed`. Clear active flags/turn, record completion, and keep/set unread so the just-finished task
  remains in Focus until Open or `Read all` acknowledges it.
- Reuse the existing hot-first plus round-robin cold paging, concurrency cap, cancellation fence,
  silent refresh, and write-only-when-changed behavior. The labelled manual `Refresh` runs the same
  terminal reconciliation immediately after its full inventory sync, so it is an explicit fallback
  in addition to the ten-second polling cycle.
- No TTL, private rollout/transcript scan, or `paused` state.

## Expected paths

- `docs/issues/eyes-on-agents-working-focus-stale.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/plan/analysis/eyes-on-agents.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/main/eyesOnAgents/codexAppServer.supervisor.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/app-server.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- A Hook working row plus matching newest `interrupted` turn becomes ended and unread.
- Matching newest `completed` and `failed` turns map to idle and failed respectively.
- `inProgress`, missing completion times, mismatched turn IDs, replaced active rows, non-Hook
  sources, and malformed/failed pages do not change runtime state.
- The status request is `itemsView: notLoaded`, descending, limit one and is issued only for active
  Hook candidates selected by the existing hot/cold page cycle.
- A later Hook `UserPromptSubmit` remains authoritative and restores working normally.
- Labelled manual `Refresh` performs full inventory sync and then runs the selected hot/cold terminal
  reconciliation in the same foreground App Server lifetime.
- No Electron UI run and no package/release; Ral owns runtime verification.

## Delivery evidence

- The complete EyesOnAgents Node/SQLite regression suite passes.
- Core tests cover terminal status admission, exact ID matching, missing/invalid completion time,
  metadata-read independence, failed requests, omission of invalid optional patch fields, and the
  labelled manual Refresh integration path.
- Repository tests cover all terminal mappings, unread Focus behavior, synthetic-ID exclusion,
  atomic replacement races, same-second timestamps, delayed same-turn rejection, and a different
  turn restoring working.
- App Server tests cover experimental capability negotiation, the exact content-free request,
  rejection of non-empty items, and the three-field supervisor projection.
- Main-process type checking and `git diff --check` pass.
- Independent static review found no remaining P1/P2 issue.
- Electron was not started and no package or release was produced; Ral owns runtime verification.
