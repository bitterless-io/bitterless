---
id: browser-history-popup-reload-001
scope: maestro browser history Cowork-aligned repair and diagnostic logging
status: in-progress
depends-on: []
verify: code-pass-runtime-pending
---

## Objective

Owner reproduction after the first increment exposed the confirmed root cause: duplicate
`coach/tabs` subscriptions overwrite each other in electron-xpc, leaving history with a stale tab
ID. Make tabStore the single snapshot owner, forwarding all authoritative snapshots to MenuBar
and history. Preserve main's active-tab check. See the issue's confirmed-root-cause section.

Owner confirms dev also fails and explicitly directs BL to follow the working Cowork implementation.
Move history query/state ownership to the home store, use Cowork's native load-success readiness
and session ordering, retain BL's database and interaction contract, and instrument the complete
path without browsing data. Computer Use remains stopped; Ral will reproduce and the agent will
inspect the logs. Earlier main/renderer typecheck baselines
reported 65/4 existing diagnostics, respectively.

## Context

- ../../issues/browser-history-popup-reload.md
- ../../features/browser-history-suggestions.md

## Path

- src/main/maestro/windows/main/maestroHistoryView.service.ts
- src/main/maestro/windows/main/maestroWindow.controller.ts
- src/main/maestro/xpc/browserHistory.handler.ts
- src/shared/maestro/browserHistoryPopup.api.ts
- src/main/maestro/windows/main/browserHistoryRecorder.ts
- src/renderer/maestro/home/src/components/MenuBar/browserHistory.store.ts
- src/renderer/maestro/home/src/components/MenuBar/menuBar.store.ts
- src/renderer/maestro/home/src/components/MenuBar/tab.store.ts
- src/renderer/maestro/history/src/history.ts
- src/renderer/maestro/history/src/history.store.ts
- src/preload/maestro/sqlite/browserHistory.dao.ts
- src/preload/maestro/sqlite/browserHistory.repository.ts
- src/shared/maestro/browserHistoryDiagnostics.service.ts (only if a shared bounded logger is useful)
- src/main/logging/logPolicy.service.ts
- src/main/logging/moduleLog.ts (only if needed for its scope union)
- tests/maestro/maestroBrowserHistoryPopup.test.mjs
- tests/maestro/*BrowserHistory*.test.mjs
- scripts/diagnostics/applicationDiagnostics.test.ts

## Verification

- Executable diagnostics regressions for input dispatch, SQLite actual row/result counts and
  native acceptance/rejection/load/attachment gates; no sentinel browsing content in logs.
- Match Cowork query/presentation ownership and load-success readiness. Cover home reload/new
  session, stale query/dismissal, empty/error/null IPC results, keyboard/IME/removal/click behavior.
- Strict renderer URL/query logging policy tests, including valid home tokens and rejection
  of unexpected/duplicate query keys; lifecycle logs carry no browsing content or token values.
- Existing history persistence/input/popup/click suites and relevant type checks.
- Isolated application build without overwriting a running development instance's out directory;
  no Electron launch/E2E.
- Independent code verification in a separate agent, then record evidence here.

## Verification evidence

The following evidence describes the first increment. Owner reproduction failed afterward;
the corrective regression and fresh independent review are required before closing this task.

- New regression: real menuBarStore + tabStore initialization, actual single-callback XPC preload
  behavior, tab-1 → tab-2 broadcast, new-tab/restore snapshots and metadata-only draft preservation.
  Assert history requests use the current ID and main accepts them; retain rejection of real stale
  tab requests. Record a failing pre-fix run and passing post-fix run.

- History persistence, input, native popup, click and bootstrap suites: 47/47 passed after the
  final source changes. Includes actual Home/main/popup store integration, stale query/action
  rejection, first-click behavior, metadata-only tab events and crash recovery.
- `yarn test:application-diagnostics`: 20/20 passed, including strict renderer URL admission and
  single-message diagnostic fields surviving the application log sanitizer without browsing data.
- `node scripts/maestro/check-new-tab-focus.mjs` and
  `node scripts/sqlite-migrations/audit.mjs` passed (14 Core, 9 Maestro, 10 Todoist, 8 Trench).
- Main and renderer/maestro type diagnostics match their pre-change baselines (65 and 4) when
  compared by file, code and message. Preload/maestro reports 7 existing diagnostics outside the
  changed history files. These broad checks are not clean.
- Renderer i18n source guard is blocked by its existing maestroTabAlias dynamic-import assertion;
  that entry is unchanged and uses a static import. No i18n strings changed in this task.
- Isolated `yarn exec electron-vite build` passed (main, preload and renderer). It ran in a normal
  source copy with private output/cache directories and did not alter the active development out
  directory, package metadata or runtime profile. All 1,683 source files still matched the
  verified snapshot hashes after the build.
- [Independent review](../reviews/browser-history-popup-reload-001-1.md): pass, no open findings.
  The reviewer independently reran all 47 history and 20 diagnostic tests and verified recovery
  after popup crash without restoring the old readiness handshake.
- No Electron launch, E2E or Computer Use. Actual device SQLite reads and visible popup behavior
  remain pending owner-operated reproduction; unit tests do not establish that runtime outcome.

Logs: `/Users/ral/Documents/projects/overmind/tmp/browser-history-reload-verification/`.

## Confirmed-root-cause corrective verification

- Production-code change is limited to MenuBar/TabStore snapshot wiring: one `coach/tabs`
  subscriber, one authoritative snapshot flow, with the main active-tab guard retained.
- `maestroBrowserHistoryTabs.test.mjs` executes the installed electron-xpc bridge, the real
  MenuBar, TabStore, history store and native history service with only platform boundaries
  mocked. Before the fix: 3/3 failed; after: 3/3 passed. Covers switching/new tabs, initial/forced
  Home restoration, debugger snapshots, metadata-only draft preservation and real stale-tab rejection.
- All history suites: 50/50; application diagnostics: 20/20. New-tab focus and related tab/source
  guards passed. Renderer type diagnostics remain the same 4 baseline errors with no additions.
- A broader tab run passed 85/91. The 6 TabAlias fixture failures were independently reproduced
  using the unchanged Git HEAD test and source in a scratch directory: identical failing test
  names and errors (`this.open` / `this.applyTabAlias` missing). They are not introduced by this fix.
- Same standalone real-preload reproducer: before, strip `tab-2` / history `tab-1`, rejected;
  after, both `tab-2`, accepted. These are synthetic test IDs.
- [Corrective independent review](../reviews/browser-history-popup-reload-001-2.md): pass, no open
  findings. Reviewer independently passed 50 history and 20 diagnostics tests and the identical
  real-preload reproducer. Isolated `yarn exec electron-vite build` passed; all 1,683 source and 12
  configuration inputs remained identical to the verified snapshot. No active dev output changed.

Runtime evidence and standalone reproducer: `overmind/tmp/browser-history-root-cause/`.
Red/green suite logs: `overmind/tmp/browser-history-reload-verification/tabs-subscription-{red,green}.log`.

## Owner runtime acceptance

Code repair and root-cause verification are complete; task remains open until owner runtime
acceptance. The earlier failed owner run now establishes successful real debug_prod SQLite
write/read and the overwritten tab subscription. The new run verifies the corrected visible flow.

Stop the existing development process in its terminal, then run `yarn dev:prod` from this project
to keep the current `debug_prod` profile. Visit a web page, type part of its title or URL, clear the
address and explicitly open recent history, then reload Home and open suggestions again. Ral owns
the GUI actions; after reproduction, inspect the `browser-history` scope in
`/Users/ral/Library/Application Support/Bitterless_DEBUG_PROD/logs/main.log`.
The installed Preview package is unchanged. Its separate database has not been read by this task.
