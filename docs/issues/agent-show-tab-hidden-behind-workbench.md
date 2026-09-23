# agent 说「给你看」时把 tab 切到了 Workbench 底下 —— 人什么都没看到

- **报告**：Ral 2026-09-23 ——「发现 bug 就是 active tab tool 没有生效。并没有成功切换到需要看的
  tab 上，把 root cause 发我并修复。」（附截图：Workbench 在前台，聊天里 agent 正在 tab-8 上操作）
- **状态**：根因已定（证据 + 源码逐行），修复见文末「修复契约」
- **证据**：BL Preview 会话 `2n6mbjo9h5hmudg8q41`，pi 会话文件
  `~/Library/Application Support/Bitterless_PREVIEW/.pi/chat-sessions/3387b432….jsonl` 第 51–80 行

## 现场

用户原话：「打开 type safe 的页面，然后**让我看一下**它的充值方式是什么。」

| 行 | 发生了什么 |
| --- | --- |
| 52 | 模型调 `activate_tab {"tab_id":"tab-8","show":"true"}` —— **判断是对的**：用户明说了要看，`show` 也传了 |
| 53 | 工具返回的 tab 列表里 **tab-8 `active: true`** |
| 54–79 | 在 tab-8 上 `page_snapshot` / `ui_act` 一路点到 Billing → 充值方式 |
| 80 | 模型回复「已打开 TypeSafe 的充值页面，**现在可以看到**：……」 |
| 截图 | 前台是 **Workbench**（`bitterless://workbench`，Settings › Proxy），TypeSafe 那一页人根本没看见 |

所以**不是模型没调、也不是 `show` 没传到** —— `"true"` 这个字符串也被 `args.show === 'true'` 接住了。
tab-8 确实被激活了，只是激活在了 Workbench **底下**。

## 根因

**Workbench 是一个前台 VIEW，不是 `OperationTab`；`activateTab()` 不会把它收起来。** 这一点代码
自己写着（`maestroBrowserView.service.ts` 接口里 `backgroundWorkbenchTab()` 的注释）：

> Needed here because the Workbench is a foreground VIEW rather than an `OperationTab`: activating a tab
> does not hide it, so anything in this file that brings a tab forward on its own … has to say so
> explicitly, the way `newTab()` already does.

规矩是「谁要把 tab 带到人眼前，谁自己先把 Workbench 退到后台」。**人走的每条路都守了**，
**agent / 宿主走的三条路一条都没守**：

| 入口 | 先退 Workbench？ |
| --- | --- |
| 人点 tab chip（`MenuBar.onTabClick`） | ✅ `workbenchStore.background()` → `activate` |
| 人点 `+` / 新建 tab（`newTab()`） | ✅ |
| 人从 `+` 菜单选 mini-app（`openCompositeTabFromMenu`） | ✅ |
| 打开文件预览（`openFilePreviewTab`） | ✅ |
| **agent `activate_tab {show:true}`** | ❌ 直接 `activateTab` ← 本次现场 |
| **agent `open_tab {show:true}`** | ❌ `openAgentTab` 里 `if (show) activateTab` |
| **聊天里「查看这个 tab」（`showAgentBrowserTab`）** | ❌ 直接 `activateTab` |

三条漏掉的路恰好是「**用户明确要求看**」时才走的那几条 —— 于是这个缺陷只在最需要它生效的时候出现。

### 为什么它藏得住

1. **工具结果说谎。** `activate_tab` 返回的 `active: true` 描述的是 tab 模型，不是屏幕。模型据此告诉
   用户「现在可以看到」，而用户看到的是 Workbench。
2. **`showAgentBrowserTab` 的自检也看不见它**：它校验的是 `activeTabId === tabId`，这一条在 Workbench
   盖着的时候照样成立，于是报 `ok: true`。
3. **只在 Workbench 开着时复现。** 平时 Workbench 不在前台，`activateTab` 就是可见的切换。

### 配对开发

micromeet-cowork 是同一套结构（`workbenchView.service.ts` + `browser.controller.ts`），三条路**同样漏了**：
`activate_tab` show 分支、`showAgentBrowserTab`、`openTabWithUrl` 的 `opts.show` 分支都直接 `activateTab`。
两仓一起修。

