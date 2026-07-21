---
id: eyes-on-agents-tiered-all-polling-019
scope: tiered 40-thread title, runtime, activity, and opted-in latest-question polling across All
status: done
depends-on: [eyes-on-agents-silent-focus-polling-018, eyes-on-agents-last-user-prompt-016]
---

# EyesOnAgents Tiered All-thread Polling

## Objective

Replace the Focus-only ten-second field refresh with one Main-owned tiered scheduler over every
persisted non-archived thread in All. Every tick refreshes the 40 most recently active rows first,
then one 40-row cold page in round-robin order, so hot metadata remains within one polling interval
while older rows still receive bounded eventual coverage.

## Context

- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Last user prompt](../../features/eyes-on-agents-last-user-prompt.md)
- [Codex observation](../../features/eyes-on-agents-codex-observation.md)
- [Focus-only predecessor](eyes-on-agents-silent-focus-polling-018.md)

## Required behavior

- Keep exactly one renderer-owned `10_000` ms interval and one result-bearing background promise.
  A foreground action, snapshot load, prior tick, connection transition, or explicit disconnect
  still skips rather than queues a tick and never drives Refresh loading UI.
- Expose one parameter-free semantic operation `refreshThreadPages()`. Renderer code cannot provide
  thread ids, page numbers, page size, cursors, App Server methods, or content-read payloads.
- Main and the repository own a fixed page size of 40. Candidate order is deterministic recency:
  `COALESCE(last_activity_at, updated_at) DESC`, then `updated_at DESC`, then `thread_id ASC`.
  Project selection, title search, Domain assignment, Focus membership, and renderer attention
  sorting never alter background coverage.
- At the start of each admitted tick, resolve logical page 1 and the current cold page against the
  same current ordering. Process page 1 first. If more than one page exists, process exactly one
  cold page, advancing `2 -> 3 -> ... -> last -> 2` only after that cold batch completes. When the
  page count shrinks, reset the cursor to page 2. Each batch contains at most 40 unique rows; one
  tick therefore reads at most 80 threads.
- Capture a request evidence time before reading one thread with
  `thread/read({ includeTurns: false })`, then project title, runtime/session state, and a reliable
  provider activity watermark. A lifecycle notification admitted while that read is pending must
  therefore remain newer than the stale response; when millisecond watermarks are equal, persisted
  lifecycle evidence wins and the polling status is ignored. Run at most four thread pipelines
  concurrently inside a batch; batches remain sequential so hot rows commit before cold rows.
  Per-thread malformed or failed reads are skipped without rolling back other rows. Cancellation or
  repository failure does not advance the cold cursor.
- Persist provider activity only when it monotonically advances `last_activity_at`; this makes a
  newly active row eligible for the next hot page. Preserve the existing status precedence and
  unread behavior: an active result marks unread, idle preserves unread, and `notLoaded`, unknown,
  or malformed status cannot overwrite stronger evidence.
- When **Store latest user question** is enabled, reuse the existing provider-activity versus
  `last_user_prompt_checked_at` gate and one bounded reverse `thread/turns/list` request. Persist at
  most one 8 KiB textual latest-user preview. When disabled, never request prompt content and keep
  read-time redaction, preference epochs, disable fencing, cleanup, and content-free Hook outbox
  unchanged.
- Apply title, runtime, activity, and latest-question patches with field-level comparisons. A
  semantic no-op performs no SQLite UPDATE and no change broadcast. Missing or newly archived rows
  are skipped rather than failing the rest of a batch. Once a SQLite mutation starts, Main drains
  it even if the App Server context is cancelled; only then may teardown continue, while the
  cancelled batch remains incomplete and cannot advance the cold cursor. Each active changed batch
  broadcasts once through the existing subscription; the XPC returns only `{ changed }`, never a
  snapshot.
- Manual Refresh and window activation remain full active-plus-archived inventory reconciliation.
  They continue to discover new threads, raw snapshots, archive state, and Project metadata; the
  tiered poll only updates already persisted non-archived rows.

## Path

- `docs/INDEX.md`
- `docs/features/eyes-on-agents-last-user-prompt.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/issues/eyes-on-agents-thread-normalization-drops-existing-sessions.md`
- `docs/plan/README.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/main/eyesOnAgents/codexAppServer.supervisor.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- `docs/plan/reviews/eyes-on-agents-tiered-all-polling-019-1.md`

## Verification

- Static review traces the fixed 40-row hot page, cold `2..N` cursor, stable order, page-count
  reset, sequential hot/cold batches, four-way bounded concurrency, and cursor behavior on success,
  partial row failure, cancellation, and repository failure. It also covers a lifecycle notification
  arriving during `thread/read`, equal-millisecond lifecycle/read watermarks, and cancellation both
  before and after a repository mutation starts.
- Repository coverage verifies monotonic activity, field-level title/status/prompt changes, missing
  or archived-row skipping, 40-row input bound, no-op writes, and changed-only broadcasts.
- Existing privacy coverage continues to prove default-off consent, 8 KiB Unicode bounds, one
  latest preview, prompt epoch fencing, cleanup, and content-free offline Hook artifacts.
- Per owner instruction, do not launch Electron or run tests, builds, formatter, lint, or typecheck;
  Ral performs runtime verification after independent static review.

## Result

Implemented the parameter-free tiered scheduler, transactional hot/cold selection, field-level
title/runtime/activity/latest-question persistence, monotonic activity promotion, bounded
concurrency, cancellation drain, lifecycle evidence ordering, and renderer single-poll integration.

## Review

Accepted by independent static review:
[eyes-on-agents-tiered-all-polling-019-1](../reviews/eyes-on-agents-tiered-all-polling-019-1.md).
Runtime verification remains with Ral per instruction.
