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

### R11 parity 注记（2026-09-17 接手会话）

`micromeet-cowork` 的 R11 移植需要一个 bl **不需要**的条件判断，原因是结构差异，记在这里免得下次
有人把两边"对齐"成同一段代码：

- 本仓：`surface.load()` 失败会从 `ensureSurface` 抛出去并 `dispose()`，surface 压根没进
  `this.surfaces`，所以 `setTabActive` 找不到 entry —— `controls-load-*` 那一类天然走不到自动重连，
  全权归 `zellijSurface.ts` 的 `promptZellijRendererRetry`。
- Cowork：tab 会**保留在注册表里**并在每次激活时重发原生弹窗，所以它的自动重连必须显式排除
  `controls-load-*`，否则自动重连会在用户正被弹窗询问时改掉状态。详见
  `projects/micromeet-cowork/docs/issues/zellij-renderer-load-timeout.md` 的 R11 收尾一节。

本仓本轮复验：`yarn test:zellij` 258 条 **257 通过**，`yarn check:zellij-tab-chrome` ok，
`yarn typecheck` 106 条诊断中 **zellij 相关 0 条**。唯一红的那条
（`quit and logout dispose all other terminal hosts before the final Zellij runtime drain`）与 R11 无关，
是登出拆卸契约的冲突，见下节。

### ⚠ 待 Ral 裁决 —— 登出不再拆 Zellij/Omni，与守卫测试冲突（2026-09-17 发现）

`src/main/xpc/auth.handler.ts` 现在只拆账号绑定的窗口，注释写着「OnlyPreview 和 Zellij 是公共/本地
窗口，必须保持可用，故意不做全窗口清扫」；`omniWindowHelper.destroy()` 与
`zellijWindowService.destroy()` 在 `a38a641f`（09-17 19:39 的 sync 提交，随 `requestLogin()` /
`prepareForAuthShutdown()` 那套改造一起）被移出登出路径。

而 `tests/zellij/zellijGlobalLifecycle.test.mjs:272` 的守卫仍要求 `auth.handler.ts` 里按序出现
`maestroWindowHandler._destroyForAuth` → `omniWindowHelper.destroy` → `zellijWindowService.destroy`，
理由是「drain 之后不能再有活着的 terminal host 能接受关闭」。退出路径（`app.main.ts`）仍然齐全、
仍然通过；**只有登出这一侧对不上**。

两边都有道理，且这是安全形状的取舍（登出后本地终端/Omni 继续可用），不由 agent 单方面定：

- **若新行为为准**：守卫应收窄到「有 drain 的那条路径（退出）」，登出侧改为断言「只拆账号绑定窗口」，
  并把这条契约写进文档（目前它只活在一行代码注释里，`custom-homepage-tab.md` 只覆盖了
  `prepareForAuthShutdown` 那一步，没说登出不再拆 Zellij/Omni）。
- **若守卫为准**：登出需要恢复 drain 这两个 host。

在 Ral 裁决前，本轮**两边都没动**——既没改守卫，也没改登出路径。

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
