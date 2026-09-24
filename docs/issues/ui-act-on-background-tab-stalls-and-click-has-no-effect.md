# `ui_act` 在后台 tab 上：每步光标卡 5 秒，点击无效，还报 ok

Status: root cause confirmed (2026-09-23, 对照实验见下) · 2026-09-24:P1-2 不做(Ral),P1-1 待对照实验 2

Paired with micromeet-cowork：`projects/micromeet-cowork/docs/issues/ui-act-on-background-tab-stalls-and-click-has-no-effect.md`
（报告和实测都在 Cowork 那边。本仓 `maestroBrowserView.service.ts` `openTabWithUrl` 对 agent 弹窗同样只调 `applyBounds` 不激活，`drive/humanMouse.ts` 同源，所以同一条路径在这里也会发作，但还没有实测。下面的实测数据全部来自 Cowork。）

## Report

Ral 2026-09-23：在 Cowork 里让 agent「导出 ChatGPT 9 月份的账单」。agent 点「Download invoice」时，
光标看起来点到了位，但没有下载；工具停了 2–3 分钟，agent 也不自救，最后报告完成。

证据（`COWORK_TEST_DEBUG`）：

- 会话 `agent-io/20260923183332504-7xgv62ltipjmudyt9ar`、`agent-io/20260923184454562-1pd5jqlnhojmudz7vks`
- `logs/main-2026-09-23.log` 里的 `cowork:browser-operation`，每一次 CDP 调用都带耗时

| 次数 | tab | 点击 `ui_act` 耗时 | 每个 `mouseMoved` | press / release | 有没有下载 |
|---|---|---|---|---|---|
| 1（10:38:32） | `tab-mudyx7fj-2`（后台） | 181 024 ms | 5002–5047 ms | 2 ms / 4 ms | 没有 |
| 2（10:45:30） | `tab-mudyx7fj-3`（后台） | 144 630 ms | 5002–5015 ms | 2 ms / 1 ms | 没有 |
| 人工（10:48:28 / 10:48:37） | 同一页，已在前台 | — | — | — | `Invoice-0CSZ9QB2-0007 (1).pdf`、`Receipt-… (1).pdf` |

同一套坐标换算前一步在**前台** tab 上点 e60（「Open invoice from September 17, 2026」），点击生效了、开出了发票页。
所以像素偏差可以排除。

## Root cause

1. **agent 开出的弹窗 tab 从不显示。** Cowork `browser.controller.ts` `openTabWithUrl`（本仓 `maestroBrowserView.service.ts` 同形）：带 `agentSessionId`
   且没有 `show` 时只调 `applyBounds`，不走 `activateTab`，view 从没 `setVisible(true)`。
   `agentBrowserSession.run()` 只绑定、标成受控，也不激活。于是 agent 在一个看不见的 view 上
   `page_snapshot` + `ui_act`，而人看到的前台还停在 ChatGPT 页。
2. **看不见的 view 上 `mouseMoved` 每次要约 5 秒才回。** 这个时间不是我们设的：`humanMouse.ts` 的
   `sendCommand` 没有超时。推断：隐藏 view 不出帧，而 `mouseMoved` 要等帧才分发，最后由 Chromium 兜底放行。
   `mousePressed` / `mouseReleased` 不等帧，所以 1–2 ms 就回。一条轨迹 30–40 个点 ⇒ 145–181 秒。
3. **按下和松开也没生效。** 在隐藏 view 上点，页面上的按钮没有反应；先切到前台再点同一个按钮，立刻就下载。
   已由下面的对照实验证实。
4. **没有看门狗。** 工具每 15 秒只记一条 `pending`，没有超时，也不中止，所以 agent 只能干等。
5. **`ok:true` 不检查点击有没有效果。** `ui_act` 的 ok 只表示 CDP 收下了事件。agent 拿到 ok
   就当完成，5 秒后结束了这一轮。结果就是报告「已导出」，其实没有任何文件。

