---
id: onlypreview-deferred-tab-placeholder-181
scope: Keep the OnlyPreview tab alive as a placeholder while the standalone window owns the surface, give it a Go-to-window button, and promote it back into the tab when that window is closed
status: in-progress
depends-on: [onlypreview-host-toggle-139]
supersedes: [onlypreview-surface-ownership-136, onlypreview-standalone-close-takeover-137]
verify: node --test tests/onlypreview/onlyPreviewDeferredTab.test.mjs tests/onlypreview/onlyPreviewStandaloneCloseTakeover.test.mjs tests/onlypreview/onlyPreviewHostToggle.test.mjs tests/onlypreview/onlyPreviewHostToggleUi.test.mjs tests/onlypreview/onlyPreviewHostMount.test.mjs tests/onlypreview/onlyPreviewFileTabLifecycle.test.mjs; yarn typecheck:node; yarn typecheck:web; yarn check:renderer-i18n; yarn check:maestro; yarn electron-vite build; no Electron/Playwright/E2E
---

# 占位 tab + 前往 + 关窗回收

## Objective

Owner 2026-09-17。完整方案、理由、边界、i18n 文案与与旧决定的关系在
[onlypreview-deferred-tab-placeholder](../../features/onlypreview-deferred-tab-placeholder.md) ——
**动代码之前先读它**。本任务实现那份方案,不多做。

## Required behavior

1. undock 路径上 `closeTab` 调用次数为 0:`teardownSource('cowork')` 删掉 `closeTab` 循环,
   `OnlyPreviewCoworkMount.destroyHost()` 改为 `deps.defer()`。
2. `onlyPreviewCoworkTab.ts` 变成 `live` / `deferred` 双态;`spec.open` 在已有活着的承载时**构建
   占位 surface 而不是抛**;`getDisplayedFile()` 在 `deferred` 下返回 `null`。
3. 新的 `onlypreview/detached` 渲染入口 + `OnlyPreviewDeferredTabSurface`,按
   `onlyPreviewFileTab.service.ts` 同形;占位页不持有 host token。
4. `focusOnlyPreviewWindow()` xpc:有活窗口就 `show()`+`focus()`,没有就走升格。不复用
   `openOnlyPreviewWindow()`(它会新建窗口)。
5. `window.on('close')`(不是 `'closed'`)布防升格,`shuttingDown` 时拒绝;
   `closeOnRendererFailure` 在 `destroyStandalone()` 之前显式布防。
6. `promoteDeferredTab(target)` 跑在 `relocate` 的同一条 FIFO 上,复用同样的 `buildHost('cowork')`
   → `restoreTarget()` → `rememberOnlyPreviewHostMount('tab')` → `show()`,不新增第二条 dock 路径。
7. 方案 #5 的三条定案原样执行:写 `'tab'` 偏好;只有「前往」一个按钮;浏览器窗口隐藏时**不**提到
   前台。
8. `check:maestro` 的守卫 `scripts/maestro/check-tab-alias.mjs:418-419` 现在断言
   「已有活着的承载时 `spec.open` 必须抛」—— 这条断言随本任务改写成「必须构建占位态」,
   `tests/maestro/maestroCompositeTabInstances.test.mjs:213,525` 同改。**不改就直接红。**
9. 两仓齐活:cowork 侧按 PQ-4 重新 vendor 共享/渲染文件(字节一致),host adapter
   (`onlyPreviewDockHost.ts` / `onlypreviewTab.service.ts` / `onlyPreviewCoworkMount.ts`)按既有 seam
   手改;`onlyPreviewDockHost.ts` 的 `closeTab` **不删**,它还服务其他调用方。

## Path

见方案 #4 的 FILE PLAN 一节(该文档与本任务同批提交)。要点:

- 新增:`src/renderer/onlypreview/detached/{index.html,src/main.ts,src/App.vue,src/App.less}`、
  `src/main/windows/onlyPreviewDeferredTabSurface.ts`
- 改:`onlyPreviewCoworkTab.ts`、`onlyPreviewCoworkMount.ts`、`onlyPreviewHostToggle.service.ts`、
  `onlyPreviewWindow.helper.ts`、`onlyPreview.handler.ts`、`onlyPreview.types.ts`、
  `onlypreview.preload.type.ts`、`onlyPreviewEnv.preload.ts`、`onlyPreviewI18n.ts`、
  `electron.vite.config.ts`、`onlyPreviewSurface.mount.ts` 的 docblock
- 守卫/测试:`scripts/maestro/check-tab-alias.mjs`、`tests/maestro/maestroCompositeTabInstances.test.mjs`
- 文档:本任务 + 方案 + `onlypreview-host-toggle-leaves-empty-cowork-tab.md` 的 Reversal 段 +
  `onlypreview-default-homepage.md` #4 的 supersede 段 + `docs/INDEX.md`
