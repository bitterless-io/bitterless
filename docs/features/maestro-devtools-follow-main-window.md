# DevTools 跟着主窗走

Status: implemented — owner testing pending(2026-09-21,Ral:「agent browser 增加功能,启动后需要将在
主窗口创建前后展示的 devtool 都和主窗口在一个屏幕下。mac 下可能有多显示器、多桌面,要确保 devtools
都和主窗口一个桌面」)。

范围是 **bl 的 Maestro 窗口**(`src/main/maestro/**`)。姊妹实现在 `micromeet-cowork`
([`docs/features/devtools-follow-main-window.md`](../../../micromeet-cowork/docs/features/devtools-follow-main-window.md)),
两侧同一套判据、同一套机制,按各自的窗口基类接进去。

## #0 目标

| #  | 目标 | 判据 |
|----|------|------|
| G1 | 主窗**之后**开的 DevTools 落在主窗那块屏 | control / workbench / 操作区 / 固定 Home 四处的 DevTools 都在主窗所在 display 的 workArea 里 |
| G2 | 主窗**之前**开的 DevTools 也落在主窗那块屏 | 隐藏的 sqlite 宿主窗(比主窗先建)的 DevTools 不再落到别的显示器 |
| G3 | macOS 多桌面下与主窗同一个 Space | 主窗在哪个桌面,DevTools 就在哪个桌面;主窗换桌面/进全屏,DevTools 跟着 |
| G4 | 多扇 DevTools 不完全重叠 | 每多一扇按固定步长错开,且始终落在 workArea 内 |
| G5 | 不抢焦点 | 开 DevTools 不把键盘从主窗/终端上夺走 |
| G6 | 关掉 DevTools 窗 = 关掉 DevTools | 目标 `WebContents` 不受影响,之后还能再开 |

不在范围内:**Bitterless 宿主自己的**窗口(Omni、OnlyPreview、Todo、EyesOnAgents、插件测试、
Submodules、llama)和 `src/main/zellij/**`。它们各有各的主窗,锚到 Maestro 主窗是错的;要不要照此办理
是另一件事。

## #1 为什么必须自己托管 DevTools 窗口

Electron 内置的 `openDevTools({ mode: 'detach' })` 开出来的那扇窗**不是 BrowserWindow** —— 它由原生侧
建,JS 拿不到句柄。本仓 Electron 40.10.6 上实测(`app.whenReady()` 里开一扇 detach DevTools 再问):

| 探针 | 结果 |
|------|------|
| `BrowserWindow.getAllWindows().length` 开前/开后 | `1` / `1` —— 没有多出一扇窗 |
| `BrowserWindow.fromWebContents(wc.devToolsWebContents)` | 返回的是**宿主窗自己**(`id` 与 owner 相同),不是 DevTools 窗 |
| `owner.getChildWindows()` | `[]` |
| `wc.devToolsWebContents.getType()` | `'remote'`,URL 是 `devtools://devtools/bundled/devtools_app.html?...` |

`fromWebContents` 那一行是最容易踩的坑:它**非空**,看着像拿到了 DevTools 窗,实际是 owner ——
照着它 `setBounds` 会把主窗搬走。

所以位置、显示器、Space 一个都设不了。仓内 `micromeet-cowork` 的 `windowState.ts` 早就写下过同一条结论
的一半:「Electron's public API can neither read which Space a window is on nor move it to one」。

唯一的口子是 `webContents.setDevToolsWebContents(host)` —— 把 DevTools 前端装进**我们自己的**
`BrowserWindow`。同一轮实测确认它可用:

- host 会被导航到 `devtools://devtools/bundled/devtools_app.html`,`devtools-opened` 照常触发;
- host 的 bounds / 父窗 / 显示与否全部可设;
- 关掉 host → `devtools-closed` 触发,目标 `WebContents` 完好(`targetAlive: true`);
- 之后可以换一扇新 host 再 `setDevToolsWebContents` + `openDevTools`,不报错。

### #1.1 代价:`isDevToolsOpened()` 从此恒为 `false`

自托管之后目标 `webContents.isDevToolsOpened()` 实测返回 **`false`**(DevTools 确实开着)。于是老代码里
那道防重复的闸

```ts
if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach', activate: false })
```

**失效** —— 原样保留会每次都判为"没开",开出第二扇、第三扇。所以去重改由本模块自己的
`WebContents → host` 映射负责,调用点一律不再问 `isDevToolsOpened()`。这不是顺手清理,是换机制带来的
必要改动:漏掉哪一处,那一处就会重复开窗。

## #2 同一个桌面靠父子窗,不靠猜

macOS 没有"把窗口移到某个 Space"的 API。能用的只有两条:

