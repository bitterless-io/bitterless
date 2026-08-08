# Settings Notification Test Silently Does Nothing

Status: implemented; owner verification pending

## Runtime evidence

On 2026-08-05, the installed signed Bitterless `0.0.68` application exposed Settings →
Notification, but clicking `notification test` produced no visible native notification. macOS
Settings showed notifications enabled for the signed Bitterless bundle, including Desktop,
Notification Center, Lock Screen, badges, and sound.

The packaged Renderer and Main chunks both contain the typed `NotificationHandler` path. The
remaining implementation is nevertheless unverifiable:

- `notifyTest()` creates a local Electron `Notification`, calls `show()`, and immediately releases
  the only JavaScript reference;
- it never observes Electron's `show` or `failed` lifecycle events;
- `Notification.isSupported() === false`, a native failure, and a missing `show` event all resolve
  the XPC request as if the test succeeded;
- the Renderer catches transport failures only in the console and always returns the button to its
  idle state without visible feedback.

This is a contract defect even when the operating system is the final display authority: the test
cannot distinguish a successful native handoff from a no-op.

## Recovery contract

```text
Settings button
  └─ typed XPC ─► NotificationHandler
                    └─► notification center retains instance
                          ├─ `show`      ─► { ok: true }
                          ├─ `failed`    ─► { ok: false, error: show-failed }
                          ├─ unsupported ─► { ok: false, error: unsupported }
                          └─ timeout     ─► { ok: false, error: show-timeout }
```

- Main must retain every newly shown native notification so garbage collection cannot end its
  lifetime immediately after `show()`.
- The test XPC method returns a strict discriminated result. Required variants are `ok`,
  `unsupported`, `show-failed`, and `show-timeout`; no exception or missing event may silently
  normalize to success.
- A bounded timeout prevents one missing native event from leaving the Settings button busy
  forever. Runtime logging records lifecycle stage and error class/message without user content.
- The Renderer keeps one in-flight request. On `ok`, it shows a localized success toast. Every
  failure variant and XPC rejection shows a localized actionable error toast.
- The Settings page still contains only the existing mini `notification test` button; transient
  Arco messages do not add a second page control or persistent setting.
- EyesOnAgents completion notifications use the same retention helper but keep their existing
  localized content, silent native notification, supplied completion tone, and non-fatal side
  effect semantics.

## Verification

- Contract tests cover every typed result variant and reject unknown variants.
- Notification-center tests use an injected fake notification implementation to prove retention,
  `show`, `failed`, timeout, and synchronous construction/show failures without mocking the XPC
  integration boundary.
- Source integration tests prove Renderer → real Main handler → notification-center wiring and
  localized toast handling.
- Ral repeats the installed macOS click test after the next signed build.

Delivery: [settings-notification-runtime-recovery-002](../plan/tasks/settings-notification-runtime-recovery-002.md)

## Handoff

Implementation and independent source review are complete. The currently running installed
`0.0.68` bundle is unchanged; owner runtime verification remains after the next signed build:
open Settings → Notification, click `notification test`, confirm the native notification appears,
and confirm the success toast reports the operating-system `show` receipt.
