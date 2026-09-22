# 按下停止之后聊天永久卡在「Stopping…」—— 界面把自己的两个出口都关了，而 XPC 回执从 2026-08-31 起就被丢掉了

**报告日期**：2026-09-22（Ral：「用户反馈 stopping 的时候卡死」）。**状态**：fixed 2026-09-22
（回执缺陷按 `tsc` 诊断实证并修复；界面侧的期限与出口已实施并按源码核过）；owner testing pending。
**遗留一条待 Ral 拍板**，见 #5。

**配对**：`micromeet-cowork`（同名文档）。#2 / #4 两仓同形；**#3 是本仓独有的** ——
那边的 `cowork.handler.ts:457` 一直是原样返回的。

## 1. 症状

人在回合进行中按停止。状态条切到 `Stopping…`，然后**再也不动**：

* 停止按钮此刻是**禁用**的 —— [ChatPanel.vue:842](../../src/renderer/maestro/control/src/ChatPanel.vue:842)
  `:disabled="session.turn?.aborting && !session.turn?.stopError"`；
* 发送按钮此刻也是**禁用**的 —— 同文件 853 行同一条判据；
* 状态条永远显示 `Stopping…`，**不带计时**，所以「在清理」和「挂死了」在屏幕上长得一模一样。

这个会话从此只能看，不能用。换一个会话可以继续工作 —— 卡的是**单个会话**，不是整个应用。

## 2. 根因一：这一侧的等待没有上限，而唯一能解锁它的东西在另一侧

只有两件事能把 `session.turn` 清掉：

| 出口 | 代码 | 触发条件 |
| --- | --- | --- |
| 正回执 → `forceStop` | [turn.service.ts:803](../../src/renderer/maestro/control/src/store/turn.service.ts:803) | `coach.abortAgent` 返回 `{ ok: true }` |
| main 的 `finished` 广播 | `finishFromMain` → `forceStop` | main 侧 `finishAgentTurn(turn,'stopped')` |

**而这两件事都排在同一个 `await` 后面**
（[maestroAgent.service.ts:1564](../../src/main/agent/maestroAgent.service.ts:1564)）：

```ts
turn.abortOperation = Promise.resolve().then(async () => {
  const results = await Promise.allSettled([
    this.workflowHost?.stopSession({ sessionId: sessionKey }),
    this.getExistingMaestroAgent(params.sessionId)?.abort()
  ])
  ...
  this.finishAgentTurn(turn, 'stopped')     // ← 回执和广播都在这之后
```

本仓的 `BaseAgent.abort()` 是**有界**的（`Promise.race([session.abort(), sleep(1500)])`，
[BaseAgent.ts:732](../../src/main/agent/BaseAgent.ts:732)）—— 这一点和 `micromeet-cowork` 相反，
那边刻意无界。但 `workflowHost.stopSession` 那一支仍然要走完 worker 终止
（`supervisor.terminateUtility`：SIGTERM → 250ms 宽限 → SIGKILL → 5s 确认）加上每一个 attempt 的收尾。
也就是说：**这一侧完全不知道要等多久，而在它等待期间界面已经先把停止和发送都禁用了。**

第三条路也被自己堵上了：再按一次停止本来可以是出口，但

```ts
if (!session || session.archivedAt || !turn || (turn.aborting && !turn.stopError)) return
```

在 `aborting && !stopError` 时**直接 return**，按钮又正好是禁用的 —— 两道锁指向同一个状态。

## 3. 根因二（本仓独有）：XPC 回执被丢掉了，`tsc` 从 2026-08-31 起一直在报

[coach.handler.ts:305](../../src/main/maestro/xpc/coach.handler.ts:305)：

```ts
async abortAgent(params: { sessionId: string; turnId: string }): Promise<void> {
  await maestroWindowHelper.abortAgent(params)        // ← 返回值被扔了
}
```

