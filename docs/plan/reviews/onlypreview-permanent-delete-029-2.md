# OnlyPreview Permanent Delete 029 — Independent Review 2

Status: **BLOCKED**

Date: 2026-08-24

## Verdict

Review-1 P1-1 is fixed for its two successful-delete interleavings. The new exact-target selection
coordinator does not cancel pending B when deleting A, a B selection started after A's confirmation
remains current, and there is no unconditional generation advance after `unlink`. Exact host,
workspace, relative path, and generation matching are enforced.

Task 029 remains blocked by one P1 failure-path race introduced by the timing of that fix. Main
invalidates pending selection A immediately after confirmation, before `openFile()` and `unlink()`
can fail. A stale, moved, replaced, or permission-denied delete can therefore cancel A's in-flight
selection even though no file was deleted. Main returns success from the now-stale selection while
Shell retains its optimistic A row; Main workspace/Preview may still own the previous file. That
violates the explicit failed-delete state-preservation contract. The previously passing
copy/menu/path/constant-space delete boundaries remain intact.

Electron/Playwright E2E, the real app, and live clipboard/delete operations were not run.

## Findings

| Severity | Blocking | Count |
| -------- | -------- | ----: |
| P0       | blocking |     0 |
| P1       | blocking |     1 |
| P2       | blocking / non-blocking |     0 |

### P1-1 — Failed delete can prematurely invalidate its exact pending selection

- **Location:** `src/main/xpc/onlyPreview.handler.ts:159-175`,
  `src/main/onlypreview/onlyPreviewSelectionCoordinator.service.ts:34-45`,
  `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:700-720`.
- **Contract:** Task 029 contracts 7, 9, and 10.
- **Problem:** after confirmation, `invalidatePendingSelection(A)` advances A's generation before
  deletion is known to have succeeded. If selection A is still resolving, the coordinator marks it
  stale. If the following `openFile()`/identity check/`unlink()` fails, the delete catch only shows
  an error dialog; it cannot restore A's generation. `selectStandaloneFile()` then exits through its
  current-generation fence as a successful void operation. Shell had already assigned
  `selectedRelativePath = A` optimistically and does not call `syncSelection()` on success, while
  Main may retain the prior workspace selection and Preview.
- **Impact:** a failed destructive action can leave Project selection and Preview visibly
  inconsistent and silently discard the user's pending file selection, despite disk remaining
  unchanged.
- **Evidence gap:** the new exact-target test proves the premature invalidation itself
  (`tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs:78-85`) but stops before simulating a
  delete failure. The two successful-delete interleaving tests cannot detect this branch.
- **Required correction:** commit exact-target invalidation only once deletion has succeeded, or use
  a two-phase coordinator whose failed delete restores/retains the pending intent. It must remain
  exact-target so a newer B selection survives. Add an integration-level behavior test in which
  pending A is followed by a rejected delete and A still completes coherently.

## Review-1 correction audit

| Required behavior | Result | Independent evidence |
| ----------------- | ------ | -------------------- |
| Deleting unselected A does not cancel in-flight selection B | **PASS** | `invalidatePendingSelection()` compares both workspace and relative path and returns without advancing for B (`src/main/onlypreview/onlyPreviewSelectionCoordinator.service.ts:34-45`). The gated test starts B, attempts to invalidate A, then proves B remains current and selected (`tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs:23-45`). |
| Selection B begun after confirming deletion of selected A survives success | **PASS** | B begins its own current generation after A's confirmation; deletion performs no post-unlink coordinator call, and exact-path `clearSelection(A)` preserves B (`src/main/xpc/onlyPreview.handler.ts:159-188`). The gated test proves B remains current after simulated A cleanup (`tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs:47-76`). |
| Exact target matching | **PASS** | The coordinator requires live pending generation plus exact host-map ownership, `workspaceId`, and `relativePath`; path mismatch is exercised by the unselected-A/B test and exact A match by the target test (`src/main/onlypreview/onlyPreviewSelectionCoordinator.service.ts:34-45`). |
| No unconditional post-unlink generation advance | **PASS** | The handler's post-`deleteOpenedFile()` body contains only exact selection clear, Preview clear, and Selection broadcast. Source contract test rejects any post-delete coordinator `advance` or invalidation and rejects the retired generation map (`src/main/xpc/onlyPreview.handler.ts:169-188`; `tests/onlypreview/onlyPreviewAppWiring.test.mjs:599-612`). |
| Failed delete preserves coherent selection/Preview | **BLOCKED** | Exact pending A is invalidated before every filesystem failure point and cannot be restored, as P1-1 describes. |

## Preserved contract audit

