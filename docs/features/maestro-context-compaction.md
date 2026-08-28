# FEATURE · Maestro 上下文压缩与召回(五段布局)

- **Status:** 📐 **契约已记录,实现暂缓** —— 等上游 `ctx-006` 落地并经真会话验证后再 backport。
  暂缓理由见下「为什么现在不实现」。
- **Design owner:** Ral, 2026-08-28。
- **性质:上游 backport。** maestro 是 `projects/micromeet-cowork` 的 vendored fork
  (`docs/features/maestro.md:5-7`,基线 `689832d`,2026-07-14)。
- **上游契约(权威):** `../micromeet-cowork/docs/features/cowork-context-compaction.md` ·
  任务卡 `ctx-001`…`ctx-008` · review `ctx-001-1.md` / `ctx-004-1.md` / `ctx-002-003-1.md`。
- **上游研究底稿:** `overmind:areas/agent-runtime/chat/compaction.html`(方案) ·
  `compaction-decisions.html`(决策台账 D-01…D-32) · `sim/`(实验台)。
- **Area(将来):** `src/renderer/maestro/control/src/store/` · `src/main/maestro/agent/` ·
  `src/shared/maestro/coach.api.ts` · `src/preload/maestro/sqlite/maestroChat.dao.ts`

---

## 为什么现在不实现

**maestro 已经有一套能跑的压缩** —— 而那正是上游被五段布局**替换掉**的旧实现:

| maestro 现有 | 位置 | 上游处置 |
|---|---|---|
| `compactSessionIfNeeded()` / `compactAllIfNeeded()` | `message.store.ts:584` / `:254` | **保留入口**,内部重写 |
| `selectCompactCandidates()` | `:631`(保护最近 6 条 / 25% 尾巴,压到 `maxTokens × 0.62`) | **废弃** |
| `selectCompactBridgeMessages()` | `:670` | 废弃 |
| `buildCompactSummary()` → `coach.compactConversation` | `:680` | 改接 pi 的 `generateSummary` |
| `buildFallbackCompactSummary()` | `:716` | 保留(LLM 失败兜底) |
| `DEFAULT_COMPRESSION_REMAINING_PERCENT = 10`(90% 触发) | `:40` / `:801-811` | **废弃** —— 改常量预算 |
| main 侧 `compactConversation()` → `piGen.oneShot(prompt, 120_000)` | `maestroAgent.service.ts:838` | 改走 pi 的压缩函数 |

⇒ backport = **拆掉一套能跑的,换上一套上游自己还没跑通的**。

**上游当前状态**:`ctx-001/002/003/004` 已交付并过 review,但

- **`ctx-006`(集成)未做** ⇒ 新路径**一行都跑不到**(`CompactionHandler` 注册了但没人调)
- **一条契约级问题未定**:压缩候选批该从 renderer 的 chat 消息取,还是从 main 侧 pi 的 entry 树取。
  已知事实:renderer 的 chat 消息**永远没有工具返回正文**,而 `findCutPoint` 的失效条件恰恰
  关于工具返回体积 ⇒ 用 renderer 消息当候选批,那条失效路径既不可能出现也不可能被验
- **凭据取法从没真调过模型**(main 侧 `modelRegistry.getApiKeyAndHeaders` 只经源码核实)

**把未验证的设计 backport 进 fork,等于把 bug 一起 backport。** 所以本文只记录契约,不派实现。

**解锁条件(三条全满足)**:① 上游 `ctx-006` 落地;② 候选批来源那条契约定案;
③ Ral 在上游真跑过一次触发压缩的会话。

---

## 设计要点(记录用,实现时以上游契约为准)

### 五段布局

```
┌──────────────────── 模型实际看到的顺序(pi 的投影产出) ─────────────────────┐
│ ① 固定预设 ≤24k │ ② U链 ≤12k │ ③ 摘要 上界13.1k │ ④ 清单 ≤40k │ ⑤ 尾部 24k │
└────────────────────────────────────────────────────────────────────────────┘
```

k = **1024**。五段满额 **115,507 ≈ 113k**,远低于 210k 触发线。

### 核心判据

> **凡程序搬的零衰减,凡模型重新生成的会衰减。**

五段里**只有 ③ 过模型**。这一条决定其他一切安排 —— ② 用户原话逐字搬、④ 清单程序渲染、
⑤ 尾部逐字保留,都不过 LLM。

### 已定案且**有实测支撑**的三条

