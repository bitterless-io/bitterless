# FEATURE · Maestro 回合内 steering(AI 回话时人可以继续发)

- **Status:** ✅ 已实现；2026-09-15 queue → steering 修复通过定向代码验证，待 Ral 人工验收。
- **Design owner:** Ral, 2026-08-28。
- **性质:上游 backport,不是新设计。** maestro 是 `projects/micromeet-cowork` 的 vendored fork
  (`docs/features/maestro.md:5-7`,基线 commit `689832d`,2026-07-14)。本 feature 把上游
  2026-08-27/28 定案并交付的 steering backport 进来。
- **上游契约(权威):** `../micromeet-cowork/docs/features/cowork-turn-steering.md` ·
  任务卡 `steer-001` / `steer-002` / `steer-003` · review `steer-003-1.md`。
  **上游侧状态:三道闸全部拆完,179 条守卫,`check:behavior` 654 绿。**
- **Area:** `src/main/agent/runtime/{piRuntimeAdapter,agentRuntime.types}.ts` ·
  `src/main/agent/BaseAgent.ts` · 新建 `src/main/agent/steering/` ·
  `src/renderer/maestro/control/src/{ChatPanel.vue,store/message.store.ts}` ·
  `src/shared/maestro/coach.api.ts` · `scripts/maestro/`

## 2026-09-15 当前投递契约（已实现，待人工验收）

活跃 Turn 的 preparing、工具安全点与最终收尾都接收有序 steering。不能把 runtime 的
`isStreaming=false` 等同于没有活跃 Turn，也不能通过第二次普通 `prompt()` 并发启动模型。
Main 在保留的 Turn 上持有专用 inbox，按接收顺序保留 messageId、turnId 和本条消息的页面、
站点技能、时间及会话上下文；准备阶段不因为模型尚未开始而丢弃消息。

运行时明确提供 `enqueueSteering`，只入原生安全点队列；缺少原生能力或暂不可入队时保留 host
FIFO，现有 owned run 在安全位置串行续送，不并发第二次普通 prompt。未消费残留通过
`takePendingSteering` 交还同一个 owned run 串行续送。该 run 保持同一订阅、计时及累计用量，
原始 root 不重发，不重复已消费消息。空队列检查与关闭接收同步完成。自然成功结束后的迟到消息
通过显式 `continueAsRoot` 回执安全接续，复用原 human/messageId 与动态快照；连续迟到消息共用
同一继承 owner，其他新 owner 不接收旧回合消息。Main 保留有界完成记录，UI 确认不删除接续资格。
停止、启动失败、模型失败或超时取消尚未消费项，保留每条消息身份并让 renderer 显示真实失败原因，
不自动误跑到新 Turn。排队反馈只表示 queued，消费回执才表示已加入本轮上下文，不保证远端
模型已理解或执行。未消费消息保留为排除于 prompt 的 human 记录，停止/失败原因另行明确展示。

新增请求默认与先前未完成请求一起完成；仅冲突部分以新指令为准。用户明确取消或替换才删除
先前工作。查杭州天气后补香港天气应完成两项；“改成只查香港”才替换杭州任务。基础 A7 第一条
同步写入此规则，其他九条不变；不是只修改文档或依赖一次用户提示。

本次覆盖 preparing、顺序、安全点、final-settled 空窗、重复消息、停止/失败、会话隔离和动态
上下文快照。仅比例适当的单元/类型验证；不启动 app、真实模型、E2E、build 或独立 review。

实现落点：`steering/turnSteeringInbox.ts` 保有队列与消费身份；`BaseAgent.runPrompt` 保持同一个
owned run 并串行 drain；`PiRuntimeSession` 对接原生 steer/queue 与消费事件；
`MaestroAgentService` 从 claim 起保留 inbox，并验证自然结束接续关系；renderer `TurnService`
在准备阶段接收追加消息、复用迟到 human 的身份和快照，首条 fallback/后台标题仍只触发一次。

代码验证（2026-09-15）：

- `node --test tests/maestro/maestroConcurrentTurns.test.mjs tests/maestro/maestroChatTabIndependence.test.mjs tests/maestro/maestroQueuedSteering.test.mjs`：42/42。
- `node --test tests/maestro/maestroComposerCleanup.test.mjs tests/maestro/maestroProjectInstructions.test.mjs`：38/38；其中包含安装的 Pi SDK 与模拟 provider 的真实回合测试，不发送外部请求。
- BaseAgent/Pi/project instructions 定向 `tsc` 与 Control（含 Maestro 全局类型）的定向 `vue-tsc` 均通过。
- Main 服务的扩展依赖检查仍有 30 项原有非本轮诊断（fileSearch、logging、skill、OnlyPreview 等）；本轮 Main service、inbox、BaseAgent、Pi session 和 renderer 代码无剩余类型诊断。未扩修无关模块。
- `git diff --check` 通过。人工需覆盖准备中连续发送、工具结束安全点、自然收尾连续追加、主动 Stop，以及“杭州 + 香港”与“只查香港”的区别。

