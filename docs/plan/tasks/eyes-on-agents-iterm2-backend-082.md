---
id: eyes-on-agents-iterm2-backend-082
scope: Persist captured iTerm2 identity, make iTerm2-identified CLI-only Claude rows visible, and add the Open-in-iTerm2 service/XPC path
status: done
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

## Implementation evidence

- `eyes_on_agents_thread` gains a nullable `iterm2_session_id TEXT` column: added directly to the
  fresh-install `CREATE TABLE` in `src/preload/sqlite/dao/eyesOnAgents.table.ts`, and through a new
  idempotent `ensureEyesOnAgentsIterm2SessionSchema` migration function in
  `src/preload/sqlite/dao/eyesOnAgents.migration.ts` (mirroring `addColumnIfMissing`, the exact
  pattern the most recent prior addition — `ensureEyesOnAgentsClaudeDeletionSchema` — used). Wired
  into `src/preload/sqlite/coreSqlite.release.ts`'s `finalizeCoreSqliteSchema` (idempotent path) and
  `coreSqliteMigrations` (new entry `versionCode: '260902120000'`, one past the prior
  `260818190001`).
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` gains `parseEyesOnAgentsIterm2SessionId` and
  `buildEyesOnAgentsIterm2DeepLink`, exactly as specified in the feature doc, except the shape
  validator is imported as `CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN` from
  `claudeHookBridge.contract.ts` (task 081's export) instead of a locally redefined pattern constant
  — see the feature doc's "Implementation note (task 082)" for why this creates a safe two-file ESM
  cycle. `src/shared/eyesOnAgents/eyesOnAgents.type.ts` gains `iterm2SessionId: string | null` on
  `EyesOnAgentsThread` and `EyesOnAgentsClaudeOpenTarget`, an *optional* `iterm2SessionId?: string |
  null` on `EyesOnAgentsClaudeInventoryThread` (so `claudeObservation.service.ts`'s pre-existing
  Desktop/transcript inventory call site — which never carries a terminal identity — needed no
  change), and a new `openThreadInIterm2({ sessionKey })` method on `EyesOnAgentsApi`.
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`: `ThreadRow` and `toThread()` carry `iterm2_session_id`
  through to every returned `EyesOnAgentsThread`; `getSnapshot()`'s `SELECT` includes the column;
  `getClaudeOpenTarget()` returns `iterm2SessionId` alongside `desktopSessionId`;
  `normalizeClaudeInventoryThread` parses the incoming optional field; `upsertClaudeInventory` reads
  and writes `iterm2_session_id` on both the insert-new-row and update-existing-row paths, applying
  the independent COALESCE-preserve rule `thread.iterm2SessionId ?? row.iterm2_session_id` with no
  ambiguity flag, no cross-row collision guard, and no interaction with the tombstone/collision
  branches that exist solely for `desktop_session_id`.
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`: `getSnapshot()`'s Claude visibility filter widened
  to `claudeProviderProjectionEnabled && (thread.desktopSessionId !== null || thread.iterm2SessionId
  !== null)`. `commitClaudeHookDeliveryInternal` computes
  `delivery.event.schemaVersion === 3 && delivery.event.payload.terminalApp === 'iterm2' ?
  delivery.event.payload.terminalSessionId : null` (equivalent to, but type-safe unlike, the design
  doc's `payload.terminalApp === 'iterm2' ? ... : null` sketch, since `payload`'s destructured type
  spans V1/V2/V3 and only the V3 `SessionStart` branch actually carries `terminalApp`) and passes it
  as `iterm2SessionId` into the existing per-event `upsertClaudeInventory` call, alongside the
  unchanged `desktopSessionId: null`. New `openThreadInIterm2({ sessionKey })` method added
  immediately after `openThread` (not a branch inside it): same `runClaudeBridgeLifecycle` +
  `requireClaudeProviderEnabled()` + raw-`repository.getSnapshot()` resolution + `provider === 'claude'`
  guard as `openThread`'s `claude:` branch, requires `getClaudeOpenTarget(...).iterm2SessionId !==
  null` (else throws), builds the URL via `buildEyesOnAgentsIterm2DeepLink`, calls
  `dependencies.openExternal(url)`, then `repository.markOpened` + `this.notify()`. It never calls
  `buildEyesOnAgentsClaudeDesktopDeepLink` or `syncOpenedThreadStatus`. `openThread` itself and its
  Desktop branch are byte-for-byte unchanged.
- `src/main/xpc/eyesOnAgents.handler.ts` registers `openThreadInIterm2` the same way `openThread` is
  registered, reusing `parseEyesOnAgentsSessionKeyParams`.
- New `scripts/eyes-on-agents/claude-iterm2-open.test.mjs` (4 tests, run via `node --test`): a
  CLI-only row with only `iterm2SessionId` is included in `getSnapshot()`'s Claude projection while a
  row with neither identity stays excluded, and a row with both identities returns both fields;
  `openThreadInIterm2` success builds the exact `iterm2:///reveal?sessionid=...` URL, calls
  `openExternal`, marks opened, and broadcasts, while never touching the Codex-only status-sync
  repository call; a `codex` provider row and a `claude` row with `iterm2SessionId === null` are both
  rejected with no `openExternal`/`markOpened` side effect. Wired into `package.json`'s
  `test:eyes-on-agents:claude` script (appended to the existing `claude-provider-toggle*` `node --test`
  group).
