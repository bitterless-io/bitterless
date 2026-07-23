# Todo Domain columns flicker during synchronized refresh

Status: fixed; owner verification pending

Implementation: [todo-renderer-refresh-stability-011](../plan/tasks/todo-renderer-refresh-stability-011.md)

## Report

When Todo sync finishes successfully, visible Domain columns briefly become empty and then refill.
The effect is most noticeable beside the sync result `Synchronized`, but that status text is not the
refresh trigger.

## Confirmed cause

`todo/data_updated` starts a full renderer reload for every changed local or remote commit. The
current `loadAll()` implementation replaces the live Todo maps with empty objects before it awaits
each Domain query, so Vue renders an empty frame and unmounts keyed Todo rows before rebuilding each
column. Several sync pages or a manual Refresh can also start overlapping reloads because renderer
refreshes have no single-flight queue.

Renderer-originated mutations add a second redundant path. The initiating renderer already applies
the returned mutation optimistically, but the repository broadcasts from Main after commit. Current
`electron-xpc` handlers do not retain the calling WebContents identity, so Main's broadcast returns
to the origin renderer as well as every other Todo renderer.

## Fix contract

- Read a complete board snapshot without mutating visible state. Commit it only after every required
  Domain, Todo, sort-order, and SubTodo-count read succeeds. A failed read retains the last valid
  board.
- Allow at most one board snapshot read in flight. An invalidation received during that read requests
  one immediate trailing read; a stale snapshot must never overwrite a newer request.
- Reconcile Domain and Todo arrays by stable `id`, reusing existing objects and arrays where
  possible. Preserve keyed component instances, column scroll position, open editing state, and the
  selected Todo unless the final snapshot proves the item absent.
- Keep remote sync page invalidations immediate. Do not hide the defect with a loading overlay,
  opacity transition, debounce delay, or deferred end-of-cycle broadcast.
- Give each Todo renderer/preload lifetime a stable opaque `originRendererId`. Every renderer write
  carries it to Main, and the resulting local-commit event carries it back. A subscriber ignores an
  event only when its own ID matches; all other Todo renderer instances refresh.
- Main, MCP, and remote-sync mutations use `originRendererId: null`, so every Todo renderer refreshes.
  The ID is refresh-routing metadata, not an authorization or trust boundary.
- The sync-status channel remains separate and never reloads the board implicitly.

## Acceptance

- A deferred full reload never exposes an empty intermediate Domain/Todo state and commits once.
- Burst invalidations never overlap reads and always perform the final required trailing refresh.
- Existing Domain/Todo object identity survives an unchanged-ID refresh; actual additions, moves,
  completions, archives, and deletions appear only at the final commit.
- Renderer A's local mutation is ignored by A's data-update subscriber and refreshes renderer B.
- Renderer B behaves symmetrically; MCP, Main, and remote-sync events refresh both.
- Manual Refresh and multi-page full sync do not make the board flash or let an older snapshot win.
- Focused Todo type checks, native sync tests, runtime checks, and `git diff --check` pass.

## Resolution

- Todo now reads each board refresh into a detached snapshot and applies only the latest complete
  result. Stable Domain, Todo, and Step identities are reconciled in place, so unchanged columns and
  rows remain mounted instead of passing through an empty frame.
- One single-flight queue covers startup, focus, manual Refresh, settings, and data-update events.
  Invalidations during a read fence its stale result and coalesce into one trailing refresh.
- Each Todo preload lifetime owns one opaque renderer origin. Renderer writes carry that origin to
  Main; the source renderer ignores its own committed broadcast while other renderers refresh.
  MCP, Main, and remote-sync commits retain a null origin and refresh every Todo renderer.
- Selected-Todo reads have their own generation fence. Failed multi-stage optimistic mutations
  schedule one recovery refresh, and active Domain, Todo-title, and Step drafts survive background
  reconciliation.
- Independent review found no open P1, P2, or P3 finding. Automated verification is recorded in
  [todo-renderer-refresh-stability-011 round 1](../plan/reviews/todo-renderer-refresh-stability-011-1.md).
  The remaining acceptance step is Ral's Electron visual check for stable scroll and editing state.
