# FEATURE · Maestro 上下文压缩与召回(五段布局)

> Superseded for Pi chat on 2026-09-17 by [Pi native automatic compaction](pi-native-compaction.md), approved by Ral. The text below records the old design and does not define the current Pi implementation. AI-CRMS behavior is outside this replacement.

- **Status:** 📐 **契约已记录,实现暂缓** —— 等上游 `ctx-006` 落地并经真会话验证后再 backport。
  暂缓理由见下「为什么现在不实现」。
- **Design owner:** Ral, 2026-08-28。
- **性质:上游 backport。** maestro 是 `projects/micromeet-cowork` 的 vendored fork
  (`docs/features/maestro.md:5-7`,基线 `689832d`,2026-07-14)。
- **上游契约(权威):** `../micromeet-cowork/docs/features/cowork-context-compaction.md` ·
  任务卡 `ctx-001`…`ctx-008` · review `ctx-001-1.md` / `ctx-004-1.md` / `ctx-002-003-1.md`。
- **上游研究底稿:** `overmind:areas/agent-runtime/chat/compaction.html`(方案) ·
  `compaction-decisions.html`(决策台账 D-01…D-32) · `sim/`(实验台)。
- **Area(将来):** `src/renderer/maestro/control/src/store/` · `src/main/agent/` ·
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

---

## pi 自带压缩的触发线 —— `<agentDir>/settings.json`

> 实现:`piCompactionSettings.service.ts` · 守卫:`check-pi-compaction-settings.mjs`
> (Ral 2026-09-11:「应用启动时需要初始化 `<userData>/.pi/settings.json`…要有默认的配置了」)

### 问题:两条触发线,一条没人管

本仓里**两套压缩同时活着**,谁先到谁赢:

| 驱动 | reserve 从哪来 | 272,000 窗口下触发线 |
|---|---|---|
| 我们自己的(renderer 账本 → `compaction.handler.ts` 的 `shouldCompact` 否决) | 每模型的 `compressionRemainingPercent` | 按比例 |
| **pi 自带的 auto-compaction** | `settings.json` 的 `compaction.reserveTokens` | **缺省 16384 ⇒ 255,616(94%)** |

第二行是问题:pi 的缺省是**固定 token 数**,不随窗口缩放(`pi-agent-core/.../compaction.js:77`)。
实测 2026-09-11,盘上的 `settings.json` **只写了 `compaction.enabled`** —— 也就是说这条线一直是 pi
的缺省,**没有任何代码写过这个文件**(那两个文件是手改/CLI 留下的)。94% 才动手意味着一个大
tool 结果就能在两次检查之间把窗口冲爆。

### 数:他的固定值与比例是同一组

Ral 先给固定值(「上下文超过 220k 就触发压缩」「reserve 近期 40k」),随后改口
「还是按比例来吧,reserved token 数是 20%,summary 是 reserved tokens 的 0.8」。
两者不矛盾 —— 他那组固定值就是按 272,000 窗口算的,比例能原样复现:

| 他说的 | 比例 | 272,000 下 |
|---|---|---|
| 触发 > 220k | reserve **20%** | 272,000 − 54,400 = **217,600** |
| reserve 近期 40k | keepRecent **15%** | **40,800** |

`summary` 那条**不用我们写**:pi 自己就是 `min(floor(0.8 × reserveTokens), model.maxTokens)`
(`compaction.js:380`)。实测这几个模型 `maxTokens = 128,000` ≫ 0.8 × 54,400 = 43,520,
**那道钳子不生效**。(他最初说的「16k summary 预算」属于固定值那一版,比例化后被 43,520 取代。)

### 合并规则(不是整份覆盖)

- **三个压缩参数每次照算出来的值写** —— 它们**由模型窗口推导**,不是用户偏好。用户的旋钮是
  设置面板里每模型的 `compressionRemainingPercent`,它是这里的输入。
- **其余键一个都不碰**。盘上真实文件带着 `httpProxy`(Codex 代理)和 `steeringMode`,
  整份覆盖等于把用户的代理配置抹掉 —— 守卫单独钉了这一条。
- 文件缺失 / 读不出 / JSON 坏了 ⇒ 从 `{}` 起,**不抛**。最坏退回 pi 缺省,和今天一样。
- **值没变不落盘**;写用 tmp + rename(pi 同步读这个文件,读到半截 JSON 会让它整份设置退回缺省
  —— 那正是本模块要修的毛病,不能由它自己制造)。