### 同一轮排查顺带查到的（不是这次点击失败的原因）

- **18:35 那一次停住，是 dev 进程退出了。** `dev parent 12875 is gone — quitting`
  （10:35:23），10:36:36 才重新起来；这一轮 agent 是被杀掉的。之后到 10:50 都没有 HMR 或重启。
- **刷新页面会让快照世代号清零。** 18:34:55 左右刷新之后，快照又从 `s1` 开始编号，因为计数器存在页面里。
  刷新前拿到的 `s1` ref 在刷新后也能通过世代校验。

## 对照实验（2026-09-23，会话 `agent-io/20260923185328086-kit7zd7fwnmudzivt8`）

这一次 agent 在点「Download invoice」之前自己先调了 `activate_tab`，正好构成对照：

| 点击 | tab 状态 | `ui_act` 总耗时 | 有没有 5 秒 `mouseMoved` | 下载 |
|---|---|---|---|---|
| 10:54:30 Download invoice（0007） | 已激活 | 2 215 ms | 没有 | 10:54:37 `Invoice-0CSZ9QB2-0007 (2).pdf` |
| 10:55:52 Download receipt | 已激活 | 1 616 ms | 没有 | 10:56:02 `Receipt-2048-7483-8728 (2).pdf` |
| 11:01:20 Download invoice（0006） | 已激活 | 6 773 ms | 没有 | 11:01:26 `Invoice-0CSZ9QB2-0006.pdf` |

三次都是真实的 CDP 鼠标事件（`Input.dispatchMouseEvent` 的 pressed/released），不是 JS `click()`，
也不是读出链接后直接跳转。「Download invoice」本身就是没有 href 的 `<button>`。
同一个按钮，后台点击无效，切到前台点击生效，所以根因 1–3 成立。

## Fix direction

1. `ui_act` 操作的 tab 不在前台时，先激活它；或者 agent 开出的弹窗在它要操作时带到前台。
2. 光标轨迹：第一个 `mouseMoved` 超过约 300 ms 就放弃轨迹、直接跳到目标，整次点击设一个上限。
3. 点击后检查效果：没有下载、跳转，DOM 也没变化时，返回里写一条 NOTE。
4. 工具级看门狗：pending 超过约 60 秒就中止，并给出能换路的错误。
5. 世代号改成主进程维护，不随页面刷新清零。

## 2026-09-24 决定与补充

### 已定(Ral 2026-09-24)

| 项 | 结论 |
|---|---|
| **P1-2 卡顿上限** | **不做**(Ral 2026-09-24:「P1-2 不做，先不要做了」)。下面「P1-2 契约」「P1-2 风险评估」只作留档，没有任务。最初的提议原话：Ral:「这批下载和 wait 做完后，先做 P1-2:第一步移动超过约 300 毫秒就放弃轨迹，单次操作超过约 60 秒就中止并报错。不管 P1-1 最后怎么修，都能把损失从几分钟压到几秒。」 |
| **P1-1 点击无效怎么修** | 先做对照实验(下面「对照实验 2」),实验里**同时测 hover**;看结果再决定要不要在操作前显示 tab(那会和 `show`「用户明确要看才显示」的语义冲突)。 |

### 补充：关键在「显示过没有」,不在「激活没有」

- 9-24 反例(会话 `n6kpen…`,日志 UTC 01:38:38):显式打到 `tab-mudyx7fj-7`,它不在前台(`active:false`),人切走时 view 会被 `setVisible(false)`
  (Cowork `browser.controller.ts:1567`;本仓对应的切换逻辑同形)。但这次整段光标移动只用了 984 ms,按下 2 ms、松开 10 ms,6 秒后下载落地。
  它是应用 01:36:53 重启后恢复的旧 tab;失败的两次都是 agent 点出来、**从未显示过**的弹窗。差别在哪还没查明。
