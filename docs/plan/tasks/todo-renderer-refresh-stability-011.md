---
id: todo-renderer-refresh-stability-011
scope: atomic Todo board refresh and origin-aware cross-renderer invalidation
status: implemented; owner verification pending
depends-on: [todo-sync-refresh-identity-004]
---

# Todo renderer refresh stability

## Objective

Remove Domain-column flashing during local and synchronized Todo updates while retaining immediate
cross-window and MCP visibility. A local renderer must not reload in response to its own optimistic
mutation, but every other renderer must observe it.

## Context

- `docs/issues/todo-domain-refresh-flicker.md`
- `docs/features/todoist-sync.md`
- `docs/plan/tasks/todo-sync-refresh-identity-004.md`

## Interaction and layout contract

```text
local renderer A write
  -> encrypted repository commit
  -> data_updated(origin=A)
       -> renderer A ignores (already reconciled optimistically)
       -> renderer B queues one atomic snapshot refresh

MCP / Main / remote sync commit
  -> data_updated(origin=null)
       -> every renderer queues one atomic snapshot refresh
```

- No visual layout, control, copy, animation, or empty-state design changes.
- Existing DomainColumn/TodoRow DOM remains mounted for unchanged IDs, retaining scroll and local
  editing state.
- The current board stays interactive while the next snapshot is read. On success it updates in one
  synchronous commit; on failure it stays unchanged.

## Implementation contract

### Refresh queue and snapshot

- Route startup, focus, manual Refresh, settings changes, and `todo/data_updated` through one
  single-flight board-refresh API.
- While a read is active, coalesce any number of invalidations into one immediate trailing run.
- Build the next active/archived Domain lists, active/completed Todo maps, SubTodo count map, and
  selected Todo detail in local non-reactive structures.
- Apply only a current, complete snapshot. Reconcile arrays and rows by `id` to preserve object and
  component identity; remove absent state only in the final commit.

### Broadcast origin

- Generate one opaque UUID for each Todo preload/renderer lifetime and expose it as static bridge
  data.
- Attach that ID only to renderer-originated write requests. Main validates and removes the metadata
  before repository business validation.
- A local repository commit publishes `{ originRendererId }`; remote sync and MCP/Main commits
  publish `{ originRendererId: null }`.
- The matching renderer skips only that event. Unknown, absent, malformed, or null origins refresh
  fail-open.
- Do not use the origin ID as authentication and do not introduce native Electron IPC.

## Path

- `docs/INDEX.md`
- `docs/features/todoist-sync.md`
- `docs/issues/todo-domain-refresh-flicker.md`
- `docs/plan/README.md`
- `docs/plan/tasks/todo-renderer-refresh-stability-011.md`
- `src/preload/todo/todo.preload.ts`
- `src/renderer/todo/src/contextBridge/todoEnv.bridge.ts`
- `src/renderer/todo/src/emitter/`
- `src/renderer/todo/src/store/todo.store.ts`
- `src/renderer/todo/src/xpc/update.subscriber.ts`
- `src/main/xpc/todoistSync.handler.ts`
- `src/main/todoistSync/todoistSync.repository.ts`
- focused Todo test files

## Verification

- Deferred-read regression proves the visible store remains unchanged until one complete commit.
- Burst invalidation regression proves one in-flight plus one trailing refresh and no stale commit.
- Identity regression proves unchanged Domain/Todo rows retain object identity.
- Routing regression proves A ignores A, B observes A, and null/unknown origins refresh all.
- Remote page regression proves a renderer origin cannot leak into a later coordinator apply.
- `yarn typecheck:todo-web`
- `yarn typecheck:todoist-sync`
- `yarn test:todoist-sync`
- `yarn check:todo-window-runtime`
- `git diff --check`

## Completion — 2026-07-23

- Board reads now build a detached, generation-guarded snapshot and reconcile it into stable
  Domain, Todo, completed-Todo, Step-count, and selected-detail collections only after every read
  succeeds. Burst events run at most one in-flight plus one trailing refresh.
- Renderer mutations carry a validated preload-lifetime origin through Main and repository commit.
  Only the matching renderer skips that broadcast; other renderer instances refresh, while MCP,
  Main, and remote-sync commits continue to refresh all renderers.
- Same-origin events fence a stale board read without cancelling an independent detail read.
  Selected-detail generations reject A/B selection races, and a failed multi-stage optimistic
  mutation schedules one contained recovery refresh.
- Stable-ID reconciliation preserves column, row, scroll, selection, and active editing state.
  Domain descriptions, Todo titles, and active Step drafts are not overwritten by background
  refresh; non-active Step titles still accept remote changes.
- Independent review found no open P1, P2, or P3 finding. `yarn test:todoist-sync` passed 52/52,
  `yarn test:todo-layout` passed 9/9, Todo renderer and sync type checks passed, the Todo runtime
  check passed, and `git diff --check` passed. See
  [round 1](../reviews/todo-renderer-refresh-stability-011-1.md). Ral's Electron visual check remains.
