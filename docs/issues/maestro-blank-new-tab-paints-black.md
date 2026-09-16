# A blank New tab paints black instead of the Bitterless splash

Status: fixed; owner verification pending (2026-09-16)

Related: [Maestro](../features/maestro.md) #541,
[maestro-local-home-branding-008](../plan/tasks/maestro-local-home-branding-008.md),
[Restored browser tabs wait before starting navigation](restored-browser-tab-navigation-delay.md)

## Report

Ral 2026-09-16: 「browser 方面 new tab 内容区域显示黑屏而不是带 logo 的背景」，同样的操作在
micromeet-cowork 里是好的。

## Contract this breaks

`maestro-local-home-branding-008` 的版式契约写着 **"Blank New tab body: centered 56px Bitterless
icon"**：空白新标签页的内容区应当看见宿主页 `Layout.vue` 里那张居中的 Bitterless 图标
(`.maestro-layout__splash`)。那张图不是新标签页自己画的 —— 它画在 home 渲染进程的 DOM 上，
**只有在操作区那个原生 view 不画东西的时候才看得见**。

## Confirmed cause

2026-09-14 的 [restored-browser-tab-navigation-delay](restored-browser-tab-navigation-delay.md)
按批准的契约加了一条「预热时就装一张真实的空白文档」：`browserDocumentPreparation.ts` 的
`prepareBrowserDocument()` 对每个 slot 跑 `loadURL('about:blank')`，`initializeViewSlot()` 在
`buildViewSlot()` 里无条件调用它。那条改动解决的是首次导航被完整 CDP attach 卡三秒的问题，
它本身要留着。

副作用出现在**空白 tab 上**：

| 阶段 | 之前（cowork 今天仍然如此） | 2026-09-14 之后的 bl |
|---|---|---|
| 预热出来的 view | 没有任何文档，合成层什么都不画 | 装着 `about:blank`，合成层**画一张不透明底** |
| `activateTab` | `setVisible(true)`，但 view 无内容 ⇒ 底下 DOM 的 logo 底图透出来 | `setVisible(true)`，about:blank 盖住整块操作区 |
| 操作者看到 | 居中的 Bitterless 图标 | 一整块黑 |

**为什么是黑的而不是 `buildViewSlot` 里设的 `#d9ecff`**：Ral 的 macOS 是 Dark 外观
(`defaults read -g AppleInterfaceStyle` → `Dark`)。Chromium 给「没有作者背景的文档」按
`prefers-color-scheme` 取基色，深色下 `about:blank` 就是近黑，它是文档自己画的一层，盖在
`setBackgroundColor` 之上。所以同一份代码在浅色外观下表现为浅色空白，在深色下表现为黑屏 ——
「换台机器复现不了」正是这个原因。

cowork 之所以没这个问题：它的 `viewSlot.service.ts` 建 slot 时**不导航**，
`initialNavigation.ts` 的 `ensureInitialNavigation()` 又在 `!url` 时直接返回 —— 一个空白 tab
的 view 从生到死没有文档，所以宿主 DOM 一直透得出来。

## Fix contract

判据是「这个 view 现在画的是不是那张**预备空白页**」，不是「这个 tab 有没有 URL」：

- `showsPreparedBlank(tab)` = 浏览器 tab ＋ (还在预备中 ‖ `webContents.getURL() === 'about:blank'`)。
  预备空白页是内部引导，不是内容，**不许盖住宿主页**。
- `activateTab` 把 `setVisible(true)` 换成 `setVisible(!showsPreparedBlank(tab))`。
- 真实文档一提交就把它显出来：`did-navigate`（已排除 `about:blank`）与 `did-fail-load` 两条
  监听里调 `revealTabContent(tab)`，只对**当前活动 tab** 生效。
- `prepareBrowserDocument` 一个字不动：首次导航不再被完整 attach 卡住这条修复要保留。

顺带修掉同一个根因的第二个症状：**加载中的黑屏**。页面提交之前 view 仍停在 about:blank，
按上面的判据它是隐藏的，所以「输入网址 → 回车 → 页面出来之前」看到的是 Home 底图＋tab 上的
转圈，而不是一块黑 —— 这也正是 cowork 今天的表现。

## Acceptance

- 深色外观下点 `+` 开一个空白新标签页：内容区是居中的 Bitterless 图标，不是黑屏。
- 在空白新标签页里输入网址回车：加载期间仍是底图＋转圈，页面提交后立刻显示页面。
- 切到别的 tab 再切回来：已经加载过的 tab 立刻显示页面，空白 tab 仍是底图。
- 重启后恢复的 tab 首次点击：不再有三秒等待（`restored-browser-tab-navigation-delay` 的修复
  未被回退），加载完成后正常显示。
- 加载失败的 tab：显示失败态，不会卡在底图上。
