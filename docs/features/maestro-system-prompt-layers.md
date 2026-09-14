# Maestro 系统提示词分层 —— 接管 pi 的基座

Ral 2026-09-11：「`prompt/sysPrompt.ts` 下要有完整的系统提示词并给 base agent 应用上」、
「A5 确实需要去掉」、「A1 的你的改动不对，需要还原成 pi 默认的 —— 我没提要求你不能改」。

设计与逐层取舍：[`areas/agent-runtime/chat/prompt-structure.html`](../../../../areas/agent-runtime/chat/prompt-structure.html) #2。

## 2026-09-14 的 runtime 契约

完整提示词由 `BaseAgent.fullSystemPrompt()` 生成，包含表 1、当前模型身份和表 2；
`systemPrompt: string` 为所有 runtime 必填的非空输入。公共提示词模块确定 cwd 及末尾说明，
pi 仅将已定稿内容映射到 SDK，不能选择默认人格。与 CoWork 的 AI-CRMS 使用同一契约，
相同输入应得到相同的最终 system 文本。
实现与验证进度见 [adapter 职责重构](../issues/runtime-adapter-responsibility.md)。
下文保留初次接管时的设计依据；首条 user 前缀、可选提示词等旧描述不再代表当前契约。

## 接管前的状况（历史实测）

`piRuntimeAdapter.ts:156` 的 `createAgentSession` 不传 `resourceLoader` → pi 自建
`DefaultResourceLoader`（`sdk.js:75-79`）→ 找不到 `SYSTEM.md` → `customPrompt` 为 `undefined`
→ `system-prompt.js:15` 那个 `if` 不成立 → 走默认分支，**A1–A5 全部生成**。

实测 **2858 字符 ≈ 817 token**：

| 段 | 内容 | 字符 | 处置 |
|---|---|---|---|
| A1 | `You are an expert coding assistant operating inside pi…` | 171 | **只换宿主名** → `inside bitterless` |
| A2 | `Available tools:` + 7 个内置工具各一行 | 391 | **逐字保留** |
| A3 | `In addition to the tools above…` | 101 | **逐字保留** |
| A4 | `Guidelines:` 9 条 | 787 | **逐字保留** |
| A5 | `Pi documentation` 块（教模型读 pi 自己的 SDK 文档） | **1408** | **删除** |

A2 那 7 行对应 `BaseAgent.ts:124 DEFAULT_PI_BUILTIN_TOOLS`（`read/bash/edit/write/grep/find/ls`），
七个都带 `promptSnippet`；A4 的 9 条 = 7 条由这些内置工具登记 + 2 条恒有。
**宿主工具一个都不在 A2 里**（bl 的 `AgentToolSpec` 没有 `promptSnippet` 字段），所以接管这段对宿主工具零影响。

## 这次做什么

**只做一件事：把 A1–A5 这块基座从 pi 手里接过来，A1–A4 逐字照搬，删掉 A5。**

A1 有一处例外：宿主名换成本产品 —— Ral 2026-09-11「bitterless 中 A1 要叫做 coding assistant inside bitterless，cowork 中要叫做 inside cowork」。句子其余部分仍是 pi 原文逐字。

除此之外不改人格、不动 A3 的措辞 —— 那些是产品层的事，Ral 没要求改。

- 新增 `src/main/agent/prompt/sysPrompt.ts`：A1/A2/A3/A4 + `SESSION_ROLE_HINT` 五个模块私有常量，`join('\n\n')` 成
  导出的 `BASE_SYSTEM_PROMPT`（1456 字符）。**只导出这一个常量** —— 曾经加过一个带 `session?` 参数的
  `buildSysPrompt()`，那是为尚无内容的会话层先付抽象税（和刚删掉的 `CoachRuntimeAdapter` 同一个毛病），已删
- `AgentRuntimeSessionOptions.systemPrompt: string` 为必填契约
- `BaseAgent.createSession()` 把它传给运行时
- `PiRuntimeAdapter.createSession()` 收到它就构造一个**最小 loader**，`getSystemPrompt()` 返回它

