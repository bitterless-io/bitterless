# rig-coder：内置编程 Agent 模块开发说明

## 概述

rig-coder 是 bitterless 的内置编程 Agent 子模块，负责自主完成代码开发任务（文件读写、代码编辑、命令执行、项目搜索等）。它作为主 Agent 的 sub-agent 运行，由主 Agent 通过 tool calling 派发编程任务。

**核心原则**：优先使用 LangGraph.js + LangChain 生态实现 Agent 循环和多模型适配；LangGraph 不包含的功能（编程工具层、System Prompt、上下文压缩策略等）参考 Cline（github.com/cline/cline）自行实现。

---

## 模块清单

### 模块 1：Agent Graph（Agentic 循环）

- **策略**：复用 LangGraph.js
- **职责**：
  - 思考 → 工具调用 → 结果回传 → 继续的核心循环
  - Plan/Act 双模式切换（Plan 模式先规划，Act 模式执行）
  - 中断/恢复（LangGraph interrupt）
  - 人工审批节点（LangGraph human-in-the-loop）
  - 流式输出（LangGraph streaming）
- **技术**：`@langchain/langgraph`、`@langchain/core`
- **自研内容**：图的节点定义、条件路由逻辑、Agent 状态类型定义

### 模块 2：多模型适配

- **策略**：复用 LangChain 模型包
- **职责**：
  - 统一调用 Claude / GPT / Gemini 等模型
  - 统一 tool calling 格式（Anthropic tool_use / OpenAI function_calling / Gemini functionDeclarations）
  - 流式响应处理
  - Token 计数
- **技术**：`@langchain/anthropic`、`@langchain/openai`、`@langchain/google-genai`
- **自研内容**：模型配置管理（运行时切换模型、Plan/Act 使用不同模型）

### 模块 3：编程工具层（核心自研）

所有工具参考 Cline 源码中 `src/core/task/` 的工具实现设计。

#### 3.1 readFile — 读取文件

- 功能：读取文件内容，支持行范围（offset + limit）
- 参考 Cline：`read_file` 工具的参数设计（path + line range）
- 复杂度：低

#### 3.2 writeFile — 创建/覆写文件

- 功能：写入文件，自动创建中间目录
- 参考 Cline：`write_to_file` 工具的实现，特别是目录自动创建和编码处理
- 复杂度：低

#### 3.3 editFile — 精确编辑文件（⭐ 最核心最难）

- 功能：基于 search/replace 块精确编辑文件的某几行
- 技术：`diff-match-patch-es`（fuzzy matching）
- 参考 Cline：**重点参考** `replace_in_file` 工具的完整实现：
  - search 内容的 fuzzy matching 定位策略
  - 多个 search/replace 块的顺序应用
  - 部分匹配时的容错处理
  - 空白字符/缩进的归一化比较
- 复杂度：高

#### 3.4 searchFiles — 代码搜索

- 功能：在项目中搜索文本/正则，返回匹配的文件和行
- 参考 Cline：`search_files` 工具——ripgrep 集成方式、结果格式化（文件路径 + 行号 + 上下文行）、`.gitignore` 尊重
- 技术：`fast-glob` 或 spawn `ripgrep`
- 复杂度：中

#### 3.5 listDir — 列出目录结构

- 功能：递归列出目录树，过滤 `.gitignore` 中的文件
- 参考 Cline：`list_files` 工具——递归深度控制、输出格式（树形 vs 平铺）、大目录的截断策略
- 复杂度：低

#### 3.6 runCommand — 执行 Shell 命令

- 功能：执行 shell 命令，流式回传输出，支持超时和中断
- 参考 Cline：**重点参考** `execute_command` 工具和 `TerminalManager` 类：
  - 实时输出流式回传机制
  - 命令超时处理
  - 长输出截断策略（防止 token 爆炸）
  - 进程状态监控（running / completed / error）
  - 工作目录管理
- 复杂度：中

### 模块 4：System Prompt（核心自研）

