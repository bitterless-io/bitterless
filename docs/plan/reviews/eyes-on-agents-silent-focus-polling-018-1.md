# EyesOnAgents Silent Focus Polling Review

Status: accepted

Date: 2026-07-21

## Findings resolved

No open P1, P2, or P3 finding remains.

- The Focus patch now contains only title, runtime/session state, and the separately consented latest
  user question. Codex provider activity remains in Main memory as a question-inspection watermark;
  it does not update `last_activity_at`, card ordering, or card time from this polling path.
- An already admitted background refresh is returned before foreground admission is checked, so
  concurrent poll callers share the same real `{ changed }` result while a newly arriving poll still
  yields to an already admitted foreground Connect, Refresh, or unarchive reconciliation.
- The integration contract now permits the narrow `thread/read({ includeTurns: false })` projection,
  records the semantic Focus XPC, describes the implemented default-off question switch, and lists
  the question preference and cleanup XPC methods.

## Static contract assessment

- The renderer owns one idempotent ten-second interval and one in-flight background promise. Its
  callback never enters `runSnapshotAction`, writes `busyAction`, applies a returned snapshot, or
  exposes a background failure as a foreground action error.
- Main derives Focus IDs from the persisted/effective snapshot. The narrow path does not list active
  or archived inventory, inspect Hooks, resolve Projects, reconcile archives, or persist raw source
  snapshots.
- The semantic XPC returns only `{ changed: boolean }`. An unchanged result performs no snapshot
  transfer or renderer reactive replacement.
- SQLite compares the three allowed semantic projections field by field and builds at most one
  dynamic UPDATE per changed row. No changed field means no UPDATE, no `updated_at` churn, and no
  repository data-change broadcast.
- Latest-question recovery is default-off, bounded to one full-items page, rejects non-full content
  views, persists at most 8,192 UTF-8 bytes, and clears its six columns when disabled. Preference
  enable/disable failures retain rollback and snapshot redaction behavior.
- Explicit Disconnect, Connect/Refresh admission, unarchive reconciliation, and App Server lifecycle
  fencing remain authoritative and non-overlapping.

## Conclusion

**Pass.** Task 018 satisfies the static contract for silent Focus-only polling and conditional
persistence. Hook-delivered prompt capture remains the separate pending task 016 scope.

## Verification

Per owner instruction, this review ran no tests, build, typecheck, formatter, or Electron process.
The assessment used only current documents, source, protocol evidence already recorded in the task,
and static diff inspection. Ral retains the runtime verification step.
