---
id: control-login-form-192
scope: Control-native login form aligned with Cowork's ControlLogin (replaces Home Login.vue in Control)
status: pending
depends-on: [change-password-current-password-191]
---

# Control's own login form

## Objective

Implement `docs/features/control-login-form.md`: a Control-native login form in
`src/renderer/maestro/control/src/auth/` that mirrors Cowork's `ControlLogin.vue`/`ControlLogin.less`
structure and metrics, driven by `localHomeAuthStore`, vertically centered in the Control card body, fully
localized (en/zh), and used by `ControlAuthApp.vue` in place of `@renderer/home/src/views/login/Login.vue`.

## Context

- `docs/features/control-login-form.md` (layout, states table, rules) — the contract
- `docs/features/control-login.md`, `docs/issues/control-login-frame-mismatch.md` (frame + authority model)
- Cowork source to mirror: `/Users/ral/Documents/projects/overmind/projects/micromeet-cowork/apps/cowork/src/renderer/control/src/auth/ControlLogin.vue`,
  `ControlLogin.less`, `controlAuth.store.ts`
- Current BL pieces: `src/renderer/maestro/control/src/ControlAuthApp.vue`/`.less`, `ControlApp.less`
  (`.control-app`, `.control-app__card`, `--focused`), `src/renderer/maestro/localHome/src/localHomeAuth.store.ts`,
  `src/shared/home/homeShellBridge.contract.ts` (`HOME_SHELL_AUTH_ERROR_MESSAGES`), `src/renderer/home/src/views/login/Login.vue`
  (behaviour reference only: restore-on-mount for `saved-session`, cooldowns, validation)
- Language switch: `requestApplicationLanguageChange()` / `onRendererLanguageApplied()` in
  `src/renderer/common/i18n/rendererLanguage.ts`
- Brand asset: `@maestro-renderer/common/assets/icons/bitterless-icon.png` (or `app-logo.png`) + "Bitterless" wordmark text
- BL house rules (Overmind CLAUDE.md "bitterless" block): business state/logic in a `*.store.ts` (`State` class +
  `reactive` singleton named `…Store`); `.vue` renders/binds only; styles in sibling `.less`, flat BEM, no
  Tailwind; i18n via `i18nHelper` in en.ts + zh.ts; no `forEach`; static imports; semicolons.

## Path

- New: `src/renderer/maestro/control/src/auth/ControlLogin.vue`, `ControlLogin.less`, `controlLogin.store.ts`
  (+ a small pure helper for error-message → i18n-key mapping if it keeps the store readable).
- `src/renderer/maestro/control/src/ControlAuthApp.vue` — keep the switch, async `ControlApp` loader with retry,
  resize handle, focused-card frame and close button; the chrome shows only the close button (right-aligned);
  the card body becomes the login component (which owns scroll → panel → states). Remove the `Login` import
  and the old status block if the new component covers those states (checking / unavailable).
- `src/renderer/maestro/control/src/ControlAuthApp.less` — keep or trim to what remains used.
- `src/renderer/common/i18n/en.ts` / `zh.ts` — `auth.controlLogin.*` keys (title, fields, placeholders, modes,
  send code / countdown, forgot/reset, set-password, recovery, restoring, cancel, retry, switch account,
  language label, validation messages, success notices) and `auth.controlLogin.errors.*` for every key of
  `HOME_SHELL_AUTH_ERROR_MESSAGES` plus a generic fallback.
- Tests (update, do not weaken intent): `tests/maestro/controlLoginFrame.test.mjs`,
  `tests/maestro/controlLoginLifecycle.test.mjs`, `tests/maestro/maestroLocalHomeAuthGate.test.mjs`,
  `tests/maestro/maestroLegacyHomeVisibility.test.mjs` (only where they assert the old `<Login … compact>`
  usage). New `tests/maestro/controlLoginForm.test.mjs`: each state branch and its action against a stubbed
  `localHomeAuthStore`; saved-session auto-restores once per Control lifetime — a `restoring` phase already in
  progress when Control first sees it counts as that one attempt, so Cancel (→ `saved-session`) lands on the
  recovery view instead of restarting the restore, and a later successful sign-in/sign-out resets nothing
  surprising; error mapping (every
  `HOME_SHELL_AUTH_ERROR_MESSAGES` value → a localized key; unknown → fallback); send-code cooldown; preference
  read/write failures don't throw; credentials cleared on mode/phase change; `ControlAuthApp` no longer imports
  `views/login/Login.vue`; en/zh key parity for `auth.controlLogin`.

Keep Home's `views/login/Login.vue` file (the hidden Home runtime may still reference login types/routes).
Do NOT touch the unrelated uncommitted files listed in task 189.

## Verification

- All tests above pass: `node --test tests/maestro/controlLogin*.test.mjs tests/maestro/maestroLocalHomeAuthGate.test.mjs tests/maestro/maestroLegacyHomeVisibility.test.mjs`.
- `yarn typecheck:web` — no new diagnostics in touched files; scoped ESLint clean.
- Rendered centering check (the orchestrator runs it after develop; leave the component SSR-renderable with its
  store stubbed): form centered within ≤ 1px at 400×{760,900,1100}, top-aligned scroll at 400×600.
- No Electron launch / E2E, no commit, no branch operations.
