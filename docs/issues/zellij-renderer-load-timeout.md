# Zellij renderer navigation can wait indefinitely

Status: implemented; focused code verification passed, packaged human acceptance pending. Scope: R8 from the update/restart investigation.

## Problem and evidence

The local controls page and the terminal WebContents navigation were awaited without a deadline. A stalled renderer can keep a surface blank or on Opening even after the independent Zellij runtime is healthy. A warning after ten seconds records the stall but does not recover it. This does not identify or fix the upstream cause of Chromium starvation.

## Contract

- Start the shared runtime independently of controls loading. Do not create a per-surface native session until controls are available.
- Bound each controls and terminal navigation to 15 seconds; report controls-load-timeout or terminal-load-timeout, respectively. Immediate navigation errors use controls-load-failed or terminal-load-failed.
- A terminal-only failure is rendered by the existing controls page and Retry reattaches to the same session.
- If controls cannot mount, the active surface has a main-owned native Retry / Dismiss dialog. Background restored tabs do not produce dialogs; only one dialog per host window may be open. The restoration promise never awaits a dialog response. Dismiss leaves the tab available; activating it again offers Retry.
- Retry recreates only failed renderer views. It must not close, remint or replace the Zellij session solely because a renderer failed.
- Disposal and retries fence old navigations. Late fulfillment or rejection cannot attach, show or focus an obsolete terminal; timers and native prompts are cancelled when their surface is disposed.
- Failed preparation stays latched through passive runtime events or tab activation; only deliberate Retry starts another bounded recovery operation. Disposal passes an AbortSignal into native preparation, preventing a disposed surface from starting a later retry.
- Native dialog labels follow application language. This fallback needs the main event loop to remain responsive; it does not solve a fully stalled main process.

## Presentation

Use the existing terminal error page for terminal failures, and the operating system dialog if that page itself cannot load:

```text
Zellij
The terminal controls did not load in time. Retry to reopen the view.
                                      [Dismiss] [Retry]
```

No new custom layout, color, animation or border treatment.

## Verification

Native Node fixtures: controlled navigation deadlines, failed and successful Retry, same session identity, closing during load, late completion, active-only deduplicated fallback, and parallel shared startup. No Electron E2E or live sessions are launched. Human package check: reopen a Zellij tab after an update; normal load succeeds, a renderer failure offers a useful retry and preserves the running session.

### Code verification (2026-09-17)

- `node --test tests/zellij/zellijRendererLoad.test.mjs tests/zellij/zellijWindow.test.mjs tests/zellij/zellijOmni.test.mjs tests/zellij/zellijTemplateBindings.test.mjs`: **25/25 passed**.

No Electron launch, Electron E2E, live Claude session, process termination, or packaged smoke test was performed. Main/shared typecheck is consolidated with the companion native-recovery change.
