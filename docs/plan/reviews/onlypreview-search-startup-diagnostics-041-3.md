---
id: onlypreview-search-startup-diagnostics-041-3
status: pass
reviewed_task: onlypreview-search-startup-diagnostics-041
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-contract-and-diagnostics-review
supersedes_review: onlypreview-search-startup-diagnostics-041-2
---

# onlypreview-search-startup-diagnostics-041 — Review 3

- Result: **PASS**
- Scope: Review 1/2 findings and the task-041 diagnostics delta only. Existing task 038–040,
  Translator, and other dirty-worktree changes were preserved and excluded.
- E2E/live app: intentionally not run. Electron, Playwright, E2E, packaged smoke, and the real
  application remain excluded by contract.

## Findings

No P1, P2, or P3 finding was found.

## Review 2 closure

### Shell initialization owns exactly one terminal across every exit

`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:141-165` now creates one diagnostic,
defaults its outcome to failure, and places subscription, host validation, and all asynchronous
initialization inside one `try/finally`:

- a synchronous subscription failure propagates unchanged and emits one failure terminal;
- a missing host keeps the prior translated error-and-return behavior and emits one failure
  terminal;
- an asynchronous rejection propagates unchanged and emits one failure terminal;
- only completion of the existing `Promise.all()` changes the outcome to success;
- the `initialized` guard still prevents a second initialization and therefore prevents duplicate
  terminals.

The production-class regression injects a recorder, makes the real renderer subscription bridge
throw synchronously, asserts the original rejection, and observes exactly one
`shell-initialized outcome=failure`.

### Production terminal regressions cover failure, cancellation, and supersession

- `tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs` injects diagnostics into the real
  executor. The drained sibling-failure test now asserts exactly one failure terminal; a separate
  priority cancellation test asserts the original `CANCELLED` rejection and exactly one cancelled
  terminal.
- `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs` exercises the production Global Search
  store. A failed runtime result asserts exactly one Shell failure terminal. A pending accepted
  request superseded by a query change asserts exactly one cancelled terminal; its late response is
  still rejected by the existing request/revision fences.
- The existing successful Shell batch/terminal test and initial-tree engine test continue to assert
  exactly one success terminal and gate-before-terminal ordering. Main relay regressions retain
  exact start/failure-terminal pairing for absent runtime, wrong host, and invalid response.

## Test seam and runtime-behavior audit

- Exporting `OnlyPreviewShellStore` adds only an ES module export; production still constructs the
  same single `reactive<OnlyPreviewShellStore>(new OnlyPreviewShellStore())` instance and configures
  Global Search against that singleton.
- Constructor diagnostics injection defaults to the same helper used before the seam. It does not
  add initialization work, watchers, reactive state, timers, I/O, or a second production store.
- `OnlyPreviewGlobalSearchStore.configureDiagnostics()` changes only its private writer reference.
  It is called by tests, is not exposed through preload/XPC/window APIs, and does not widen the
  renderer capability or public protocol.
- Diagnostics objects contain stable functions/closures and no UI state. Their placement on the
  reactive Shell instance does not participate in templates, computed access, or mutation-driven
  rendering, so the injection does not introduce a reactivity or performance dependency.
- The test-only failing subscription flag exists only inside the esbuild stub; no production
  source references it.

## Timeline, performance, and privacy audit

- The success timeline now covers visible Preview start, hidden runtime renderer/preload/relay
  readiness, visible runtime readiness, Shell renderer load, Shell initialization, index phases,
  search gates/sections/terminal, Main XPC duration, and Shell first-batch/terminal acceptance.
- Failure paths for visible/hidden windows, initialize/search runtime, Main XPC, engine search, and
  Shell initialization/search have terminal events. Cancellation and supersession are terminal and
  retain existing late-result fences.
- Each duration starts and ends inside one process using an injected monotonic clock. No Main,
  hidden-renderer, or Shell timestamp is transported or subtracted across processes.
- The schema allowlist accepts only fixed enums/booleans, bounded counts/revisions, local tags, and
  non-negative bounded elapsed values. Reviewed call sites pass no query, body/snippet, name, path,
  workspace/config/database identity, exclude rule, capability/token, raw error, object, or stack.
- Event count is O(1) per window lifecycle, build phase, and accepted search, independent of corpus
  size. First-section events are guarded once per Files/Contents section. No diagnostic emit was
  added to entry/file/chunk/result or progress loops.
- Diagnostics add no filesystem operation, SQLite statement, traversal, public payload field,
  persistent state, behavior threshold, or Main search I/O. Existing readiness, candidate,
  one-active/one-latest, token, cancellation, and grouped-result semantics remain unchanged.

## Verification

| Command / evidence | Result |
| --- | --- |
| Task-listed focused Node suites | **PASS, 48/48** |
| `yarn typecheck:node` | **PASS** |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false` | **PASS** |
| `git diff --check` | **PASS** |
| Build | Not rerun; both directed type checks and task-focused bundled/source/runtime suites pass |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**PASS — task 041 is ready for Ral's live timing acceptance.** All Review 1/2 blockers are closed:
Main early exits pair exactly, the full visible Preview-to-Shell/search timeline is present, Shell
initialization owns one terminal across every exit, and production regressions directly prove
success/failure/cancellation/supersession behavior. The instrumentation remains privacy-safe,
bounded, process-local, and free of additional search I/O or corpus-scaled logging.