- `scripts/eyes-on-agents/repository.test.mjs` gains a dedicated `upsertClaudeInventory` sequence
  covering the COALESCE-preserve rule in both directions (a no-identity event does not clear a stored
  `iterm2SessionId`; a new identity replaces it) and its independence from `desktop_session_id`
  (setting one identity does not disturb an already-stored value of the other), plus migration-audit
  coverage for the new idempotent `iterm2_session_id` column (both the `repairDb` double-run check and
  the legacy `oldDb` upgrade-path assertion). Two of `getClaudeOpenTarget`'s existing `deepEqual`
  fixtures were updated to include the new `iterm2SessionId: null` field the DAO now always returns.
- `scripts/eyes-on-agents/claude-visibility-lifecycle.test.mjs`'s `persistedThread()` fixture helper
  gained an `iterm2SessionId = null` default/field: without it, the widened visibility filter's
  `thread.iterm2SessionId !== null` check saw `undefined !== null` (`true`) on every plain-JS mock
  thread missing the field, incorrectly making the file's unmapped CLI-only Claude row visible. This
  is the only edit to that pre-existing test file, and its assertions are otherwise unchanged.
- `docs/features/eyes-on-agents-iterm2-open.md` and `docs/integrations/eyes-on-agents.md` updated in
  this change for the naming/shape corrections above and the new column/XPC surface entries.

## Verification evidence

- `node --test scripts/eyes-on-agents/claude-iterm2-open.test.mjs` — 4 passed.
- `yarn test:eyes-on-agents:repository` — passed.
- `yarn test:eyes-on-agents:claude` — passed (29 tests in the `node --test` group that now includes
  `claude-iterm2-open.test.mjs`; every pre-existing Claude test, including the Desktop-route
  `openThread` coverage, passed unmodified).
- `yarn test:eyes-on-agents:core` — passed.
- `yarn typecheck:eyes-on-agents:core` — passed.
- Also run for extra confidence (not required by this task): `yarn test:eyes-on-agents` (full suite,
  including `:ui`) and `yarn typecheck:eyes-on-agents:ui` — both passed, confirming the renderer was
  not touched and still compiles against the widened `EyesOnAgentsThread`/`EyesOnAgentsApi` shapes.
- Electron, packaged-app, and end-to-end tests were not run, per the task's explicit instruction.

## Review

[Independent review 1](../reviews/eyes-on-agents-iterm2-backend-082-1.md) passed with no blocking
findings, including a dedicated investigation of the new `eyesOnAgents.contract.ts` ↔
`claudeHookBridge.contract.ts` value-level ESM cycle (confirmed safe: both sides reference the
imported binding only inside function bodies, and a real `electron-vite build` of the main/preload
bundles succeeded). Two P3 non-blocking observations were moved to `docs/plan/backlog.md`.
