---
id: eyes-on-agents-silent-focus-polling-018
scope: silent field-level refresh for locally focused Codex threads
status: done
depends-on: [eyes-on-agents-refresh-polling-015, eyes-on-agents-hook-delivery-007]
---

# EyesOnAgents Silent Focus Polling

## Supersession

[Task 019](eyes-on-agents-tiered-all-polling-019.md) preserves this task's single-timer,
non-overlap, privacy, conditional-write, and foreground-admission guarantees, but supersedes the
Focus-only candidate set and the prohibition on monotonic `last_activity_at` updates. This file
remains the historical contract for the completed first coverage slice.

## Objective

Replace the ten-second full-sync timer with one silent, non-overlapping Focus-only refresh. The
first coverage slice updates only title, runtime/session state, and—when separately enabled—the
latest user question. Manual Refresh and window-activation reconciliation remain full inventory
operations.

## Contract

- Add one parameter-free semantic XPC operation, `refreshFocusedThreads()`. Main derives thread IDs
  from its persisted/effective Focus snapshot; renderer cannot supply IDs or arbitrary App Server
  methods.
- A connected refresh calls `thread/read({ threadId, includeTurns: false })` per local Focus row.
  It never calls active/archived `thread/list`, `hooks/list`, raw snapshot persistence, Project
  resolution, or archive reconciliation.
- A disconnected/error refresh may reconnect only when persisted auto-connect intent is enabled.
  Explicit Disconnect remains authoritative and makes the background operation a no-op.
- Foreground Connect and Refresh establish Main-process admission before waiting for an existing
  background refresh. A background request admitted first completes and returns its shared changed
  result before foreground work continues; a foreground request admitted first makes a new
  background request return `changed: false`. This closes the timer/XPC race independently of the
  renderer's `busyAction`. The automatic full sync following `thread/unarchived` uses the same
  admission-and-join ordering.
- The renderer owns exactly one `10_000` ms interval and one in-flight background promise. A timer
  tick never enters `runSnapshotAction`, never writes `busyAction`, never starts another interval,
  and never queues behind an in-flight tick. Therefore neither Refresh surface shows loading.
- The semantic XPC returns only `{ changed: boolean }`, never a snapshot. An unchanged poll therefore
  transfers no snapshot and performs no renderer reactive replacement. A changed repository write
  broadcasts once so the existing change subscription performs the snapshot reload; `changed: false`
  causes no repository data-change broadcast. App Server connection-state notifications remain
  separate. Concurrent callers share the same result-bearing background promise, while a foreground
  full sync may still wait for that promise before continuing.
- Manual Refresh continues to call `syncThreads()` and is the only timer-adjacent path that may show
  `busyAction === "sync"`. Window activation keeps its full inventory/trust reconciliation.
- Repository input is a field-level patch containing only title, runtime/active flags, and last
  question. Codex provider activity remains an in-memory input for deciding whether to inspect the
  latest question; it never writes `last_activity_at` from this polling path. The persisted fields
  are compared independently with null-safe semantics. `updated_at` changes only when at least one
  persisted semantic value changes. A no-op refresh performs no UPDATE and emits no renderer
  broadcast.
- `notLoaded` or malformed App Server status does not overwrite stronger Hook/App Server lifecycle
  evidence. Active status marks unread; an idle result preserves unread so working -> idle remains
  visible in Focus until opened.
- Last-question polling is gated by the separate default-off **Store latest user question**
  preference. For a Focus thread, it calls one bounded
  `thread/turns/list({ itemsView: "full", sortDirection: "desc", limit: 10 })` only when the
  thread's provider activity is newer than the last content check or no check exists. It searches
  turns newest-first and items newest-first, retains only text segments from the newest
  `userMessage`, bounds the preview to 8,192 UTF-8 bytes, and immediately discards every other item.
  Codex 0.137 does not implement `thread/turns/items/list`, so this task must not call it.
- Each returned turn must omit `itemsView` or explicitly report `itemsView: "full"`. A summary,
  `notLoaded`, or any other explicit view rejects the whole content page; metadata may continue but
  the last-question checked watermark must not advance from that response.
- Equal provider turn time may refresh an existing App Server preview only for the same non-null turn,
  with a non-null preview and a strictly newer checked watermark. This preserves later same-turn
  steers without allowing an empty result to downgrade available content or replace a Hook preview.
- Persist a content-free `last_user_prompt_checked_at` watermark in addition to the prompt fields.
  This watermark prevents an unchanged Focus thread from replaying its rollout every ten seconds;
  it is exposed only as normalized check metadata, never as provider payload.
- Initial coverage cannot discover a non-Focus thread that starts running, rename a non-Focus
  thread, or reconcile archive state. App Server notifications/trusted Hooks remain the live entry
  path into Focus; activation and manual Refresh remain the full fallback. Later tasks may expand
  coverage without widening this task's write set.

## Paths

- `docs/features/eyes-on-agents-last-user-prompt.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/main/eyesOnAgents/codexAppServer.supervisor.ts`
- `src/main/eyesOnAgents/lastUserPromptPreference.service.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/preload/sqlite/dao/eyesOnAgents.table.ts`
- `src/preload/sqlite/dao/eyesOnAgents.migration.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/preload/sqlite/coreSqlite.release.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- `package.json`

## Verification handoff

- Static review must trace one timer, one result-bearing background promise, no background
  `busyAction`, zero snapshot transfer/reactive replacement for an unchanged poll, main-owned Focus
  IDs, explicit-disconnect fencing, supported Codex 0.137 methods, and conditional SQL writes.
- Ral performs runtime validation. This task does not launch Electron or run build/test/typecheck
  commands in the implementation session.
