# Todo Renderer Refresh Stability Review — Round 1

Status: accepted

Date: 2026-07-23

## Findings and resolutions

No open P1, P2, or P3 finding remains.

- **Mutation failure recovery:** a local mutation can commit its first database write and then fail
  during a later sort/read step. The source renderer ignores its own commit broadcast, so observed
  mutation failures now schedule one atomic recovery refresh. Recovery rejection is contained and
  logged instead of becoming an unhandled promise rejection.
- **Partial-read races:** Domain restore, cross-Domain move, archived-Domain opening, and Step CRUD
  no longer commit independent partial reads that can overtake the board snapshot. They use the
  shared single-flight refresh queue.
- **Selected-detail races:** selected-Todo Step reads use a separate generation and selected-ID
  fence. Rapid A-to-B selection, close, or a newer full refresh prevents an older detail response
  from committing. A same-origin idle event does not invalidate that independent read.
- **Editing state:** stable-ID reconciliation initially left Step draft projections stale and the
  existing Domain-description and Todo-title watchers could interrupt focused input. Non-active
  Step text now follows remote updates while the active draft remains local; focused Domain and Todo
  title drafts are likewise preserved.
- **Layout test contract:** the Todo location test now verifies the fenced detail commit completes
  before `nextTick()` and row location, replacing its obsolete `loadSubTodos()` assertion.

## Broadcast and refresh assessment

- Each Todo preload lifetime exposes one opaque UUID. Every renderer mutation is enveloped with that
  origin, validated in Main, and passed explicitly to the repository commit.
- Repository-origin context is scoped to the direct mutation call and cannot leak through the
  coordinator's later remote apply. Renderer A ignores only origin A; renderer B refreshes. Null,
  missing, malformed, MCP, Main, and remote origins refresh fail-open.
- Snapshot construction does not mutate visible state. The queue permits one in-flight read and one
  coalesced trailing run, and its generation guard prevents an older snapshot from winning.
- Complete snapshots reconcile existing Domain, Todo, completed-Todo, count, and selected-Step
  objects by stable ID, preserving keyed Vue instances and scroll position.

## Verification

Independent verification passed:

- `yarn test:todoist-sync` — 52/52
- `yarn test:todo-layout` — 9/9
- `yarn typecheck:todoist-sync`
- `yarn typecheck:todo-web`
- `yarn typecheck:node`
- `yarn typecheck:mcp`
- `yarn check:todo-window-runtime`
- `git diff --check`

## Conclusion

**Pass.** No source or automated-test blocker remains. Ral's remaining runtime acceptance is to keep
a populated column scrolled and an edit active while triggering Refresh/sync, confirm there is no
empty/refill frame or draft interruption, then optionally open a second Todo renderer and confirm
the other renderer receives the change while the source renderer does not reload itself.
