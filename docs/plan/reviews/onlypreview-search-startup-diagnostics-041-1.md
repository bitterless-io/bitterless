---
id: onlypreview-search-startup-diagnostics-041-1
status: blocked
reviewed_task: onlypreview-search-startup-diagnostics-041
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-contract-and-diagnostics-review
---

# onlypreview-search-startup-diagnostics-041 — Review 1

- Result: **BLOCKED**
- Scope: task-041 diagnostics changes only. Existing task 038–040, task 039, Translator, and other
  dirty-worktree changes were preserved and excluded from this conclusion.
- E2E/live app: intentionally not run. Electron, Playwright, E2E, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

### P2 — blocking: Main emits XPC start events that can exit without a terminal event

`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:148-163` emits `xpc-start` before reading the
active runtime, validating the host token, or constructing the pending expectation. The matching
`try/catch` does not begin until line 171. Consequently, at least these accepted diagnostic paths
leave an unmatched start event:

- no hidden runtime is active (`runtimeStoppedError()` at line 156);
- the request host does not own the active runtime (`HOST_ROLE_DENIED` at lines 157-161);
- `_createPendingExpectation()` rejects malformed initialize/search parameters at line 163.

This violates the task's terminal failure requirement and makes the Main XPC duration timeline
ambiguous precisely during early startup/readiness failures. Move the validation into the same
terminal-owning control flow (without changing the public error) and add a fake-writer regression
covering these pre-dispatch failures.

### P2 — blocking: the promised window-to-Shell startup chain is incomplete

The task objective starts at the OnlyPreview window, and the accepted issue explicitly requires
“Preview/hidden-runtime lifecycle: window start, renderer loaded, preload ready, relay attached,
Shell initialized.” The implementation records only the hidden file-search `BrowserWindow` phases
in `src/main/fileSearch/fileSearchWindow.service.ts:43-160`. There is no task diagnostic in
`src/main/windows/onlyPreviewWindow.helper.ts` or
`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`, and the shared event schema has no
Preview-window or Shell-initialized lifecycle event.

As a result, the log cannot measure the interval from the user-visible Preview window startup to
hidden-runtime startup, nor distinguish Shell initialization from the later first search dispatch.
The delivered chain therefore begins later than the documented boundary and cannot fully diagnose
whether that missing interval dominates the first-search delay.

### P3 — blocking evidence gap: task-listed diagnostics regressions do not exercise integration

`tests/onlypreview/onlyPreviewSearchDiagnostics.test.mjs:6-64` proves helper formatting, rejection
of one unknown event, writer/clock failure swallowing, and a locally reimplemented `Set` guard. It
does not invoke the production Main relay, runtime lifecycle, search engine, or Shell store. The
task's Verification section specifically requires regressions for terminal cancellation/failure,
initial-tree wait ordering, Main dispatch/failure timing, Shell dispatch/first/terminal timing,
forbidden-value absence across call sites, and absence of emissions in tight loops. Those assertions
are not present in the task-focused suites; this is why the unmatched Main start passed the full
listed Node command.

This finding is classified as blocking because the task makes those focused regressions part of
its acceptance contract, and one of the untested terminal paths is already incorrect.

## Reviewed contracts without findings

- The shared helper uses exact event schemas and constructs one `[onlypreview-search]` string. Extra
  fields are discarded; invalid clocks, writers, enums, tags, counts, and durations fail safely.
- No query, snippet/body, file/directory name, path, workspace/config/database identity,
  capability/token, raw error, object, or stack is passed to a diagnostic call in the reviewed
  task-041 sources.
- Durations use a process-local injected monotonic clock. No timestamp is transported or subtracted
  across Main, hidden runtime, and Shell.
- Search/index events are aggregate lifecycle events. No emit was added inside a per-entry,
  per-file, per-chunk, per-result, or progress-tick loop; no diagnostic I/O, SQLite statement,
  traversal, public payload field, persisted state, or threshold was introduced.
- SQLite assessment, count, candidate backup, combined traversal/index, promotion wait/commit,
  initialize total, search gates, section completion, first section, runtime, and Shell timings
  otherwise measure the operations adjacent to their local clocks. Event volume is constant per
  lifecycle/search rather than corpus-size dependent.
- Search cancellation/failure drains its existing sibling work before terminal logging; Shell
  supersession emits one cancelled terminal and its current-request fences reject late acceptance.
- Task-040 search behavior changes sharing some touched files were treated as out of scope rather
  than attributed to diagnostics.

## Verification

| Command / evidence | Result |
| --- | --- |
| Task-listed focused Node suites | **PASS, 42/42**; output itself includes an unmatched `xpc-start tag=x3` and no corresponding terminal |
| `yarn typecheck:node` | **PASS** |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false` | **PASS** |
| `git diff --check` | **PASS** |
| `yarn build` | Parent reported the build completed; not redundantly rerun in this review |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**BLOCKED.** The privacy allowlist, local timing model, bounded event volume, and core search/index
instrumentation are sound, but Main has real start-without-terminal failure paths and the timeline
does not yet start at the visible Preview window or record Shell initialization. The task-listed
integration/privacy regressions also do not test the production diagnostic control flow, allowing
the Main terminal defect to pass.