## 修复契约

**F1 · 一个「给人看」的入口，三条路都走它。** 控制器里加 `showTabToHuman(id)`：先
`workbenchView.backgroundTab()`，再 `activateTab` —— 与人点 tab chip **同一个顺序**。
`activate_tab` 的 show 分支与 `showAgentBrowserTab` 改走它；`open_tab` 的 show 分支在浏览器层
`activateTab` 之前补 `_state.backgroundWorkbenchTab()`（那一层拿不到控制器，走接口上现成的方法）。
`backgroundTab()` 在 Workbench 不可见时直接返回，所以无条件调用是安全的。

**不改 `activateTab()` 本身。** 它还被 drill、后台加载、回放等「不该把人从 Workbench 里拽出来」的
路径调用 —— 接口注释选择「逐个调用点显式声明」正是为了这个。本次只补漏掉的那三个声明。

**F2 · 自检要看屏幕，不只看模型。** `showAgentBrowserTab` 的校验补上「Workbench 不在前台」：
被盖住就是没显示成功，不许报 `ok: true`。

**F3 · 守卫。** 钉住三条路都经过「先退 Workbench」、顺序是先退后激活、以及自检包含 Workbench。
红检：任一条回退成直接 `activateTab` 必须转红。

## 落点

| 仓 | 文件 |
| --- | --- |
| bitterless | `main/maestro/windows/main/maestroWindow.controller.ts`（`showTabToHuman`、`activate_tab`、`showAgentBrowserTab`）· `maestroBrowserView.service.ts`（`openAgentTab` show 分支） |
| micromeet-cowork | `main/modules/window-manager/windows/main/mainWindow.controller.ts`（同上三处）· `main/modules/browser/browser.controller.ts`（`openTabWithUrl` show 分支） |

## 追加（同日，逐个调用点复查两仓之后）

### 与设计文档的冲突，以及怎么处理的

cowork `docs/features/workbench-tab.md` #5 写着「**agent / 钻探调 `activateTab` 不动 Workbench 的
前后台**」。本次修复让 agent 的 `show: true` 去退 Workbench，与它字面冲突，所以没有静默覆盖，而是
**在 #5 里加了一条例外**：

- #5 的理由是**钻探**：钻探一轮一轮地开关 tab，操作者常常盯着 Workbench 里的 Capture 面板看录制行
  落下来，每次激活都退 Workbench 会反复抢走视图。
- `show: true` 的语义是「仅当用户明确要求看」，一次请求只发生一次，不会反复抢；聊天里「查看这个 tab」
  本身就是操作者的点击。
- 修复**没动 `activateTab()` 本身**，钻探与 `show=false` 的激活照旧不碰 Workbench —— #5 保护的东西
  原样保留。

### 两仓逐个调用点复查的结果

| 路径 | bitterless | micromeet-cowork |
| --- | --- | --- |
| `activate_tab {show}` / `open_tab {show}` / 「查看这个 tab」 | ❌→✅ 本次修复 | ❌→✅ 本次修复 |
| **OnlyPreview 以 tab 挂载时的打开**（MCP `preview_open`、聊天工作区芯片） | ❌ `openWorkspaceInPreview → openCompositeTab → activateTab`，没退 → **补上** | ✅ 走 `mainWindow.newTab({kind:'miniapp'})`，而 `newTab()` 第一句就是退 Workbench —— **本来就对，不改** |
| **操作者开 app**（Workbench Apps 页「打开 OnlyPreview」、Zellij、Trench、OnlyPreview 窗口→tab） | ❌ 控制器 `openCompositeTab` 直接开，Workbench Apps 页那个按钮点了就开在 Workbench 底下 → **补上** | ✅ Workbench 页里没有开 tab 的按钮；开 mini-app 走 `newTab()` |
| 点 tab chip / 新建 tab / 文件预览 | ✅ | ✅ |
| 启动恢复、关 tab 后激活下一个、钻探、`rebuildTabView` | 不属于「要求看」，不该退 —— 不改 | 同左 |
