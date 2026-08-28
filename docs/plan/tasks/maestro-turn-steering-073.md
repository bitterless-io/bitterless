---
id: maestro-turn-steering-073
scope: Maestro main-side steering policy, pi delivery wiring, and busy-gate entry for in-turn steering
status: pending
depends-on: []
verify:
  - Policy returns steer while streaming and followUp while compacting, with a pending steering message, or while aborting
  - Delivery passes streamingBehavior to pi (pi throws without it while streaming)
  - steeringMode is set explicitly to one-at-a-time rather than inherited from the SDK default
  - A second prompt during an active turn reaches the policy instead of the busy early-return
  - The new entry neither sets nor clears busy, and produces no second turn accounting
  - Mutation testing shows every new assertion fails when its guarded behavior is removed
  - node scripts/maestro/check-maestro.mjs
  - yarn typecheck:node
  - yarn typecheck:web
  - yarn build
  - No Electron/Playwright/E2E
---

# Maestro main 侧 steering —— 策略 · 投递 · busy 入口

## Objective

把上游已交付的 steering **main 侧**三件 backport 进 maestro:

1. **投递**:`piRuntimeAdapter.prompt()` 传 `streamingBehavior`(pi 流式中**必填**,不传会抛)
2. **策略**:四条机械判定,默认 steer,不给人工选择
3. **入口**:`BaseAgent.ts:243` 那道 `if (this.busy) return` 之外,开一个**不吃 busy 锁、
   打同一个活会话**的入口

## Context

- [`docs/features/maestro-turn-steering.md`](../../features/maestro-turn-steering.md) —— 契约,**先读全**
- `../micromeet-cowork/docs/features/cowork-turn-steering.md` —— 上游契约
- `../micromeet-cowork/docs/plan/tasks/steer-001.md` · `steer-003.md` —— 上游对应两棒
- `../micromeet-cowork/docs/plan/reviews/steer-003-1.md` —— 上游 review,**F1 那条必须读**
- `src/main/maestro/agent/BaseAgent.ts` —— `:91 busy` · `:237 prompt()` · `:243` 早退 · `:395 abort()`
- `src/main/maestro/agent/runtime/piRuntimeAdapter.ts` —— `:16-42` / `:214-218` 手写窄接口 · `:174 prompt()`

## Path

- `src/main/maestro/agent/runtime/piRuntimeAdapter.ts`
- `src/main/maestro/agent/runtime/agentRuntime.types.ts`
- `src/main/maestro/agent/BaseAgent.ts`
- `src/main/maestro/agent/steering/steeringPolicy.ts`(新建)
- `src/shared/maestro/coach.api.ts`(`AgentReply` 加 `mergedIntoTurn?: boolean`)
- `src/main/maestro/agent/maestroAgent.service.ts`(投递意图透传 + `delivered` 分支返回)
- `scripts/maestro/check-agent-runtime.mjs`(**必改,见下**)
- `scripts/maestro/check-turn-steering.mjs`(新建)+ `scripts/maestro/check-maestro.mjs`(`38` → `39`)

## 策略表(契约原文,不要自己改)

优先级 **4 → 3 → 2 → 1**,先命中先返回:

| # | 情形 | 选 |
|---|---|---|
| 1 | 正常流式输出 | **steer**(默认) |
| 2 | 正在压缩 | **followUp** |
| 3 | 已有未投递 steering 且 `steeringMode === 'one-at-a-time'` | **followUp** |
| 4 | 回合已进入收尾(`aborting`) | **followUp** |

**没在流式时也传 `steer`** —— pi 只在 `isStreaming` 为真时读该字段,而我们读它与 pi 读它之间隔一次
await,恒传把这段竞态关掉;不传的代价是 pi 直接抛。

**策略与当前在跑什么工具无关。** 上游初版有一张 60 条读写表,理由是「中途打断会留半完成状态」——
**该理由已被源码证伪**(`steer` 只入队,`agent-harness.js:601`),上游已删。不要重建它。

## 上游 review 的 F1 —— 投递**之前**必须判 `isStreaming`

