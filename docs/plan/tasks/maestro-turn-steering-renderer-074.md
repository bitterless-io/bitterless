---
id: maestro-turn-steering-renderer-074
scope: Maestro Control renderer input unlock, global busy gate scoping, and steering queue feedback
status: pending
depends-on: [maestro-turn-steering-073]
verify:
  - The composer textarea, send button, and voice control stay usable while a turn is streaming
  - Stop and Send coexist instead of alternating through v-if/v-else
  - Same-session steering bypasses globalBusySessionId while a different session is still refused
  - mergedIntoTurn suppresses the empty assistant bubble and the predicate is not an empty-string check
  - Attachments, model, provider, and effort controls stay disabled during an active turn
  - Queued steering is visible to the user rather than silently accepted
  - Mutation testing shows every new assertion fails when its guarded behavior is removed
  - node scripts/maestro/check-maestro.mjs
  - yarn typecheck:node
  - yarn typecheck:web
  - yarn build
  - No Electron/Playwright/E2E
---

# Maestro renderer 侧 steering —— 放开输入区 · 全局闸定界 · 排队留痕

## Objective

把 Control 侧的四道拦阻按契约放开,并让人看得到 steering 的去向。

**这是端到端的最后一道闸** —— `073` 落地后,做完这张卡 steering 才真通。

## Context

- [`docs/features/maestro-turn-steering.md`](../../features/maestro-turn-steering.md) —— 契约,
  尤其「maestro 与上游的四条差异」「输入区最终状态」
- [`maestro-turn-steering-073`](maestro-turn-steering-073.md) —— main 侧,给好了策略与 `mergedIntoTurn`
- `../micromeet-cowork/docs/plan/tasks/steer-002.md` —— 上游对应那棒
- `src/renderer/maestro/control/src/ChatPanel.vue` —— **13 处** `session.busy`
- `src/renderer/maestro/control/src/store/message.store.ts` —— `:173` / `:267` / `:275` / `:344`
  `globalBusySessionId`;`:264 send()`;`:537 dispatch()`;`:569` 打断气泡标 `promptExcluded`

## Path

- `src/renderer/maestro/control/src/ChatPanel.vue`
- `src/renderer/maestro/control/src/store/message.store.ts`
- `src/renderer/maestro/control/src/store/message.type.ts`(排队留痕字段)
- `src/renderer/maestro/control/src/ControlApp.vue`(模型 / provider / effort 若在此)
- `scripts/maestro/check-chat-composer.mjs`(**必改,见下**)
- `scripts/maestro/check-turn-steering.mjs`(`073` 新建的,本卡扩它)

## 四件事

### 1. 放开输入区

| 控件 | 处置 |
|---|---|
| **`<textarea>`**(`ChatPanel.vue:500`) | **放开** —— 现在 `session.busy` 时**连字都打不了** |
| **发送按钮**(`:643`) | **放开**,且与 Stop(`:623`)**并存** —— 现在是 `v-if`/`v-else` 二选一 |
| **语音**(`:613`) | **放开** |
| **附件**(`:532`) | **仍禁**(PQ-2:先只带文本) |
| **模型 / provider / effort** | **仍禁**,但**先核实它们现在是否真的被回合禁** —— 上游实测发现「以为在保留一把锁,其实是新加一把锁」,这里要独立核一遍并如实报 |
| workspace 选/清/刷(`:542/:559/:570/:579`)· 新对话(`:424`) | 不动 |

⚠️ 新增 class 必须落在 `chat-panel__*` 下 —— `check-chat-composer.mjs:28` 的正则只允许这个前缀。

### 2. `globalBusySessionId` 定界(**本卡最需要小心的一件**)

```ts
// message.store.ts:267
if (!session || session.archivedAt || !text || session.busy || this.globalBusySessionId) return null
```

它是**全应用一次只准一个会话跑**,上游没有这条。而 maestro 是每个 operation tab 一个 chat
(`channel.store.ts:13 maestroSessionByTabId`)。

| 情形 | 处置 |
|---|---|
| 目标会话 **就是** `globalBusySessionId` 指的那个 | **放行** —— 这是 steering,打的是同一个活会话 |
| 目标会话 **不是** 那个 | **仍拦**,报 `busy-elsewhere` |

⚠️ **不要删这个字段。** 删了等于顺手放开跨会话并发,那是另一个议题,不在本卡。

### 3. `mergedIntoTurn` —— 不建空气泡

`dispatch()` 认 `reply.mergedIntoTurn` → 不建 assistant 气泡(steering 是当前回合的一部分,
没有属于自己的回复)。

⚠️ **绝对不要改成判 `text === ''`** —— 空正文是会被别的路径复用的值(超时、被过滤、模型真没说话)。
守卫必须能抓到「把判据换成空串」这个突变。

顺带核一条:`:569` 现在把被打断的气泡标 `promptExcluded = true`(永久踢出上下文)。
**steering 成功的消息不该被这条路径误伤** —— 确认它只作用在 abort 路径上。

### 4. 排队留痕(PQ-1 / PQ-4)

人发出去看不到任何反馈会以为**没发成功**。做一个最小反馈:投递前置 pending、
`mergedIntoTurn` 回来后计数 +1,渲染一行状态。

maestro 没有 `Turn` 实体 ⇒ 留痕字段**挂 session 上**(`steeringCount` / `steeringPending`)。

⚠️ `AgentReply` 只有一个 `mergedIntoTurn` 布尔,**分不出 steer 还是 followUp**。
所以文案**不要编投递时机**(别写「马上就插进去」)。要让 UI 说出 followUp 的语义,
需要 main 侧广播策略决策 —— **那要动 main,不在本卡,报回来。**

## 守卫的雷

| 位置 | 断言 | 处置 |
|---|---|---|
| `check-chat-composer.mjs:98-105` | `onComposerKeydown` 的确切实现 | 改发送路径可能红,核实后同步 |
| `check-chat-composer.mjs:119-124` | `messageStore` **不得**含某些字符串 | 新增字段可能红 |
| `check-chat-composer.mjs:28` | class 名正则只允许 `chat-panel__*` | 新增 class 受约束 |
| `check-maestro.mjs:12` | `checks.length` | `073` 已改成 39;本卡不新增脚本就不用再动 |

⚠️ **先跑基线**,别把自己造成的红算进「本来就红」。

## Verification

- `node scripts/maestro/check-maestro.mjs` · `yarn typecheck:node` · `yarn typecheck:web` · `yarn build`
- 新守卫覆盖契约验收 1 · 7 · 8 · 9 · 10
- **突变验证,每条先报锚点命中数(≠1 就换锚点)**:`mergedIntoTurn` 判据换成 `text === ''` /
  忽略 `mergedIntoTurn` 照建气泡 / textarea 重新被回合禁 / 放开模型选择 /
  回合活跃时放开附件 / 同会话也被 `globalBusySessionId` 拦 / 跨会话被放行。
  **每条必须变红**,跑完立即还原并核对与突变前一致
- **不跑 Electron E2E** —— overmind 规则;`MANUAL_GATES.md` 把「send, stream, abort, and resume a chat」
  列为人工发布闸,本卡的最终验收由 Ral 亲自跑