- **策略**：自研
- **职责**：指导模型如何使用工具、如何规划、编码规范、错误处理策略
- **参考 Cline**：**重点参考** `src/core/prompts/` 目录：
  - system prompt 的整体结构设计（角色定义 → 工具说明 → 规则约束 → 输出格式）
  - 工具使用的格式定义
  - Plan 模式和 Act 模式的 prompt 差异
  - 环境信息注入（OS、shell、cwd、项目结构）

### 模块 5：上下文管理（自研 + LangGraph）

- **策略**：自研截断策略 + LangGraph checkpointer 持久化
- **职责**：
  - 对话历史压缩/截断
  - Token 预算管理
  - 关键上下文保留
- **LangGraph 覆盖**：对话历史持久化（checkpointer）、状态快照
- **参考 Cline**：**重点参考** `ContextManager` 类：
  - 模型感知的 context window 大小判断（64K / 128K / 200K）
  - 主动截断策略（半截 / 四分之三截）
  - 始终保留首条任务消息
  - 截断后保持 user-assistant 交替结构
  - Context window 溢出错误的自动检测和恢复

### 模块 6：MCP 集成

- **策略**：复用 `@modelcontextprotocol/sdk`
- **职责**：
  - MCP Server 生命周期管理（连接、断开、重连）
  - 工具发现和注册
  - 工具调用转发
- **参考 Cline**：`src/services/mcp/McpHub.ts`：
  - 多 MCP Server 并行管理
  - Server 健康监控和自动重连
  - MCP 工具 → Agent 工具的格式转换
  - Server 配置文件格式
- **自研内容**：`McpManager` 类、MCP tool → LangChain tool 适配器

### 模块 7：浏览器控制

- **策略**：复用 Playwright MCP Server（`@playwright/mcp`）
- **职责**：网页导航、点击、输入、截图
- **实现**：作为 MCP Server 接入，模块 6 自动覆盖，零额外开发

### 模块 8：Git Checkpoint

- **策略**：自研 + `simple-git`
- **职责**：
  - 每次工具执行后创建 checkpoint
  - 支持回滚到任意 checkpoint
- **原理**：使用 shadow git repo（`--git-dir` 与 `--work-tree` 分离），不污染用户项目的 git 历史
- **参考 Cline**：`CheckpointTracker` 类：
  - 基于 shadow git repo 的实现
  - Checkpoint 命名策略
  - 回滚时的文件恢复逻辑

### 模块 9：通信层（可嵌入性）

- **策略**：自研
- **职责**：SDK 对外暴露的两种使用方式
- **子模块 A**：`DirectTransport` — 同进程 import 调用，async iterator 流式事件
- **子模块 B**：`StdioTransport` — 被 spawn 后通过 stdin/stdout nd-JSON 通信
- **参考 Cline**：Cline CLI 2.0 的 headless 模式：
  - `--json` 流式结构化输出格式
  - 事件类型定义（text / tool_call / tool_result / error / complete）

---

## 多实例与任务队列

rig-coder 支持多实例并行运行，每个实例操作独立的项目目录。

### ProjectManager

- 管理多个 rig-coder 实例，每个实例绑定一个项目目录
- 每个项目拥有独立的 `CodingTaskQueue`（优先级队列，串行执行）
- 不同项目的 rig-coder 可并行工作，互不干扰

### 意图路由

- 主 Agent 通过 tool calling 自然路由（`coding_task` 工具）
- System Prompt 中注入当前活跃项目列表，模型根据对话上下文推断目标项目
- 无法确定目标项目时，设置 `project: "unknown"`，由主 Agent 反问用户

### 任务追加

- 主 Agent 判断新需求是独立任务还是对当前任务的补充
- 独立任务：入队排队
- 追加需求：通过 `append_to_task` 工具追加到正在执行的任务

---

## 依赖清单

