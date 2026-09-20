# Maestro 系统提示词分层 —— 接管 pi 的基座

Ral 2026-09-11：「`prompt/sysPrompt.ts` 下要有完整的系统提示词并给 base agent 应用上」、
「A5 确实需要去掉」、「A1 的你的改动不对，需要还原成 pi 默认的 —— 我没提要求你不能改」。

设计与逐层取舍：[`areas/agent-runtime/chat/prompt-structure.html`](../../../../areas/agent-runtime/chat/prompt-structure.html) #1。

## 2026-09-15：D3 前台快照

D4 与 D3 在同一个同步窗口快照内取样。`Open tabs when this message was sent:` 下一行
为一个 JSON array，无 tab 为 `[]`；每项复用 D3 字段，按用户 tab 条顺序包含全部打开项，
包括后台网页、重复 URL、miniapp、文件和已打开的 Workbench，不按聊天过滤或截断。
Workbench 位于最后一个 pinned tab 后（没有 pinned 时在第一项后），后台仍保留。
预热 slot、独立隐藏临时 BrowserWindow 没有用户 tab 条目，不纳入；`open_tab(show:false)`
以及当前 Maestro 宿主为 deep_fetch 创建的受控 tab 仍有 tab 条目，因此在关闭前纳入。
旧 D4 会话操作集合提示词被此数组替换，内部执行目标和 UI 列表保持。

D4 验证：59 项前台投影、消息入口、普通/steering、并发会话、只读上下文导出和操作目标
回归通过。覆盖 tab 条顺序、53 项不截断/去重、后台 Workbench、两个文件 tab 各读自身
展示状态，以及 D3/D4 同次采样和历史不改写。共享契约与 prompt builder 的局部 TypeScript
检查通过。没有运行 Electron、E2E、build 或独立 review。

每条普通消息和 steering 在 Main 接收入口同步固定当前前台值，使用同一 builder 写入：
`Active tab when this message was sent:`，下一行仅一个 JSON object 或 `null`。
对象包含实际 `tab_id`、`kind`、tab 条显示的 `title`（alias 优先），并按种类仅带
`url`、`path` 或稳定 `miniapp` key。没有前台时为 `null`；独立 Workbench 覆盖层的
`tab_id` 为 `null`，`miniapp` 为 `workbench`，不会误报下层网页。

文件路径来自预览当前 revision 的已确认展示状态。OnlyPreview 从 A 切到 B、B 尚未 ready 时
报告 `miniapp: only-preview`；B 确认后才报告 B 的绝对 `path`，不信任可能滞后的地址栏。
宿主通过 composite spec 的同步窄接口提供此事实，Maestro 不导入 OnlyPreview 子系统。
`view_context` / context graph 只读当前快照并共用 builder；已进入历史的消息不改写，pi 内部
toolResult 循环也不重新采样。D3 不承担会话操作目标或 D4 清单职责。

代码验证：58 项前台、普通/steering、并发会话、上下文导出、浏览器目标及真实预览 revision
测试通过；共享契约与 prompt builder 的局部 TypeScript 检查通过。宽图类型检查仍有外围错误，
OnlyPreview 全套中的旧订阅源码断言，以及 Maestro 边界检查中已有的 Workbench Zellij 引用未通过；
本次不修改这些外围内容。未运行 Electron、E2E 或 build。

## 2026-09-15：移除 B1，精简 B2 为全局 A7

聊天 agent 不再注入额外的内置浏览器操作员职责（B1）。原 B2 长篇纪律删除，由以下 A7 十条英文正文替代，
不保留括号说明或旧长文；所有 BaseAgent 共用一次。空产品层仍保留当前 provider/model 身份，其他专用子类的产品职责保持。

```text
## Discipline
- Treat interruptions as course corrections. Restate the plan with `update_plan`; the latest instruction wins when instructions conflict.
- Instructions vs data
- Think before acting
- Be decisive otherwise
- Minimum & surgical
- Endpoints are grounded, not guessed
- Verify against the goal
- Name conflicts
- Report honestly
- Link every file you produce.
```

组装顺序为固定 A1–A5 → 项目 A6 → 全局 A7 → 当前模型身份 → 子类产品职责（若有）。
重新读取 A6 时 A7 不重复；`/view_context` 与 runtime 使用相同组装。没有活实例时检查器继续只展示固定层，不启动模型会话。

