---
task: onlypreview-open-diagnostics-114
review: 3
status: passed
---

# OnlyPreview open diagnostics independent review 3

## Result

Passed after the review finding was resolved. No open P0, P1, P2, or P3 findings remain. The
expanded trace is privacy-safe, best-effort, type-consistent, and does not add a readiness wait or
change the window presentation path.

## Findings

### P1 — Closing the window during Shell bootstrap leaves the open trace alive

`createStandaloneWindow()` registers failure terminals for `did-fail-load`, `render-process-gone`,
and `unresponsive`, but its native `window.closed` callback tears down the host and views without
finishing the active Shell open trace. A user can close the already-shown window after
`did-finish-load` but before the renderer's `renderer-receipt`; that destroys the only renderer able
to send the receipt while the trace remains active until the five-minute diagnostic timeout. The
result is a delayed `diagnostic-timeout` record rather than a terminal tied to the close, and the
timer retains the otherwise-dead trace state even though it is correctly unreferenced.

Finish the exact `openTrace.tag` from the current window's `closed` path with one allowlisted close
reason (failure or superseded, according to the intended diagnostic semantics). Keep the existing
window identity fence so a stale window cannot terminate a replacement trace. Add a coordinator or
source regression for close-before-receipt and prove that a late receipt remains a no-op and only
one terminal is emitted.

## Resolution

Resolved. The current window's `closed` callback now requires both the exact `BaseWindow` identity
and the exact current host token before it finishes `openTrace.tag` with `outcome=failure` and the
allowlisted `reason=closed`. Coordinator completion clears the 300,000 ms diagnostic timer. The
regression closes before renderer receipt, then exercises a late receipt and the expired timer; both
are no-ops and the log contains exactly one terminal. A stale window therefore cannot terminate a
replacement trace, while a real close no longer survives until `diagnostic-timeout`.

## Confirmed contracts

- Cold cleanup runs before `windowOpenTraces.begin()`, so the replacement trace cannot supersede
  itself.
- The 300,000 ms timer is diagnostic-only, calls `unref()`, and neither cancels nor delays window
  work.
- `dom-ready`, `did-finish-load`, `did-fail-load`, `unresponsive`, and renderer-gone listeners are
  installed before `loadView()`, avoiding a load-event registration gap.
- Shell renderer reports are fenced by the current host capability, the shell-only `openTag`, and
  coordinator tag identity. Renderer stages are emitted after script entry, language readiness,
  dynamic import, Vue mount, and `nextTick`; Main does not await them. Stale reports cannot finish a
  newer trace. Calls originate in order and contain no private values, although the source test does
  not simulate transport reordering.
- Failure, timeout, supersede, renderer receipt, and Preview revision traces use once-only terminal
  coordinators. `unresponsive` ends diagnostics without closing or otherwise changing existing
  window behavior.
- The allowlisted formatter drops paths, filenames, URLs, tokens, capabilities, raw errors, and
  unknown fields. Dedicated-log writes are best-effort and do not mirror diagnostic lines.
- Shared API types, preload environment fields, XPC validation, renderer client calls, and Main
  handler exports type-check consistently. Explicit target FIFO and Project/external presentation
  ordering remain unchanged.

## Verification

- Initial focused OnlyPreview diagnostics, explicit-open, App wiring, external-file, and
  Preview-region tests: 52/52 passed.
- Resolution re-review focused diagnostics and App wiring tests: 18/18 passed.
- `yarn typecheck:node`: passed.
- Directed renderer type check: passed.
- `git diff --check`: passed.
- Electron, E2E, build, packaging, and the real application were not run.
