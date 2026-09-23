# `ui_act` 在后台 tab 上：每步光标卡 5 秒，点击无效，还报 ok

Status: root cause located (2026-09-23), fix not started

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
3. **按下和松开也没生效。** 在隐藏 view 上点，页面上的按钮没有反应，前台点同一个按钮立刻就下载。
   这一条属于推断：还没做「先激活再点」的对照实验。
4. **没有看门狗。** 工具每 15 秒只记一条 `pending`，没有超时，也不中止，所以 agent 只能干等。
5. **`ok:true` 不检查点击有没有效果。** `ui_act` 的 ok 只表示 CDP 收下了事件。agent 拿到 ok
   就当完成，5 秒后结束了这一轮。结果就是报告「已导出」，其实没有任何文件。

### 同一轮排查顺带查到的（不是这次点击失败的原因）

- **18:35 那一次停住，是 dev 进程退出了。** `dev parent 12875 is gone — quitting`
  （10:35:23），10:36:36 才重新起来；这一轮 agent 是被杀掉的。之后到 10:50 都没有 HMR 或重启。
- **刷新页面会让快照世代号清零。** 18:34:55 左右刷新之后，快照又从 `s1` 开始编号，因为计数器存在页面里。
  刷新前拿到的 `s1` ref 在刷新后也能通过世代校验。

## Fix direction（待定，修之前先对照实验）

1. **对照实验：** 先把发票 tab 切到前台，再让 agent 点同一个按钮。点击生效就证实第 3 条。
2. `ui_act` 操作的 tab 不在前台时，先激活它；或者 agent 开出的弹窗在它要操作时带到前台。
3. 光标轨迹：第一个 `mouseMoved` 超过约 300 ms 就放弃轨迹、直接跳到目标，整次点击设一个上限。
4. 点击后检查效果：没有下载、跳转，DOM 也没变化时，返回里写一条 NOTE。
5. 工具级看门狗：pending 超过约 60 秒就中止，并给出能换路的错误。
6. 世代号改成主进程维护，不随页面刷新清零。