- 明确不动:`maestroBrowserView.service.ts`、`compositeTab.api.ts`、`onlyPreviewStandaloneMount.ts`、
  shell 的 `App.vue` 与 `onlyPreviewHostToggle.store.ts`

## Tests

- NEW `tests/onlypreview/onlyPreviewDeferredTab.test.mjs` — undock 的 `closeTab` 零调用;
  `spec.open` 不再抛;占位 surface 装 `onlypreview/detached` 入口且无 host token;
  `getDisplayedFile()` 为 `null`;源码守卫:`detached/src/App.less` 里有 `border: 0` 和 `background`;
  `focusOnlyPreviewWindow` 的两条分支。
- NEW `tests/onlypreview/onlyPreviewStandaloneCloseTakeover.test.mjs`(沿用 task 137 的文件名)——
  升格建 `cowork` 承载 + `restoreTarget` + 写 `'tab'`;幂等;无占位 tab 则不升格;no-op 路径也要
  `endHostTransition()`;**竞态**:排队的 dock `toggle()` 与排队的升格只建出一个 cowork 承载;
  源码守卫:`window.on('close'` 已注册、`closeOnRendererFailure` 先布防、`destroyStandalone()` 不布防、
  `shuttingDown` 时拒绝。
- EDIT `onlyPreviewHostToggle.test.mjs:377-389` — 由「explicit docking removes only the stale
  placeholder tab」改写为「explicit docking promotes the deferred tab and closes nothing」;
  `:236-262` 双向搬迁与 `:357-375` 目标失败恢复保持绿。
- EDIT `onlyPreviewHostToggleUi.test.mjs:292-294` — 三个 `detached.*` key 各出现恰好两次;
  既有 toggle 按钮的位置与 props 不变。
- EDIT `onlyPreviewHostMount.test.mjs` — 升格是 `'tab'` 的写入方之一。
- cowork:NEW `tests/unit/onlyPreviewHostToggle.test.mjs`(该仓今天完全没有 host-toggle 覆盖,
  按 `_load.mjs` 移植而不是复制)、NEW `tests/unit/onlyPreviewDeferredTab.test.mjs`;
  EDIT `onlyPreviewCompositeStartup.test.mjs` 把 `deferred` 态加进既有生命周期用例。

## Progress (2026-09-17)

**bl 侧全部落地,owner 验收待做。** 反转两处(`OnlyPreviewCoworkMount.destroyHost()` → `deps.defer()`、
`teardownSource('cowork')` 删掉 `closeTab` 循环)、新的 `onlypreview/detached` 渲染入口 ＋
`OnlyPreviewDeferredTabSurface`、`focusOnlyPreviewWindow()` xpc、`window.on('close')` 布防与
`promoteDeferredTab()`、两条守卫(`check-tab-alias.mjs`、`maestroCompositeTabInstances.test.mjs`)
都已跟着改。测试:`onlyPreviewDeferredTab.test.mjs` 7/7、`onlyPreviewStandaloneCloseTakeover.test.mjs`
10/10、`onlyPreviewHostToggle.test.mjs` 11/11、`onlyPreviewHostToggleUi.test.mjs` 8/8、
`onlyPreviewHostMount.test.mjs` 8/8、`maestroCompositeTabInstances.test.mjs` 22/22;
`yarn electron-vite build` 绿;`typecheck:node` / `typecheck:web` 零新增诊断。

**cowork 侧(Required behavior #9)还没做**:PQ-4 的 re-vendor、`onlyPreviewDockHost.ts` /
`onlypreviewTab.service.ts` / `onlyPreviewCoworkMount.ts` 三个 host adapter 的手改、以及该仓那三个
新/改测试。`CoworkCompositeTabHostApi` 要加 `defer()`,`onlyPreviewDockHost.ts` 的 `closeTab` 保留。

**一处与方案的偏离**,理由见下:`electron.vite.config.ts` 里 `onlyPreviewHtmlSecurityPlugin` 的
`closeBundle` 模式清单**没有**加 `'detached'`。那个字面量数组被三处测试
(`onlyPreviewAgentSkill` / `onlyPreviewAlertDialogs` / `onlyPreviewGlobalSearchOfficeRenderer`)逐字
钉住,而它们都不在本任务的 FILE PLAN 里。新入口的 CSP/charset 仍然由同一个插件的
`transformIndexHtml`(`secureOnlyPreviewHtml`,按路径含 `/onlypreview/` 生效)强制,缺的只是构建后
那几条 `<head>` 顺序/WASM/Monaco worker 断言。要补就四处一起改。

## Out of scope

占位页上的「移回标签页」按钮(方案 #5.2 已定不做)、隐藏窗口一律提前台(方案 #5.3 的反面,
Ral 若要翻只改一处判断)、以及 host toggle 之外的任何 tab/窗口行为。
