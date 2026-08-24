# OnlyPreview Permanent Delete 029 — Independent Review 3

Status: **PASS**

Date: 2026-08-24

## Verdict

Review-2 P1-1 is fixed. Delete confirmation no longer mutates selection generation. A failed
`openFile()`/identity check/`unlink()` returns through the failure dialog without changing the
coordinator generation, workspace selection, or Preview state. After a successful unlink, Main
performs exact-target pending-selection invalidation, then exact-target workspace-selection clear;
only a successful clear revokes the Preview and publishes the empty selection snapshot.

The Review-1 interleavings remain safe: deleting unselected A does not cancel pending B, and B
started after A's confirmation remains current after A is deleted. There is no unconditional
post-success generation advance. No P0-P2 correctness, security, performance, or workspace
code-review finding remains in the reviewed Task 029 scope.

Electron/Playwright E2E, the real app, and live clipboard/delete operations were not run.

## Findings

| Severity | Blocking | Count |
| -------- | -------- | ----: |
| P0       | blocking |     0 |
| P1       | blocking |     0 |
| P2       | blocking / non-blocking |     0 |

## Review-2 correction audit

| Required behavior | Result | Independent evidence |
| ----------------- | ------ | -------------------- |
| Failed delete does not change generation | **PASS** | The handler does not call the coordinator before or inside the delete attempt. `openFile()` and `deleteOpenedFile()` failures return at `src/main/xpc/onlyPreview.handler.ts:165-171`; invalidation begins only afterward at lines 174-178. The rejection test proves pending A remains current (`tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs:97-121`). |
| Success ordering is delete → exact invalidate → exact clear | **PASS** | `deleteOpenedFile(opened)` completes at handler line 168, exact `invalidatePendingSelection()` follows at lines 174-178, and exact `clearSelection()` follows at lines 179-182. Main wiring tests pin that source order and reject invalidation before delete success (`tests/onlypreview/onlyPreviewAppWiring.test.mjs:588-617`). |
| Successful delete invalidates exact pending A | **PASS** | Coordinator invalidation requires the live pending generation and exact `workspaceId` plus `relativePath` before advancing. The successful-delete test proves exact pending A becomes stale only after the delete operation resolves (`tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs:78-95`). |
| Deleting unselected A preserves pending B | **PASS** | Exact file matching returns false without advancing when pending B differs from deleted A. The gated interleaving proves B remains current and selectable (`tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs:23-45`). |
| B started after confirmation of A survives A's success | **PASS** | B owns the latest pending generation; exact invalidation for A cannot match B and exact `clearSelection(A)` cannot clear B. The gated interleaving proves B remains current (`tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs:47-76`). |
| No post-success unconditional advance | **PASS** | The delete-success block uses only exact `invalidatePendingSelection()`, exact `clearSelection()`, Preview clear, and Selection broadcast. The source contract rejects coordinator `.advance()` after `deleteOpenedFile()` and the retired `selectionGenerationByHost` map (`tests/onlypreview/onlyPreviewAppWiring.test.mjs:599-617`). |

## Complete contract audit

| Area | Result | Independent evidence |
| ---- | ------ | -------------------- |
| Project-item capability/menu split | **PASS** | Main re-resolves one current content-host/workspace-relative item and requires canonical containment. Root, symlink, traversal, and device targets fail closed. Files expose Preview/Open/Reveal, four copy actions, and separated Delete; directories expose Reveal and the four copy actions only. |
| Clipboard semantics and process safety | **PASS** | Item copy never reads target bytes. macOS uses fixed `/usr/bin/osascript`, passes the hostile path as argv after `--`, and uses `shell:false`; Windows uses fixed noninteractive STA PowerShell and passes the target only through an environment variable. Both have timeout/maxBuffer limits and a one-active-helper guard. Unsupported Linux returns a visible failure instead of claiming text is a pasteable item. |
| Path/name privacy and meaning | **PASS** | Main computes canonical absolute path, normalized project-relative path, and basename. Renderer copy calls return `void`; no resolved absolute path or delete result is returned to renderer. Error dialogs contain localized generic text, not absolute paths or file contents. |
| Focused-row shortcuts | **PASS** | Project row focus plus exact modifier guards implement Cmd/Ctrl+C item, Shift+Cmd/Ctrl+C absolute path, and Option/Alt+Cmd/Ctrl+C name. Relative path remains menu-only. Inputs, textarea/select, contenteditable/editor descendants, and Preview-native text copy retain their normal behavior. |
| Permanent deletion primitive | **PASS** | Main owns confirmation and mutation. Registry opens one file handle, checks regular-file identity, closes it before unlink for Windows compatibility, rechecks lstat/symlink/canonical containment/device/inode/size/mtime, and executes one `unlink`. There is no body read, recursive traversal, wildcard, retry loop, directory deletion, or Trash fallback. Ordinary, replaced-file, containment, and 1 GiB sparse-file tests pass. |
| Selection/Preview cleanup | **PASS** | Successful exact selected-file deletion invalidates matching in-flight work, clears the matching selection, revokes the active Preview workspace, and broadcasts Selection. An unselected or newly superseded target does not clear the newer selection/Preview. Failed delete leaves generation and UI state unchanged. |
| Device/performance risk | **PASS** | Copy/delete remain constant-space: no file-byte materialization, no workspace traversal, one bounded helper process at most, one open file handle, bounded metadata/path checks, and one unlink. The coordinator is two host-keyed maps with constant-time comparisons and host-revoke cleanup. No device-freeze mechanism was found. |

