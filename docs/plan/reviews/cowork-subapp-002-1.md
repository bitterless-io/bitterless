# Review: cowork-subapp-002 (round 1)

## Findings

- **P2 · blocking — repeated Open is not verified to focus the existing Cowork window.** Task 002
  explicitly requires the Playwright baseline to verify singleton/focus behavior
  (`docs/plan/tasks/cowork-subapp-002.md:7-10,18-20`), and the feature contract says a subsequent
  Open focuses the same instance (`docs/features/cowork-subapp.md:10-12,48-53`). The E2E does bring
  Bitterless Home to the front and click Cowork again, but its poll returns only `count`, `id`,
  `visible`, and `same`; a visible window can still be behind another focused window
  (`tests/cowork/specs/baseline.spec.ts:124-138`). The implementation calls `show()` on the existing
  instance and `show()` calls `focus()` (`src/main/xpc/coworkWindow.handler.ts:63-66`;
  `src/cowork/main/windows/window.helper.ts:129-135`), so this is a verification gap rather than an
  observed runtime failure. Minimal fix: return
  `focused: windows[0]?.isFocused() || false` from the existing repeat-open poll and require
  `focused: true` in the expected object.

No P1 finding was found.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Real Mini Apps entry | pass | The test authenticates the built Bitterless Home, navigates to `#/mini-app`, locates the real `data-mini-app-id="cowork"` card, and clicks its Open button (`baseline.spec.ts:13-30`). The production card routes through `CoworkWindowHandler`, parallel to Todo (`MiniApp.vue:34-51`; `miniApps.constant.ts:20-39`). |
| Production auth/E2E boundary | pass | E2E mode is rejected immediately in packaged builds before user-data or protocol setup; otherwise it requires an isolated user-data directory (`src/main/app.main.ts:24-39`). The local auth response exists only behind that E2E gate. No production authentication bypass was found. |
| Exact network isolation | pass | E2E validates a loopback origin only, installs separate handlers on `defaultSession` and `persist:bitterless-cowork`, allows only exact auth `/auth/me` requests in the default session and exact AI-CRMS `/` in the Cowork session, and fails all other HTTP(S) requests with `Response.error()` (`app.main.ts:41-107`). The E2E proves both sessions reject unknown URLs and that denied logs omit query values (`baseline.spec.ts:201-228`). |
| Safe child environment and diagnostics | pass | The fixture builds an allowlisted child environment, replaces HOME/app-data roots, and proves a parent secret sentinel is absent in Electron (`tests/cowork/fixtures/bitterlessApp.fixture.ts:176-220,223-260`). Renderer errors cover page errors, crashes, and console errors; the sole ignored condition is the exact unpackaged host-Qdrant `ENOENT` signature (`bitterlessApp.fixture.ts:157-173`). Unexpected mock paths fail with HTTP 500 and are asserted empty (`bitterlessApp.fixture.ts:69-129`; `baseline.spec.ts:201-203`). |
| Renderer graph and Workbench clone boundary | pass | The baseline waits for Cowork Home, Control, Workbench, hidden SQLite, and the AI-CRMS operation page, exercises the Workbench UI, and ends with zero renderer errors (`baseline.spec.ts:26-106,228`). Capture rules are converted from Vue proxies to plain records before XPC (`src/cowork/renderer/workbench/src/workbench.store.ts:924-937`), and `check-embedded-host` guards that regression. |
| Singleton/focus | **partial / blocked** | The test proves one BrowserWindow, the same ID, and no duplicate graph after repeat Open (`baseline.spec.ts:111-138`). It does not inspect `BrowserWindow.isFocused()` (Finding 1). |
| Close cleanup, Todo, and reopen | pass | Closing Cowork is followed by zero first-party renderers, zero operation pages, and zero remaining web contents in the complete Cowork session (`baseline.spec.ts:140-158`). Bitterless then opens/closes Todo successfully and reopens Cowork with a new BrowserWindow and an entirely fresh set of Cowork webContents IDs (`baseline.spec.ts:160-199`). |
| SQLite bootstrap and keychain safety | pass | The preload consumes the token only in the actual `coworkSqlite/index.html` document (`src/cowork/preload/sqlite.preload.ts:141-150`); E2E proves consumption on first open and reopen (`baseline.spec.ts:90-97,173-188`). SQLite key selection is exact: packaged E2E rejects, unpackaged E2E is process-ephemeral, production alone uses `safeStorage`, development uses a distinct owner-only random key file, and unknown environments fail closed (`src/cowork/main/security/sqliteKey.service.ts:10-115`). Task 003 round 2 and the executable embedded-host harness cover malformed keys, races, non-`EEXIST` failures, and forbidden safeStorage calls. |
| Cowork parity inventory | pass | `scripts/cowork/check-cowork.mjs` requires exactly 36 checks. The target contains all 35 upstream leaf checks (the upstream `check-coach.mjs` aggregator is replaced) plus the embedded-host boundary check. `yarn check:cowork` independently ran all 36 and exited 0. |
| Production build | pass | `yarn build` exited 0 and emitted the Cowork Home, Control, Workbench, SQLite, and both preload outputs. Only the four already-documented host CSS optimizer warnings appeared. |
| Playwright runtime | pass with Finding 1 | `yarn test:e2e:cowork` launched the built Bitterless application and passed 1/1 test in 6.3 seconds. The passing test does not cover the focus assertion identified above. |
| Targeted E2E TypeScript | pass | Direct `tsc --noEmit` over the Playwright config, fixture, ARIA helper, and baseline spec completed with 0 diagnostics. |
| Patch hygiene | pass | `git diff --check` exited 0. |

The repository-wide typecheck baselines were not rerun as Task 002 signals. Prior independent
evidence documents `typecheck:node` exhausting both 4 GB and 8 GB heaps without diagnostics, while
`typecheck:web` reports 89 pre-existing diagnostics in 27 host files and zero paths under
`src/cowork` or `src/renderer/cowork*` (`docs/plan/reviews/cowork-subapp-001-1.md:79-80`;
`docs/plan/reviews/runtime-001-001.md:5-10`). The focused test TypeScript check and production build
both passed in this review.

## Manual/package gates

The automated baseline does not replace the contract's live and package gates. Still outstanding are
live AI-CRMS/Codex login and authenticated flows; chat streaming/abort; attachments, workspace, and
artifacts; capture/replay/export; skills, injections, integrations, tools, and models; authentication
invalidation and host quit; and signed macOS arm64/x64 plus Windows packages covering native SQLite,
the CLI extra resource, signing/entitlements, folder/microphone permissions, and update installation
(`docs/features/cowork-subapp.md:190-198`).

## Conclusion

**blocked** — the implementation and all independently run automated commands pass, including the
36 migrated parity checks and the built-app Electron flow. Task 002 cannot pass review until the
existing repeat-open assertion proves that the same Cowork BrowserWindow is actually focused, not
only visible.
