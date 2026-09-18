# 每轮提示词把用户那句话埋在 74,547 字符的末尾

**报告日期**：2026-09-18，Ral：「说个 hi 调用了几十次无意义的 bash 调用，肯定有问题」、
「为什么导出 context 的时候，提示词的部分显示到最后，而不是会话」。

**状态**：根因已定（证据为 Ral 提供的 agent-io 实录）。P2/P3/P1-钻探 已实施并红灯验证。
P1-技能目录（72.4%）、P3b（单轮工具预算）、P4（导出显示会话）未动，理由见文末。

**证据**：`~/Library/Application Support/COWORK_TEST_DEBUG/agent-io/20260918174106964-9wkjcu7ohrkmu6rqkue`

## 症状

Ral 在一个新会话里发了 `hi`。模型连续调用了 41 步 `bash` / `read_file`，一次纯文本回复都没有。

同一份实录里，`kind=prompt` 的记录有 25 条，全部名为 `skills-catalog-request-boundary` ——
每一次模型请求都会重写一遍技能目录并整包落盘，所以单轮日志 3.1MB。

## 这一轮真正发出去的东西

`messages[0]` 是**一条** `role: user` 的消息，74,547 字符（≈69,205 tokens）。构成：

| 段 | 字符 | 占比 |
| --- | ---: | ---: |
| 技能目录 `<host_skill_catalog>`（66 条，每条一行 JSON） | 53,993 | **72.4%** |
| 钻探 DRILL 流程 | 9,593 | 12.9% |
| 其余（块首 + D1–D4 tab 上下文、浏览器/deep-fetch 策略、技能路由、workspace 工具块、会话记忆块） | ~10,961 | 14.7% |
| **`User message:` 之后，Ral 实际打的字** | **2** | **0.003%** |

`User message:` 这一行出现在第 **74,531** 个字符处 —— 整条消息的最后 0.02%。

## 根因

**用户那句话不是一条消息，是一条 74,547 字符指令墙的最后一行。** 分界只有正文里一行字面量
`User message:`，模型拿不到任何结构信号来区分"参考资料"和"这一轮要我做的事"。

这不是推测，`contextGraph.service.ts:30` 的注释早就写着同一件事：

> 因为 `user` 条目的正文**不是**用户那句话：它是整块拼装后的 turn prompt（系统提示词 + 每轮注入的
> 上下文 + 末尾 `User message: …`）。前缀匹配因此必然失败

于是一个 flash 档模型（本轮 `qwen3.8-flash`，thinkingLevel `low`，provider `ai-crms`）把指令墙当成
了任务。它第一条回复的 thinking 原文：

> The user wants me to scan the Cowork codebase (micromeet-cowork) for a new feature idea: expanding
> browser-use capabilities with network capture…

这个任务 Ral 从没提过 —— 是模型从墙里 `page_snapshot` / `ui_act` / `start_recording` / `drill` 这些词
**编出来的**，还给自己"引用"了一段并不存在的需求原话。之后 27 轮（截图为 41 步）每一轮
`stopReason` 都是 `toolUse`。

### 三个放大器，都不是"模型笨"

1. **`tool_choice` 是 `auto`**（`openAiChatProtocol.ts:121`）。没有任何配置强制调工具 ——
   这完全是提示词推出来的，所以换个开关修不了。
2. **墙里有一句明确的"别停"**：`If you stop early the host RE-PROMPTS you to keep going until every
   module is done — so there is no point stopping.` 它本来只针对钻探，却和别的段落平铺在同一条
   user 消息里，没有任何作用域标记。
3. **全文没有一条"闲聊就直接回答"的规则**。搜索 `greeting` 0 次、`small talk` 0 次。模型没有依据
   判断这一轮不需要动工具。

### 第二个症状是同一个根因

导出 / 预览取正文前 160 字符（`CONTEXT_GRAPH_PREVIEW_CHARS`）。本轮取到的是：

