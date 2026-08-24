# OnlyPreview Permanent Delete 029 — Independent Review 1

Status: **BLOCKED**

Date: 2026-08-24

## Verdict

Task 029 is blocked by one P1 selection race. The filesystem and clipboard boundaries otherwise
match the contract: Project rows resolve through the live host/workspace capability, root/traversal/
symlink/device targets fail closed, deletion revalidates one opened regular file and performs one
constant-space non-recursive `unlink`, and pasteable copy launches at most one bounded helper without
placing a target path in executable script text. The native file/directory menu split, text
projections, renderer result boundary, and exact-row shortcut guards are also present.

The blocker is the two unconditional host-generation advances around deletion. They can cancel a
legitimate selection started while deletion is in flight, and the first advance also cancels an
unrelated in-flight selection when deleting an unselected file. This contradicts the task's explicit
state-preservation contract. Electron/Playwright E2E and the real app were not run.

## Findings

| Severity | Blocking | Count |
| -------- | -------- | ----: |
| P0       | blocking |     0 |
| P1       | blocking |     1 |
| P2       | blocking / non-blocking |     0 |

### P1-1 — Delete generation advances can cancel a newer or unrelated selection

- **Location:** `src/main/xpc/onlyPreview.handler.ts:159-162,178-181`
- **Contract:** Task 029 contract 9; `docs/plan/analysis/onlypreview.md:164-168`.
- **Problem:** confirmation advances the host-global `selectionGenerationByHost` for every delete,
  even when the target is not selected. A selection already resolving/presenting another file then
  fails its generation fence and is lost. After `unlink`, deletion advances the same generation a
  second time. If the user selects file B after confirming deletion of file A but before unlink
  completes, B owns the newer generation; the second delete advance invalidates B. Depending on
  timing, B either returns before installing selection, or installs/presents but suppresses its
  final Selection broadcast. `clearSelection(A)` cannot repair either outcome.
- **Impact:** deleting an unselected file may disturb the current/in-flight preview, and a newer
  explicit user selection can disappear or remain out of sync. This is contrary to “deleting
  another file preserves the current selection and preview.”
- **Required correction:** determine whether the target is the selected file under the same
  workspace state, invalidate only the stale selection work owned by that deleted target, and do not
  advance the generation again after unlink. Add a behavior test for both interleavings: unselected
  delete during selection B, and selection B started between confirmation and successful deletion of
  selected A.

## Contract audit

| Area | Result | Independent evidence |
| ---- | ------ | -------------------- |
| Project-item admission | **PASS** | `resolveProjectItem()` requires a live content host and opaque workspace, parses a normalized non-empty relative path, checks lexical and canonical containment, rejects the workspace root/symlinks/devices, and accepts only regular files/directories (`src/main/onlypreview/onlyPreviewWorkspace.registry.ts:205-263`). Real temporary-file tests cover directory/file resolution, empty root, traversal, outside and inside symlinks (`tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs:190-249,313-348`). |
| File/directory menu split | **PASS** | Files receive Preview/Open/Reveal, four copy actions, then Delete; directories receive Reveal and the copy group only (`src/main/xpc/onlyPreview.handler.ts:451-518`). Shell sends both file and directory rows but rejects symlink rows (`src/renderer/onlypreview/shell/src/App.vue:273`; `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:240-249`). |
| Copy projections and renderer boundary | **PASS** | Main writes canonical `realPath`, normalized workspace-relative path, or basename directly to Electron clipboard; the renderer API accepts only `item`, `absolute-path`, or `name` intents and returns `OnlyPreviewResult<void>`, leaving relative-path copy menu-private (`src/main/onlypreview/onlyPreviewClipboard.service.ts:128-188`; `src/shared/onlypreview/onlyPreview.contract.ts:165-181`; `src/shared/onlypreview/onlyPreview.types.ts:169-177,351-355`). No copy result carries an absolute path. |
| Pasteable file/folder copy | **PASS** | No file body is read. macOS uses fixed `/usr/bin/osascript` source with the path after `--` as argv; Windows uses fixed non-interactive STA PowerShell and passes the hostile path only through one fixed environment variable. Both set `shell:false`, 5-second timeout, 16-KiB `maxBuffer`, and hidden Windows process; a singleton in-flight guard admits one helper. Linux throws a bounded typed failure, which Main converts to one parented localized dialog (`src/main/onlypreview/onlyPreviewClipboard.service.ts:45-126,137-192`; `tests/onlypreview/onlyPreviewClipboard.test.mjs:10-138`). |
| Shortcut ownership | **PASS** | Shell capture handles only non-repeat, non-composing plain `C` with the platform primary modifier. The event target itself must be exactly a Project tree/search-result row button; inputs, textareas, selects, contenteditable/textbox controls, Preview content, and descendants do not match. `Cmd/Ctrl+C`, `Shift+Cmd/Ctrl+C`, and `Option/Alt+Cmd/Ctrl+C` map to item, absolute path, and name; Shift+Alt is left untouched and relative copy is menu-only (`src/renderer/onlypreview/shell/src/App.vue:590-624`). |
| Confirmation and delete primitive | **PASS** | Delete remains Main-private. It re-resolves a regular file for a parented warning; Cancel is button/default/cancel 0 and Delete is destructive 1. After confirmation Main opens the file, checks opened device/inode/size/mtime, closes the handle for Windows, rechecks `lstat`, no-symlink regular-file type, canonical containment/path and identity, then calls one `unlink(candidate)`. There is no recursive delete, Trash fallback, wildcard, retry, or body read (`src/main/xpc/onlyPreview.handler.ts:135-175`; `src/main/onlypreview/onlyPreviewWorkspace.registry.ts:366-460`). A sparse 1-GiB test proves constant-space deletion, and replacement tests preserve the swapped path (`tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs:252-348`). |
| Selection/Preview convergence | **BLOCKED** | Exact-path `clearSelection()` and `clearWorkspace()` would preserve a different completed selection and revoke the deleted selected file's assets/documents/presentation (`src/main/onlypreview/onlyPreviewWorkspace.registry.ts:466-472`; `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:348-358,578-617`). However the unconditional double generation advance can cancel the different selection before that exact-path guard, as P1-1 describes. Existing source tests assert the problematic order instead of exercising the race (`tests/onlypreview/onlyPreviewAppWiring.test.mjs:593-608`). |
| Failure privacy/state | **PASS** | Copy/delete helpers catch failures and show one localized parented generic dialog; neither error message includes target path/content. Delete mutates selection/Preview only after successful unlink, aside from the P1 generation effect (`src/main/xpc/onlyPreview.handler.ts:91-132,163-193`). |
| Performance/device safety | **PASS** | Right-click/copy/delete uses metadata only; item copy has at most one short-lived child process, deletion has one descriptor plus metadata checks and one unlink, and no operation reads bytes or recursively traverses. The focused 1-GiB sparse-file regression completed in milliseconds without body materialization. No device-freeze risk was found in the admitted path. |