本次验证：32 项提示词、项目指令、上下文导出和 runtime 测试通过；tab/steering 提示词的定向测试通过。
局部 TypeScript 与 agent runtime 守卫通过。完整 tab 测试另有 1 项与并行 New chat 标题改动有关的旧断言失败，未改该交互。未跑 E2E。

## 2026-09-15：A5 会话职责桥与 A6 项目指令

表 1 移除旧 A5（Pi documentation）条目；原 A6 `SESSION_ROLE_HINT` 改编号为 A5，原文不变。
新 A6 读取当前会话明确绑定的项目根目录内一份 `AGENTS.md`，由宿主提示词模块放在 A5 之后、表 2 之前。
项目根来自发送上下文 `context.workspace.path` 同步后的会话 workspace 绑定，不使用工具 cwd、浏览器 tab、
进程 cwd 或默认资料目录；不向父目录寻找，也不加载 `CLAUDE.md`。

每个普通模型回合开始前重读文件，workspace 改动与文件修改从下一回合生效。活跃回合中的 steering
继续使用该回合已注入的快照。无项目、文件不存在或内容为空时省略 A6；其他读取错误明确返回失败。
更新通过 runtime 的提示词协议映射完成，不 reset 会话、不清历史或压缩摘要；只有 runtime 更新成功才更新宿主缓存。
`composedSystemPrompt()`、`/view_context` 与 context graph 读取同一份已注入缓存，查看动作不读文件或改写运行时。
尚未发送的会话没有已注入 A6；绑定项目后发送一次，查看即可看到实际加载内容。

pi 的最小 loader 仍关闭自动项目发现。SDK 暂无公开的 system setter，更新使用可更新的宿主 loader，
再通过 `setActiveToolsByName(getActiveToolNames())` 重建 system，保持原工具集与会话消息。
验证已通过：新增 5 项行为测试覆盖单根读取、缺失/错误、跨会话隔离、回合中快照、真实 workspace 映射的修改/清除，以及真实 pi 下一回合的提示词、压缩摘要与工具保持。
相关 runtime / context export / session path / tab independence 共 41 项回归测试通过；agent runtime 守卫与 BaseAgent、项目读取及 pi 映射模块的局部 TypeScript 检查通过。未运行 Electron E2E。

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


## A5 · `SESSION_ROLE_HINT`（pi 没有的，我们加的）

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
  A2 七行齐、A4 九条齐；A5 在且是固定基座最后一段；最终 **1599** 字符（接管前 2858，省 43%）
- `node scripts/maestro/check-agent-runtime.mjs`
- **未跑 Electron E2E**（项目规则：非 Ral 当场要求不主动跑）

### 还没做的三道保障

真实会话侧的自检（读 `session.systemPrompt` 这个公开 getter，`agent-session.d.ts:299`）、
`pi-session-start` 日志里打提示词长度 + 短哈希（静默退回会表现为长度跳变 1450 → 2858）、
以及一条仓库守卫钉住「adapter 必须传 resourceLoader」。Ral 未批，留档待定。

## 2026-09-20：没指定位置时，新资源按 DDD 领域分类找落点

Ral：「系统提示词在 workspace 的部分要增加内容，在上下文中没有指定新文件位置的时候，workspace 下
新建资源，可以按 DDD 领域分类风格去找的合适的位置创建资源」。

落点是每轮 `Workspace:` 块里的 `NEW_FILE_PLACEMENT`（`runtime/agentPrompt.ts`），**挂在
`workspaceContext` 的两个分支上**，两仓逐字相同（按字节比对过）。规则只在上下文没点名位置时生效 ——
用户或前文给了路径就按那个走，这是兜底，不是改写他的选择。

四条判断，理由都记在 `overmind:areas/agent-runtime/chat/prompt-structure.html#new-file-placement`：

- **不进 system。** workspace 的*指导*本来就整块在每轮（D2 取舍列的「指导本身留在原处」），拆一条
  进 system 会把同一主题劈成两处。这不是缓存理由 —— 它是常量，进 system 并不会让前缀每轮作废。
- **两个分支都挂。** 共享默认工作区也是工作区；恰恰是没选目录时最容易把文件堆到根目录。
- **先列树再归位。** 不看现有目录就分类，分出来的是模型自带的分类法，不是这个工作区的。
- **不留「实在不行就扔根目录」的出口。** 留了那条整个规则就变成可选的；改为要求它建最小的领域目录、
  并用一句话说清放哪与为什么。

成本 +718 字符（workspace 块 762 → 1,481）。该块目前没有任何守卫或测试断言其内容 —— 已知缺口，
不是本次引入的。