而契约写的是 `abortAgent(...): Promise<{ ok: true }>`
（[coach.api.ts:117](../../src/shared/maestro/coach.api.ts:117)），renderer 也是照契约读的：

```ts
const reply = await coach.abortAgent({ sessionId: session.id, turnId: turn.id })
if (reply?.ok !== true) throw new Error(i18nHelper.workflow.stopError)
this.forceStop(session, turn.id)                      // ← 永远到不了
```

所以**一次成功的停止，在 renderer 看来永远是失败的**：`reply` 是 `undefined` → 抛错 →
`turn.stopError` 置位 → `forceStop` 不执行。平时救回它的是 #2 表里的第二条出口
（main 的 `finished` 广播先到，`finishFromMain` 把回合清掉，之后那个抛错撞上
`session.turn?.id !== turn.id` 早退，不留痕）。**广播一旦没到** —— renderer 在这中间重载过、
或者快照对不上 —— 就只剩这条假失败，会话永久卡住。

这不是推断，编译器一直在说：

```
src/main/maestro/xpc/coach.handler.ts(305,9): error TS2416:
  Property 'abortAgent' in type 'CoachXpcHandler' is not assignable to the same property in base type 'CoachXpcContract'.
```

它是 `main` surface 那 65 条基线诊断之一，从 `6e7e8b30`（2026-08-31，*migrate Cowork chat parity
into Maestro*）起就在。**基线里的错误不是"已知无害"，这一条是一条真缺陷。**

## 4. 改动

1. **回执按契约返回**：`coach.handler.abortAgent` 改回 `Promise<{ ok: true }>` 并 `return`。
   `tsc` 的 TS2416 随之消失（65 → 64）。
2. **停止的确认有期限了**：`STOP_ACK_TIMEOUT_MS = 10_000`。到点不取消 main 的清理，只在回合上
   记一个 `stopStalledAt`，让界面停止撒谎。回执照常在后台等；它一到，还是照原样 `forceStop`。
3. **状态条说实话**：超期后从 `Stopping…` 换成 `stopStalled`（带计时）。
   「在清理」和「挂死了」从此在屏幕上不一样。
4. **超期之后再按停止 = 放行**，不是再停一次：main 的 `turn.abortOperation` 返回的是**同一个**
   pending promise，重发撞的是同一堵墙。这一按直接本地 `forceStop`：气泡收尾、`session.turn`
   清掉、会话可用。停止按钮在超期后重新可用，正是为了这一按。
   **`stopError` 不走这条路** —— 那一发 abort 已经 settle 并在 `finally` 里清掉了，重发是**全新的**
   一发，真的可能成功，所以失败仍然是「重试」。两者措辞也分开（`Retry` / `Release this chat`）。
5. **相位顺序对齐 `micromeet-cowork`**：`aborting` 从原来的**任务相位之后**提到压缩之后、
   紧邻队首。原来只要本会话还有一个 live task，按下停止之后状态条显示的仍然是那个任务在跑 ——
   停止看起来像被忽略了。两仓现在同序。

## 5. Ral 已拍板：不是 A/B，两条都不对 —— 停止应该**立刻**

**Ral 2026-09-22:「stop 应该立刻结束会话并尽量结束正在执行的命令呢 pi 或 claude 应该都能做到
这点吧」。他是对的，而我把一条注释当成了已定的设计。**

pi 就是两仓的运行时，它的做法与那条注释相反，而且逐行可查（`@earendil-works/pi-coding-agent@0.85.1`）：

| 事实 | 出处 |
| --- | --- |
| Esc 的处理是 `this.agent.abort()`，**同步、不 await** | `dist/modes/interactive/interactive-mode.js` 的 `onEscape` → `restoreQueuedMessagesToEditor({abort:true})` |
| `agent.abort()` 全文**一行** | `pi-agent-core/dist/agent.js:202` `this.activeRun?.abortController.abort()` |
| 「尽量结束正在执行的命令」靠同一个 signal | 内置工具签名 `execute(id, args, signal, …)`；`core/tools/bash.js:81` 收到 abort **杀整棵进程树** |
| pi 唯一 `await session.abort()` 的地方是**会话树导航** | `interactive-mode.js:4406`（那里不能让一个还在流的回合窜进分支） |

