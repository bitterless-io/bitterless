# 按停止时队列里的 steering 被 pi 在中止后又跑了一轮

- **来由**：2026-09-24 WORKFLOW-MCU 会话在做问卷投递时顺带发现，并给了复现脚本（真实的 pi 0.85.1 循环 + 本地假模型）。
- **状态**：已修复（2026-09-24），见文末「修复与验证」
- **相关**：`requeued-steering-loses-identity-and-honesty.md`（停止后把没投出去的消息顺延成下一回合）——
  本缺陷会让那条顺延**重复投递**，所以两条必须一起成立。

## 现象

模型正在流式输出时，人发了一句 steering，然后按停止。中止之后 pi **又发了一次模型请求**，带着那句 steering，
并把「人的这句话 + 模型的回复」**写进会话文件**。而界面早已把这句话判成「没投出去」—— 并且（9-22 起）把它顺延成下一个回合。

## 复现（本地假模型，无网络、无凭据）

| 顺序 | 模型请求 | 会话条目 |
| --- | --- | --- |
| `steer` → `abort`（宿主现在的做法） | **2 次**：`[ROOT]`、`[ROOT, assistant(aborted), HUMAN…]` | `ROOT` · `assistant:aborted` · **`HUMAN…`** · **`assistant:answer-2`** |
| `clearQueue` → `abort`（pi 自己按 Esc 的顺序） | 1 次：`[ROOT]` | `ROOT` · `assistant:aborted`；`clearQueue()` 把 `HUMAN…` 原样交回 |

## 根因

**pi 自己中止之前总是先清队列，宿主漏了这一步。** pi 0.85.1 `modes/interactive/interactive-mode.js` 的
`restoreQueuedMessagesToEditor({ abort: true })`：第一句 `this.clearAllQueues()`，最后才 `this.agent.abort()`；
按 Esc、以及另外两处中止入口都走它。

宿主的 `PiRuntimeSession.abort()` 只有 `abortCompaction()` + `await session.abort()`。`BaseAgent.abort()` 的注释
引用的正是 pi 的 `onEscape → restoreQueuedMessagesToEditor({abort:true}) → agent.abort()`，但实现里没有清队列那一步。
宿主确实会清 —— `takePendingSteering()` 里调 `clearQueue()` —— 可它在 `runPrompt` 里 `await running` **之后**才调，
那时 pi 的循环已经把排队的 steering 取出来跑完了那一轮。

## 后果（叠加 9-22 的顺延之后）

1. **模型收到两次。** 界面把它判成「没投出去」、顺延成下一个回合；pi 在中止后已经把它喂给模型跑过一轮。
2. **上下文里夹着一段人从没看见的回复。** 那一轮的回复写进了会话文件（`sessionFile` 跨会话复用），下一回合的上下文里有它，
   时间线上没有。
3. **会话文件分叉的风险。** 中止后的那一轮在后台跑（`BaseAgent.abort()` 不等它），新会话同时从同一个文件起步，两边各自往树上追加。

`heldSteering`（压缩期间扣住、压缩结束才交给 pi 的那几条）同理：中止发生在压缩中，压缩一结束它们会被 `steer()` 进一个已经中止的会话。

## 修复

`PiRuntimeSession.abort()` 第一步调 `takePendingSteering()` —— 它清 pi 的队列（`clearQueue()`）、清 `heldSteering`、清宿主镜像，
并留 `steering-dropped` 痕 —— 然后才 `abortCompaction()` / `session.abort()`，与 pi 的顺序一致。这些话的去向不变：
收件箱已经在 `BaseAgent.abort()` 里被取消，渲染端照旧把它们顺延成下一个回合 —— 现在只会投递**一次**。两仓同形。

## 守卫

`abortClearsQueuedSteering.test.mjs`：用真实的 pi `AgentSession` + 本地假模型，包进宿主的 `PiRuntimeSession`，流式中
`enqueueSteering` 再 `abort()` —— 断言只有 1 次模型请求、会话条目里没有那句 steering。修复前的源码上必须转红。

## 修复与验证（2026-09-24）

**状态**：已修复（两仓）；未启动应用目测，未跑 Electron E2E。

| | micromeet-cowork | bitterless |
| --- | --- | --- |
| 落点 | `main/agent/runtime/piRuntimeSession.ts` `abort()` 第一句 `this.takePendingSteering()` | 同左 |
| 行为测试 `abortClearsQueuedSteering.test.mjs`（真实 pi 0.85.1 循环 + 本地假模型） | 修复前 ✖（「中止之后 pi 又带着这句话发了一次模型请求」）→ 修复后 ✔ | 同左 |
| 相关套件 | `steeringInterruptsBash` 11/11、`queuedMessageOutlivesTheTurn` 6/6、`steeringWithdraw` 7/7、`turnSteeringDelivery` 8/9（与修复前相同）；问卷五个套件全绿 | `steeringInterruptsBash` 9/9、`requeuedSteeringKeepsIdentity` 4/4、`queuedMessageOutlivesTheTurn` 4/4、`steeringWithdraw` 5/5 |
| 类型检查 | `tsc -p tsconfig.node.json` exit 0 | 该文件 0 条 |

**与问卷投递（qn-002，WORKFLOW-MCU 会话）的配合**：cowork 这个文件里另有 qn-002 未提交的改动；本修复只动 `abort()` 这一处，
已与对方确认兼容 —— 它的「运行结束后补写」把「交给 pi 但会话里没确认」的问卷条目视为未写入，只补一次，
并有测试在 `abort()` 前先调 `takePendingSteering()`。