```
Context — Message sent at: 2026-09-18T09:41:08.786Z | page:
- Active workspace: /Users/ral/Documents/projects/overmind
Active tab when this message was sent:
{
```

**每一条 user 条目的开头都是提示词，会话在第 74,531 个字符处。** 所以"导出 context 看到的是提示词
不是会话"不是导出功能的问题，是被导出的那条消息本来就长这样。

## 设计文档早有定案，只是没落地

[`areas/agent-runtime/chat/prompt-structure.html`](../../../../areas/agent-runtime/chat/prompt-structure.html)
表 3.1（2026-09-16 登记）已经量过 BL 的同一条路径（当时 15,715 字符，钻探占 61%），并记下 Ral 的定案：

> 「肯定不搬啊，可以作为内置技能按需调用触发这个流程」
>
> 所以这一段的问题不是「装错层」，而是**无条件注入**：现在它零插值、无站点/浏览器开关地拼进
> **每一条** user 消息（steering 再发一次），纯聊天会话也照发 9,594 字符。

那份文档把实现明确留给两仓各自的 `docs/` 流程 —— 就是本文件。十天过去，同一条路径从 15,715 长到
74,547，主要增量是技能目录。

## 修复契约

**P2 · 请求必须可识别。**（本次实施）用户那句话用显式围栏包起来，并说明围栏之外全部是参考资料、
不是这一轮的指令。`pi` 的 `session.prompt(text)` 只收一个字符串，拆成两条消息要动 pi 边界，不在本次
范围内 —— 但围栏不需要动边界就能给模型一个明确判据。

**P3 · 闲聊逃生阀。**（本次实施）原来那条只在用户**明确说**「别用浏览器工具 / 只要聊天回答」时才
生效，且只挡浏览器那一组 —— 一句 `hi` 触发不了它的任何一个条件。新的一条按**请求本身**判（问候、
道谢、寒暄、问你是谁 → 直接回话、不调任何工具），并明说「上面那些描述的是你**能**做什么，从来没说
你**必须**做」。

**P3b · 单轮工具预算。**（本次**未**实施）本仓现在没有任何单轮工具上限（只有 workflow executor 的
`maxSteps`，管不到聊天回合）。真要一个不靠提示词的兜底，落点在 `piRuntimeSession.prompt()` 里数
`toolCall` 事件并到顶收尾 —— 那是新机制，上限取多少是产品判断，需要 Ral 定。没有它，P2/P3 仍然是
提示词级的说服，不是强制。

**P1-钻探 · 钻探改为 builtin 技能。**（2026-09-18 已实施，Ral 当天追加「现在就做」）执行 2026-09-16
的定案。**没有用"按需开关"那条路** —— 它需要一个「钻探进行中」的信号从 `DrillService` 穿到
`buildAgentTurnPrompt`，只按关键词开关会把跑到一半的多轮钻探在下一轮打断。

实际走的是更简单也更准的一条：**那 10,464 字符里的大部分本来就是重复的**。
`explore_session {"action":"begin"}` 的回包 `BEGIN_GUIDANCE`（cowork 7,582 / bitterless 7,956 字符）
已经完整交付了循环怎么跑 —— observe→act、`ui_act`、`explore_record` 的 plan/module/module_done/
expectedChildren、登录墙、分支新标签页、commit control、覆盖率判据。**那是按需交付，时机也更对**：
人真的开钻时才读到。

所以：

- 新建 `drill.skill.ts`（形状照 `deepFetch.skill.ts`），把 `DRILL_BUILTIN_SKILL` 从 service 搬进来，
  和 `DRILL_ROUTE` 放在一起；
- 每轮提示词里只留 `DRILL_ROUTE` —— `begin` **之前**必须知道的四步路由，和 `end` **之后**才用得上的
  收尾纪律（完成播报归谁说、失败回合不许写成成功、`focus` 续钻、已探站点走 sitemap）。
  实测 `BEGIN_GUIDANCE` 这两头一个字都没有（`start_recording` / `ingest_recording` / `apidoc` /
  完成播报 命中数全为 0），所以它们必须留下；
