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
`yarn typecheck` 106 条诊断中 **zellij 相关 0 条**。当时唯一红的那条
（`quit and logout dispose all other terminal hosts before the final Zellij runtime drain`）与 R11 无关，
是登出拆卸契约的冲突；Ral 已于同日裁决，守卫已按下节改形状，套件现已全绿。

### 登出不得让不依赖账号的能力不可用（Ral 2026-09-17 裁决）

**裁决原文**：「omni 和 zellij 都不依赖账号登录，所以首先登出不应该导致 zellij 和 omni 不可用，
可能之前某个过时需求导致这么做了，更新文档并优化。」

所以**现行代码是对的**，过时的是守卫测试与文档。`src/main/xpc/auth.handler.ts` 的
`deactivateSession()` 只收回账号绑定的那几个窗口（coin / todo / eyesOnAgents / maestro）；
`omniWindowHelper.destroy()` 与 `zellijWindowService.destroy()` 已在 `a38a641f` 移出登出路径。

**为什么这条比「少关一个窗口」重要**：登出不只是手动那一下。后端 401 会走
`invalidateSession()` → 广播 `auth/invalidated` → renderer 在 `auth.subscriber.ts:27` 回调里调
`deactivateSession()`。也就是说 token 每次过期都会走同一条路；若在这里 drain，
`zellijWindowService.destroy()` 会 `stopZellijRuntime()` 停掉**共享 web server**，等于每次过期
把所有终端界面一起断掉。

**核实过的三件事**（2026-09-17）：

| 判据 | 结论 |
| --- | --- |
| 登出会不会间接拆掉承载 Zellij 的 Maestro tab | 不会。`prepareForAuthShutdown()` 只是 `applicationAuth.invalidate()`，后者仅重置自身的 auth 就绪快照（`readGeneration`、`setReady(false, true)`），不碰窗口 |
| 登出后还能不能**重新打开** Zellij / Omni | 能。`zellijWindow.handler.ts`、`src/main/zellij/**`、`omniWindow.helper.ts` 里都没有 `sessionShouldBeActive` / `requiresAuth` / `isAuthenticated` 之类的门槛 |
| 终端里跑的 shell 会不会丢 | 不会。native `--server` 会话按 Ral 2026-09-12 的约定始终保留，连应用退出都保留 |

**守卫测试相应改形状**（`tests/zellij/zellijGlobalLifecycle.test.mjs`），拆成两条而不是删掉：

1. `app quit disposes every terminal host before the final Zellij runtime drain` —— 退出路径
   （`src/main/app.main.ts`）**保留原有的顺序断言**。顺序本身就是保护：只有退出会 drain，
   而 host 若在 drain 之后还活着，就可能对一个已停的 runtime 发起 close。
2. `logout revokes only account-bound owners and never makes Zellij or Omni unusable` ——
   登出路径改成**反向断言**：账号绑定的四个仍须被收回，且 `omniWindowHelper.destroy` /
   `zellijWindowService.destroy` / `stopZellijRuntime` **一个都不许出现**。这样将来谁把它们加回
   登出路径，测试立刻红。已做变异验证：临时加回 `zellijWindowService.destroy()` → 红；还原 → 绿。

**同一条裁决覆盖 OnlyPreview 与 browser**（Ral 2026-09-17 追加：「登出不应影响 onlypreview 及 browser 的
功能」）。核实结果是现状已满足，链条如下：

- 登出仍会调 `maestroWindowHandler._destroyForAuth()`，但它并不销毁 Maestro 运行时（那是退出路径的
  `destroyMaestroRuntime` / `shutdown`）。它走 `performAuthCleanup()` →
  `maestroWindowHelper.suspendAuthenticatedSession()`：停 agent、清 agent 侧的 browser 自动化状态
  （`browserUse` / `browserSessions` / `browserToolOwners`），注释原文「browser tabs and local tool
  mounts are retained」。
- 唯一会动 tab 的是 `browserView.suspendProtectedTabs()`，而它 `if (!spec.requiresAuthentication) continue`
  ——全仓**只有一个** spec 标了这个标记：`src/main/windows/trenchCoworkTab.ts:17`（Trench，确实是账号绑定的
  加密货币数据），且是 suspend + `resumeProtectedTabs()` 还原，不是销毁。Zellij / OnlyPreview / 普通
  browser tab / translator / motto / submodules 全部被跳过。
- OnlyPreview 的 `destroyOnlyPreviewForAuth()` 现在**只被退出路径**调用
  （`destroyOnlyPreviewForHostQuit`），登出侧没有调用点。（函数名里的 `ForAuth` 已名不符实，属可选的
  改名，未在本轮动。）

守卫相应加了第三条 `only account-bound composite tabs are suspended on logout`：钉住「全仓有且仅有
Trench 一个 spec 标 `requiresAuthentication`」。两条反向断言都做过变异验证——把 `zellijWindowService.destroy()`
加回登出路径、或把 zellij 的 tab spec 标成需要登录，都会立刻变红，还原后恢复绿。

**Cowork 侧无需改动**（配对开发规则下已评估）：`micromeet-cowork` 里根本没有
`deactivateSession` / `_destroyForAuth` / `destroyForHostQuit`，没有等价守卫测试，也没有 Omni ——
这条契约在那边不存在对应物。

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