### 挂在哪

挂在 `getLlmConfig()` 上,因为它是**换模型、改余量百分比、启动**三件事的共同下游。
用**精确 token 数**而不是 `contextLengthK`(后者四舍五入到 K:272,000 → 266K → 反推 272,384)。

---

## ② 用户原话链 —— 「用户消息不能被压缩」

> 实现 `renderer/maestro/control/src/store/userChain.service.ts` · 守卫 `check-user-chain.mjs`
> Ral 2026-09-11：「用户发的消息不能被压缩」

### 在这之前 bl 是做反的

`selectCompactCandidates` 的可压集是 `session.messages.filter(isPromptContextMessage)` ——
判据里**没有任何一条排除 `role:'human'`**。也就是说用户原话照样进摘要，此后上下文里就只剩
模型复述的版本。没有报错、UI 上看不出来，只有在模型把用户说过的话记岔了的时候才暴露。

这不是「还没做」，是做反了。

### 为什么是「再追加一遍」而不是「不压它」

压缩的切点是 pi entry 树上的**一个下标**（`findCutPoint` 给 `firstKeptEntryIndex`），切点之前
整段折叠 —— 没有「跳过中间某几条」这种形态。所以保住原话的唯一办法是：照常摘要，然后把那批
原话作为一条 `custom_message` entry **重新追加**到摘要之后。

main 那一半一直是现成的（`compaction.handler.ts` 的 `applyToSession` → `appendCustomMessage`），
在等渲染端把 `userChainText` 交出来 —— **在此之前它是条死链**。

### 三条不能破的性质（与 cowork 逐条相同）

| | |
|---|---|
| **逐字** | 不归纳、不截断、不改写措辞。改一个字，这一段就退化成第二份摘要 |
| **排除自己与摘要** | 判据在 `isUserChainMessage`。链本身会作为 entry 回到上下文，下一轮再收进来就**逐轮翻倍** |
| **裁剪只在一处** | `buildUserChain` 结完账，渲染时不做第二次裁剪 —— 于是「哪些进链」只有一个答案 |

### 预算

`USER_CHAIN_BUDGET_TOKENS = 12,000`，与 cowork 的 `CONTEXT_SEGMENT_BUDGETS['user-chain']` 同值。
**倒着装、最新优先**，装不下的最老那些出链。

最新一条自己就超预算时（粘了一整份日志进来）：**留它、逐字、越预算**，不裁成空链 ——
空链等于这一刻上下文里没有任何用户意图，比越预算严重得多。这条路径在
`longPaste.service.ts` 接管之后会少很多：20,000 字符以上的粘贴在发送时就换成引用块了，到不了这里。

> 那个 20,000 字符阈值正是从这 12k 预算推出来的（≈5k token = 预算的 41%）。
> **改了预算就要重算阈值** —— `check-user-chain.mjs` 把这个比例关系钉住了。
> 推导见 [`long-paste-threshold.html`](../../../../areas/agent-runtime/chat/long-paste-threshold.html) #4。

### 与长粘贴转文件的联动（**必须共用同一个阈值**）

渲染端存的是**用户敲的原文**（UI 要显示原文，这是对的），而 main 只把**自己那一份**换成文件引用
（`longPaste.service.ts`，挂在 `sendAgentMessage`）。链是渲染端用 `session.messages` 建的 ——
所以不加判据的话：

> 一条 20 万字符的粘贴，发送时被换成约 300 字符的引用，**第一次压缩时又被原话链原样注入回来**。
> 长粘贴转文件从那一刻起形同虚设。

修法是让链服从同一个决定：超过 `LONG_PASTE_CHAR_THRESHOLD` 的消息**不进链**。
那个常量因此只能有**一处定义**（`longPaste.contract.ts`，在 `shared/`），两处判据必须同数 ——
不一致的两种后果都不报错：

| 漂移方向 | 后果 |
|---|---|
| 链的阈值更大 | 已换成引用的消息被链原样重新注入 ⇒ 长粘贴失效 |
| 链的阈值更小 | 还在正文里的消息被排除出链 ⇒ 用户原话白白丢了逐字保留 |

**为什么是排除而不是在链里换成引用**：渲染端算不出那个文件路径（文件名带时间戳与序号，由 main 生成），
给一个没有路径的占位比什么都不放更糟 —— 模型会去找一个不存在的地址。排除本身不丢东西：
那段内容在 main 的 entry 树里**本来就是引用形态**（带真实绝对路径），而链的职责是「把用户原话逐字留住」，
对这一类内容我们**已经决定了不逐字留**。

