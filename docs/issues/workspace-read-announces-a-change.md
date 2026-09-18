# Reading the workspace announced a change (hardening, paired with Cowork)

Cowork hit a closed feedback loop on 2026-09-18 that emitted ~3,700 `workspace-changed` broadcasts
per second and drove the machine out of memory. The full investigation, measurements and repair
contract are in
[Cowork's issue](../../../micromeet-cowork/docs/issues/workspace-read-announces-a-change.md).

## Why this repo is in scope

Bitterless carries three of the loop's four edges, in the same shapes:

- `getWorkspaceDirectory` announced a change on **every successful read** — it stamped a fresh
  `updatedAt`, persisted it and broadcast it, so a query behaved like a write;
- `clearWorkspaceRef` broadcast even when there was no binding to clear;
- `persistDefaultWorkspace` broadcast even when the stored path was unchanged;
- both a Workbench store and the Control message store subscribe to `coach/workspace-changed`, and
  the Control handler rewrites a whole session in response.

The loop never closed here only because `skillCatalog` reads the bound root through
`projectRootForSession`, a pure map lookup, rather than calling the query for its side effect the way
Cowork's `getSkillCatalog` did. That is luck, not design: one refactor replacing that lookup with
`getWorkspaceDirectory` would have reproduced the Cowork outage here.

## Applied

The same three invariants, so the missing edge cannot complete the circuit:

- a query never announces — the success path neither persists nor broadcasts, and no longer restamps
  `updatedAt`;
- `clearWorkspaceRef` returns without broadcasting when nothing was bound;
- `persistDefaultWorkspace` broadcasts only when the stored path actually changed.

No Bitterless caller used the query for its side effect, so nothing on that side needed changing.

## Verification

`tests/onlypreview/workspaceQueryBroadcast.test.mjs` is byte-identical to Cowork's and runs against
this repo's real service source: 25 reads add zero broadcasts, a vanished directory notifies once, a
dead persisted default is removed rather than re-read, and a genuine change notifies exactly once.
4/4 pass; the first and third failed before the repair here too.

Full `tests/onlypreview` sweep: **1356/1382**, with **no failure that was not already failing** before
this work, plus one pre-existing flaky case that now passes. Typecheck surfaces `main` 63 and
`renderer/maestro` 4, both identical to baseline.