## Code Review report

- Scope: Task 029 implementation/tests plus the selection-race correction on `dev/next`
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
| 13 | `tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs` | 122 | 0 |
| 14 | `tests/onlypreview/onlyPreviewAppWiring.test.mjs` | 664 | 0 |
| 15 | `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | 591 | 0 |
| 16 | `tests/onlypreview/specs/onlyPreviewActions.spec.ts` | 174 | 0 |

### Problems

None under the workspace `code-review` rules. Every reviewed TS/JS/Vue file is at most 800 lines
(TS-1); no replaceable `function` declaration/expression appears (TS-2). `App.vue` retains event
routing while Store owns state and copy-command execution (FE-1), and no business payload is emitted
(FE-2). No backend-specific rule applies to this scope.

## Fresh verification

| Check | Result |
| ----- | ------ |
| Focused coordinator + Workspace/Clipboard/Main wiring/Shell UI tests | **PASS — 40/40**, zero failed/cancelled/skipped/todo |
| `node --test tests/onlypreview/*.test.mjs` | **PASS — 336/336**, zero failed/cancelled/skipped/todo |
| `yarn typecheck:node` | **PASS** |
| `yarn check:renderer-i18n` | **PASS** |
| focused error-level ESLint (`--quiet`) over all 16 reviewed code/test files | **PASS**, zero errors |
| `git diff --check` | **PASS** |
| `yarn build` | **PASS** — Main 1,664, preload 1,039, client 10,428 modules; OnlyPreview Shell/Preview outputs emitted |
| `yarn typecheck:web` | **NOT RERUN** — Review 1 established 76 unrelated diagnostics and zero OnlyPreview matches; Review-2 correction is Main/test-only |

The build emitted the same unrelated mixed static/dynamic-import warnings for Maestro ExcelJS,
EyesOnAgents handler, and Home router. These warnings and the existing web-typecheck baseline are not
Task 029 regressions.

## Delivery handoff

The delivery owner should add
`src/main/onlypreview/onlyPreviewSelectionCoordinator.service.ts`,
`tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs`, Review 2, and this Review 3 to Task
029's exact Path when closing the docs sprint. The task/feature/README status transition is also
delivery-owner work; this independent review intentionally did not edit those files.

## Owner-only live acceptance

Ral still owns the environment-dependent acceptance that this review intentionally did not perform:

- paste one copied file and folder in Finder/Explorer; on Linux, confirm unsupported pasteable-item
  copy fails visibly;
- verify absolute/relative/name copy and all three shortcuts with spaces, quotes, and non-ASCII,
  while editor/input/Preview text copy remains native;
- cancel once, force one delete failure, delete an unselected file during selection B, delete
  selected A followed immediately by B, and delete selected A while it is still loading;
- confirm success removes exactly one file directly from disk (not Trash/Recycle Bin) and
  tree/search/Preview converge without losing the latest explicit selection.

## Conclusion

**PASS.** Review-2 P1-1 is corrected, both earlier selection interleavings remain protected, and the
full Task 029 clipboard/menu/permanent-delete/privacy/performance contract passes independent
non-E2E verification.