最小 loader 而不是 `DefaultResourceLoader`：后者会连带接手 A7（项目上下文文件发现）与 A8（skills 扫描），
还要 `await reload()`。形状照已在跑的 `codex/codexRuntime.service.ts:746-763 createSterileResourceLoader`。

**顺带关掉 A7 的一个真实风险**：pi 会从 `cwd` 一路 `dirname()` 走到文件系统根，收每层的
`AGENTS.md`/`CLAUDE.md`（`resource-loader.js:82-108`）。bl **没传 `cwd`** → `process.cwd()`，
dev 下从仓库启动就可能把 `overmind/CLAUDE.md`（47 KB ≈ 1.2 万 token）吸进 system 段。
最小 loader 的 `getAgentsFiles()` 返回空，这条路直接断掉。


## 段 6 · `SESSION_ROLE_HINT`（pi 没有的，我们加的）

Ral 2026-09-11：「agent 除了 coding agent 可能承担别的职责，需要在 system prompt 中指明下，
后续 agent 就能按会话基础提示词里定义的角色或职责等来行动了」。

```
Your responsibilities are not limited to coding. A session may assign you a specific role, scenario, or scope.
```

**它占掉 A5 的位**（A5 是 pi 的文档索引块，已删），**是会话基础层（设计文档表 2）的桥** ——
没有它，基座只说「你是 coding assistant」（A1），会话层将来给的角色（客服 / 浏览器操作员 / …）
就没有任何着力点。放在最后：表 2 的内容将来追加在这段之后，也不切断 A1–A4 那块 pi 原文的连续性。

**2026-09-11 精简过一次。** 初版 533 字符，写了三层意思：「会话角色压过基座人格」、
「工具是手段不是身份」、「无角色时按通用助手走」。Ral 判定太繁杂，只留这两句（110 字符）。

**因此丢掉的是「优先级」那句明示。** 今天表 2 为空、不存在与 A1 冲突的角色，所以不影响；
等表 2 真写进角色时要重新判断这句还需不需要 —— 留档备查。

代价 110 字符：接管净省 **43%**（删 A5 的 1408，加回 110）。

## 不在这次范围

- **产品层**（`MAESTRO_SYSTEM_PROMPT` / `SKILL_EXECUTION`）仍拼在第一条 user 消息里
  （`BaseAgent.ts:621 withSystemPreamble`）。把它搬进 system 是下一步，要逐段过内容。
- **会话基础层**（角色/场景，见设计文档表 2）—— 预留，暂无内容。
- **动态层**（每轮重拼）—— 需要 `prepareNextTurn` / `onPayload` 钩子，另一件事。

## 静默失效模式（这是必须防的）

pi 对 `customPrompt` 只做 truthy 判断（`system-prompt.js:15`），实测两种失效**都不报错**：

| 传入 | 结果 |
|---|---|
| `''` / `undefined`（loader 抛错被吞、配置错） | **A1–A5 原样回来**，长度 2858，看起来完全正常 |
| `'   '`（只有空白） | 走 customPrompt 分支，但基座只剩 41 字符，**A2/A4 一起没了** |

所以 `PiRuntimeAdapter` 在构造 loader 前必须断言 `systemPrompt.trim()` 非空 —— 宁可启动失败，
不可静默退回 pi 原厂。

## 验证

- `TYPECHECK_SURFACES_LIST_ERRORS=1 yarn typecheck:node` —— 不高于基线
- 组装结果断言：**不含** `Pi documentation`；**除 A1 那个宿主名外与 pi 原文逐字节相同**；
  A2 七行齐、A4 九条齐；段 6 在且是最后一段；最终 **1599** 字符（接管前 2858，省 43%）
- `node scripts/maestro/check-agent-runtime.mjs`
- **未跑 Electron E2E**（项目规则：非 Ral 当场要求不主动跑）

### 还没做的三道保障

真实会话侧的自检（读 `session.systemPrompt` 这个公开 getter，`agent-session.d.ts:299`）、
`pi-session-start` 日志里打提示词长度 + 短哈希（静默退回会表现为长度跳变 1450 → 2858）、
以及一条仓库守卫钉住「adapter 必须传 resourceLoader」。Ral 未批，留档待定。
