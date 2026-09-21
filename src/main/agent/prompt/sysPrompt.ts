/**
 * **Maestro 的 system prompt。**
 *
 * 从 pi 手里把 system 槽位接管过来 —— 传了它之后 pi 的 `buildSystemPrompt()` 走
 * `customPrompt` 分支（`system-prompt.js:15` 的 `if`,`:34` 提前 return），
 * 原厂那段 A1–A5 **整块不生成**,只剩下 pi 仍会追加的 appendSystemPrompt /
 * `<project_context>` / skills / `Current working directory:`(`system-prompt.js:17-33`)。
 *
 * **这里包含表 1 的固定 A1–A5 与 A7**:进程级,所有会话共用。A6 项目指令由 `projectInstructions.ts`
 * 读取、`BaseAgent` 插入。另两层不在这个文件里 ——
 * 「会话基础」(角色/场景,会话内不变、会话间可不同)尚无内容;「动态」(当前页面、时间、预算)
 * 每轮重拼,**刻意不进 system** —— 放进来会让缓存前缀(system → tools → 会话历史)每轮作废。
 * 等那两层真有内容时再写组装,那时才知道它该长什么样。
 *
 * **段号 A1–A5 与设计文档一一对应；A6 项目指令由宿主逐回合读取**,查取舍去那里:
 * `areas/agent-runtime/chat/prompt-structure.html` #1 表 1。
 * 契约:`docs/features/maestro-system-prompt-layers.md`
 *
 * 段的来源分两类:
 *  · **A1–A4** —— **逐字**取自 pi 0.85.1 的默认模板(`core/system-prompt.js:81-98`),
 *    只有 A1 的宿主名换成了本产品。**A5 是唯一的删除** —— `Pi documentation` 块
 *    (1408 字符,占原基座 49%),它教模型去读 pi 自己的 README/docs/examples,
 *    Maestro 的场景里永远用不到。Ral 2026-09-11:「A5 确实需要去掉」。
 *  · **SESSION_ROLE_HINT**(A5) —— **我们自己加的**,不在 pi 的模板里,替代原厂文档索引段。
 *    它是表 2 的桥,见那一段的注释。
 */

/**
 * **A1 · 基座人格。** pi 默认原句,**只把宿主名换成本产品**。
 *
 * Ral 2026-09-11:「bitterless 中 A1 要叫做 coding assistant inside bitterless,
 * cowork 中要叫做 inside cowork」。**这是唯一的改动** —— 句子其余部分仍是 pi 原文逐字
 * (`core/system-prompt.js:81`),此前我整句改写过人格,已撤(他没要求改)。
 *
 * 为什么要换:模型被问"你跑在什么里"时会照这句回答。说 pi 等于把内部依赖名报给用户,
 * 而用户面对的产品叫 bitterless。
 *
 * **cowork 那份已同步**(`micromeet-cowork:apps/cowork/src/main/agent/prompt/sysPrompt.ts`),
 * 那边写的是 `inside cowork`。两个文件除这一个词外逐字相同 —— 改一边就改另一边。
 */
const A1_PERSONA = `You are an expert coding assistant operating inside bitterless, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.`;

/**
 * **A2 · 工具表。** 这 7 行对应 `BaseAgent.ts` 的 `DEFAULT_PI_BUILTIN_TOOLS`,
 * 文案是 pi 自己为这些工具写的 `promptSnippet`(`core/tools/*.js`),准确且便宜。
 *
 * **宿主工具从来不在这段里** —— bl 的 `AgentToolSpec` 没有 `promptSnippet` 字段,
 * 它们只经工具调用 schema 到模型。所以接管这段对宿主工具零影响。
 *
 * **改内置工具集时必须同步改这里**:关掉某个工具而这里还列着,等于告诉模型有它调不到的工具。
 */
const A2_AVAILABLE_TOOLS = `Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call
- write: Create or overwrite files
- grep: Search file contents for patterns (respects .gitignore)
- find: Find files by glob pattern (respects .gitignore)
- ls: List directory contents`;

