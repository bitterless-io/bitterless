# Browser history popup silently stays closed

Status: root cause confirmed and code repair verified; owner runtime acceptance pending (2026-09-16).

## Confirmed root cause after owner reproduction

At 23:48–23:49 in the owner's `debug_prod` run, the native history document loaded and Vue mounted.
SQLite emitted a committed visit and five successful reads (`rows: 1`, `matches: 1`). All 19 popup
updates were rejected as `tab-mismatch`. This confirms that this reproduction failed at active-tab
validation, rather than storage or popup bootstrap.

`MenuBar.vue` initializes `menuBarStore` then `tabStore`. Both previously subscribed to `coach/tabs`,
but the installed `electron-xpc` preload stores one callback per channel using `Map.set`. The second
subscription overwrote the first: the strip followed tab switches while the history store retained
the ID from MenuBar's initial snapshot. Main correctly rejected that stale tab ID. A Node reproduction
executing the real stores and installed preload produced `stripActive: tab-2`, history request
`tab-1`, and `accepted: false` after a tab switch. These are synthetic IDs, not user browsing data.

Cowork has the same duplicate subscriptions but its history protocol has no active-tab guard, so
the overwritten subscriber does not block its popup. Removing BL's guard would mask stale state;
the repair keeps it and gives tab snapshots one owner.

Corrective contract: `tabStore` is the only `coach/tabs` subscriber in Home. Every authoritative
snapshot it receives or fetches updates its strip and synchronously forwards the same snapshot to
MenuBar/history. Remove MenuBar's competing subscription and initial fetch; keep its other events.
Initial load, restore, new tab, tab switching and metadata changes must keep both stores aligned,
while metadata-only changes continue preserving typed input. Do not modify electron-xpc or Cowork.

The previous automated pass missed this integration: its linked fixture set the history tab ID
directly and modeled subscriptions as multiple callbacks. Add a regression using the actual
single-callback preload semantics and the actual MenuBar/TabStore initialization order, demonstrate
failure before the fix, then verify aligned IDs and accepted display state afterward.

Corrective repair complete: TabStore now owns the subscription and forwards initial/restored,
broadcast and debugger-returned snapshots to MenuBar/history. The new real-XPC integration suite
failed 3/3 before the repair and passed 3/3 afterward; all 50 history and 20 diagnostic tests,
isolated build and [independent review](../plan/reviews/browser-history-popup-reload-001-2.md) pass.
The current running app still requires the owner's restart and visible acceptance.

Ral confirmed development mode also fails, requested application log instrumentation, then explicitly
directed Bitterless to follow the working Cowork implementation. Align the query and native-popup
lifecycle with Cowork and retain diagnostics for owner-operated verification. Computer Use remains
stopped. Initial persistence tests used test databases and could not prove device history contents.
The subsequent debug_prod runtime logs above now prove a committed visit and successful real reads;
the separate installed Preview database was not accessed.

## Report and contract

Ral reports that address suggestions work on the development device, including its packaged app,
but fail on a second device after installation. Nonblank input and the explicit history button must
open suggestions under [browser-history-suggestions.md](../features/browser-history-suggestions.md).

On the existing installed Preview 0.0.117, entering text changes the history button to “Hide history
suggestions” without a visible popup. This reproduces the symptom, not yet its exact native gate.
Investigation used the running app; no new Electron instance or Electron E2E was launched.

## Evidence

- Preview logs show successful Maestro startup, but no history request/render lifecycle diagnostics.
- The installed ASAR includes the history HTML, JS/CSS, preload and its dependency closure. The
  actual renderer modules mount with valid mocked IPC in jsdom for English/Chinese and empty/nonempty
  history. This does not test Chromium CSP or Electron's native view lifecycle.
- Schema creation runs before migrations on every Maestro DB initialization. Persistence tests and
  the migration audit pass; an empty history database must still display a popup empty state.
- **Proven reload defect:** main retains `lastRequestId` while the home renderer restarts its
  counter at zero. The home `did-start-navigation` listener only hides the popup. After request 50,
  a normal home reload rejects a new session's request 1 through 50; request 51 works again.
  A source-executing lifecycle test reproduces this. No log proves that reload caused Ral's specific
  A/B difference, so this must not be presented as that conclusion yet.