## 2026-09-15 响应式 Turn 归属回归（已修复，待人工验收）

BL 的准备阶段已按 turnId 检查，不产生 CoWork 同名的 preparation 错误，但最终回复与兜底释放
仍直接比较新建 raw Turn 与 Vue 代理对象，可能误认为回合被替换。所有本轮归属判断以稳定 turnId
为准；新建后从 session 读取响应式 Turn。Stop 状态和真正更换 turnId 仍应阻止旧准备工作投递，
迟到回调不能释放或修改接管的回合。验证使用真实 Vue reactive/ref 包装的旧会话恢复与异步准备
fixture，不依赖 Main 完成广播替 renderer 掩盖最终回复路径。

`TurnService` 已统一稳定 ID 归属判断，新建后读取存储于 session 的代理；准备期和 steering
等待结束时同时拒绝 aborting。新增 3 项真实响应式恢复测试，修复前复现其中 2 项失败：最终
RPC 回复未显示、Stop IPC 尚未返回时仍投递 root；真正换 Turn 的保护原本通过。修复后
`node --test tests/maestro/maestroComposerCleanup.test.mjs` **35/35 通过（原 32 + 新 3）**，
既有双迟到消息测试改为真实 `ref` 包装后同样通过。Control 定向 `vue-tsc` 与
`git diff --check` 通过；本轮只重跑受影响 renderer 验证，未重复上面的 80 项或运行 app/E2E。

## 2026-08/09 先前交付记录

Steering 已作为 [Cowork chat core 089](../plan/tasks/maestro-cowork-chat-core-089.md) 的 Turn
垂直切片落地，而不是按本文最早的散字段方案单独接线。Main 原子持有全局 root Turn，root 与
steering 使用显式 intent、Turn id 和 generation；renderer 重建可恢复 active/finished Turn，Stop
有界，旧回调不能污染新 Turn。Control、Workbench 和 Main 同时锁定活跃 Turn 的 LLM target。

2026-09-14：浏览器 tab 与聊天选择解耦。每次 root 或 steering 发送均附带当次活动页面的上下文
和站点技能；固定 system 指令、session id、turn id/generation 不随切 tab 重建。见
[参考链接与页面上下文](../issues/reference-link-tab-chat-tooltip.md)。

[独立 review](../plan/reviews/maestro-cowork-chat-core-089-1.md) 已通过，当前无未解决 P0-P2。
按 Ral 要求未运行 tests、typecheck、lint、build、Electron/E2E、应用脚本或网络验证。

> 以下内容是 2026-08-28 的迁移前推导，保留作决策历史。凡是“没有 Turn”“尚未接线”或具体
> 文件/守卫数量等描述均已被 089 当前实现取代；交付事实以 089 任务卡和 review 为准。

---

## 目标

**AI 正在回话时,人再发一条消息 → 直接带进当前回合继续,而不是被拦住。**

选 steer 还是 followUp **由系统机械判定,不让人选**(上游 Ral 2026-08-28:
「不用让人选了,不需要快捷键,steer 还是 followUp 都是按策略进行」)。

---

## 底座是齐的 —— 缺的纯是接线

`package.json:147` `@earendil-works/pi-coding-agent@0.80.10`。pi 侧全部就位:

| pi API | 声明 |
|---|---|
| `streamingBehavior?: "steer" \| "followUp"` | `dist/core/agent-session.d.ts:136`(*Required if streaming*) |
| `prompt(text, options?)` | `:342` |
| `steer(text, images?)` / `followUp(text, images?)` | `:358` / `:366` |
| `steeringMode` / `followUpMode` getter | `:307` / `:309` |
| `getSteeringMessages()` / `pendingMessageCount` | `:409-412` |
| `{ type: "queue_update", steering, followUp }` 事件 | `:49-51` |

**maestro 侧一处都没接**:`piRuntimeAdapter.ts:174` 就是全部 ——
`return await this.session.prompt(message.text)`,第二个参数没传。
全仓 `src/` 下 grep `steer(` / `followUp(` / `streamingBehavior` **零命中**。

