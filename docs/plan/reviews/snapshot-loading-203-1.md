# `snapshot-loading-203` — independent review 1

Date: 2026-09-24. Independent verifier; did not implement the change. Read-only apart from this file:
no source edits, no `git add` / commit / stash / checkout / reset, no app launch, no E2E. Every mutant and
probe ran on a scratch copy (`src/main`, `src/shared`, `tests/maestro`) in the session scratch directory,
never in this working tree.

Task: [snapshot-loading-203](../tasks/snapshot-loading-203.md).
Contract: [page-snapshot-silent-while-loading](../../issues/page-snapshot-silent-while-loading.md) 修法
(`:20-26`) and 验收 (`:28-34`), plus the Cowork issue it points to for the shared contract. Paired:
micromeet-cowork `snapshot-loading-001`, reviewed separately in
`micromeet-cowork/docs/plan/reviews/snapshot-loading-001-1.md`.

Reviewed diff, limited with `git diff --` to the `# LOADING` parts, plus the new test:

- `src/main/maestro/drive/requestExec.service.ts` `toolPageSnapshot`: `:331-333` (the `loading` read) and
  `:356-359` (the conditional line in `composed`).
- `src/main/maestro/drive/snapshotSegment.ts:154-155`: the `# LOADING:` exemption from the FULL-snapshot
  suffix.
- `tests/maestro/pageSnapshotLoading.test.mjs` (new, 3 tests).

Excluded: the other uncommitted work in the same files, which belongs to other sessions. That covers the
`captureElementShot` / `shootTarget` / `readLabel` / `hover` hunks in `requestExec.service.ts` and the
`decisionHelper` migration in `snapshotSegment.ts`.

## Conclusion: **pass**

- No blocking finding. The implementation matches the 修法 list.
- There are no stubs, mocks or fakes on the integration path.
- There are three P3 findings, all non-blocking. F1 and F2 are the same two test gaps found in Cowork. F3 is
  about test registration.

## Findings

### F1 — P3 — non-blocking — no test pins "before `# INCOMPLETE`"

- **Design:** 修法 `:22` puts the line "空行之后、快照正文(含 `# INCOMPLETE` 等 NOTE)之前".
- **Code:** correct. The line is a separate `composed` element placed ahead of `snapshot.yaml`
  (`requestExec.service.ts:356-360`), so it always comes before the walker's `# NOTE` / `# INCOMPLETE` lines. The
  real-prune probe below confirms this order.
- **Gap:** test 1 (`:107-127`) always uses a body with no NOTE. Test 2's `# INCOMPLETE` case (`:133-142`) is
  the not-loading case, and test 3 (`:149-192`) does not check the order of the notes.
  - Mutant M8 moved the line to after the yaml's leading `#` lines, so it came after `# INCOMPLETE`. All 3
    tests still passed.
- **Recommendation:** add one assertion with `loading: true` and a yaml that starts with `# INCOMPLETE:`.
  Keep it the same as the Cowork test so the paired tests stay in step.

### F2 — P3 — non-blocking (the design does not state this) — the segmentation exemption is correct, but only half of it is tested

- **Design:** 修法 `:24` says only "带 `goal` 分段时这一行照样保留". `:22` and the task Objective ask for the exact
  line.
- **Code:** `snapshotSegment.ts:155`. Only lines that start with `# LOADING:` skip the suffix
  `(applies to the FULL snapshot, not to the reduced view below)`.
- **Judgment: correct.**
  - Without the change, the reduced view would print the line with that suffix appended. The line would then
    no longer be verbatim, and it would contradict itself: "the tree below may be incomplete…
    (…not to the reduced view below)".
  - The suffix exists because walker NOTE counts and sample strings describe the full tree. `# LOADING:` has
    no count and no sample, so the reason does not apply to it.
- **Other NOTEs are unchanged:**
  - Every other line still maps to the same string as before.
  - No other producer emits a `# LOADING:` prefix. The walker's NOTEs are `debuggerCapture.ts:1844-1852`, and
    the segmenter's own lines are `# REDUCED` and `# SEGMENTED`.
  - A scratch probe ran the real `pruneSnapshot` on an 800-row snapshot. It printed `# LOADING:` verbatim,
    exactly once, followed by `# INCOMPLETE: …   (applies to the FULL snapshot, not to the reduced view below)`.
- **The two repos match:** the `notes.map` line and its comment are identical to Cowork's (`diff`).
- **Gaps:**
  1. The issue does not say that the line is printed without the suffix. Recommend half a sentence in both
     issue files.
  2. No test in either repo mentions the suffix. Mutant S2 removed the suffix from every note, and all 3 tests
     still passed.
     - Recommend that test 3 also assert that its `# INCOMPLETE:` line ends with the suffix.

### F3 — P3 — non-blocking (the design does not cover this) — the new test is not in any package script

- **Design:** 验收 `:30-32` says `maestroAgentBrowserSession.test.mjs` fell behind its imports because nothing
  runs it. The review confirms it: it no longer loads (`Dynamic require of "fs" is not supported`, 0/1).
  The issue asks for "能真正跑起来的那套夹具", and the new file does run.
