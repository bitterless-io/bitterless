---
id: onlypreview-search-startup-diagnostics-041-2
status: blocked
reviewed_task: onlypreview-search-startup-diagnostics-041
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-contract-and-diagnostics-review
supersedes_review: onlypreview-search-startup-diagnostics-041-1
---

# onlypreview-search-startup-diagnostics-041 — Review 2

- Result: **BLOCKED**
- Scope: Review-1 findings and the task-041 diagnostics delta only. Existing task 038–040,
  Translator, and other dirty-worktree changes were preserved and excluded.
- E2E/live app: intentionally not run. Electron, Playwright, E2E, packaged smoke, and the real
  application remain excluded by contract.

## Findings

### P2 — blocking: Shell subscription failure still exits without its lifecycle terminal

`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:134-149` creates the Shell diagnostic,
marks the store initialized, and calls `this.subscribe()` before entering the `try/catch` at line
149. Both `onlyPreviewGlobalSearchStore.subscribe()` and `subscribeOnlyPreviewShellEvents()` are
external bridge subscription calls (`onlyPreviewShell.store.ts:340-385`) and can throw
synchronously during renderer/bridge startup. Such a failure rejects `initialize()` without either
`shell-initialized outcome=success` or `outcome=failure`.

This leaves the newly added visible Preview → hidden runtime → Shell chain without a terminal at
the exact boundary Review 1 required. Put subscription, host validation, and asynchronous
initialization under one terminal-owning control flow while preserving the existing error/return
behavior; prove a subscription failure produces exactly one failure terminal.

### P3 — blocking evidence gap: cancellation/failure terminal assertions remain incomplete

Review 1 required production regressions for terminal cancellation/failure. The new tests directly
cover:

- Main relay early failures and exact start/terminal pairing;
- engine initial-tree gate ordering before one successful terminal;
- one successful Shell dispatch/first-batch/terminal;
- source-level forbidden-field and two tight-loop checks.

They still do not assert the production engine's `search-terminal outcome=failure` or
`outcome=cancelled`, nor the Shell store's `shell-terminal outcome=failure` or
`outcome=cancelled`. Those outcomes happen incidentally in other tests using the default console
writer, but no assertion would fail if their terminal were duplicated, omitted, or mislabeled.
There is likewise no production Shell-initialization failure assertion, allowing the finding above
to pass all 44 focused tests.

Because terminal cancellation/failure is an explicit task Verification contract and one untested
failure path is still incorrect, this remains blocking rather than optional test hardening.

## Review 1 closure status

### Closed: Main XPC early failures pair exactly once without behavior change

`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:148-206` now places active-runtime lookup,
host validation, expectation construction, dispatch, response validation, and cleanup under one
`try/finally`. `outcome` defaults to failure and changes to success only after the existing response
validator succeeds. Nullable cleanup state preserves pre-dispatch behavior and prevents deleting a
pending call that was never registered.

The production relay regression covers absent runtime, wrong host, and invalid search response,
asserting three exact start/failure-terminal pairs. Existing success, timeout, malformed response,
detach, and host/capability tests remain green.

### Partially closed: visible Preview and hidden-runtime lifecycle phases are now present

`src/main/windows/onlyPreviewWindow.helper.ts:314-345,624-739` now records visible window start,
hidden-runtime-ready, Shell renderer load, and visible-window success/failure using one Main-local
monotonic interval. The existing hidden runtime independently records renderer load, preload ready,
relay attach, and terminal. Shell now records its own renderer-local initialization duration, and
Global Search retains Shell dispatch/first batch/terminal events.

The event order reflects actual awaited boundaries, and no cross-process clock values are carried
or subtracted. This closes the missing success-path timeline, but the Shell pre-`try` failure above
prevents full lifecycle terminal coverage.

### Partially closed: production and source regressions materially improved

The Main relay, real engine initial-tree ordering, real Shell successful terminal, privacy payload,
and tight-loop checks now exercise production code. The remaining cancellation/failure assertions
are listed above.

## Performance, privacy, and behavior audit

- The helper remains a fixed event-schema allowlist. It emits one bounded string and discards extra
  fields; logging/clock failures are swallowed.
- Reviewed call sites pass only local tags, fixed enums/booleans, bounded aggregate counts,
  generation/build revision, and local elapsed durations. No query, result body/snippet, name,
  path, workspace/config/database identity, capability/token, or raw error is logged.
- Event count is constant per window lifecycle, build phase, and accepted search. It does not scale
  with corpus entries/chunks/results; the first-section guard permits at most one event per section.
- No diagnostic SQLite statement, filesystem operation, traversal, public payload field, timer,
  persistent state, or threshold was introduced. Main retains its zero-search-I/O boundary.
- All durations start and end inside one process. Shared chronological logs may compare event order,
  but the implementation never subtracts Main, hidden-renderer, and Shell clocks.
- Apart from diagnostic side effects, the reviewed relay/window/Shell changes preserve existing
  readiness, exception, result, one-active/one-latest, token, and state behavior.

## Verification

| Command / evidence | Result |
| --- | --- |
| Task-listed focused Node suites | **PASS, 44/44** |
| `yarn typecheck:node` | **PASS** |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false` | **PASS** |
| `git diff --check` | **PASS** |
| Build | Not rerun; changes are covered by both directed type checks and the focused source/runtime suites |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**BLOCKED.** Review 1's Main XPC defect is fixed, and the success-path visible Preview → hidden
runtime → Shell → search timeline is now real, privacy-safe, bounded, and locally timed. Delivery
still needs one terminal-owning Shell initialization flow plus direct production assertions for
failure/cancellation terminals before the diagnostics contract is complete.
