---
task: onlypreview-open-diagnostics-114
review: 4
status: passed
---

# OnlyPreview open diagnostics independent review 4

## Result

Passed after both P1 startup-concurrency findings were resolved. No open P0, P1, P2, or P3 finding
remains. The Shell startup preference is now owned by an exact host + window + view lease independent
of diagnostic lifetime, and every native refresh entry uses the same cancellation-aware index path.

## Findings

### P1 — A superseded/stale diagnostic can strand the current Shell unthrottled

`reportShellMounted()` returns before restoring throttling whenever `windowOpenTraces.isActive(openTag)`
is false (`src/main/windows/onlyPreviewWindow.helper.ts:334-355`). This makes an operational resource
state depend on a best-effort diagnostic being active. A second `openOnlyPreviewWindow()` while the
cold Shell is still loading sees the already-issued window/host as `existing`; `begin()` supersedes the
cold trace, immediately finishes the new existing trace, and the eventual cold renderer receipt is
discarded. The Shell then remains `backgroundThrottling: false` for the rest of the window lifetime,
and that open records zero `first-visible`/`interactive` stages. The same permanent state occurs if a
valid receipt arrives after the five-minute diagnostic timeout.

The stale-event fence is also incomplete. `finishShellOpenTrace()` clears the shared
`shellOpenHostToken` before knowing whether its tag is current (`src/main/windows/onlyPreviewWindow.helper.ts:923-929`),
while `render-process-gone`, `did-fail-load`, and `unresponsive` call it without first checking the exact
current window, host, and Shell view (`src/main/windows/onlyPreviewWindow.helper.ts:764-797`). A late
event from a destroyed/replaced view can therefore clear the replacement view's token and suppress its
receipt. For a current `did-fail-load` or `unresponsive` event, the code terminates the trace and clears
the token without restoring `backgroundThrottling: true`, directly missing the required failure cleanup.

Separate the Shell startup-throttling lease from diagnostic activity. Settle it through an exact
window + view + host identity check, restore `true` on every current success/failure path, and clear only
that exact lease. A stale/closed view must be a complete no-op. Diagnostic timeout or supersession may
stop logging, but must not prevent a later current receipt from restoring the WebContents preference.
Add a behavioral regression for a second open during cold bootstrap, a current load failure, and a
late failure from an old view after replacement; each should prove the new Shell alone is restored once.

### P1 — Native refresh starts a second index without cancelling the 750ms restore timer

The public `refresh()` method correctly cancels a pending deferred initialization and initializes
immediately (`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:183-186`). The subscribed
`ONLY_PREVIEW_REFRESH_EVENT` path does not use it: it calls `refreshIndex()` directly
(`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:360-362`). Therefore Command-R during the
startup grace starts an immediate refresh while leaving the timer armed; 750ms later the scheduled
`initializeIndex()` starts as well with the same workspace/search generation. On the observed 86k-item
Project this can create exactly the duplicate expensive work and snapshot race the near-instant change
is intended to avoid.

Route every manual refresh entry through the same cancellation-aware method (or one shared private
primitive). Add a fake-timer behavioral test that arms the initial restore, triggers the native refresh
event, advances past 750ms, and proves only one immediate index request occurs. The current test uses
source regular expressions and does not exercise either competing callback.

## Resolution

- Resolved the Shell lease finding. `shellStartupLease` captures the exact host token, `BaseWindow`,
  and Shell `WebContentsView`. `settleShellStartupLease()` first requires those three objects to remain
  the active Shell, then requires all three lease identities before clearing the lease and restoring
  `backgroundThrottling: true`. Trace completion no longer mutates lease state.
- A valid renderer receipt settles the exact lease even when its diagnostic trace has already been
  superseded by an existing-window open or timed out; diagnostic activity now gates only trace marks.
  Receipt success still shows before settling, while receipt failure settles without showing.
- Current `render-process-gone`, `did-fail-load`, and `unresponsive` callbacks are identity-fenced and
  settle before terminating their trace. Native close settles before teardown, and
  `destroyStandalone()` settles the current lease before clearing or destroying its graph. The same
  checks make every late callback from an old window/view a no-op against a replacement.
- Resolved the refresh finding. The native event subscription now calls the public `refresh()` path.
  While the 750ms timer is armed, `cancel()` clears it and returns true, so that event starts exactly
  one immediate `initializeIndex()` and the deferred callback cannot later run. With no deferred timer,
  the established manual behavior remains one immediate `refreshIndex()`.

## Confirmed contracts

- `createView()` disables background throttling only for `mode === 'shell'`; Preview and Global Search
  retain their existing `true` preference.
- In the uncontended success path, `did-finish-load` calls show, then focus, then records
  `first-visible`; its once-listener plus the renderer-receipt visibility guard prevents a duplicate.
- Initial history restore schedules the index after 750ms without awaiting it from Shell initialization.
  Workspace-change restore is immediate and cancels an armed timer; public and native-event refresh
  now share that same path. The timer checks both its own generation and current workspace generation
  before starting.
- Explicit external-file presentation does not await Project initialization, and the initial restore
  suppression leaves it without a synthetic Project selection.
- New open records remain fixed-schema and privacy-safe. Main open records use the persistent
  per-profile OnlyPreview log; renderer search/grace records contain only phase, bounded generation,
  and elapsed milliseconds and are captured by the existing first-party renderer log bridge.

## Verification

- `node --test --test-reporter=spec tests/onlypreview/onlyPreviewOpenDiagnostics.test.mjs tests/onlypreview/onlyPreviewExplicitOpenSerialization.test.mjs tests/onlypreview/onlyPreviewAppWiring.test.mjs`: 26/26 passed. The two findings are not behaviorally covered by this suite.
- `yarn typecheck:node`: passed.
- `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false`: passed.
- `yarn typecheck:web`: blocked by existing repo-wide strict errors outside the reviewed OnlyPreview
  near-instant files (Poker tests plus Connector/Home/Maestro/Omni/shared files); it reported no error
  in the changed OnlyPreview Shell files.
- Task-scoped whitespace check: passed before this review was written.
- Build, Electron, E2E, packaged smoke, and the real application were not run.

Resolution re-review:

- `node --test --test-reporter=spec tests/onlypreview/onlyPreviewOpenDiagnostics.test.mjs tests/onlypreview/onlyPreviewAppWiring.test.mjs`: 21/21 passed.
- `yarn typecheck:node`: passed.
- `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false`: passed.
- Source inspection covered receipt after diagnostic supersession, stale callback isolation, current
  failure/close/destroy settlement, and cancellation before native-refresh initialization.
- Build, Electron, E2E, packaged smoke, and the real application were not run.