## Code Review report

- Scope: Task 029's exact TS/JS/Vue Path entries on `dev/next`
- Date: 2026-08-24

### File list

| # | File | Lines | Findings |
| -: | ---- | ----: | -------: |
| 1 | `src/main/xpc/onlyPreview.handler.ts` | 686 | 0 |
| 2 | `src/main/onlypreview/onlyPreviewClipboard.service.ts` | 192 | 0 |
| 3 | `src/main/onlypreview/onlyPreviewWorkspace.registry.ts` | 504 | 0 |
| 4 | `src/shared/onlypreview/onlyPreview.types.ts` | 371 | 0 |
| 5 | `src/shared/onlypreview/onlyPreview.contract.ts` | 473 | 0 |
| 6 | `src/renderer/common/i18n/en.ts` | 783 | 0 |
| 7 | `src/renderer/common/i18n/zh.ts` | 767 | 0 |
| 8 | `src/renderer/onlypreview/shell/src/App.vue` | 667 | 0 |
| 9 | `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts` | 798 | 0 |
| 10 | `tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs` | 670 | 0 |
| 11 | `tests/onlypreview/onlyPreviewClipboard.test.mjs` | 156 | 0 |
| 12 | `tests/onlypreview/onlyPreviewAppWiring.test.mjs` | 664 | 0 |
| 13 | `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | 591 | 0 |
| 14 | `tests/onlypreview/specs/onlyPreviewActions.spec.ts` | 174 | 0 |

### Problems

None under the workspace `code-review` rules. All reviewed TS/JS/Vue files are at most 800 lines
(TS-1); no replaceable `function` declaration/expression appears (TS-2). `App.vue` delegates copy
execution/state/error handling to `onlyPreviewShell.store.ts` and contains only exact event routing
(FE-1), and it emits no business payload (FE-2). There are no BE-applicable files or BE rules.
P1-1 is a task-contract/runtime correctness finding, not one of the four code-review rule findings.

## Fresh verification

| Check | Result |
| ----- | ------ |
| Focused Workspace/Clipboard/Main wiring/Shell UI tests | **PASS — 36/36**, zero failed/skipped/todo |
| `node --test tests/onlypreview/*.test.mjs` | **PASS — 332/332**, zero failed/cancelled/skipped/todo |
| `yarn typecheck:node` | **PASS** |
| `yarn typecheck:web` | **BASELINE ONLY** — exit 2 with 76 existing non-OnlyPreview diagnostics; zero OnlyPreview matches |
| `yarn check:renderer-i18n` | **PASS** |
| focused error-level ESLint (`--quiet`) over the 14 code/test files | **PASS**, zero errors |
| `git diff --check` | **PASS** |
| `yarn build` | **PASS** — Main 1,643, preload 1,039, client 10,428 modules; OnlyPreview Shell/Preview outputs emitted |

The safe build emitted three existing mixed static/dynamic-import warnings (Maestro ExcelJS,
EyesOnAgents handler, and Home router). They are outside Task 029. A supplementary strict
warning-level ESLint/Prettier check found 17 formatting warnings across task-touched files and nine
Prettier-check failures; formatting is not a Task-029 gate or a workspace code-review rule, so these
are recorded as weak hygiene evidence rather than additional findings.

## Owner-only live acceptance

After P1-1 is fixed and a second independent review passes, Ral still owns these real-OS checks:

- In Finder/Explorer, paste one copied file and one copied folder; on Linux confirm Copy File/Folder
  fails visibly rather than copying text.
- Verify Copy Path, Copy Relative Path, Copy Name, `Cmd/Ctrl+C`, `Shift+Cmd/Ctrl+C`, and
  `Option/Alt+Cmd/Ctrl+C` with spaces/quotes/non-ASCII names, while ordinary copy remains intact in
  search inputs, editors, and Preview content.
- Cancel one delete; delete an unselected file while selecting another file; then delete the selected
  file while immediately selecting a different file. Confirm tree/search convergence and that the
  latest explicit selection/Preview always wins.
- Confirm the deleted file is removed directly from disk and is not in Trash/Recycle Bin.

## Conclusion

**BLOCKED.** Filesystem deletion and native clipboard work are bounded and otherwise satisfy their
security/performance contract, but P1-1 must be corrected and independently re-reviewed before Task
029 advances to owner verification.
