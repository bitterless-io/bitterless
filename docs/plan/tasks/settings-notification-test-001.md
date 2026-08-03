---
id: settings-notification-test-001
scope: Settings native-notification smoke test through Renderer-to-Main XPC
status: implemented-owner-verification-pending
depends-on: [eyes-on-agents-completion-alert-030]
---

# Settings Notification Test

## Objective

Add a `Notification` Settings module immediately above `Log` with one `notification test` button
that triggers a native Bitterless test notification through `electron-xpc`.

## Context

- `docs/issues/settings-notification-test.md`
- `docs/issues/eyes-on-agents-completion-alert.md`
- `docs/features/application-diagnostics.md`
- `docs/INDEX.md`

## Path

- `docs/issues/settings-notification-test.md`
- `docs/plan/tasks/settings-notification-test-001.md`
- `docs/plan/reviews/settings-notification-test-001-1.md`
- `docs/plan/README.md`
- `docs/INDEX.md`
- `src/main/notificationcenter/notify.helper.ts`
- `src/main/xpc/notification.handler.ts`
- `src/main/xpc/xpc.helper.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/home/src/views/setting/Setting.vue`
- `src/renderer/home/src/views/setting/components/NotificationSetting/`
- `src/shared/setting/settingNavigation.contract.ts`
- `scripts/notification/notificationTest.test.mjs`
- `package.json`

## Verification

- Source test proves the Settings order, exact button label, typed Renderer-to-Main XPC call, Main
  notification-center delegation, one in-flight UI request, and test notification copy.
- `yarn test:notification`, `yarn check:renderer-i18n`, `yarn typecheck:node`,
  `yarn typecheck:web`, and `git diff --check` pass.
- Do not launch Electron automatically. Ral performs the final operating-system notification
  delivery check by clicking the new button in the running app.

## Implementation

- Added the top-level Notification Settings entry immediately above Log and one mini
  `notification test` button with a one-request-at-a-time reactive store.
- Added a typed Renderer-to-Main `NotificationHandler` XPC path that delegates to the existing
  Main notification-center helper.
- Added an isolated native test notification without the EyesOnAgents completion tone or any
  user/task content.
- Added focused source-contract coverage and a `test:notification` package script while preserving
  the existing `0.0.65` and version-code edits.

## Reviews

- [Independent passing review](../reviews/settings-notification-test-001-1.md)

## Handoff

Implementation and independent source review are complete. `yarn test:notification`,
`yarn check:renderer-i18n`, `yarn typecheck:node`, and diff checks pass. The repository-wide
`yarn typecheck:web` remains blocked by pre-existing errors outside this task; it reports no task
path. Ral retains the final click-through operating-system notification check in the running app.
