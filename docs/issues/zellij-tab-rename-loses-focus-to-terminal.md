# 双击 Zellij tab 改名,光标落在终端里

Status: 根因已定位并逐环取证,**未修**。Ral 2026-09-20 只要根因;修法见 *建议的修法*,待他点头。

## 症状

Ral 2026-09-20:「双击 zellij tab 标题,激活的 session 的光标,而不是 zellij tab 的编辑」。

就地改名(`docs/features/zellij-tab-inline-rename.md`)本身是装上了的:双击确实会让输入框出现。
但键盘焦点不在输入框里 —— 它在那个 tab 的 Zellij 终端里,于是敲下去的字进了 shell。

## 根因:激活 tab 会无条件抢回终端的键盘焦点,而双击必然先触发两次激活

Electron 的键盘焦点是**按 WebContents 分的**。MenuBar(tab 条)活在 Maestro 窗口自己的渲染进程里,
Zellij 终端是**另一个** `WebContentsView`。渲染层的 `input.focus()` 只改得动自己文档里的焦点,
改不动窗口把键盘交给哪个 view —— 那由主进程的 `webContents.focus()` 决定。

一次双击会依次派发 `click`、`click`、`dblclick`。每一次 `click` 都走这条链:

| # | 位置 | 做了什么 |
|---|---|---|
| 1 | [`MenuBar.vue:64`](../../src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue) `onTabClick` | 守卫是 `if (tabStore.isRenaming(id)) return` —— 但 `beginRename` 要到 `dblclick` 才跑,所以**两次 click 都没被挡住**;随后 `await workbenchStore.background()`、`await tabStore.activate(id)`,两个 XPC 往返 |
| 2 | [`maestroBrowserView.service.ts:2384`](../../src/main/maestro/windows/main/maestroBrowserView.service.ts) `activateTab` | composite 分支**没有「已经是活动 tab 就早返回」这一支**,照样执行 `setCompositeActive(tab.id, true)` |
| 3 | [`maestroBrowserView.service.ts:1097`](../../src/main/maestro/windows/main/maestroBrowserView.service.ts) `setCompositeActive` | `spec.setActive(host, true)` |
| 4 | [`zellijCoworkTab.ts:34`](../../src/main/windows/zellijCoworkTab.ts) | → `zellijWindowService.setTabActive(host, true)` |
| 5 | [`zellijWindow.service.ts:157`](../../src/main/zellij/zellijWindow.service.ts) `setTabActive` | `active` 为真时调 `entry.surface.focus(...)` |
| 6 | [`zellijSurface.ts:199`](../../src/main/zellij/zellijSurface.ts) `focus` | 终端已 attach → `this.terminal.focus()` |
| 7 | [`zellijTerminalView.ts:160`](../../src/main/zellij/zellijTerminalView.ts) | `this.view.webContents.focus()` —— **窗口的键盘焦点交给终端** |

而 `dblclick` 这一路只做到 DOM 焦点:`beginRename` → 监视器 → `await nextTick()` →
`input.focus()`([`MenuBar.vue:102`](../../src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue))。

**顺序是决定性的,不是偶发竞态。** `nextTick` 是微任务,当场就跑完;第 1 步那两个 XPC 是跨进程往返,
至少一个事件循环起步。双击的两次 click 间隔通常几十毫秒,所以**第二次 click 的激活必然落在
`input.focus()` 之后** —— 终端总是最后一个拿到焦点。这就是为什么它是稳定复现而不是时灵时不灵。

主进程这一侧完全不知道有「正在改名」这回事:`src/main` 里搜不到任何 `renaming` / `isRenaming`。
渲染层也没有任何办法告诉它「这次别抢」。

### 连带效应:输入框会被自己的 blur 立刻提交掉

输入框上挂着 `@blur="tabStore.commitRename()"`
([`MenuBar.vue:329`](../../src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue))。
主进程把焦点交给终端时,MenuBar 那个 WebContents 被 blur,文档里处于焦点的输入框随之收到 `blur`,
于是 `commitRename()` 把**没改过的名字**提交一遍并拆掉输入框。所以现象不只是「打字进了终端」,
还包括那个编辑框一闪即逝。

## 次要触发点:Workbench 可见时还有第二条抢焦点的路

`onTabClick` 里先跑的 `workbenchStore.background()` 在 Workbench **可见**时会走
`backgroundTab()` → `applyVisibility()` → `setOperationContentCovered(false)` →
`setContentCovered(false)`([`maestroBrowserView.service.ts:1103`](../../src/main/maestro/windows/main/maestroBrowserView.service.ts)),
而它会对每个 composite tab 重跑一次 `setCompositeActive`,又回到上表第 3 步。

Workbench 不可见时 `backgroundTab()` 在第一行就 `return`,这条路是空转 —— 所以它是加重项,
不是主因。主因就是 `activateTab` 那条。

## 范围

BL 独有。micromeet-cowork 没有 Zellij tab 就地改名(历史差异),所以这次不涉及配对修改。

## 建议的修法(待 Ral 拍板,尚未实现)

第 5 步那次 `focus()` 是**激活**的副作用,而不是激活本身的一部分 —— 把 tab 设为前台、和把键盘交给它,
是两件事。切 tab 时该聚焦;点一个已经在前台的 tab 时不该。

倾向:在第 2 步给 composite 分支补上「已经是活动 tab 就不要再当作一次切换」的判断,让重复激活不再
产生焦点副作用。这样双击的两次 click 都不会抢焦点,`input.focus()` 就留得住,连带的 blur 自提交
也一起消失,而真正的切 tab 行为一个字不用改。

需要 Ral 确认的是**语义**:点击当前已激活的 Zellij tab,是否应该把键盘焦点送回终端?
- 如果**应该**(「点一下 tab 回到终端」是个有用手势),那就不能靠上面那条,得让主进程知道「正在改名」,
  代价是渲染层要新增一条 XPC 把编辑态告诉 main,多一个状态要维护。
- 如果**不应该**(焦点只在真正切换 tab 时才动),上面那条是最小且没有新状态的改法。

两种都能修掉这个 bug,差别在于保不保留那个手势。

## 未做

没有跑 Electron E2E(本仓规矩:未经要求不自行启动)。以上每一环都是读源码取证 + 行号可核,
但「双击后焦点确实在终端」这一条最终由 Ral 在打包版上确认。