所以正确的形状是 pi 的：**发信号 + 同步放行，清理是后台的后果，不是前置条件。**
本次照此改了三层（两仓同形）：

1. `BaseAgent.abort()` —— 从「await 这一发 prompt 加上每一个在飞的工具」改成**同步**：
   置 `stopped`、发 abort、**同步让开发送闸**（`busy` / `sessionWork` / `sessionPromise` 全部清），
   残余在后台排干。旧 ownership 被整份丢掉，它名下的工具晚一点返回也进不了下一个回合
   —— 下一次发送会开一份**新的** session/ownership。
2. `abortAgent()` —— 不再 `await Promise.allSettled([...])` 才回执：当场 `{ ok: true }`；
   workflow worker 的终止（SIGTERM → 宽限 → SIGKILL → 确认）留在后台。
3. renderer `stop()` —— **先本地收尾，再发信号**，不等 IPC 往返。

**于是 #3 里加的那套中间态全部删除**：`stopStalledAt`、`Still stopping · {elapsed}`、
`Release this chat`、`stopError` 的渲染与它的重试按钮、`ChatPanel` 里 `aborting` 的三态标签。
Ral 同一次口述：「停止失败 就不该有 stop 必须能停止成功」。状态条的其余重构见
[`features/chat-status-bar-status-and-action.md`](../features/chat-status-bar-status-and-action.md)。

**留在原处的**：main 侧 `ActiveAgentTurn.stopError` 只服务于**退出应用**那条路（workflow 清理
未确认 → 拒绝退出的对话框），与聊天的停止按钮无关。

## 6. 验证

* `yarn typecheck:node`：`main` surface **65 → 64**。逐行 diff 只有两处：消失的
  `coach.handler.ts(305,9): error TS2416`，以及 `maestroAgent.service.ts` 的一处**行号位移**
  （1106 → 1130，来自本工作区里另一个会话未提交的改动，不是本次改的文件）。
* `yarn typecheck:web`：`renderer/maestro` 8 条诊断**全部在 `TabAliasApp.vue`**，
  `renderer/home` 21 条也与本次无关；本次改的四个 renderer 文件
  （`turn.service.ts` / `message.type.ts` / `ResponseStatus.vue` / `ChatPanel.vue`）**零诊断**。
* 未跑 E2E（桌面 E2E 需 Ral 当场要求才跑）。

**顺带发现：`yarn check:renderer-i18n` 在 `HEAD` 上就是红的，与本次改动无关**，本次没有修：
断言 `maestroControl must start language initialization before evaluating product UI` 读的是
`src/renderer/maestro/control/src/control.ts` —— 那个文件既不在本次改动里，工作区里也**没有任何
未提交修改**（`git status` 干净），守卫脚本本身同样是 `HEAD` 原样。也就是说它对着 `HEAD` 的源码
就不成立。`micromeet-cowork` 那边同样发现两条 `HEAD` 上就红的守卫（见该文档 #5）。

## 7. 守卫

#3 有守卫：它就是 `tsc` —— 只要没有人再把这条 TS2416 当成「基线里的已知噪声」。

#2 / #4 在**本仓还没有**守卫。`micromeet-cowork` 那边有
（`tests/unit/chatEscape.test.mjs` 的 *a stop that never confirms is escapable…*，并且先验过红），
本仓缺的是那套能挂载 `ChatPanel` + `ResponseStatus` 的 renderer 测试装置 —— 补它是一件独立的事，
本次没做。**两仓的行为是对齐的，守卫不是。**
