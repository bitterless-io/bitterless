# Settings Notification Test

Status: implemented; owner verification pending

## Need

Settings needs a direct native-notification smoke test so a user can verify operating-system
notification delivery without waiting for an EyesOnAgents task to finish.

## Layout

`Notification` is a top-level Settings item immediately above `Log`. Its content contains one
action only:

```text
┌──────── Settings ────────┬────────────────────────────────────────┐
│ Proxy                    │                                        │
│ General                  │ [notification test]                    │
│ Model Config             │                                        │
│ System Prompt            │                                        │
│ Notification        ◀    │                                        │
│ Log                      │                                        │
│ About                    │                                        │
└──────────────────────────┴────────────────────────────────────────┘
```

The page follows the existing Settings spacing and Arco `mini` control sizing. It introduces no
new decoration, explanatory copy, success alert, or persistent setting.

## Interaction contract

| Input | Scope | Behavior |
|---|---|---|
| Click `notification test` | Notification Settings | Disable/show loading on the button while one XPC request is active, then show one native notification. |

The Renderer calls a typed `electron-xpc` Main handler. Main delegates notification construction to
the existing notification-center helper. The notification title is `Notification test`; the body is
`Bitterless notifications are working.`. It does not play the EyesOnAgents completion tone and does
not contain task, prompt, response, path, or account data.

Repeated clicks after a request completes intentionally create repeated tests. Concurrent clicks
while the request is active are suppressed by the disabled/loading button.

## Entry points

- `src/main/notificationcenter/notify.helper.ts`
- `src/main/xpc/notification.handler.ts`
- `src/renderer/home/src/views/setting/Setting.vue`
- `src/renderer/home/src/views/setting/components/NotificationSetting/`
- `src/shared/setting/settingNavigation.contract.ts`

Delivery: [settings-notification-test-001](../plan/tasks/settings-notification-test-001.md)

## Handoff

The first runtime verification on signed `0.0.68` produced no visible result and reopened delivery
through [Settings notification test silently does nothing](settings-notification-test-silent-noop.md).
