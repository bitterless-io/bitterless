---
id: change-password-current-password-191
scope: account change-password sends the current password (server requires old_password for active accounts)
status: pending
depends-on: [maestro-settings-gear-restore-190]
---

# Change password with the current password

## Objective

Implement `docs/issues/change-password-rejected-without-current-password.md` #修法 end to end on the client:
the `#/account/password` page asks for the current password and the request carries `old_password`, while the
invited first-password setup path (no old password) keeps working.

## Context

- `docs/issues/change-password-rejected-without-current-password.md`
- Server contract: `/Users/ral/Documents/projects/overmind/projects/bitterless-private/apps/core/src/modules/auth/auth.service.ts`
  (`changePassword`) and `auth.dto.ts` (`ChangePasswordDto { old_password?, new_password >= 8 }`)
- BL i18n rule: every user-facing string in both `src/renderer/common/i18n/en.ts` and `zh.ts`, via `i18nHelper`.

## Path

- `src/shared/home/homeShellBridge.contract.ts` — `HomeShellPasswordChangeRequest { newPassword: string; oldPassword?: string }`;
  `parseHomeShellPasswordChangeRequest` accepts exactly `['newPassword']` or `['newPassword', 'oldPassword']`;
  `oldPassword`, when present, must be a non-empty string; anything else keeps throwing.
- `src/renderer/home/src/xpc/homeShellBridge.handler.ts` — pass `oldPassword` through.
- `src/renderer/home/src/stores/auth/auth.store.ts` `changePassword(newPassword, oldPassword?)` — include
  `old_password` only when given; keep the existing session-fencing checks and post-success behaviour.
  **The post-success profile refresh must not flip the phase.** Today it calls `fetchMe()`, which sets
  `checking = true`, so the Home snapshot goes `ready → restoring → ready`; main's `applicationAuth` treats that as
  not-ready and runs `suspendAuthenticatedSession()` (`maestroWindow.controller.ts`: `agentService.shutdown()` aborts
  every active turn, browser-use sessions are cleared, protected tabs suspended), and the `#/account/password` page
  flips to `SignInGuide` mid-save. It never showed before only because the request always failed with 400 first.
  For an account that is already `ready` (active, no setup pending), refresh with a phase-neutral validation that
  keeps `fetchMe()`'s token fencing and invalidation semantics but does not touch `checking`; the invited
  first-password setup path (not yet `ready`) keeps `fetchMe()`. Test: `checking` never becomes true during an
  active-account change, and the setup path still behaves as before.
- `src/renderer/home/src/networking/auth.api.ts` — `changePasswordApi` payload type gains `old_password?: string`.
- `src/renderer/home/src/views/login/loginSurface.type.ts`, `src/renderer/maestro/localHome/src/localHomeAuth.store.ts`
  — `changePassword(newPassword, oldPassword?)`.
- `src/renderer/maestro/localHome/src/ChangePassword.vue` + `changePassword.store.ts` — add a required
  "Current password" field first (`autocomplete="current-password"`, `id="account-current-password"`); validate
  it is non-empty (new error key `currentPasswordRequired`); send `{ newPassword, oldPassword }`; when the bridge
  result's error message equals `HOME_SHELL_AUTH_ERROR_MESSAGES.credentialsRejected` show a new
  `currentPasswordIncorrect` message, otherwise the existing `passwordFailed`; `reset()` clears all three fields.
  Keep the page's existing styling rules (the new input uses the same `input` rule).
- `src/renderer/common/i18n/en.ts` / `zh.ts` — `setting.account.currentPassword`, `currentPasswordRequired`,
  `currentPasswordIncorrect` (en: "Current password", "Enter your current password.", "The current password is
  incorrect."; zh: "当前密码", "请输入当前密码。", "当前密码不正确。").
- `tests/maestro/accountMenu.test.mjs` — extend the password-form test: missing current password is rejected
  locally; the bridge receives `{ newPassword, oldPassword }`; a `credentialsRejected` failure maps to
  `currentPasswordIncorrect`. Add contract-parser tests (both key shapes accepted, empty/extra keys rejected)
  and an auth-store test that `old_password` is sent only when provided.

Do NOT touch the unrelated uncommitted files listed in task 189.

## Verification

- `node --test tests/maestro/accountMenu.test.mjs` and `yarn test:customer-auth` pass (report any pre-existing
  failures with evidence that they fail identically before the change).
- `yarn typecheck:web` — no new diagnostics in touched files.
- No Electron launch / E2E, no network calls to real backends, no commit, no branch operations.
