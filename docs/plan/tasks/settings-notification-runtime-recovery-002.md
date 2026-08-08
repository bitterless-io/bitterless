---
id: settings-notification-runtime-recovery-002
scope: observable and retained native-notification test lifecycle
status: implemented-owner-verification-pending
depends-on: [settings-notification-test-001]
---

# Settings Notification Runtime Recovery

## Objective

Replace the silent fire-and-forget Settings notification test with a retained, event-observed Main
notification lifecycle and a typed XPC result that produces localized visible feedback.

## Context

- `docs/issues/settings-notification-test-silent-noop.md`
- `docs/issues/settings-notification-test.md`
- `docs/issues/eyes-on-agents-completion-alert.md`
- `docs/INDEX.md`

## Path

- `docs/issues/settings-notification-test-silent-noop.md`
- `docs/plan/tasks/settings-notification-runtime-recovery-002.md`
- `docs/plan/reviews/settings-notification-runtime-recovery-002-1.md`
- `docs/plan/README.md`
- `docs/INDEX.md`
- `src/main/notificationcenter/notify.helper.ts`
- `src/main/xpc/notification.handler.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/home/src/views/setting/components/NotificationSetting/notificationSetting.store.ts`
- `src/shared/setting/settingNavigation.contract.ts`
- `scripts/notification/`
- `package.json`

## Verification

- Run `yarn test:notification`, `yarn check:renderer-i18n`, `yarn typecheck:node`, focused ESLint,
  and `git diff --check`.
- Run `yarn typecheck:web`; if unrelated repository baseline failures remain, prove that no task
  path appears in its diagnostics.
- Do not restart or rebuild the currently running installed application. Ral owns the final click
  verification after the next signed build.

## Implementation

- Main retains each native Electron `Notification` until a terminal interaction or a bounded
  60-second retention timeout.
- The test waits for `show`, `failed`, or a five-second missing-event timeout and returns an exact
  typed result; unsupported and synchronous native failures cannot normalize to success.
- Renderer parses the result fail-closed and shows distinct localized feedback for success,
  unsupported, native failure, timeout, and request/contract failure while preserving one in-flight
  button request.
- EyesOnAgents completion alerts reuse native retention without changing silent delivery, supplied
  audio, localized content, or non-fatal semantics.
- Executable tests cover fake native lifecycle branches and the real `electron-xpc/main` registry →
  actual handler → actual helper integration.

## Reviews

- [Independent passing review](../reviews/settings-notification-runtime-recovery-002-1.md)

## Handoff

Implementation and independent review are complete. `yarn test:notification` passes 11/11;
renderer i18n, Main typecheck, focused ESLint, and diff checks pass. The repository-wide Web
typecheck remains blocked only by pre-existing errors outside notification task paths. Ral retains
the final click-through verification after installing the next signed build.