| | 结论 | 证据 |
|---|---|---|
| **`customInstructions` 一律不传** | pi 在 `compaction.js:444` 提供官方追加点,**我们不用** | A/B/C 三组各 8 轮真实压缩:无追加指令留存 **89%**;加 `Done` 上限 + 因果要求 **17%**;**只加因果要求(纯加法、零裁剪许可)仍掉到 51%**。⇒ 加任何追加指令都会让模型从**搬运**切换成**重写**,而重写在递归结构里逐代复利 |
| **③ 不设人为上限** | `reserveTokens` 用 pi 默认 `16384` ⇒ `maxTokens = 13,107` | `maxTokens` 是**输出上限**,调小换来的是 `stop_reason: max_tokens` **截断**;而 pi 骨架有序,截在 4k 砍掉的正好是尾部 `## Next Steps` / `## Critical Context` |
| **③ 沿用 pi 的固定骨架** | 不要求散文 | 骨架写死在**非导出**常量里,推翻它就是跟基座对着干;且没有骨架就没有刻度 —— 衰减度量按 `## 段` 切 |

实验台可复跑:`overmind:areas/agent-runtime/chat/sim/` ——
`node cli.mjs run --pick --max 8 [--focus f.txt] --out d` + `node decay.mjs d`。
**任何「要不要动压缩指令」的想法,先跑一组再进契约。**

### `findCutPoint` 的静默失效路径

`findValidCutPoints` **排除 `toolResult`**。当单条工具返回 ≥ `keepRecentTokens` 且它不是合法切点时,
`cutIndex` 回落到区间最前端 ⇒ **压缩空转** ⇒ 下一轮撞窗口上限。
**它不抛错、不返回错误码**,返回的是一个看起来合法的 `CutPointResult`;`isSplitTurn` 在这条路径上是 `false`。

三层处置:① 校验 `firstKeptEntryIndex > startIndex` 且被选段非空 → ② 按 item 粒度切,
`tool_call`/`tool_result` **一起切走**(补占位 `tool_result` 修的是反方向 ——
落单只可能是「返回被留下、调用被切走」)→ ③ 被切走的前缀交 `generateTurnPrefixSummary`。

**可证性质**:失效条件 ⟺「从过线那条到最新之间全是 `toolResult`」⇒ 它们的调用必然都在切点之前
⇒ 「一起切走」在真失效那一路**必然把 ⑤ 尾部清空**。⑤ 为空是**合法结果**。

---

## maestro 与上游的差异(实现时必须处理)

| # | 差异 | 影响 |
|---|---|---|
| 1 | **压缩逻辑长在 renderer**,token 用 `gpt-tokenizer` 估(`message.store.ts:2` / `:75 safeTokenCount`) | 与上游本版一致(上游也留在 renderer),但上游已把**真 usage 口径**移到 main 的 `usageLedger` —— maestro **没有** `usageLedger` / `inputBudget` / `modelIoLog` |
| 2 | **凡调 pi 的都在 main** 这条边界要重新核 | 上游依据是 renderer 无 `externalizeDepsPlugin` + 有 `nodePolyfills` ⇒ import pi 静默拿空 shim。**maestro 的 `electron.vite.config.ts` 要独立核一遍**,不能照抄结论 |
| 3 | pi 是**动态 `import()`** + 手写窄接口 | 上游是静态 import。要用 `findCutPoint` / `generateSummary` / `appendCompaction` 得逐个扩窄接口,不能 `import type` |
| 4 | DB 列**已经就位** | `maestroSqlite.release.ts:52-75`:`compressed` / `prompt_excluded` / `compact_summary` / `compact_until_message_id` / `token_count`;会话侧在 `detail_json`(`maestroChat.dao.ts:53-55`)⇒ **不需要迁移** |
| 5 | 默认窗口 **256K**(`message.store.ts:38 DEFAULT_CONTEXT_LIMIT_K = 256`) | 上游参数表的 210k 触发线是按别的窗口推的,要重算 |
| 6 | 没有 `Turn` 实体 | 上游「压缩按 turn 边界切」依赖 turn 是实体。maestro 只有散字段 ⇒ 切点只能落在 pi 的 entry 层 |
| 7 | 38 个源码字符串守卫 | 压缩改动会碰 `check-chat-composer.mjs` / `check-agent-runtime.mjs`;新增脚本要同步 `check-maestro.mjs:12` 的 `38` |

---

## 与 steering 的接缝

见 [`maestro-turn-steering.md`](maestro-turn-steering.md)。三条:

1. **steering 消息必须逐字进 ② 用户原话链** —— 它是用户意图,不可重建。
2. **steering 消息在 pi 眼里是新 turn 起点** ⇒ 多一个合法切点。对压缩是好事。
3. **压缩期间的消息走 followUp,压缩不受影响** —— 不 abort,没有活锁。

⚠️ **steering 会让 renderer 的 token 账立刻不准** —— 它只统计自己 push 进 `session.messages` 的东西,
看不到 pi session 内部的真实历史。这是 maestro 缺 `usageLedger` 的直接后果,压缩实现时必须回答。