- **Proven diagnostic gap:** the history entry is missing from the first-party logging catalog;
  its `historyToken` query would also be rejected. The home entry's `maestroReadyToken` query is
  rejected too. Renderer exceptions and the address request path are therefore invisible in logs.

## Repair contract

- Follow Cowork's state ownership: the home address store queries SQLite, debounces input and
  validates query responses; the main service receives complete candidate/loading/error snapshots
  and manages native presentation. Keep Bitterless's existing encrypted BrowserHistoryDao, schema,
  stored history and ranking; do not import Cowork's database or add a migration.
- Create the history view with the main window, and become ready after its loadURL/loadFile promise
  succeeds, as Cowork does. Remove the history renderer mounted-token handshake. The popup subscribes
  to state changes and fetches the current snapshot during initialization.
- Apply request/revision ordering within the active session, not across restarted home renderers.
  New home sessions after reload must work immediately. Dismissed sessions and stale asynchronous
  query results must not reopen the popup. Return an acceptance result to the home store so rejected
  updates cannot leave the history toggle falsely open.
- Preserve BL's recovery after popup renderer failure: dismiss the failed session, allow a fresh
  session to recreate the view, and ignore delayed callbacks from the old view. Recovery must use
  the new load-success lifecycle without restoring the mounted-token handshake.
- Preserve the existing Google candidate, localized loading/empty/retry states, IME handling,
  keyboard navigation, removal, focus/click ordering and native layering/dismissal behavior.
  Follow Cowork's address synchronization rule: tab metadata-only broadcasts must not replace
  in-progress input; update the address when the active tab or its URL actually changes.
- Query errors, including null returned by the IPC bridge, must become a retryable error state;
  they must not leave the native view or home store silently inconsistent.

## Diagnostic contract

- Use the common `browser-history` log scope in development and installed profiles. Log address
  input/focus/history-toggle dispatch, main acceptance/rejection reasons (including session revision,
  window focus and tab mismatch), SQL record/query begin/result/error, renderer bootstrap phases,
  load/mount/attachment gates and dismissal reasons. Include request/revision numbers, boolean state,
  row counts and fixed error classifications so a stalled phase can be distinguished from no event.
- Query diagnostics must report actual rows read from SQLite and matched result count; record
  success must be emitted after the existing write transaction completes. Metadata-only changes
  remain distinct from visits. Do not create diagnostic history rows or alter database contents.
- Record bounded history request acceptance/rejection reasons, load/mount/attachment and failures.
  Never log query text, visited URLs, titles, favicons or session/readiness token values.
- Allow only the documented first-party history/home entry query shapes in the logging policy;
  continue rejecting unrelated queries, duplicate keys and remote lookalikes.
- Preserve existing input/IME, Google search, dismissal and click behavior. Do not add speculative
  throttling changes, database resets, migrations or permissive CSP fallbacks.
- Keep fields as sanitized scalar data within one log message so the application log sanitizer
  retains stage, revision and count information without recording browsing content.

## Verification

Verify logs execute for storage/read, input, bootstrap and native popup gates, and do not contain
sentinel browsing data. Run history persistence, input, popup and click suites, diagnostic-policy
tests, relevant type checks and an isolated application build. Include reload/new-session, stale
query after dismissal, IPC null/error, initial loading/empty results, and mouse/keyboard regressions.
The installed app will continue running its previous package until a new build is installed.
Ral will run development mode and reproduce the problem; the agent will read the profile's log file
after Ral signals reproduction. Do not launch Electron or use Computer Use to reproduce it.

Implemented and verified: 47 history/interaction tests, 20 application diagnostic tests, focused
source guards and an isolated application build passed. Independent review has no open findings;
the confirmed global request-counter defect is removed and popup crash recovery is retained.
Main/renderer type diagnostics match the existing 65/4 baselines; preload reports 7 existing
diagnostics outside history changes. The i18n source guard remains blocked by its unchanged
TabAlias dynamic-import assertion. See [delivery evidence](../plan/tasks/browser-history-popup-reload-001.md).
Those checks describe the first increment; they missed the duplicate-subscription integration.
The subsequent owner run established successful debug_prod SQLite reads and the tab mismatch above.
Visible recovery still requires the corrective repair and another owner-operated run.