| 做法 | 能保证什么 | 为什么(不)选 |
|------|-----------|--------------|
| `setVisibleOnAllWorkspaces(true)` → `false` | 把窗口钉到**当前活动**的 Space | 本仓 `todoWindow.handler.ts` 用过。但"当前活动"不等于"主窗所在" —— 主窗不在前台时就钉错了,而 G2 那批 DevTools 恰恰在主窗出现之前就开了 |
| `host.setParentWindow(mainWindow)` | 子窗与父窗**始终同一个 Space** | macOS 的子窗随父窗排序:父窗换桌面、进全屏、隐藏/显示,子窗一并跟着。不需要知道父窗在哪个 Space,也就没有猜错的可能 |

取父子窗(G3)。实测 `setParentWindow` 可在 host 建好**之后**调用,所以"主窗还没有"那批也能后补
(见 #3)。

代价说清楚:**子窗永远盖在父窗上面**。调试时这通常正是想要的(一边操作主窗一边看 console),但主窗
最大化时 DevTools 会压住右侧内容。不想要就 `COACH_DEVTOOLS_ANCHOR=0`,整个特性退回 Electron 内置行为
(连带退回原来的乱跑)。

非 macOS 上父子窗没有 Space 这层含义,只剩"跟着父窗显示/隐藏",无害,所以不按平台分叉。

## #3 主窗还没有的时候

Maestro 的启动顺序是:**隐藏的 sqlite 宿主窗 → 主窗**(`maestroWindow.handler.ts` 的 `boot()`:
`ensureMaestroSqliteReady()` 在 `maestroWindowHelper.create()` 之前)。sqlite 宿主窗 `showOnReady = false`,
但它的 DevTools 照开 —— 这就是 Ral 说的"主窗口创建**前**展示的 devtool",它连个可锚的窗都没有。

两步解决,不是猜一次了事:

1. **先按主窗记住的几何落位。** `windowStateService.resolve('maestro')` 拿到的是上次关窗时的 bounds ——
   主窗**将要**开在哪块屏,这是现成的答案,比 `getPrimaryDisplay()` 准。没有存档才退回主显示器。
2. **主窗一出现就重排。** `setDevToolsAnchor(win)` 把此前所有 host 重新落位到主窗那块屏并补上
   `setParentWindow`。所以第 1 步猜错也只是短暂错位,不是最终状态。

## #4 位置

一个纯函数 `devToolsHostBounds({ workArea, index })`,不碰 Electron,可单测
(`tests/maestro/devtoolsPlacement.test.mjs`):

- 宽 = `clamp(round(workArea.width * 0.45), 640, 1100)`,高 = `clamp(round(workArea.height * 0.8), 480, 900)`,
  两者都再收进 `workArea − 2×MARGIN`(小屏上不会比工作区还大);
- 基准位 = 工作区**右上角**内缩 `MARGIN`(24) —— 主窗默认 1360 宽偏左,右上角冲突最小;
- 第 `index` 扇按 `28px` 向左下错开,`index % 6` 回绕(G4);
- 最后整体 clamp 回 workArea,保证任何 index 都不会跑出屏幕。

`index` = 当前已存活的 host 数。关掉一扇再开会复用腾出来的槽位,这是有意的:槽位是"错开",不是身份。

## #5 接进去的地方

| 位置 | 原本 | 现在 |
|------|------|------|
| `maestro/windows/window.helper.ts` | 窗口 `did-finish-load` 后 `openDevTools` | `openAnchoredDevTools(win.webContents, …)`;`isDevToolsAnchor = true` 的那一个(主窗)在 `create()` 里 `setDevToolsAnchor(win)` |
| `maestro/windows/main/maestroControlView.service.ts` | 同上 | 同上,标题 `Maestro control` |
| `maestro/windows/main/maestroWorkbenchView.service.ts` | 同上 | 同上,标题 `Maestro workbench` |
| `maestro/windows/main/maestroBrowserView.service.ts` `openOperationDevTools()` | `isDevToolsOpened()` 去重 | 交给映射去重,标题 `Maestro operation` |
| `maestro/windows/main/maestroBrowserView.service.ts` `openPinnedHomeDevTools()` | 同上 | 同上,标题 `Maestro home` |

标题:host 窗默认会被 DevTools 页面标题覆盖成 `DevTools`(实测),所以 `page-title-updated` 一律
`preventDefault()` 再 `setTitle('DevTools — <surface>')` —— 五扇 DevTools 同时开着时,这是唯一能一眼
分清谁是谁的东西。

## #6 验证

- `tests/maestro/devtoolsPlacement.test.mjs` —— 落位函数的判据(在工作区内、随 index 错开、小屏不溢出、
  回绕)。
- `yarn typecheck`。
- **人工**:debug 模式下双屏 + 多桌面启动 Maestro,看 sqlite 宿主窗与四个 view 的 DevTools 是否都在主窗
  那块屏、那个桌面;把主窗拖到另一个桌面,看 DevTools 是否跟着。这一条 agent 侧没跑 —— 按仓规
  Electron 端到端不自行启动。
