# maestro-workbench-account-logout-097 — Review 1

- Date: 2026-09-01
- Scope: independent review of the dedicated Workbench Settings Account category, token-free
  identity presentation, logout ordering, authenticated Workbench teardown, and forced pinned-Home
  replacement boot against `docs/plan/tasks/maestro-workbench-account-logout-097.md`.
- Method: read-only task/design/source inspection plus focused Node tests. No source edit, Electron,
  Playwright/E2E, packaged-app smoke, signing, notarization, publication, or network operation was
  used by the reviewer.

## Findings

- **P0:** None.
- **P1:** None.
- **P2:** None.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Account is an inner Settings category | The typed Settings contract inserts `account` immediately after `general`; `Setting.vue` renders the localized sidebar entry and `AccountSetting` content without adding a Workbench top-level pane | pass |
| Identity remains token-free and fresh | `AccountSetting` calls `homeShellBridge.getSessionSummary()` on each component setup and renders only its trimmed email; no token, session, device, customer ID, or raw record is introduced | pass |
| Failure remains recoverable | Loading, unavailable/retry, resolved, and logout-in-progress states are explicit; identity-read failure does not disable Logout and both retry/logout reject duplicate in-flight actions | pass |
| General has no duplicate account controls | The old account markup, styles, state, Home bridge import, and Logout method were removed from General | pass |
| Logout authority/order is preserved | The existing Home-shell client awaits hidden Home `prepareLogout()` before dispatching Main deactivation; the hidden authority clears local auth, routes/broadcasts signed-out, and never sends credentials across the bridge | pass |
| Existing Workbench closes onto Home | Auth teardown marks the session invalid, activates pinned Home, hides the Workbench overlay, and then destroys the authenticated Maestro runtime | pass |
| Replacement cannot revive a stale page | The versioned force-Home intent passes a one-boot query, skips custom startup opening, restores tab entries without activating the saved web tab, writes `coach.lastActiveTab=home`, and explicitly confirms pinned Home | pass |
| Failed replacement retains intent | Shutdown clears only the active-attempt marker; the pending version is consumed by `markBootSuccessful()` only after the handler verifies a ready, non-destroyed, auth-ready Maestro window | pass |
| One-shot behavior preserves ordinary startup | The renderer removes only the force-Home query with guarded `history.replaceState`; no-force boots retain the existing startup URL and last-active restoration paths | pass |

## Verification

- Focused Account, logout-landing, and fixed-Home auth-gate tests: passed, 11/11.
- Relevant customer-auth tests: passed, 2/2.
- `yarn typecheck:node`: passed.
- Debug `yarn build`: passed.
- `git diff --check`: passed across the dirty worktree.
- Task-scoped ESLint additions have no attributable error. A whole-file `--quiet` pass still reports
  two pre-existing baseline errors in touched host files: an unused historical controller import
  and an existing `prefer-const` declaration in the Maestro window handler.
- `yarn typecheck:web` remains blocked by existing unrelated project errors; neither implementation
  worker found a new Account/logout diagnostic.
- Electron, Playwright/E2E, packaged-app smoke, signing, notarization, publication, and network
  operations were not run. Ral owns runtime and visual acceptance.

## Conclusion

**Approved — no unresolved P0-P2 findings.**

The implementation gives Workbench a dedicated, token-free Account surface and makes logout land
deterministically on pinned Home Login without changing ordinary tab/startup restoration.
