# DevTools 跟着主窗走

> ## ⛔ 已撤回（2026-09-22）
>
> Ral：「devtool 要控制屏幕和位置的功能都去掉吧，会影响实际使用」。
>
> **整个自托管 + 落位机制已删除**：`devtoolsAnchor.service.ts`、`devtoolsPlacement.ts`
> 与对应守卫都不在树上了；所有调用点回到 Electron 自己的
> `openDevTools({ mode: 'detach', activate: false })`，位置由 Electron 决定。
>
> 保留这份文档是为了**不要再被重新提出来**：下面记的目标与判据都成立过，代价也都测过，
> 但实机上不好用——自托管的 host 窗从一个角落按固定步长错开，几扇同时开时会互相压住，
> 而「谁在上面」不可控。要重做的话，先解决这一条，不要从复制这份实现开始。
>
> 只有一件事留了下来，并且是独立的：**谁开不开** DevTools 的判据统一到了
> `devtoolsGate.ts`（原来四份互不相认，任何关闭开关在 dev 下都是空操作）。
> 见 `docs/issues/control-devtools-do-not-open-in-dev.md`。

Status: **implemented — G3(同一个 Space)已于 2026-09-22 放弃,其余保留;默认开启,见 #7**。(原需求 2026-09-21,Ral:「agent browser 增加功能,启动后需要将在
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
| ~~G3~~ | ~~macOS 多桌面下与主窗同一个 Space~~ | **2026-09-22 放弃**(#7):唯一实现 `setParentWindow` 会让 DevTools 随主窗移动、压在主窗上面、且自己不能被拖走 |
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

代价说清楚,而且**当初没写全** —— 这正是 2026-09-22 把 G3 整条放弃的原因(见 #7):子窗不只是
**永远盖在父窗上面**,它还**随父窗一起移动**、并且**自己不能被拖走**。调试时第一条通常还能接受
(一边操作主窗一边看 console),后两条不行 —— DevTools 成了焊在主窗上、位置不可调的挡板。

**所以下面那张表的结论已经反转:`setParentWindow` 不再被采用。** 现在只按
`screen.getDisplayMatching(主窗 bounds)` 落位,拿到 G1/G2,放弃 G3。整条路仍然**默认开启**
(`COACH_DEVTOOLS_ANCHOR=0` 退回 Electron 内置行为)。

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
- 基准位 = 工作区**左下角**内缩 `MARGIN`(24)(Ral 2026-09-22:「将 devtool 窗口默认配置到屏幕
  左下角打开」);
- 第 `index` 扇按 `28px` 向**右上**错开,`index % 6` 回绕(G4)。方向跟着基准位走:从左下往左/往下
  错会立刻撞到工作区边缘、被 clamp 压成同一个位置,G4 就名存实亡;
- 最后整体 clamp 回 workArea,保证任何 index 都不会跑出屏幕。

`index` = 当前已存活的 host 数。关掉一扇再开会复用腾出来的槽位,这是有意的:槽位是"错开",不是身份。

### #4.1 这是角落偏好,不是避让算法

上一版基准位取右上角,写的理由是「主窗默认 1360 宽偏左,右上角冲突最小」—— **实机不成立**,
Ral 2026-09-22 报的正是它照样压在主窗上。改成左下角是他点名的固定偏好。

但要说清楚:**会不会盖住主窗,取决于主窗此刻多宽、摆在哪**。1512×920 的工作区上第一扇是
`x=24, y=185, 680×736`(右边缘 704),主窗若是默认 1360 宽、靠左,仍然会重叠。真要保证不重叠,
得读主窗几何再挑空位 —— 那是另一件事,这一版没做。

## #5 接进去的地方

| 位置 | 原本 | 现在 |
|------|------|------|
| `maestro/windows/window.helper.ts` | 窗口 `did-finish-load` 后 `openDevTools` | `openAnchoredDevTools(win.webContents, …)`;`isDevToolsAnchor = true` 的那一个(主窗)在 `create()` 里 `setDevToolsAnchor(win)` |
| `maestro/windows/main/maestroControlView.service.ts` | 同上 | 同上,标题 `Maestro control` |
| `maestro/windows/main/maestroWorkbenchView.service.ts` | 同上 | 同上,标题 `Maestro workbench` |
| `maestro/windows/main/maestroBrowserView.service.ts` `openOperationDevTools()` | `isDevToolsOpened()` 去重 | 交给映射去重,标题 `Maestro operation` |
| `maestro/windows/main/maestroBrowserView.service.ts` `openPinnedHomeDevTools()` | 同上 | 同上,标题 `Maestro home` |

**只有上表这五个入口被锚定。** 其余 11 处 `openDevTools({ mode: 'detach' })`(zellij、onlypreview、
omni、todo、submodules、eyesOnAgents、llama、pluginTest)仍然走 Electron 自己的落位,不受 #4 影响 ——
它们要不要一起接进来,是一个没问过的问题。

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

## #7 G3 撤回、其余保留(Ral 2026-09-22,两次往返)

**第一次**(撤回整条路):

> devtool 看起来是独立窗口,但是拖动主窗口时会和主窗口一起被拖动,devtool 窗口覆盖到主窗口上了,
> devtool 自己不能被拖动,我想了下,干脆先取消我提的 devtool 和主窗口得在一个屏幕的需求

这不是实现跑偏,是 **#2 那条已知代价在真机上的完整形状**。文档当时只写了「子窗永远盖在父窗上面」,
漏了更要命的另外两条:macOS 的子窗**随父窗一起移动**,而且**自己不能被拖走**。三条加起来,
DevTools 成了焊在主窗上、位置不可调的挡板 —— 对调试是净负担。

**第二次**(选了折中):

> 可以做: 如果你还是想要「和主窗同一块显示器」,有个没试过的中间方案:不 parent,只按
> `screen.getDisplayMatching`

于是定案:**G1 / G2 / G4 保留,G3 放弃。**

| 目标 | 现在 | 说明 |
|---|---|---|
| G1 主窗之后开的 DevTools 落在主窗那块屏 | ✅ | `placeHost` 按 `screen.getDisplayMatching(主窗 bounds).workArea` 落位 |
| G2 主窗之前开的也落在主窗那块屏 | ✅ | 先用 `windowState` 记住的几何猜,主窗就位后 `placeAll()` 补排一次 |
| G3 macOS 多桌面下与主窗同一个 Space | ❌ **放弃** | 唯一实现是 `setParentWindow`,而它换来的正是上面那三条代价 |
| G4 多扇不完全重叠 | ✅ | 不变 |
| G5 不抢焦点 | ✅ | 仍是 `detach` + `activate: false` + `showInactive()` |
| G6 关掉 DevTools 窗 = 关掉 DevTools | ✅ | 不变 |

落点两处,每仓一处:`placeHost` 去掉 `setParentWindow` 那一句(只留 `setBounds`),
`isAnchored()` 从 `=== '1'` 改回 `!== '0'`(第一次撤回时把它关成了 opt-in,折中方案成立后恢复默认开)。

**落位只发生在开的那一刻**(以及主窗就位后补排一次)。**刻意不监听主窗的 `move`** —— 跟着主窗跑
就又回到「拖主窗时 DevTools 一起动」,那正是被否掉的那个行为。

### #7.1 防回归

`setParentWindow` 是 G3 唯一的实现方式,所以它**非常容易被再次加回来** —— 这条回归已经发生过一次
(2026-09-21 报、2026-09-22 再报)。`devtoolsPlacement.test.mjs` 因此多了一条**源码断言**:

- `devtoolsAnchor.service.ts` 的代码(去掉注释之后)里不许出现 `setParentWindow` 或
  `setVisibleOnAllWorkspaces`;
- 同时钉住 `host.setBounds(devToolsHostBounds(` 还在 —— 否则把落位一起删掉也能让上一条通过;
- 以及不许 `.on('move'` / `.on('moved'`。

读源码而不是跑 Electron:整条锚定逻辑的行为要真实窗口才能观察,单测里没有窗口。
要找回 Space 这一层,要找的是**一条不牺牲可拖动性的绑定方式**,不是把那一行加回来。