> ⚠️ pi 是 ESM-only,且完整声明图会把 workspace typecheck 撑爆
> (`piRuntimeAdapter.ts:12-15` 有说明)⇒ 适配器**故意手写窄接口**(`:16-42`、`:214-218`)。
> **不要 `import type { AgentSession }` 省事** —— 继续手写扩展那个窄接口。

---

## `steer` 不打断任何东西 —— 差别是**投递时机**

上游源码结论,直接适用(pi 版本不同但这两处未变):

```js
// pi-agent-core/harness/agent-harness.js:601
async steer(text, options) {
  this.steerQueue.push(createUserMessage(text, options?.images));   // 只是入队
  await this.emitQueueUpdate();
}
```

| | 取队时机(`pi-agent-core/agent-loop.js`) | 含义 |
|---|---|---|
| `steer` | `:154` —— 每个 turn 跑完(一次 LLM 调用 + 它那批工具**执行完毕**)之后 | **下一个工具边界** |
| `followUp` | `:157` —— 内层循环整个退出后 | **整个 run 结束** |

```
LLM调用 → 工具批 → LLM调用 → 工具批 → LLM调用 → 结束
              ↑          ↑           ↑         ↑
            steer      steer       steer   followUp
```

⇒ **工具永远不会被切成半截。** 这个安全属性是 pi 白送的。

> ⚠️ pi 的 d.ts 自相矛盾:`PromptOptions` 把 `streamingBehavior` 注成 `"steer" (interrupt)`,
> 而 `steer()` 自己注的是 *"Delivered after the current assistant turn finishes executing its
> tool calls"*。**以源码为准 —— 不打断。**

---

## 策略表(机械判定,无人工介入)

**默认 steer。** 四条,按 4 → 3 → 2 → 1 的优先级判定(先命中先返回):

| # | 情形 | 选 | 理由 |
|---|---|---|---|
| 1 | 正常流式输出 | **steer** | 默认档。这就是本 feature 的目标 |
| 2 | 正在压缩 | **followUp** | 摘要正在生成,此刻插队没有落点 |
| 3 | 上一条 steering 尚未投递(`steeringMode` = `one-at-a-time`) | **followUp** | 避免连续打断把回合搅碎 |
| 4 | 回合已进入收尾(`aborting`) | **followUp** | 抢一个正在停的回合没有意义 |

`steeringMode` 取 **`one-at-a-time`**,**显式**调 `AgentSession.setSteeringMode()`
(`agent-session.d.ts` 有公开声明;`createAgentSession()` 的 options **没有**这一栏)。
pi 当前默认恰好也是它 —— 正因如此才要显式设:那是 SDK 的决定,**它改了我们不会有任何地方报红**。

### 为什么偏向 steer

代价不对称:

- 「补充信息」被误判成 steer → 多插一次,**内容不丢**
- 「改方向」被误判成 followUp → 用户看着 AI 继续跑一条已被否掉的路,**得等整个 run 结束**

### 不做的三件(上游已证伪 / 已定案)

| 不做 | 原因 |
|---|---|
| **按工具读 / 写分类降级** | 上游初版有一张 60 条读写表,理由是「中途打断会留半完成状态」——
  **该理由已被源码证伪**:`steer` 从不打断执行中的工具。pi 自己也零分类。上游已删(227 → 103 行) |
| **压缩期间 abort 压缩** | 上游曾经的方案。**有活锁**:abort 后压缩无产出,上下文仍在触发线之上 →
  立刻重触发 → 用户再发 → 再 abort,压缩永远完不成。pi 的做法是排队等待 |
| **让用户选**(含 pi 式 `Alt+Enter` 修饰键) | Ral 明确:不用人工选 |

---

## maestro 与上游的四条差异 —— **本文的核心**

上游契约不能照抄,这四条必须按 maestro 的形状重写。

### 差异 1 —— 没有 `Turn` 实体,只有三个散字段

| | 上游 cowork | maestro |
|---|---|---|
| 回合状态 | `Turn` 实体(`phase` / `endReason` / per-turn activity / watchdog) | `message.type.ts:69-71` 的 `busy` / `aborting` / `activeTurnId?: string` |
| `activeTurnId` 的用途 | — | 只用来判「回来的回复还是不是我这一轮的」(`message.store.ts:328` / `:565`) |
| main 侧 | 同上 | **连 turn 概念都没有**,只有 `BaseAgent.ts:91` 的 `private busy = false` |

**决定:不先做 turn 收敛。** steering 不依赖 `Turn` 实体,在散字段上做即可。
上游的排队留痕(PQ-4)挂在 `Turn.steering`,maestro **挂在 session 上**。

