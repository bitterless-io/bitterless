# Control 面板的 DevTools 在 dev 下没打开

- 报告：Ral 2026-09-22「cowork control 进程 dev 时没有打开 devtools」（本仓为配对同步，同一套机制）
- 状态：**已修**——自托管落位整套撤回（Ral 当天追加：「devtool 要控制屏幕和位置的功能都去掉吧，会影响实际使用」），判据统一到一个闸

## 先说已经排除掉的

用 cowork 自己的 Electron **40.4.1** 跑了两个最小复现（`WebContentsView` + 自托管 DevTools），
照 `openAnchoredDevTools` 的原样序列：

| 复现 | 结果 |
| --- | --- |
| 单个 `WebContentsView` 自托管 | host 窗可见、`host.webContents.getURL()` = `devtools://devtools/bundled/devtools_app.html…`，成功 |
| 主窗 + 子 view **同时**各自托管 | 两扇都成功，窗口数 3，位置按 index 错开 |

所以这三条**不是**原因：

- `setDevToolsWebContents` 在 40.4.1 上失效 —— 没有，正常；
- 同时只允许一份自托管 DevTools —— 没有这回事，两份并存；
- `WebContentsView`（而不是 `BrowserWindow`）不支持自托管 —— 支持。

顺带确认 `target.isDevToolsOpened()` 自托管之后**恒为 `false`**，与
`devtoolsAnchor.service.ts` 注释里写的一致 —— 任何调用点都不能拿它当去重闸。

另外核对过：`is.dev` = `!app.isPackaged`（`@electron-toolkit/utils`），dev 下为真；
两仓的 `devtoolsAnchor.service.ts` 逻辑**逐行相同**（只有注释与 windowState 取法不同）；
control view 只 `create()` 一次，没有任何代码关掉或重建它的 DevTools。

## 真正查出来的缺陷：四个闸，互不相认

| 表面 | 闸 | `COACH_OPEN_DEVTOOLS=0` 能关掉吗 | `COACH_DEMO_SMOKE_OUT` 呢 |
| --- | --- | :-: | :-: |
| `blBaseWindow`（主窗等） | `shouldOpenDevTools()` | ✅ | ✅ |
| workbench | `is.dev \|\| COACH_WORKBENCH_DEVTOOLS=1 \|\| COACH_DEVTOOLS=1 \|\| COACH_OPEN_DEVTOOLS=1` | ❌ | ❌ |
| **control 面板** | `is.dev \|\| COACH_DEVTOOLS=1` | ❌ | ❌ |
| operation | `COACH_DEVTOOLS === '1'`（默认关） | — | ❌ |

四个闸只有第一个认关闭开关，其余三个都只看 `=== '1'`，而 `is.dev` 又排在最前面短路掉了 ——
**所以任何 `=0` 在 dev 下都是空操作**。E2E fixture 明明设了
`COACH_OPEN_DEVTOOLS=0` / `COACH_WORKBENCH_DEVTOOLS=0` / `COACH_DEVTOOLS=0`，
control 与 workbench 的 DevTools 每轮 E2E 照开不误 —— 与那份 fixture 的意图正相反。

这条本身不解释 Ral 的症状（他的症状是"该开没开"，不是"该关没关"），但它意味着
**现在没有任何一个开关能可靠地描述"这个表面到底开不开"**，排查也就无从下手。

## 改了什么

### 1. 自托管 + 落位整套撤回

Ral 2026-09-22 追加：「devtool 要控制屏幕和位置的功能都去掉吧，会影响实际使用」。

删掉 `devtoolsAnchor.service.ts`、`devtoolsPlacement.ts` 与 `devtoolsPlacement.test.mjs`（两仓各一份；本仓在 `src/main/maestro/windows/`），
所有调用点回到 Electron 自己的 `openDevTools({ mode: 'detach', activate: false })`，位置由 Electron 决定。
`window.helper.ts` 的 `isDevToolsAnchor` 标志一并删除。

**顺带解决了本条的症状**：自托管的 host 窗从一个角落按固定步长（28px）错开，几扇同时开时会互相压住，
而「谁在上面」不可控——面板那扇被压在底下，看起来就是「没打开」。撤回之后 DevTools 回到 Electron
自己的窗口管理，不再有这个叠放问题。

**副作用（正面）**：`isDevToolsOpened()` 恢复可用。自托管期间它恒为 `false`，所有调用点都被迫
拿掉这道闸、改由 `hosts` 映射去重；现在它重新是正确的去重方式，调用点各自判即可。

### 2. 一个闸

新增 `devtoolsGate.ts`（本仓 `src/main/maestro/windows/devtoolsGate.ts`），`shouldOpenDevTools(surface)` 是唯一判据：关闭开关
（`COACH_OPEN_DEVTOOLS=0` / `COACH_DEVTOOLS=0` / `COACH_DEMO_SMOKE_OUT`）对**每个**表面都生效、
且**排在强制打开之前**；per-surface 的 `=1`（如 `COACH_WORKBENCH_DEVTOOLS`）只能在默认关的时候
单独打开某一个，不能反过来绕开关闭开关。五个表面（cowork: window / control / workbench / operation / zellij；bitterless: window / control / workbench / operation / home）
全部改走它，各自的判据函数删除。`operation` 保持默认**关**（它被 `debugger.attach()` 接管，
DevTools 一挂会跟 capture 抢，且 ai-crms 的 SPA 重渲染会闪）。

### 3. 守卫

`check-devtools-debug.mjs` 重写了 DevTools 那一段（本仓在 `scripts/maestro/`，它是**真的执行**那份判据的，改成按 surface 传参）：闸存在且唯一、关闭开关齐全且排在强制打开之前、
五个表面都问同一个闸、没有表面自建判据、自托管模块保持删除、没有调用点把 `openAnchoredDevTools`
写回来、`detach + activate:false`、用 `isDevToolsOpened()` 去重。**红灯验证过**——把关闭开关排到
`=1` 之后、或把自托管调用写回去，各判红一条。

顺带修好了这个守卫里一条**与本次无关的陈旧断言**：它要求 `ControlApp.vue` 里出现
`xpcRenderer.subscribe('cowork/agent-activity'`，而订阅早就改走 `subscriptions` 句柄了
（重复订阅那次改造）。断言在 HEAD 上就是红的，整个守卫因此跑不完——顺手改成钉「订阅了这两条频道」
而不是「用哪个门面订的」。

## 复现脚本留档

两个最小复现（`WebContentsView` + 自托管 DevTools、主窗与子 view 同时各自托管）在 Electron 40.4.1
上**都成功**——所以当时排除掉的三条结论仍然成立，它们不是原因。真正的原因是叠放，而不是机制失效。
如果将来有人要重做落位，先解决「谁在上面」这一条，不要从复制那份实现开始。
