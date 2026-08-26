# Cmd+Q reveals the hidden legacy Home window

Status: implemented; owner verification pending

## Observed behavior

With an authenticated Maestro session, pressing `Cmd+Q` opens the quit confirmation and reveals
the otherwise hidden Bitterless Home `BrowserWindow` on its old `New Chat` route behind it.

Maestro is a `BaseWindow`, while the current dialog helper asks only
`BrowserWindow.getFocusedWindow()`. When that lookup returns no owner, it falls back to
`BrowserWindow.getAllWindows()[0]`, which is the hidden Home authentication/bootstrap host. On
macOS, attaching a message box to that hidden parent makes the old Home window visible.

## Required behavior

```text
Authenticated Maestro focused
        │ Cmd+Q
        ▼
focused BaseWindow ──► quit confirmation
        │ cancel                 │ confirm
        ▼                        ▼
Maestro stays visible        cleanup → process exit

hidden Home auth/bootstrap host: never selected or revealed
```

- Resolve dialog ownership across Electron `BaseWindow`, not only `BrowserWindow`.
- Prefer the focused, visible, non-destroyed `BaseWindow`. If none is focused, use only another
  visible, non-destroyed window. If no visible owner exists, show an unparented app-modal dialog.
- Never use an arbitrary first window or a hidden window as a dialog parent.
- Apply the same owner rule to both quit confirmation and Keychain-access dialogs.
- Cancel keeps the authenticated Maestro window visible. Confirm preserves the existing bounded
  host cleanup and quit flow.
- Do not delete the hidden Home runtime in this fix. It still owns customer authentication, login
  recovery, and Todo readiness; removing it requires a separate migration of those responsibilities.

## Acceptance

- From authenticated Maestro, `Cmd+Q` shows only the confirmation above Maestro; the old
  `BitterLess` / `New Chat` window never appears.
- Cancelling returns to Maestro without changing the session or window graph.
- Confirming quits after the existing cleanup sequence.
- From the signed-out visible Home window, the confirmation remains parented to Home.
- Automated tests cover focused BaseWindow, visible fallback, hidden-only, destroyed, and no-window
  parent selection without launching Electron.

Implementation task: [maestro-quit-dialog-parent-009](../plan/tasks/maestro-quit-dialog-parent-009.md).
Independent review: [review 1](../plan/reviews/maestro-quit-dialog-parent-009-1.md) — PASS.
