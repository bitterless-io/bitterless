---
id: eyes-on-agents-iterm2-backend-082
scope: Persist captured iTerm2 identity, make iTerm2-identified CLI-only Claude rows visible, and add the Open-in-iTerm2 service/XPC path
status: pending
depends-on: [eyes-on-agents-iterm2-hook-capture-081]
verify: focused EyesOnAgents service/repository unit tests, Core strict typecheck; no Electron
---

# EyesOnAgents iTerm2 Backend

## Objective

Store the `terminalSessionId` captured by task 081 as `iterm2_session_id` on
`eyes_on_agents_thread`, widen Claude row visibility to include rows identified only by that column,
and add a new `openThreadInIterm2` service method plus XPC registration that builds and opens the
`iterm2:///reveal` deep link. The existing Claude Desktop Open path, its visibility rule for
Desktop-matched rows, and every Codex path are unchanged.

## Context

- `docs/features/eyes-on-agents-iterm2-open.md` — "Persisted identity", "Visibility", "Open", and
  "XPC surface addition" sections define the exact contract for this task.
- `docs/integrations/eyes-on-agents.md` — `eyes_on_agents_thread` table contract and XPC surface
  list this task extends.
- `docs/features/eyes-on-agents-claude-observation.md` — "Open and transcript preview" section;
  the new route follows its `shell.openExternal` evidentiary caveat.

## Required behavior

- `eyes_on_agents_thread` gains a nullable `iterm2_session_id` column, added through the project's
  existing SQLite migration mechanism (match whatever pattern the most recent prior schema addition
  to this table used; do not hand-edit a shipped migration).
- `upsertClaudeInventory` (`src/preload/sqlite/dao/eyesOnAgents.dao.ts`) accepts an optional
  `iterm2SessionId` field on each thread entry and applies the COALESCE-preserve rule
  `thread.iterm2SessionId ?? row?.iterm2_session_id ?? null` — an incoming `null`/omitted value never
  clears an already-stored value; only a new non-null value sets or replaces it. This mirrors, but is
  independent from, the existing `desktop_session_id` preserve rule; neither column's write depends
  on the other's value.
- `commitClaudeHookDeliveryInternal` (`src/main/eyesOnAgents/eyesOnAgents.service.ts`) passes
  `iterm2SessionId: payload.terminalApp === 'iterm2' ? payload.terminalSessionId : null` into the
  existing per-event `upsertClaudeInventory` call, alongside the unchanged `desktopSessionId: null`.
- `getSnapshot()`'s Claude visibility filter changes from
  `claudeProviderProjectionEnabled && thread.desktopSessionId !== null` to
  `claudeProviderProjectionEnabled && (thread.desktopSessionId !== null || thread.iterm2SessionId !== null)`.
  No other filter, archive-state rule, or Focus/unread computation changes.
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` gains `parseEyesOnAgentsIterm2SessionId` and
  `buildEyesOnAgentsIterm2DeepLink`, reusing task 081's `ITERM_SESSION_ID` shape validator rather
  than redefining the pattern a third time.
- `eyesOnAgents.service.ts` gains `openThreadInIterm2({ sessionKey })`: resolve the thread by
  `sessionKey`, require `provider === 'claude'` and `iterm2SessionId !== null` (throw a clear error
  otherwise), build the deep link, call `this.dependencies.openExternal(url)`, then run the same
  `markOpened` / `notify()` sequence the existing `openThread` claude branch runs. It must not call
  `syncOpenedThreadStatus` (that is Codex-only) and must not modify the existing `openThread` method
  or its Desktop branch.
- XPC registration in `src/main/xpc/eyesOnAgents.handler.ts` adds `openThreadInIterm2` using the same
  `parseEyesOnAgentsSessionKeyParams` parameter parsing `openThread` already uses. No existing XPC
  method's signature or behavior changes.

## Path

- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` (thread type gains `iterm2SessionId: string | null`)
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- the SQLite migration file(s) adding `iterm2_session_id`
- `scripts/eyes-on-agents/repository.test.mjs` and/or a new focused
  `scripts/eyes-on-agents/claude-iterm2-open.test.mjs`
- `docs/integrations/eyes-on-agents.md` (update the `eyes_on_agents_thread` column table and XPC
  surface list to add `iterm2_session_id` / `openThreadInIterm2`, in the same change)

## Verification

- New/extended tests cover: a CLI-only row with only `iterm2SessionId` set is included in
  `getSnapshot()`'s Claude projection; a row with neither identity is excluded exactly as today; a
  row with both identities is included and both are present on the returned row.
- `openThreadInIterm2` tests cover: success builds the expected `iterm2:///reveal?sessionid=...` URL
  and calls `openExternal`, marks opened, and notifies; a `codex` provider row is rejected; a claude
  row with `iterm2SessionId === null` is rejected; none of these calls ever invoke the Desktop
  deep-link builder or `syncOpenedThreadStatus`.
- DAO tests cover the COALESCE-preserve rule in both directions (a later event with no terminal
  identity does not clear a stored one; a later event with a new terminal identity replaces it) and
  confirm it does not interact with the existing `desktop_session_id` preserve/collision logic.
- Run `yarn test:eyes-on-agents:repository`, `yarn test:eyes-on-agents:claude`,
  `yarn test:eyes-on-agents:core`, and `yarn typecheck:eyes-on-agents:core`.
- Confirm the existing Desktop-route `openThread` tests still pass unmodified — this task must not
  need to edit their assertions.
- Do not launch Electron.
