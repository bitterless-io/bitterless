# Issue — The unread badge can misfire for the active session (port regression, wider than cowork)

**Status:** ✅ Fixed, code-verified. Human `yarn dev` confirmation pending.
**Reported:** 2026-09-17 (Ral: "chat 未读状态无法消失 … 2. 当前的会话完成后应该直接已读,非当前激活的
会话完成后才展示未读", then "bl cowork control chat 未读状态都需要修复").
**Area:** `src/renderer/maestro/control/src/store/channel.store.ts`.
**Amends:** [`docs/features/maestro-session-list-unread.md`](../features/maestro-session-list-unread.md)
— that doc's design (§2 "什么时候置未读") is unchanged; this issue is about *when* the store's own
`activeSessionId` write actually lands relative to it, which the design doc didn't cover.
**Reference:** cowork's identical root cause and fix —
[`unread-badge-active-session-id-race.md`](../../../micromeet-cowork/docs/issues/unread-badge-active-session-id-race.md).

## Root cause

Same defect as cowork, ported: "is this session currently on screen" is tracked as **two**
separately-writable fields — `channelStore.activeSessionId` (set eagerly/synchronously from a click
or `readActiveId()`) and `messageStore.activeSessionId` (the field `markUnread`'s guard in
`turn.service.ts` actually reads). The second was only ever brought in sync as a **trailing** effect
inside `syncActiveSession()`, which runs only after an async session-load/restore chain resolves.

**BL is exposed to this MORE than cowork was, not just equally**, because of one additional,
BL-specific regression on top of the shared design: cowork's `selectCoworkHistorySession` short-
circuits the await entirely for an already-loaded (warm) session —
`messageStore.getSession(id) || await loadPersistedSession(id)` — closing the race window on the
common path. BL's `selectMaestroHistorySession` dropped that short-circuit
(`git show ec0ba4265fbf015f48ea856ccf5dc4472456d79c` on this file) and unconditionally awaited
`loadPersistedSession`, so BL paid the race window on **every** click, not just cold loads.

## Fix

`channel.store.ts`:

1. `ChannelStoreState`'s constructor now propagates the eagerly-read `activeSessionId` into
   `messageStore.activeSessionId` immediately — closing the boot-time gap (`init()` →
   `ensureMaestroSession()` → `loadPersistedSession()`'s internal reply replay can no longer outrun
   `syncActiveSession()`, because there is no longer a window where the two fields disagree at all).
2. `selectMaestroHistorySession` restores the warm-session short-circuit
   (`messageStore.getSession(sessionId) || (await messageStore.loadPersistedSession(sessionId))`) and
   writes `messageStore.activeSessionId = sessionId` **before** that await, not only inside the later
   `syncActiveSession()` — with the previous value captured and restored if the generation changes or
   the session turns out missing/archived, so a failed switch never leaves the two fields desynced in
   the other direction.

`syncActiveSession()` itself was already correct in isolation (writes `messageStore.activeSessionId`
synchronously before calling `markRead`) — the bug was entirely in *when* callers reach it.

BL's `SessionsDrawer.vue` was checked against cowork's separate "click on an already-active-but-
unread row is a no-op" bug
([`unread-badge-active-session-click-noop.md`](../../../micromeet-cowork/docs/issues/unread-badge-active-session-click-noop.md))
— BL's `selectHistory`'s early return has no such guard, so **BL does not have that specific bug**.

## Verify

- `yarn typecheck:web` (surface `renderer/maestro`) — unchanged baseline (4 pre-existing
  diagnostics, none in `channel.store.ts`).
- New store-level tests planned (not yet written): (a) the boot-time race, (b) the session-switch
  race, (c) a case specific to the restored short-circuit — clicking an already-loaded session must
  not introduce an extra microtask/await before `activeSessionId` updates, (d) `finishFromMain` (bl's
  main-authoritative completion channel, no cowork equivalent) racing against
  `selectMaestroHistorySession` for the same session.