> 更好的形态是把路径也带进链（那样 `/view_context` 里连这一类也有指针），但要先让消息上区分
> 「用户敲了什么」与「模型拿到了什么」。**已报 Ral，待定。**

### 未做：出链条目的去处

cowork 把 `overflow` 交给 ④ 清单，在那里拿到 `out/chain/<messageId>.md` 地址。
**但那半在 cowork 也没实现** —— 渲染端生成地址，`src/main` 里没有代码写这些文件，模型去读就是 ENOENT。

所以 bl 这边先只**如实带出** `overflow`，不生成任何指向空文件的地址：宁可上下文里少一段，
也不给模型一个读不到的路径。

### 验证

`check-user-chain.mjs` 跑真源码，覆盖：逐字、从老到新、六类不该进链的消息、预算倒装、
最新超预算留它、空链渲染成空串、**接线本身**（渲染端传 + main 侧落 entry）、以及预算与长粘贴
阈值的比例关系。已反向验证：拆掉接线、去掉 `type` 判据，都立刻变红。**未跑 Electron E2E。**

---

## ② 用户原话链 —— 每会话一份 JSONL（2026-09-11 重做）

> 实现 `main/agent/userChainStore.service.ts` · 守卫 `check-user-chain.mjs`
> Ral 2026-09-11 定的形态。

### 形态

| | |
|---|---|
| 文件 | `<userData>/chain/<sessionId>.jsonl`，**会话创建时就有**（空文件） |
| 为什么空文件而不是"用到再建" | 路径从 newchat 起就在提示词里。空文件读出来是空，**不存在的文件读出来是错误** —— 后者会让模型以为自己用错了工具 |
| 为什么 jsonl 不是 md | 追加 **O(1)**，不用重写；一行一条，读尾巴不必解析整份；坏一行不致命；结构化字段不用自己发明分隔符 |
| 每条字段 | `n` 序号 · `at` 发送时间 · `ws` 当时的 workspace · `tab` 当时开着的页面 · `text` |
| 提示词预算 | **窗口的 10%**（Ral）。272,000 下 = 27,200 token |
| 路径注入 | 属 **C**（会话级、路径固定），落在表 3 的动态前缀里 —— 今天还没有独立的 C 层落点 |

### 整条归 main，渲染端退出

**这是这次重做的要点。** 上一版由渲染端用 `session.messages` 建链，而渲染端存的是
**用户敲的原文**，main 发出去的却是长粘贴换过的**引用**。后果：

> 一条 20 万字符的粘贴，发送时省掉，**第一次压缩时被链原样注入回来** —— 长粘贴转文件形同虚设。

现在 main 写进 jsonl 的**就是它真正发出去的那一份**，那类矛盾从根上不存在。顺带三样白拿：
顺序、元数据（时间/workspace/tab 只有 main 知道）、跨重启的持久化。

**顺序是判据的一部分**：必须先转文件再记历史。反过来的话 jsonl 里存的是原文，等价于没修。
守卫按行号钉住了这个先后。

### 「不重复、不遗漏」

文件是**发送即追加的全量**，提示词里的链是它的**尾巴**。交给模型的那段话点明边界：

```
Messages #1–#120 are ONLY in that file — read it with the `read` tool when you need them.
Messages #121–#156 are quoted in full below; do NOT re-read those from the file.
```

于是**模型需要读的部分**零重复零遗漏。`fileOnlyCount + quoted.length === total` 由守卫钉住。

> ⚠ 与 Ral 字面要求的一处偏离：他说文件里只放"被挤出去的"。那样在重启后会出现真空洞 ——
> 那批"还在提示词里、尚未固化"的记录既不在文件也不在内存。全量追加把空洞这一类可能性直接消掉，
> 代价只是文件里多存了已被引用的那几条（**不占上下文**）。已向他说明。

### 边界那句话是承重点

没有它，模型要么整份重读（浪费上下文，正是本机制要省的），要么干脆不读（那文件就白存了）。
守卫单独钉了 `do NOT re-read` 这句在。

### 未做

Ral 提的优化：文件太大时触发压缩再读，或**按用户意图分片读并总结、标记位置**
（读了 1-1000 行、1001-2000 行），免得上下文不够导致读不动大文件。**尚未实现。**