⇒ 上游 `steer-002` 卡里的「7 处 `:disabled="!!session.turn"`」在 maestro 对应的是
**13 处 `session.busy`**(`ChatPanel.vue`)+ **5 处**(`message.store.ts`)。

### 差异 2 —— 多一道全局闸 `globalBusySessionId`

```ts
// message.store.ts:267
if (!session || session.archivedAt || !text || session.busy || this.globalBusySessionId) return null
```

`globalBusySessionId`(`:173` / `:267` / `:275` / `:344`)= **全应用一次只准一个会话跑一个回合**。
上游没有这条。此处原来的「每个 operation tab 一个 chat」绑定已被 Ral 于 2026-09-14 取消；
见 [tab/chat 解耦](../issues/reference-link-tab-chat-tooltip.md)。浏览器切 tab 只改变后续消息的页面
上下文，不切换聊天；本节的全局并发约束保持原样。

**决定:同会话 steering 绕过它,跨会话仍拦。**

| 情形 | 处置 |
|---|---|
| 目标会话 = `globalBusySessionId` 指的那个 | **放行** —— 这是 steering,打的是同一个活会话 |
| 目标会话 ≠ 那个 | **仍拦**,报 `busy-elsewhere` |

等价于上游 `steer-002` 保留的 `busyElsewhere` 行为。**不要删这个字段** ——
删了等于顺手放开跨会话并发,那是另一个议题。

### 差异 3 —— `abort()` 的语义是「毁会话」,不是「停这一轮」

```ts
// BaseAgent.ts:395-406
if (!this.busy || !this.sessionPromise) return
…
finally { this.reset(); this.busy = false }
```

`reset()`(`:348-353`)把 `sessionPromise` 置空 + `primed = false` + abort 掉旧 session;
`maestroAgent.service.ts:895` 还会 `hydratedMaestroAgentSessions.delete(...)`;
renderer 侧 `message.store.ts:569` 把被打断的气泡标 `promptExcluded = true`(**永久踢出上下文**)。

**决定:本 feature 不改 `abort()`。** steering 不需要打断能力(见上「`steer` 不打断任何东西」),
所以两者可以共存:**Stop 仍是「毁会话」,steering 是「往活会话里插一条」**。

⚠️ 但 UI 上两者必须**同时可用**(见差异 4),所以要在文案/行为上让人区分得开:
Stop = 放弃这一轮,steering = 补一句话继续。

### 差异 4 —— textarea 本体被 disabled,Stop 与 Send 物理上不共存

| 位置 | 现状 |
|---|---|
| `ChatPanel.vue:500` | `<textarea :disabled="session.busy \|\| Boolean(session.archivedAt)">` —— **streaming 时连字都打不了** |
| `ChatPanel.vue:623` / `:643` | Stop 按钮 `v-if="session.busy"` / Send 按钮 `v-else` —— **二选一,不共存** |

比上游更深一层(上游至少还能打字,只是发不出去)。

**决定:textarea 放开;Stop 与 Send 改成并存布局。**

⚠️ 新增的 class 必须落在 `chat-panel__*` 命名空间下 ——
`scripts/maestro/check-chat-composer.mjs:28` 那个正则只允许这个前缀。

---

## 输入区最终状态

| 控件 | 处置 |
|---|---|
| **textarea · 发送 · 语音** | **放开** |
| **附件** | **回合活跃时仍禁** —— pi 的 `steer(text, images?)` 收 images,但 maestro 的附件是
  绝对路径 ref(`coach.attachFiles`),先只带文本 |
| **模型 / provider / effort** | **仍禁**,并**核实它们现在是否真的被回合禁** ——
  上游实测发现「以为在保留一把锁,其实是新加一把锁」,maestro 要独立核一遍 |
| workspace 选/清/刷 · 新对话 | 不动(仍禁) |
| 会话归档 | 不动 |

---

## `mergedIntoTurn` —— 不要拿空正文当哨兵

steering 投递成功后,回复是**空正文**:它是当前回合的一部分,**没有属于自己的回复**。

⇒ `AgentReply`(`src/shared/maestro/coach.api.ts`)加**显式标记** `mergedIntoTurn?: boolean`。

**不要**用 `ok && text === ''` 当判据 —— 空正文是会被别的路径复用的值
(超时、被过滤、模型真没说话),当哨兵迟早误伤。

上游这条不是为了空气泡才做的,是被一个真 bug 逼出来的:`handleAgentTurn` 的后置条件从
「回合跑完才返回」被静默改成「回合还在跑就返回」,而依赖那个后置条件的钻探续跑循环没跟着改 ——
`if (!reply.ok) break` 永不断,对着**还在跑的回合**灌了最多 40 条合成消息。

