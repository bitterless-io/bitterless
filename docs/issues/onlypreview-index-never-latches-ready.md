# The Project index never latches ready, so the pane stays on "Loading project"

Status: implemented; owner verification pending

## Observed behavior

Ral 2026-09-04: on the first open of OnlyPreview the pane shows `Loading project`, and it **stays**
there after the Project tree has fully rendered, instead of falling back to `Select a file`.

## Root cause

`OnlyPreviewProjectIndexStateService` marks a workspace `building` the moment it is bound
(`markBound`) and leaves it there until a search snapshot reports `ready`. `markObserved` is the only
path to `ready` — and it had exactly one caller: the relay's `broadcast` callback in
`onlyPreviewWindow.helper.ts:842-853`, whose own comment states the intent plainly:

> Main sees every snapshot before the renderers do … so this is the authoritative point to record
> whether the Project index is finished.

But **Main does not see every snapshot there.** `initialize` and `refresh`
(`onlyPreviewSearchRuntime.handler.ts`) hand their snapshot back through the RPC *result*:

```ts
return await this._call(request.hostToken, 'initialize', request, CONTROL_TIMEOUT_MS, bootstrap);
```

and the shell consumes it directly — `onlyPreviewShell.store.ts:511-518` awaits
`onlyPreviewSearchClient.initialize(...)` and calls `applySearchSnapshot(snapshot)`. That snapshot
never passes the `broadcast` callback.

The search engine does reach `ready` (`search-engine.mjs:350, 360, 606, 623`, each followed by
`emitSnapshot()`). So when the index is usable by the time `initialize` answers — a warm or
persisted index, or simply a fast one — the shell renders the whole tree from the returned snapshot
while Main's index state is still the `building` it set at bind time. Nothing later corrects it: the
engine is idle, so no further snapshot is broadcast.

The pane then shows `Loading project` for the rest of the session, because `PreviewSurface.vue`
orders the indexing branch ahead of the empty one.

This is the open question left by
[`onlypreview-preview-stuck-loading-after-delete`](onlypreview-preview-stuck-loading-after-delete.md),
now answered. That issue's fix retires the placeholder once a Project has *resolved a file*, which
covers the delete case but not a first open where nothing was ever selected.

## Fix

Observe the returned snapshot too. `observeReturnedSnapshot()` wraps the `initialize` and `refresh`
results in the handler and calls `markObserved` with the snapshot's own workspace and state,
completing the intent the broadcast-path comment already claimed.

- Best effort by design: it is bookkeeping about a search call that already succeeded, so a failure
  to resolve the host leaves the search result untouched.
- The broadcast path stays — a watch-driven snapshot never arrives as a return value.
- The `browsedWorkspaceId` retirement from the delete issue stays as well. It is now defence in
  depth rather than the only thing standing between a stale state and a wrong pane.

## Acceptance

| Scenario | Expectation |
|---|---|
| First open, index ready by the time `initialize` answers | `Select a file` once the tree renders |
| First open, large Project still building | `Loading project` until the first ready snapshot |
| Watch-driven rebuild after the index is ready | Unchanged — `ready` still latches |
| `initialize` fails | Search result unchanged; no index state written |

Regression: `tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` — "every Project index
snapshot is observed, returned ones included". Verified to fail against the pre-fix handler.

With task 122's `project-index` trace in place, a future recurrence is answerable from
`onlypreview.log` instead of from a source re-read.

Implementation task:
[onlypreview-observe-returned-index-snapshot-125](../plan/tasks/onlypreview-observe-returned-index-snapshot-125.md).