这条是上游 review 判 blocked 的两条之一,**照做,别重蹈**:

`busy === true` 但 pi 尚未进入流式的那段窗口**不是毫秒级** —— 首个回合的 `await ensureSession()`
是整个 pi 会话创建。后果不是等待,是**孤儿 run**:steering 那次一旦先抢到 `activeRun`,
真正的第一条就变成 `steer` 入队 → `session.prompt()` 立刻 resolve →
`finally` 拆订阅 + 清 `busy` ⇒ **pi 那次 run 无人订阅:流不到 UI、usage 不入账、互斥失效。**

⇒ **投递前判 `isStreaming`,非流式不投、如实报失败**(此刻什么都没排进去,报失败是诚实的)。
⚠️ **不要改成加超时** —— 超时会给一条其实已排进去的消息编一个不存在的结局。

## 三条硬要求(上游 review 逐条验过)

1. **不新起一份回合记账。** steering 是**当前**回合的一部分。新入口不得产生第二个 turn 状态、
   第二次计时、第二条 usage 记账 —— 别走 `runPrompt()` 那条路。
2. **不吃 `busy` 锁,也不清它。** 清位仍由原 `prompt()` 负责。误清会让真正的回合失去互斥保护。
3. **`busy` 为假时**没有活跃回合,走原 `prompt()`,不要误入 steering 分支。

## `mergedIntoTurn` —— 顺带查一遍后置条件

`AgentReply` 加 `mergedIntoTurn?: boolean`,`delivered` 时置真。**不要拿 `ok && text === ''` 当哨兵。**

⚠️ **必须查:谁依赖「`sendAgentMessage` 返回 = 回合结束」这个后置条件。**
上游踩过 —— 钻探续跑循环 `if (!reply.ok) break` 永不断,对着还在跑的回合灌了最多 40 条合成消息,
出口还无条件写收尾。maestro 侧在 `maestroAgent.service.ts` / `maestroWindow.controller.ts` 里
凡是循环调用它的地方都要认这个标记。**找到了就报回来**,不要自己改钻探逻辑。

## 守卫的雷 —— 必须处理

| 位置 | 断言 | 处置 |
|---|---|---|
| `check-agent-runtime.mjs:133` | `piRuntime.includes('this.session.prompt(message.text)')` | 一加第二参**立刻红**。放宽成能容纳 options 的形状 |
| `check-agent-runtime.mjs:120-127` | `BaseAgent.prompt` 会话复用形态 | 改 busy 分支可能红,核实后同步 |
| **`check-maestro.mjs:12`** | **`checks.length === 38`** | 新增 `check-turn-steering.mjs` ⇒ **同步改成 39** |
| `check-agent-runtime.mjs:186-255` | fake runtime 的**真实行为测试**(`prompts` / `abortCalls` 计数) | **扩它来测 steering**,不要只加源码正则 |

⚠️ **先跑一遍记下基线**(`node scripts/maestro/check-maestro.mjs`),把本来就红的记下来 ——
别把自己造成的红算进「本来就红」。上游正是靠跨 revision 逐条手跑才分离出一条被遮住的真回归。

## Verification

- `node scripts/maestro/check-maestro.mjs` —— 全 39 个脚本
- `yarn typecheck:node` · `yarn typecheck:web` · `yarn build`
- 新守卫覆盖:策略四条 + 「投递方式与工具无关」+ 「压缩期间不调用任何 abort」+
  「显式设过 `one-at-a-time`」+ 「不产生第二份回合记账」+ 「投递前判 `isStreaming`」
- **突变验证,每条先报锚点命中数(≠1 就换锚点)**:去掉 `isStreaming` 前置判断 /
  判定挪到投递之后 / 让新入口清 `busy` / 让它新起回合记账 / 去掉显式 `setSteeringMode` /
  `mergedIntoTurn` 恒 false。**每条必须变红**,跑完立即还原并核对与突变前一致
- **不跑 Electron E2E** —— overmind 规则;`scripts/maestro/MANUAL_GATES.md` 把
  「send, stream, abort, and resume a chat」列为人工发布闸