```json
{
  "@langchain/langgraph": "^0.2.x",
  "@langchain/core": "^0.3.x",
  "@langchain/anthropic": "^0.3.x",
  "@langchain/openai": "^0.3.x",
  "@langchain/google-genai": "^0.1.x",
  "@modelcontextprotocol/sdk": "^1.x",
  "diff-match-patch-es": "^0.1.x",
  "simple-git": "^3.x",
  "fast-glob": "^3.x"
}
```

---

## 目录结构（规划）

```
src/preload/rigcode/
  core/
    agent.ts                # Agent 主类（对外 API）
    agentGraph.ts           # LangGraph 图定义
    agentState.type.ts      # Agent 状态类型
    contextManager.ts       # 上下文压缩/截断
  tools/
    readFile.tool.ts
    writeFile.tool.ts
    editFile.tool.ts
    searchFiles.tool.ts
    listDir.tool.ts
    runCommand.tool.ts
    tools.type.ts
  prompt/
    systemPrompt.ts         # 主 prompt 模板
    toolDescriptions.ts     # 工具描述
  mcp/
    mcpManager.ts           # MCP Server 生命周期管理
    mcpTool.adapter.ts      # MCP 工具 → LangChain 工具适配
  checkpoint/
    gitCheckpoint.ts        # 基于 simple-git 的 shadow git checkpoint
  transport/
    stdio.transport.ts      # stdin/stdout nd-JSON
    direct.transport.ts     # 同进程 import 调用
    transport.type.ts
  queue/
    taskQueue.ts            # 编程任务优先级队列
    taskQueue.type.ts
    projectManager.ts       # 多项目实例管理
  rigcode.preload.ts        # preload 入口
  rigcode.spec.md           # 本文档
```

---

## 开发阶段

### Phase 1：MVP（约 2 周）

1. 项目搭建 + LangGraph 基础图 + LangChain 模型接入
2. readFile + writeFile + listDir 工具
3. editFile 工具（fuzzy matching，最核心最难）
4. runCommand + searchFiles 工具
5. System Prompt v1

### Phase 2：增强功能（约 1.5 周）

1. MCP 集成 + Playwright 浏览器控制
2. Plan/Act 双模式
3. Git Checkpoint
4. 上下文管理（截断策略）

### Phase 3：可嵌入性 + 多实例（约 1 周）

1. StdioTransport（nd-JSON）
2. DirectTransport（同进程 API）
3. TaskQueue + ProjectManager
4. 与 bitterless 主 Agent 集成测试

## 核心循环流程
接收用户请求 — 用户在聊天面板中输入任务描述
LLM 推理 — 将对话历史 + 系统提示 + 工具定义发送给 LLM（如 Claude），获取下一步动作
工具调用执行 — LLM 返回的响应中可能包含工具调用（读文件、写文件、执行命令等），Cline 解析并执行
结果反馈 — 将工具执行结果追加到对话历史中
循环判断 — 如果任务未完成，回到步骤 2 继续推理；如果 LLM 认为任务完成，则结束循环
关键设计
支持mcp / skill 的调用
Human-in-the-loop — 敏感操作（如写文件、执行命令）需要用户确认后才执行,用户可以用自然语言确认,
流式处理 — LLM 响应是流式的，参考Cline 会逐步解析工具调用，实现边生成边执行的效果
上下文管理 — 对话历史过长时会进行截断/压缩，避免超出 token 限制,设默认值
错误恢复 — 工具执行失败时，错误信息会反馈给 LLM，让它自行调整策略

## 需要参考cline时,请进入参考cline源码,源码位置:/Users/ral/Documents/projects/cline

## 开发提示:
- 开发时,每个子模块都需要spec.md文件进行规划,然后开始开发
- 能使用langchain/langgraph的功能有限使用langchain/langgraph
- 浏览器功能先试用langchain
- langchain不包含的部分,代码尽量参考cline
- rigcode 会先通过sandbox:false的electron 渲染进程的preload加载,通过spawn,通过stdio和其他mcp等工具通信

