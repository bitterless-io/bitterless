# Review: browser history popup tab identity correction

Date: 2026-09-16. Reviewer: independent verification agent, separate from implementation.
Scope: the corrective increment after owner reproduction; baseline `dev/next`, `35c3c51b`.

Task: [browser-history-popup-reload-001](../tasks/browser-history-popup-reload-001.md)
Issue: [confirmed root cause](../../issues/browser-history-popup-reload.md)
Previous review: [first increment](browser-history-popup-reload-001-1.md), retained as historical evidence.

## Files reviewed

Counts refer to unresolved findings in the corrective changes. Existing unrelated working-tree
changes and pre-existing style issues outside changed lines are excluded.

| # | File | Findings |
|---|---|---:|
| 1 | `src/renderer/maestro/home/src/components/MenuBar/menuBar.store.ts` | 0 |
| 2 | `src/renderer/maestro/home/src/components/MenuBar/tab.store.ts` | 0 |
| 3 | `tests/maestro/maestroBrowserHistoryTabs.test.mjs` | 0 |
| 4 | `tests/maestro/maestroBrowserHistoryInput.test.mjs` | 0 |

## Findings and result

**PASS for the corrective source, executable regressions and isolated application build.**
No unresolved findings. The production correction changes only the two stores' tab snapshot
wiring. The reviewer edited only this new review inside the project; verification scripts,
fixtures and build output live under the private workspace `tmp/`.

The earlier pass did not establish the deployed subscription behavior: its linked fixture set
the history tab ID directly and used a multicast subscription substitute. It therefore missed
two real stores competing for one callback. This review closes that specific coverage gap with
the installed XPC preload and the actual store initialization sequence.

The code-review skill's TS/FE rules were checked on the corrective changes; there are no new
rule findings. The functional assessment below follows the owner's explicit repair contract.

## Root-cause evidence

- Owner-operated `debug_prod` logs show the native history document loaded, Vue mounted, a visit
  committed, and five successful SQL searches with one row/match. All 19 popup updates were
  rejected with `reason: tab-mismatch`. These logs establish storage/read success for that run;
  they do not inspect the separate installed Preview database.
- `MenuBar.vue:171-172` initializes MenuBar then TabStore. Both previously subscribed to
  `coach/tabs`. Installed `electron-xpc/dist/preload/index.js:62-69` uses `Map.set` and dispatches
  to one callback per channel, so TabStore overwrote MenuBar's callback. The tab strip advanced,
  but history retained the tab ID from MenuBar's separate initial fetch.
- The unchanged standalone Node reproducer executes the three production stores and installed
  preload/renderer bridge. Before correction: two subscriptions, strip `tab-2`, history request
  `tab-1`, rejected. After correction: one subscription, both `tab-2`, accepted, history open.
  These are synthetic fixture IDs. This standalone script substitutes the main acceptance
  boundary; the new repository test additionally executes the actual native history service.
- BL's native service still rejects updates/actions for a different active tab. The new test
  first proves a current-tab update reaches visible attached state, then proves an actual stale
  tab update is rejected. The fix does not weaken that guard or alter electron-xpc/Cowork.

## Corrective contract and regression coverage

TabStore now owns the sole `coach/tabs` subscription. Its shared `applyTabs` updates the strip and
synchronously forwards the same snapshot to MenuBar/history. The same path handles the initial
post-restore fetch, forced Home fetch and debugger result. MenuBar's competing subscription and
independent initial fetch are removed. Its navigation/title/focus subscriptions remain intact.
The new import is one-way: TabStore → MenuBar → history, with no cycle.

The actual-bridge tests cover switching, new tabs, initial and last-active restoration, forced
Home, debugger responses, metadata-only draft preservation, and continuing tab persistence.
Metadata-only updates retain the input draft and popup revision; identity/URL changes dismiss
the old history session. The focused MenuBar test now calls its public snapshot receiver, while
the new integration test verifies that production TabStore actually supplies it.

No earlier lifecycle test was removed by this corrective increment. The full 50-test history
run retains reload/new-session, stale revision/query/action, crash/destruction recovery, late
load/snapshot, blur/tab switch, keyboard/IME/blank input, click/removal and diagnostic privacy
coverage described in the first review. No production logging or stored-data behavior changes
are introduced by this correction.

## Independent verification

- Same standalone real-preload script: RED evidence saved before source correction, then GREEN
  independently rerun afterward. Evidence: `overmind/tmp/browser-history-root-cause/`:
  `verify-tabs-subscription.mjs`, `red-evidence.json`, `green-evidence.json`.
- `node --test tests/maestro/maestroBrowserHistory*.test.mjs`: **50/50 passed**, zero skipped.
  Three new tests execute the real bridge, all three stores and native history service together.
- `node scripts/diagnostics/run-tests.mjs`: **20/20 passed**, zero skipped.
- Scoped `git diff --check`: passed.
- The broader tab run's six TabAliasDialog failures were independently checked against Git HEAD:
  export the HEAD test and its source dependencies into a scratch fixture, run that fixture,
  then run the same test against the working tree. Both yielded **7 tests, 1 pass, 6 failures**
  with identical failing names and errors (`this.open` / `this.applyTabAlias` missing from the
  extracted test class). This proves the failures predate the history changes. Logs and the
  normalized comparison are in `overmind/tmp/browser-history-root-cause/`.
- Isolated `yarn exec electron-vite build`: **passed, exit 0**, main/preload/renderer complete.
  History preload and both Home/history HTML outputs exist. Build cwd was the ordinary source
  snapshot under `overmind/tmp/browser-history-reload-verification/build-snapshot/`; `out`,
  `.monaco`, `.vite`, `.vite-temp` and `.cache` were private real directories. Dependencies were
  linked per package. No profile wrapper, `before.js`, installation, packaging or app launch ran.
- After the build, all **1,683 original source files** and snapshot source files still matched
  the pre-build SHA-256 manifest, with no additions/removals. All **12 configuration/package
  inputs** also remained byte-identical. Environment values were not printed.
- Detailed results: `overmind/tmp/browser-history-reload-verification/final-verification-2.json`,
  `reviewer-history-tests-2.log`, `reviewer-diagnostics-tests-2.log`, `isolated-build.log` and
  `snapshot-source-hashes.json`.
- The implementation agent separately reports that Maestro renderer type diagnostics remain the
  same four baseline errors. Main/preload source did not change in this corrective increment;
  the previous baseline was 65/7 existing diagnostics. No clean whole-project typecheck is claimed.

## Limits

The observed `debug_prod` failure now has matching runtime evidence and a deterministic source
reproduction. This does not establish every historical A/B-device difference or prove visible
recovery in the owner's running app. The currently running instance and installed Preview
package were not rebuilt in place or restarted. Owner-operated runtime acceptance remains.

Electron/DOM/DAO platform boundaries are bounded test fixtures. No Computer Use, Electron E2E,
real-profile SQLite access, keychain access or installed-app launch was performed.
