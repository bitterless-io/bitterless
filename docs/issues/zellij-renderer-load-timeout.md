# Zellij renderer navigation can wait indefinitely

Status: implemented; focused code verification passed, packaged human acceptance pending. Scope: R8 from the update/restart investigation. R10 (below) adds a preventive complement.

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

## R10 — stop Chromium from throttling a hidden Zellij tab (2026-09-17)

**Reported by Ral:** an idle-for-a-while Zellij tab, once not displayed for a stretch, needs Retry when reopened. Live evidence from `~/Library/Logs/Bitterless_PREVIEW/main.log`:

```
2026-09-17T11:04:42.725Z surface preparation failed reason=operation-failed
  [error name=Error code=*** message=ERR_TIMED_OUT (-7) loading 'http://127.0.0.1:<port>/***']
```

This is the terminal `WebContentsView`'s navigation to the local zellij web server timing out — the exact stall class R8 bounds to 15s. R8 recovers from the stall; it does not prevent it. Neither Zellij `WebContentsView` in this app disables Chromium's background throttling, so an invisible/backgrounded tab's timers and pending navigation are subject to Chromium's own background throttling policy — a known, already-used mitigation elsewhere in this codebase (`fileSearchWindow.service.ts`, `trenchIoWindow.service.ts`, `deepFetch.ts`, `exploreSession.service.ts`, `omniWindow.helper.ts`, `onlyPreviewWindow.helper.ts` all set `backgroundThrottling: false` or call `setBackgroundThrottling(false)` for this same reason), just never applied to Zellij's own views.

**Contract:**

- `ZellijSurface`'s controls `WebContentsView` (`zellijSurface.ts`, `createControls()`) and `ZellijTerminalView`'s terminal `WebContentsView` (`zellijTerminalView.ts`, `~line 200`) both set `backgroundThrottling: false` in `webPreferences`.
- Purely preventive and additive: no change to R8's bounded-navigation behavior or the R9/session-remint logic (`zellij-update-restart-blocks-and-new-tab-fails.md` #3.6). It only reduces how often the timeout path is reached.
- Mirrored in `micromeet-cowork` (`apps/cowork/src/main/modules/browser/zellijTab.service.ts`, both its controls and terminal `WebContentsView` construction) per the bitterless/cowork paired-development rule — common Zellij infra, not product-specific.

**R10 rejected by Ral (2026-09-17) — reverted.** Independent review found a real, documented Electron side effect before this shipped: per `electron.d.ts` (Electron 40.10.6), *"When at least one webContents displayed in a single browserWindow has disabled `backgroundThrottling` then frames will be drawn and swapped for the whole window and other webContents displayed by it."* A Zellij tab docked into a shared Maestro composite tab host (`zellijWindow.service.ts` `openOnTab` → `host.attach(surface.container)`) lives in the same window as unrelated Maestro browser/mini-app tabs, so this would have silently disabled background frame throttling for every other tab in that window for as long as a Zellij tab existed there — directly undermining the careful default-throttled design already in `omniWindow.helper.ts`. Ral's ruling: do not accept that side effect. `zellijSurface.ts` and `zellijTerminalView.ts` were reverted to their pre-R10 state (confirmed clean via scoped `git checkout`). See R11 below for the replacement approach.

R10's own code verification before revert (kept for record): 25/25 targeted tests passed, 77 typecheck diagnostics unchanged. No packaged/human acceptance was ever run on it.

## R11 — auto-reconnect on tab activation, distinct "Reconnecting" state (Ral 2026-09-17)

**Ral's ruling, replacing R10:** don't touch background throttling. Instead, when a Zellij tab is reactivated after sitting hidden and its terminal has degraded to `error`, retry automatically instead of leaving the stale error card until the user notices and clicks Retry. While that automatic attempt is in flight, the loading state must read distinctly as **"Reconnecting"**, not the generic "Opening" text used for a true cold start — so the user can tell "resuming after being away" from "starting fresh."

This does not touch R9's bounded-recovery contract (`zellij-bounded-session-recovery.md`) underneath — it only changes *when* a retry fires (also on activation, not only on an explicit click) and *what label* shows while it runs. `ZellijTerminalView.sync()` today refuses to retry once `state.status === 'error'` ("An exhausted recovery attempt stays failed until the user explicitly presses Retry") — that latch is what silently left reactivated tabs stuck. This supersedes that latch for the activation path specifically; passive/broadcast-driven paths are unchanged.

**Contract:**

- `ZellijSnapshot['status']` (`src/shared/zellij/zellij.type.ts`) gains `'reconnecting'`, between `'starting'` and `'ready'`.
- `ZellijTerminalView.sync()` (`zellijTerminalView.ts`) no longer refuses when `state.status === 'error'` — only `disposed` blocks it. `sync()` is called only from deliberate "the user is now looking at this surface" call sites (standalone `open()`, `openOnTab()`, and the new activation hook below) — never from a passive/timer/broadcast path — so this cannot become an unbounded retry loop.
- `ZellijTerminalView.initialize()`: when starting a new attempt, if the state being replaced was `'error'`, the in-flight status is `'reconnecting'` instead of `'starting'`.
- `zellijWindow.service.ts`'s `setTabActive(host, active)`: when `active` becomes `true`, also call `entry.surface.sync()` (in addition to the existing `refreshTab`/`focus`) — today reactivating a docked tab only re-focuses/re-lays-out the existing view and never attempts recovery.
- Renderer (`zellij.store.ts`): the snapshot-validity allowlist accepts `'reconnecting'`; a new `loadingLabel` getter shows the reconnecting-specific string when `status === 'reconnecting'`, else the existing generic opening text. `App.vue`'s loading paragraph uses `zellijStore.loadingLabel` instead of the hardcoded opening string. The header status pill needs no template change — it already reads generically from the i18n status map, which gains the new key.
- i18n (`en.ts` / `zh.ts`, both under the `zellij` block): add `status.reconnecting` (short label, header pill) and a new `reconnecting` string (loading-body text).

**Verification target:** targeted Zellij test suites + `yarn typecheck:node`, no Electron/E2E. Packaged human acceptance: leave a docked Zellij tab until it visibly needs Retry (or force it into `error`), switch away and back — it should show "Reconnecting…" and recover without a manual click; a genuinely dead session still surfaces the error card after the bounded attempt(s) fail.
