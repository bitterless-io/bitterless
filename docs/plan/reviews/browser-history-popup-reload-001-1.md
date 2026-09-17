# Review: browser history popup reload 001

Date: 2026-09-16. Reviewer: independent verification agent, separate from implementation.
Baseline: `dev/next`, `35c3c51b`; reviewed the current uncommitted history-related changes.

Task: [browser-history-popup-reload-001](../tasks/browser-history-popup-reload-001.md)
Contract: [browser history suggestions](../../features/browser-history-suggestions.md)
Issue: [popup investigation](../../issues/browser-history-popup-reload.md)

## Files reviewed

Counts are unresolved findings in the final reviewed version. Unrelated working-tree changes
and pre-existing style issues outside the changed history code are excluded.

| # | File | Findings |
|---|---|---:|
| 1 | `src/main/logging/logPolicy.service.ts` | 0 |
| 2 | `src/main/maestro/windows/main/browserHistoryRecorder.ts` | 0 |
| 3 | `src/main/maestro/windows/main/maestroHistoryView.service.ts` | 0 |
| 4 | `src/main/maestro/windows/main/maestroWindow.controller.ts` | 0 |
| 5 | `src/main/maestro/xpc/browserHistory.handler.ts` | 0 |
| 6 | `src/preload/maestro/sqlite/browserHistory.dao.ts` | 0 |
| 7 | `src/preload/maestro/sqlite/browserHistory.repository.ts` | 0 |
| 8 | `src/renderer/maestro/history/src/history.store.ts` | 0 |
| 9 | `src/renderer/maestro/history/src/history.ts` | 0 |
| 10 | `src/renderer/maestro/home/src/components/MenuBar/browserHistory.store.ts` | 0 |
| 11 | `src/renderer/maestro/home/src/components/MenuBar/menuBar.store.ts` | 0 |
| 12 | `src/shared/maestro/browserHistoryPopup.api.ts` | 0 |
| 13 | `src/shared/maestro/browserHistoryDiagnostics.service.ts` | 0 |
| 14 | `tests/maestro/maestroBrowserHistory.test.mjs` | 0 |
| 15 | `tests/maestro/maestroBrowserHistoryBootstrap.test.mjs` | 0 |
| 16 | `tests/maestro/maestroBrowserHistoryClick.test.mjs` | 0 |
| 17 | `tests/maestro/maestroBrowserHistoryInput.test.mjs` | 0 |
| 18 | `tests/maestro/maestroBrowserHistoryPopup.test.mjs` | 0 |
| 19 | `scripts/diagnostics/applicationDiagnostics.test.ts` | 0 |

## Findings and result

**PASS for the reviewed source, executable unit tests and isolated application build.**
No unresolved blocking or nonblocking findings. The reviewer edited only this review document
inside the project; isolation scripts and build outputs are under the private workspace `tmp/`.

The initial functional review found one blocking regression: copying Cowork's permanent
`unavailable` state would prevent a fresh address session from reopening the popup after its
renderer crashed or was destroyed. This removed existing BL behavior and its old popup test.
The implementation now rejects the closed session before recovering, recreates the view for a
fresh session, and ignores load/crash callbacks from the replaced view. The reviewer inspected
the final code and independently passed the crash/destruction and delayed-load regressions.
The obsolete mounted-token handshake was not restored.

The workspace code-review TS/FE rules were also checked on the history changes. No new
unresolved rule findings remain. Functional checks below follow the task's explicit contract.

## Contract and regression coverage

- Home owns SQLite queries, the 90 ms input debounce, selection and actions. Main receives a
  complete state and returns an acceptance boolean; the popup reads snapshots and forwards
  actions with the same session/revision. Main no longer owns a second query/selection state.
- The view is created with the window, becomes ready after document load, and remains detached
  until there is accepted state. New sessions can start at revision one after an older session
  reached revision 50. Closed sessions and stale revisions/actions remain rejected.
- First-click tests cover history, Google, remove, retry and close. The linked test executes the
  actual Home store, native-view service and popup store together. Focus restoration occurs
  after identity acceptance; unchanged geometry and metadata-only tab broadcasts do not create
  a new revision or overwrite typed text.
- Old query/removal race coverage was mapped to the new Home ownership. Pending queries cannot
  flash old data during a new debounce or reopen a cleared list. A delayed removal cannot alter
  a reopened session, and dismissal during the post-removal search keeps the popup closed.
- Existing empty/whitespace, IME, Escape/Tab, arrow wrapping, ordinary Enter, Google encoding,
  locked-tab recents, tab switching, navigation, window blur, outside focus, clipped bounds and
  window destruction coverage remains. Candidate validation rejects removing Google or
  accepting an unrelated URL. Late popup snapshots cannot replace newer state.
- A null/non-array XPC query result enters the localized retry state. SQLite diagnostics count
  actual rows returned by the SELECT separately from matched entries; record-committed is
  emitted only after the transaction returns. Rollback tests prevent a false committed log.
- History logging contains only fixed stages/reasons, counters, flags and allowlisted error
  classifications. Sentinel tests exclude browsing values, paths, tokens and raw error text.
  Home logging accepts only its documented readiness query; history accepts no query keys.
  Tests reject unexpected/duplicate parameters and remote renderer lookalikes.

## Independent verification

- `node --test tests/maestro/maestroBrowserHistory*.test.mjs`: **47/47 passed**, zero skipped
  (9 SQLite/history, 2 bootstrap, 8 DOM click, 14 Home/input, 14 native/linked interaction).
- `node scripts/diagnostics/run-tests.mjs`: **20/20 passed**, zero skipped.
- Scoped `git diff --check`: passed.
- Isolated `yarn exec electron-vite build`: **passed**, exit 0. Main, preload and renderer
  completed, including the history preload and both history/Home HTML outputs.
- Build input was a normal source copy under
  `overmind/tmp/browser-history-reload-verification/build-snapshot/`, with real private `out`,
  `.monaco`, `.vite`, `.vite-temp` and `.cache` directories and dependency links per package.
  No `before.js`, Rig profile wrapper, installation, packaging or Electron launch ran.
- All **1,683 source files** matched their snapshot SHA-256 hashes after verification, with no
  added, removed or changed source paths. All 12 copied configuration/package inputs also
  remained byte-identical to their originals; no environment values were printed.
  Logs and the hash manifest remain under
  `overmind/tmp/browser-history-reload-verification/`.
- The parent separately reports that normalized TypeScript diagnostics remain identical to the
  baseline: main 65, Maestro renderer 4; Maestro preload's 7 diagnostics are pre-existing and
  outside history files. This review does not claim a clean repository-wide typecheck.

## Limits

The confirmed old request-counter defect is removed. The original device-specific runtime
failure is not proven from the available logs; this review does not attribute it to language
initialization, encryption, database contents or an Electron rendering issue.

SQLite tests use real temporary Node SQLite databases with the production repository/DAO code;
they do not inspect the installed Preview database or prove its current stored row count.
Existing void-returning write/delete IPC still has electron-xpc's null-on-error limitation;
the added DAO/SQL diagnostics identify failures, while query results are explicitly validated.

Electron/window boundaries are mocked in the executable interaction tests. No Computer Use,
Electron E2E, installed-app launch, real-profile/keychain access or manual visual acceptance
was performed. Owner-operated reproduction and log inspection remain the runtime acceptance
step; the running development instance was not restarted or rebuilt in place.