- 不带 `show` 的 `activate_tab` 只改会话的默认目标，不会让页面开始渲染，对这个问题没有作用。
- **hover 也受影响，但分两层：**
  - **慢是确定的。** hover 与点击走同一条拟人光标轨迹，只是停在按下之前(BL `replayEngine.ts` 注释原话："the same … human pointer path as a click,
    stopping short of the press";Cowork 同)。从未显示过的 tab 上每个移动点约 5 秒，一条轨迹 36–40 个点，所以一次 hover 也要 2–3 分钟。
  - **能不能生效没验证。** 那 5 秒是 Chromium 的兜底计时器，到点后移动事件还是会派发，页面理论上最终能收到移动并触发悬停效果;
    但同样的 tab 上点击的按下 / 松开都发出去了却没生效，原因未明。所以 hover 会不会同样白做，现在说不准。
- **修好之前的已知绕行:** 对 agent 点出来的弹窗，hover 和点击一样，先 `activate_tab {tab_id, show:"true"}`(9-23 kit7zd 三次点击都这样成功)。
  这只是记录已知可行的做法;要不要让 agent 默认这么做，属于 P1-1 的决定，等实验。

### P1-2 契约

| 件 | 行为 |
|---|---|
| **光标降级**(`drive/humanMouse.ts`,两仓同形) | 轨迹的**第一个** `mouseMoved` 若 CDP 往返超过 **300 ms**(`FIRST_MOVE_SLOW_MS`),放弃剩下的轨迹点，只再发**一个**落在目标点的 `mouseMoved`,然后照常按下 / 松开(hover 到此为止)。最坏情况从 36–40 × 5 s 降到 2 × 5 s。 |
| **单个动作看门狗**(`drive/replayEngine.ts`) | 每个 `ui_act` 动作(定位 → 移动 → 按下 / 松开或页内执行)从开始算，超过 **60 s**(`UI_ACTION_WATCHDOG_MS`)就不再等:这一项记为 `fault: 'timeout'`,整批停下，后面的动作不执行。卡住的那次 CDP 调用晚些时候返回也忽略，不再落地任何动作。 |
| **报给 agent** | 看门狗走现有的 fault 通道(`toolUiAct` 对 `fault` 返回 `ERROR:` 字符串):`ERROR: ui_act could not run in the page (timeout) — the action did not finish within 60s; the tab is not responding (e.g. an agent-opened tab that was never shown). Observe again (list_tabs / page_snapshot) and decide on a different path.` 光标降级不改 `ok`,只在结果末尾加一行 `NOTE: pointer trajectory skipped — the first pointer move took <n>s, so this tab is not rendering frames (likely an agent-opened tab that was never shown); the action may not take effect.` |
| **诊断** | 降级和看门狗各记一条诊断事件(本仓 maestro 的 browser-operation 诊断;Cowork 是 `cowork:browser-operation`),带耗时。 |
| **常量可注入** | 两个阈值导出为常量，测试里注入小值，不真等 5 s / 60 s。 |

验收：单测用假的 `debugger.sendCommand`(让 `mouseMoved` 变慢)覆盖：首个移动变慢 → 只剩一次跳点、结果带 NOTE;某一步永不返回 → 60 s(注入值)后
`ERROR: … (timeout)` 且后续动作未执行;正常 tab 上轨迹不变(回归)。两边 typecheck。不跑 E2E。真实会话验收待 Ral:在从未显示过的弹窗上点一次，`ui_act` 应在约 10 秒内返回并带 NOTE。

任务(暂未拆,P1-2 暂缓):bitterless `ui-act-stall-cap-198` → micromeet-cowork `ui-act-stall-cap-001`。

### 对照实验 2(P1-1 的前提;要在真实应用里做)

同一个页面、同一个按钮、同一个悬停才出现的菜单，在三种 tab 上各做一次**点击**和一次**悬停**:

| tab 类型 | 怎么得到 |
|---|---|
| A. 从未显示的 agent 弹窗 | agent 点一个会开新 tab 的链接，不 `activate_tab` |
| B. 显示过、再被切走 | `activate_tab {show:"true"}` 后切到别的 tab |
| C. 重启后恢复、重启后没显示过 | 应用重启，不点它 |

每格记：`ui_act` 总耗时、每个 `mouseMoved` 的耗时(`cowork:browser-operation` 日志)、效果(点击：有没有下载 NOTE / 文件;悬停：紧接着 `page_snapshot` 里菜单项在不在)。
一次实验同时回答「点击为什么无效」和「hover 能不能生效」,以及关键变量是不是「从未显示过」。

**要人做或授权:** 这需要启动真实应用、让 agent 真实操作(相当于 Electron E2E),按仓库规则 agent 不能自行启动。

### P1-2 风险评估(2026-09-24)

**它换来什么：** 在从未显示过的 tab 上，一次点击 / 悬停从 145–182 秒的静默卡顿，变成约 10 秒(两次慢移动)加一行说明;看门狗兜住其它未知的卡死。
**它不换来什么：** 点击照样不生效 —— 那是 P1-1。只要 P1-1 修好(这类 tab 能正常出帧),光标降级基本不会再触发。

| 部件 | 会不会影响别的操作 | 依据 |
|---|---|---|
| 光标降级，阈值 300 ms | **有误判风险。** 可见 tab 上页面忙(长任务、正在加载、GC)时，第一个移动也可能超过 300 ms;误判后指针直接跳到目标：点击本身照常(Playwright 默认就是一步到位),但**沿途的悬停丢了** —— 靠经过父菜单才能展开的多级菜单打不开，这正是当初加轨迹要解决的问题(`cdp-mouse-teleports-no-trajectory.md`),也少了拟人移动 | 移动点是「安静」阶段，快的时候不记日志，所以正常 tab 上单个移动的耗时分布**测不到**;只知道 9-24 那次约 40 个点共 984 ms。9-23 卡住那次点击时页面还在 `loading=true` |
| 光标降级，更保守的写法 | **风险很低**:只在「tab 此刻不可见 **且** 第一个移动 ≥ 1.5 s」时降级。病态值是 3.4–5.0 s,1.5 s 仍有余量;人眼前的 tab 永远不降级 | 同上 |
| 看门狗 60 s | **不会误杀正常动作。** 页内步骤的等待都有上限(找元素 ≤ 6 s,原生下拉 ≤ 3 s,自定义下拉有截止时间);`fill` 直接赋值，不逐字输入;BJ3 的人工确认在动作之前，不在看门狗里 | `drive/inject/browserStepRunner.inject.ts` |
| 看门狗和 Ral 的超时原则 | **不冲突。** Ral 2026-09-18:「我们工具调用不该设置超时，如果工具自己内部超时报错，我们捕获并提示才对」——这是工具自己的超时，不是宿主墙钟。9-22「回合没有超时」管的是回合 | `agent/BaseAgent.ts` 注释;`turn.service.ts` 注释 |
| 看门狗的真实风险 | **报了超时，动作可能晚到。** 卡住的那次 CDP 调用之后仍可能送达;agent 若照原样重试，可能重复提交。报错里要写「可能仍会生效，先观察再决定」,并停掉整批 | 从未显示过的 tab 上按下 / 松开根本不生效(9-23),但别的卡法(如原生 `alert` 挡住页面)可能晚到 |
| 后台节流 | **不是原因**(新排除的假设):9-23 卡住的两次、kit7zd 成功的三次、9-24 正常的一次，日志里 `backgroundThrottling` 全是 `false` | `cowork:browser-operation` 日志的 pageState |

**结论：** 有用，但不是非做不可;它只把失败变快，不让失败变成功。要做的话，光标降级用保守写法(不可见 + ≥ 1.5 s),看门狗照原提议但报错写明「可能仍会生效」。
也可以先做对照实验 2:如果 P1-1 能很快修掉根因，光标降级就不必做，只留看门狗兜底。
