---
id: customer-account-recovery
scope: Customer authentication and Royal Blue home surface
status: done
depends-on: []
---

# Customer Account Recovery

## Objective

Add email-code password recovery, enforce the `invited / active / inactive` customer lifecycle at
every desktop session boundary, keep invited customers in first-password setup regardless of login
mode, and bring the login/chat home surfaces into the documented Royal Blue system without native
black underpaint.

## Context

- `docs/design/customer-authentication.md`
- `docs/design/colors.md`
- `docs/plan/tasks/customer-otp-login.md`
- `../bitterless-private/docs/plan/customer-account-recovery.md`

## Path

- `src/renderer/home/src/views/login/`
- `src/renderer/home/src/stores/auth/auth.store.ts`
- `src/renderer/home/src/networking/auth.api.ts`
- `src/renderer/home/src/router/index.ts`
- `src/renderer/home/src/App.less`
- `src/main/windows/mainWindow.helper.ts`
- `src/renderer/home/src/views/chat/`
- `src/renderer/home/src/components/QuillEditor/QuillEditor.less`
- `docs/design/`
- `docs/plan/`

## Verification

- `yarn build` passes.
- Source review covers reset-code request, mismatched confirmation, successful reset without
  session activation, invited first-password setup, inactive rejection, and invalid-session cleanup.
- A temporary Electron smoke probe confirmed that login/reset/setup controls remain reachable at
  `800x600` and `1200x800`; the probe was removed after verification.
- The native main-window background and renderer root are `#F3F5FC`; the login smoke probe contains
  no large black/near-black tile, and the authenticated chat surface uses the same Royal Blue tokens.
- Login and chat primary/selected states use documented Royal Blue values; the documented orange
  assistant accent remains unchanged.
- `git diff --check` passes, and any pre-existing typecheck failures are reported separately from
  files touched by this task.