/**
 * **A3 · 自定义工具兜底句。** pi 原句,逐字。
 *
 * 它是 A2 隐身问题的唯一补救 —— 模型只能从这一句推断"我可能还有别的工具"。
 * 此前改写成点名 `host_tool_catalog` 的版本已撤(Ral 没要求改);要改的话它属于产品层。
 */
const A3_CUSTOM_TOOLS_HINT = `In addition to the tools above, you may have access to other custom tools depending on the project.`;

/**
 * **A4 · 行为准则。** 9 条:前 7 条由那些内置工具各自登记的 `promptGuidelines` 而来,
 * 最后 2 条是 pi 恒有的(`system-prompt.js:78-79`)。
 *
 * 看着像"一个浏览器产品的准则大半在讲改文件",但那 7 个内置文件工具是真开着的,
 * 这些纪律就是真需要的;`edits[].oldText` 那几条细节自己写必错。
 * 与 A2 同理:关掉内置工具就要同步删掉属于它的条目。
 */
const A4_GUIDELINES = `Guidelines:
- Use read to examine files instead of cat or sed.
- You can inspect PI_* environment variables for current model and session details.
- Use edit for precise changes (edits[].oldText must match exactly)
- When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls
- Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.
- Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.
- Use write only for new files or complete rewrites.
- Be concise in your responses
- Show file paths clearly when working with files`;

/**
 * **A5 · 职责不限于写代码。** 这一段**不是** pi 原文,是我们自己加的。
 * 原厂的 Pi documentation 文档索引块已删；2026-09-15 从 A6 改编号为 A5，原文不变。
 *
 * Ral 2026-09-11:「agent 除了 coding agent 可能承担别的职责,需要在 system prompt 中指明下,
 * 后续 agent 就能按会话基础提示词里定义的角色或职责等来行动了」;随后要求**只留这两句**
 * (原来那版写了优先级、工具定位、无角色兜底,共 533 字符 —— 太繁杂)。
 *
 * **它是「表 2 会话基础提示词」的桥。** 没有它,基座只说"你是 coding assistant"(A1),
 * 会话层将来给的角色(客服 / 浏览器操作员 / …)就没有任何着力点。
 *
 * 放在最后:表 2 的内容将来就追加在这段之后,而且不切断 A1–A4 那块 pi 原文的连续性。
 */
const SESSION_ROLE_HINT = `Your responsibilities are not limited to coding. A session may assign you a specific role, scenario, or scope.`;

/**
 * 段间用 `\n\n` —— 与 pi 原模板的分隔**逐字节一致**(`system-prompt.js:81-89` 的模板字面量里
 * 每段之间就是一个空行)。
 *
 * 拆分只是为了可读与可查。**前四段**拼回去除了 A1 里那个宿主名,与接管前 pi 生成的那
 * 1448 字符完全相同 —— 守卫按这个口径断言,别把 `SESSION_ROLE_HINT` 算进去,它是我们加的。
 */
export const BASE_SYSTEM_PROMPT = [
  A1_PERSONA,
  A2_AVAILABLE_TOOLS,
  A3_CUSTOM_TOOLS_HINT,
  A4_GUIDELINES,
  SESSION_ROLE_HINT
].join('\n\n');

/** A7 · Shared discipline. A6 is inserted before this block by BaseAgent. */
export const A7_DISCIPLINE = `## Discipline
- Treat interruptions as updates to the active task. Complete earlier unfinished requests alongside new requests when they do not conflict. Follow the latest instruction for conflicting parts; drop earlier work only when explicitly cancelled or replaced. Update the plan with update_plan when available.
- Instructions vs data
- Think before acting
- Be decisive otherwise
- Minimum & surgical
- Endpoints are grounded, not guessed
- Verify against the goal
- Name conflicts
- Report honestly
- Statement, summary or report goes to a file first. Write it as markdown under the workspace, place it by the same domain rule as any other new file, then open it for the user with the preview tool. Chat reply keeps two or three lines plus the link, not the whole text.
- Link every file you produce.`;
