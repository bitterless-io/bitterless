---
id: maestro-workbench-account-logout-097
scope: dedicated Workbench Settings Account tab and logout-to-fixed-Home lifecycle
status: implemented; owner verification pending
depends-on: [maestro-local-home-auth-gate-096]
verify: focused source/contract tests, node typecheck, scoped lint, debug build, diff check, independent source review; no Electron/E2E
---

# Add Workbench Settings Account and deterministic logout landing

## Objective

Give Workbench Settings a dedicated Account tab that shows the current signed-in email and logs the
customer out, then close Workbench and deterministically reveal the pinned Home tab on Login.

## Context

- `docs/issues/maestro-workbench-account-tab-missing.md`
- `docs/design/customer-authentication.md`
- `docs/features/maestro.md`
- `docs/plan/tasks/maestro-local-home-auth-gate-096.md`
- `docs/plan/tasks/customer-auth-login-account-001.md`

## Path

- `src/shared/setting/settingNavigation.contract.ts`
- `src/renderer/home/src/views/setting/Setting.vue`
- `src/renderer/home/src/views/setting/components/AccountSetting/`
- `src/renderer/home/src/views/setting/components/GeneralSetting/`
- renderer English and Chinese i18n dictionaries
- Home-shell logout, Maestro runtime teardown, and fixed-tab selection only where the existing
  lifecycle does not already guarantee the required outcome
- focused customer-auth and Maestro source/contract tests
- the linked issue, feature/design docs, indexes, and independent review artifact

## Contract

- Add `account` immediately after `general` in the shared typed Settings navigation contract and
  render it as an inner Settings category. Do not add a Workbench top-level pane.
- Extract the current account email and Logout action from General into one reusable Account
  component/store. General keeps only general preferences.
- Read the email fresh when Account mounts through `homeShellBridge.getSessionSummary()`. Expose no
  credential or raw customer data and never adopt Cowork's AI-CRMS local-storage/auth bridge.
- Render localized loading, unavailable/retry, resolved, and logout-in-progress states. Logout stays
  available after an identity-read failure and rejects duplicate clicks.
- Keep the page visually flat, use semantic `name` and BEM classes, and reuse the existing Royal
  Blue Arco Button theme.
- Preserve the existing safe order: hidden Home clears local auth, routes/broadcasts signed-out,
  and acknowledges preparation before Main deactivates authenticated runtimes.
- The successful logout outcome is deterministic: authenticated Workbench is destroyed, Maestro is
  visible, the pinned `bitterless://home` tab is selected, and its auth gate renders Login. Clear or
  bypass only the stale active/startup state needed for this transition; preserve ordinary startup
  and tab persistence outside logout.
- Keep account identity renderer-local only for presentation. A recreated Account page always reads
  the current authority state rather than trusting an old component instance.

## Verification

- Add focused tests for Settings navigation/order, Account/General ownership, i18n coverage,
  token-free identity use, duplicate-submit protection, logout ordering, authenticated-runtime
  teardown, and fixed-Home selection after logout.
- Run focused tests, scoped ESLint, `yarn typecheck:node`, a debug `yarn build`, and
  `git diff --check` where the dirty worktree permits attributable results.
- Do not launch Electron, Playwright/E2E, a packaged app, signing, notarization, publication, or
  network operations. Ral owns runtime and visual acceptance.

## Owner verification

- Open Workbench → Settings → Account and confirm the current email plus Royal Blue-aligned Logout.
- Confirm General no longer contains account controls.
- Trigger Logout from Account and confirm Workbench closes, Maestro stays visible, pinned Home is
  selected, and Login appears without a Mini Apps or stale-web-tab flash.
- Sign in as another account, reopen Account, and confirm the new email is read fresh.

## Delivery

- Added the typed inner `Account` Settings category after General, moved email/logout ownership into
  its own component/store, removed the General duplicate, and added localized loading, failure,
  retry, resolved, logout-in-progress, and failure-message states.
- Preserved the token-free Home authority boundary: Account reads only a fresh email summary and
  uses the existing prepare-then-deactivate logout bridge.
- Added a versioned force-pinned-Home boot intent. Existing Workbench hides after Home activation;
  replacement boot skips custom startup and stale last-active activation while preserving saved tab
  entries and ordinary non-logout startup behavior.
- Focused Account/logout/auth-gate plus customer-auth tests passed 13/13, `yarn typecheck:node`
  passed, the debug `yarn build` passed, and `git diff --check` passed. Whole-file scoped ESLint has
  only two pre-existing host-file baseline errors unrelated to these additions.
- [Independent review 1](../reviews/maestro-workbench-account-logout-097-1.md) approved the final
  source with no unresolved P0-P2 finding.
- Electron, Playwright/E2E, packaged-app smoke, signing, notarization, publication, and network
  operations were not run. Ral owns runtime and visual acceptance.