| Area | Result | Independent evidence |
| ---- | ------ | -------------------- |
| Project-item/menu split | **PASS** | Main still resolves one live contained regular file/directory capability. Files receive Preview/Open/Reveal/copy/Delete; directories receive Reveal/copy only; root/symlink/device targets fail closed. |
| Clipboard semantics/security | **PASS** | Copy Item remains byte-free and bounded to one helper; macOS passes the target as `osascript` argv, Windows passes it only through the fixed PowerShell environment variable, `shell:false`, timeout/maxBuffer, singleton process guard, and truthful Linux failure remain unchanged. Absolute/relative/name projection stays Main-owned and void to renderer. |
| Permanent deletion primitive | **PASS** | The registry still verifies one opened descriptor, closes it for Windows, rechecks type/symlink/canonical containment/device/inode/size/mtime, and calls one non-recursive `unlink` without body reads, wildcard, retry, or Trash fallback. Large-file/replacement/containment tests pass unchanged. |
| Successful selected-file cleanup | **PASS** | After successful unlink, exact `clearSelection(A)` decides whether to clear/revoke the Preview Region and publish Selection. A different selected B returns false and remains intact. |
| Failure state | **BLOCKED** | File/Preview state remains untouched for ordinary copy/delete failures, but exact pending A is already invalidated before the delete attempt. |
| Device/performance risk | **PASS** | Coordinator work is two bounded maps and constant-time comparisons. Copy/delete still materializes no file bytes, launches at most one bounded helper, holds one file handle, performs bounded metadata checks, and executes one unlink. No recursive traversal or equipment-freeze risk was found. |

## Code Review report

- Scope: Task 029 code/test entries plus the Review-1 correction service/test on `dev/next`
- Date: 2026-08-24

### File list

| # | File | Lines | Findings |
| -: | ---- | ----: | -------: |
| 1 | `src/main/xpc/onlyPreview.handler.ts` | 683 | 0 |
| 2 | `src/main/onlypreview/onlyPreviewClipboard.service.ts` | 192 | 0 |
| 3 | `src/main/onlypreview/onlyPreviewWorkspace.registry.ts` | 504 | 0 |
| 4 | `src/main/onlypreview/onlyPreviewSelectionCoordinator.service.ts` | 54 | 0 |
| 5 | `src/shared/onlypreview/onlyPreview.types.ts` | 371 | 0 |
| 6 | `src/shared/onlypreview/onlyPreview.contract.ts` | 473 | 0 |
| 7 | `src/renderer/common/i18n/en.ts` | 783 | 0 |
| 8 | `src/renderer/common/i18n/zh.ts` | 767 | 0 |
| 9 | `src/renderer/onlypreview/shell/src/App.vue` | 667 | 0 |
| 10 | `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts` | 798 | 0 |
| 11 | `tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs` | 670 | 0 |
| 12 | `tests/onlypreview/onlyPreviewClipboard.test.mjs` | 156 | 0 |
| 13 | `tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs` | 86 | 0 |
| 14 | `tests/onlypreview/onlyPreviewAppWiring.test.mjs` | 669 | 0 |
| 15 | `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | 591 | 0 |
| 16 | `tests/onlypreview/specs/onlyPreviewActions.spec.ts` | 174 | 0 |

### Problems

None under the workspace `code-review` rules. All reviewed TS/JS/Vue files are at most 800 lines
(TS-1); no replaceable `function` declaration/expression appears (TS-2). `App.vue` retains only
event routing while Store owns state/copy execution (FE-1), and no business payload is emitted
(FE-2). There are no BE-applicable files or BE rules. P1-1 is a task-contract/runtime correctness
finding, not one of the four code-review rule findings.

## Fresh verification

| Check | Result |
| ----- | ------ |
| Focused coordinator + Workspace/Clipboard/Main wiring/Shell UI tests | **PASS — 39/39**, zero failed/skipped/todo |
| `node --test tests/onlypreview/*.test.mjs` | **PASS — 335/335**, zero failed/cancelled/skipped/todo |
| `yarn typecheck:node` | **PASS** |
| `yarn check:renderer-i18n` | **PASS** |
| focused error-level ESLint (`--quiet`) over correction files | **PASS**, zero errors |
| `git diff --check` | **PASS** |
| `yarn build` | **PASS** — Main 1,664, preload 1,039, client 10,428 modules; OnlyPreview Shell/Preview outputs emitted |
| `yarn typecheck:web` | **NOT RERUN** — Review 1 baseline was 76 unrelated diagnostics and zero OnlyPreview matches; correction is Main/test-only |

The build emitted the same three unrelated mixed static/dynamic-import warnings for Maestro
ExcelJS, EyesOnAgents handler, and Home router. Review-1's supplementary formatting warnings remain
weak hygiene evidence only; no task gate or workspace code-review rule changed.

## Delivery handoff

The delivery owner still needs to add the correction service/test and Review 2 to Task 029's exact
Path when the next implementation round is recorded. Task/README correctly remain `in-progress`
while this review is blocked.

## Owner-only live acceptance

After P1-1 is fixed and a new independent review passes, Ral still owns:

- paste one copied file and folder in Finder/Explorer; confirm Linux pasteable-item copy fails
  visibly rather than substituting text;
- verify absolute/relative/name copy and all three shortcuts with spaces, quotes, and non-ASCII,
  while editor/input/Preview text copy remains native;
- exercise cancel, failed delete, unselected delete during selection B, selected A delete followed
  immediately by B, and selected A delete while A is still loading;
- confirm success removes exactly one file directly from disk (not Trash/Recycle Bin) and
  tree/search/Preview converge without losing the latest explicit selection.

## Conclusion

**BLOCKED.** Review-1's success-path generation race is corrected and the copy/delete safety and
performance contract remains sound, but the exact pending selection must not be irreversibly
invalidated before a delete that can still fail.