⇒ **maestro 侧必须查一遍:谁依赖「`sendAgentMessage` 返回 = 回合结束」这个后置条件。**
`maestroAgent.service.ts` 与 `maestroWindow.controller.ts` 里凡是循环调用它的地方都要认这个标记。

---

## 只在 pi 这条运行时上成立

`AgentRuntimeSession` 若不暴露「是否在流式」,就是**这条运行时没有可插进去的活跃流** ——
steering 如实报失败,一个字都不投。maestro 目前只有 pi 一条运行时,但接口要留成可选面。

---

## 待踩的雷 —— 守卫脚本会锁死要改的行

`scripts/maestro/` 下 **38 个** `check-*.mjs`,性质是**源码字符串断言**。

| 位置 | 断言 | 后果 |
|---|---|---|
| `check-agent-runtime.mjs:133` | `piRuntime.includes('this.session.prompt(message.text)')` | 一加第二个参数**立刻红** |
| `check-agent-runtime.mjs:120-127` | `BaseAgent.prompt` 的会话复用形态 | 改 busy 分支可能红 |
| `check-chat-composer.mjs:98-105` | `onComposerKeydown` 的确切实现 | 改发送路径可能红 |
| `check-chat-composer.mjs:119-124` | `messageStore` **不得**含某些字符串 | 新增字段可能红 |
| `check-chat-composer.mjs:28` | class 名正则只允许 `chat-panel__*` | 新增 class 受约束 |
| **`check-maestro.mjs:12`** | **`checks.length === 38`** | **新增任何 check 脚本都会红,必须同步改成 39** |

`check-agent-runtime.mjs:186-255` 有一个 fake runtime 的**真实行为测试**
(已有 `prompts` / `abortCalls` 计数骨架)—— **扩它来测 steering,不要只加源码正则。**

> 上游踩过同一颗雷:`check-agent-runtime.mjs:167` 那条 `prompt(message.text)` 断言变红,
> 但被另一条 pre-existing 红遮住,verify 跨 revision 逐条手跑才分离出来。**maestro 这边先跑一遍
> 记下基线**,别把自己造成的红算进"本来就红"。

---

## 验收基准

| # | 验收 | 方法 |
|---|---|---|
| 1 | 流式中能发出消息 | 守卫:`session.busy` 为真时 textarea 不禁用、发送路径不早退 |
| 2 | 默认走 steer | 守卫:流式 → 策略返回 `steer` |
| 3 | 投递方式与工具无关 | 守卫:任意工具名(含未知)在同样状态下返回同一结果 |
| 4 | 压缩期间走 followUp | 守卫:压缩中 → `followUp`,**且不调用任何 abort** |
| 5 | 连续 steering 退让 | 守卫:已有未投递 steering 且 `one-at-a-time` → `followUp` |
| 6 | 收尾中退让 | 守卫:`aborting` → `followUp` |
| 7 | 同会话绕过 `globalBusySessionId`,跨会话仍拦 | 守卫:两个方向各一条 |
| 8 | `mergedIntoTurn` 被认;**判据不是 `text === ''`** | 守卫:能抓到「把判据换成空串」这个突变 |
| 9 | Stop 与 Send 并存 | 守卫:两者不再是 `v-if`/`v-else` |
| 10 | 模型 / provider / effort 仍禁 | 守卫(防回归) |

**Electron E2E 不跑** —— overmind 规则:不许主动跑。
`scripts/maestro/MANUAL_GATES.md` 明确「send, stream, abort, and resume a chat」属**人工发布闸**。
自动验证只有 `yarn check:maestro` + `yarn typecheck:node` + `yarn typecheck:web` + `yarn build`。

---

## 待定项

| id | 项 | 阻塞性 | 倾向 |
|---|---|---|---|
| PQ-1 | 排队留痕挂在哪(maestro 没有 `Turn`) | 可后置 | 挂 session 上:`steeringCount` / `steeringPending` |
| PQ-2 | 附件在 steering 时怎么带 | 可后置 | 先只带文本 |
| PQ-3 | 回合超时要不要重算(`COACH_PI_TURN_TIMEOUT_MS` 600s;renderer 侧另有 11 分钟
  `CHAT_TURN_TIMEOUT_MS`) | **可后置但要记着** | steering 会延长回合。超时后 `BaseAgent.ts:287`
  又是 `this.reset()` 毁会话 —— 两个数得一起看 |
| PQ-4 | 要不要顺手做 turn 收敛(对齐上游的 `Turn` 实体) | 另立议题 | **不在本 feature** ——
  它会把 fork 差距从 510 行进一步扩大或缩小,是独立决定 |
