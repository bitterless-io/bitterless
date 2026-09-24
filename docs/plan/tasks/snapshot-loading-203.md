---
id: snapshot-loading-203
scope: page_snapshot says when the snapshotted tab is still loading (a `# LOADING:` line); output unchanged otherwise
status: done
depends-on: []
---

Paired with `micromeet-cowork` `docs/plan/tasks/snapshot-loading-001.md` (same contract, same text).

# page_snapshot reports loading

## Objective

Implement `docs/issues/page-snapshot-silent-while-loading.md`: in `toolPageSnapshot`, when the passed `tab` has `loading === true`
(read before `capture.snapshot()`), insert the exact `# LOADING:` line after the 5-line header and its blank line, before the snapshot body;
byte-identical output otherwise; preserved through `segmentSnapshot`; no `tab` → no line. No waiting, no header-shape change.

## Context

- `docs/issues/page-snapshot-silent-while-loading.md`; micromeet-cowork `docs/issues/page-snapshot-silent-while-loading.md` (evidence)

## Path

- `src/main/maestro/drive/requestExec.service.ts` (`toolPageSnapshot` only — this file has other sessions' uncommitted edits; touch only this function)
- `src/main/maestro/drive/snapshotSegment.ts` only if segmentation does not already keep the line
- a runnable test under `tests/maestro/`

## Verification

- The issue's 验收 cases in a test that actually loads the real `toolPageSnapshot`; existing snapshot tests; typecheck (`tsc` for the main surface,
  judged against the HEAD baseline — BL typecheck has pre-existing errors). No E2E.