- `BEGIN_GUIDANCE` 也缺的两条（`uncovered` 结算、`end` 的强制前置）补进 `DRILL_ROUTE` —— 不补的话
  模型只能靠撞 `end` 的拒绝才知道自己还没完，可恢复，但白跑一轮。

结果（2026-09-18 19:00 复测，前一版写的 ~20.4k → 9,861 是错的，来源是源码 diff 的字符数而不是渲染出来的提示词）：

| | 改前 | 改后 | 差 |
| --- | ---: | ---: | ---: |
| 钻探块本身 | 9,672 | 5,002（`DRILL_ROUTE`） | **−4,670** |
| 空 briefs 的整条 user 消息 | 14,890 | 10,220 | −4,670（−31%） |
| 真实会话（66 条技能目录） | 75,415 | 69,471 | −5,944（−7.9%） |

空 briefs 的两个数分别取自 `805da0a` 与 HEAD 的 `buildAgentTurnPrompt`；真实会话两个数取自 Ral 的两份实录
（`COWORK_TEST_DEBUG/agent-io/20260918182726077-*` 与 `Micromeet Cowork/agent-io/20260918185611709-*`）。

真实会话只降 7.9%，是因为**技能目录 53,4xx 字符一个字没动** —— 那条等 Ral 定。钻探正文不再每轮发、steering 不再重发一遍。

**P1-技能目录 · 需要 Ral 定夺。**（本次不动）它占 72.4%，是真正的大头。但"完整目录"是**刻意的
设计不变量** —— `refreshModelSkillCatalog` 在超预算时硬失败并声明「no skills were silently
omitted」。把它改成按需/分页是产品决定，不是缺陷修复，所以不在本次单方面改。备选：只注入
id+name+triggers 的精简索引，正文走已有的 `get_skill_contract`。

**P4 · 导出显示会话 · 需要 Ral 定夺。**（本次不动）P2 之后围栏让人一眼能在正文里找到那句话，但
`CONTEXT_GRAPH_PREVIEW_CHARS` 取的仍是提示词开头。要让导出/预览直接显示会话，得让记录本身单独
带上用户原文字段 —— 那会改动记录格式，牵涉 `contextGraph` 的归属匹配，值得单独一条。

## 验证

不跑 Electron E2E（CLAUDE.md）。本次以计数断言为准：

- 围栏存在，用户原文逐字在围栏内，且围栏之后没有任何内容；
- 围栏前面明说「上面是参考资料、不是任务、唯一的请求在下面」；
- 闲聊逃生阀按请求本身判、覆盖全部工具，且排在旧的「用户明确要求」那条之前；
- 旧的裸 `User message:` 收尾不再出现。

`turnPromptFencesTheRequest.test.mjs`（两仓同一份，cowork `tests/unit/` · bitterless
`tests/maestro/`）：**各 6/6**，并做过**红灯验证** —— 把提示词还原成回归前的裸 `User message:`
收尾，两边都是 6 条里 5 条判红。

类型检查：cowork `typecheck:node` 19、bitterless `main` surface 63，均与基线同量，改动文件零诊断。

bitterless 的 `maestroDeepFetchSkill.test.mjs` 里有一条 `prompt.endsWith(message)` 随围栏一起更新为
断言围栏形状；该文件目前因另一个会话在途的 `virtual:bitterless-pi-skills` 打包插件而无法构建
（把本次改动 stash 掉照样失败），所以它跑不出结论，与本次改动无关。

Ral 的真机验收：新开会话发 `hi`，应当直接得到一句回话，零工具调用。

## 配对范围

micromeet-cowork 同一条路径、同一份 `agentPrompt.ts`，两边一起改。本文件的实录出自 cowork；
本仓的 `agentPrompt.ts` 结构相同（尾部多一个 `params.catalog`），同样的围栏与逃生阀已一并落地。