- **Code:** `package.json` has no script that reaches `tests/maestro/pageSnapshotLoading.test.mjs`. This repo
  registers node tests one file per script (`test:tool-approval`, `test:default-workspace`, …). The sibling
  `decisionHelper` / `decisionMakerCard` tests are not registered either.
- **Recommendation:** add `test:page-snapshot-loading` so that this file does not go the same way as the old
  one. This is optional for this task.

## Checked, no finding

| Check | Evidence |
|---|---|
| The line text matches the issue exactly, and the two repos match | SHA-1 of the `# LOADING: …` literal is identical (`a37daa86892a…`) in both issue files, both `requestExec.service.ts` and both tests |
| Position: after the 5-line header and its blank line, before the body | `composed` `:348-361`: 5 headers, `''`, then `...(loading ? [LINE] : [])`, then `snapshot.yaml`. `splitHead` still gets exactly 5 headers. Mutants M6 (line before the blank) and M10 (extra blank after it) are both killed |
| Not loading gives byte-identical output | The spread adds nothing. `notes.map` is unchanged for non-LOADING lines. Test 2 compares with `assert.equal` against the old shape, including the `# INCOMPLETE` case. Mutant M2 (always on) is killed |
| The signal is the passed tab's `loading`, the same field `list_tabs` reports | `OperationTab.loading`, whose only writer is `setTabLoading` (`maestroBrowserView.service.ts:2676-2695`, with the watchdog). `list_tabs` (`maestroWindow.controller.ts:1817`) merges `describeAgentTab`, whose `status` is `tab.loading ? 'loading' : 'ready'` (`maestroBrowserView.service.ts:2595`) |
| Read before `capture.snapshot()`, and after `warmAndLoad` for a cold tab | `:326` warm, then `:333` read, then `:334` capture. Mutants M4 (read after the capture) and M5 (read before the warm) are both killed |
| Only the passed `tab`, never `activeTabId`; no tab, no line | `tab?.loading === true`. The agent's scoped wrapper always passes the resolved `tab_id` (`maestroWindow.controller.ts:1935-1938`, `tool.execute({ ...args, tab_id: id })`), so the agent path always has a `tab`. Test 2 `:143-145` uses a loading foreground and no tab, and expects no line. Mutant M3b (fall back to `activeTabId`) is killed |
| No waiting, no header change, no tool-description change | Nothing is awaited apart from the existing warm and capture. The `page_snapshot` description is untouched; the controller diff hunks belong to other sessions |
| Local style | `requestExec.service.ts` has no statement-ending semicolons anywhere (0 of 897 lines), so the new lines follow the file. The test uses semicolons, like its siblings |
| The tests run the real implementation | The test's own loader transpiles the real `requestExec.service.ts` and its import graph. Only `electron` is stubbed by default. Test 3 also stubs `snapshotPrune`, `snapshotChunker` and `decisionHelper` (the last one is network) so that REDUCED and SEGMENTED both happen deterministically. The real `segmentSnapshot` runs. Each `load()` gets a fresh cache |

### Mutation results (scratch copy; 3 tests)

Killed: M1 never, M2 always, M3b fall back to `activeTabId`, M4 read after the capture, M5 read before the
warm, M6 inside the header, M7 after the body, M9 one word changed, M10 extra blank line, S1 revert the
segmentation change, S3 drop the line when segmenting.

Survived: **M8** (after `# INCOMPLETE`, see F1) and **S2** (no suffix on any note, see F2).

Also, with only this task's hunks reverted in the scratch copy, tests 1 and 3 fail and test 2 passes, which is
the expected result against the old code.

## Commands run (in this tree)

| Command | Result |
|---|---|
| `node --test tests/maestro/pageSnapshotLoading.test.mjs tests/maestro/decisionHelper.test.mjs tests/maestro/decisionMakerCard.test.mjs` | 57/57 pass (the 3 new tests included) |
| `node scripts/maestro/check-snapshot-prune.mjs` | exit 0: `ok — 4 actionable refs preserved, 26366 bytes dropped` |
| `node scripts/maestro/check-snapshot-selects.mjs` | exit 0: `ok` |
| `TYPECHECK_SURFACES_LIST_ERRORS=1 node scripts/typecheck/surfaces.mjs main` | 59 distinct diagnostics on the `main` surface, **0 in `requestExec.service.ts` or `snapshotSegment.ts`**. Every existing error is in other files, so the HEAD comparison is not needed for the changed files |
| `node --test tests/maestro/pageSnapshotClipboard.test.mjs tests/maestro/pageSnapshotCompare.test.mjs tests/maestro/maestroForegroundSnapshot.test.mjs` (extra) | 20/22. The two failures, `maestroForegroundSnapshot` D3/D4, **are not caused by this task**: they fail the same way in a scratch copy with this task's hunks reverted, and they do not touch `toolPageSnapshot` or `segmentSnapshot` |

E2E: not run, per the workspace rule.
