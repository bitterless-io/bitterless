# Maestro `/copy_session_path` 在发送后仍报没有日志

**报告日期**：2026-09-09；Ral 2026-09-15 再次报告并要求修复。

**状态**：代码完成，定向验证通过；待人工 UI 验收。

**范围**：启动时配置日志目录、现有日志的查找/复制、`/view_context` 的日志路径头。

## 根因

`BaseAgent.prompt()` 已调用 `modelIoLog.append()`，但宿主从未调用 `setModelIoRoot()`。
日志模块拿不到根目录，开目录失败返回 `null`；`copySessionIoPath()` 因此一直提示
“send a message first”。会话的运行时条目和 `chain/<sessionId>.jsonl` 属于其他存储，
有这些内容不代表曾保存模型诊断日志。问题与具体 provider/model 无关。

此外，日志异步创建目录并排队写入。刚发送就复制时，查找必须等待当前会话的 opening 与写队列，
否则可能报假缺失，或把仅创建了目录、尚未成功写入日志的路径当成成功。

## 修复契约

- 宿主在 profile 与测试隔离路径确定后配置 `<userData>/agent-io`，与 CoWork 保持一致；
  日志模块继续不依赖 Electron。旧文档的 `<userData>/model-io` 是错误目录名。
- 查找只读：先等待该会话已存在的 opening，再等待其当前写队列；活目录优先，
  其次精确匹配 17 位时间戳后的完整会话段寻找最新历史目录，不能把 `prefix-a` 匹配成 `a`。
  仅返回含非空 `part-NNN.jsonl` 普通文件的目录。
- `/copy_session_path` 不创建目录、不创建或重置 runtime；成功才写剪贴板。
  缺失时明确说没有留存日志，可能是启用日志前的会话或日志已被清理，并提示新发一轮后重试。
- `/view_context` 如有已保存日志，在现有 `model-io jsonl:` 头中附上同一目录；
  没有日志时省略，不为了导出写新日志。结构图继续不加日志页脚。
- Sessions 抽屉和标题搜索结果提供右键 Copy session path / Open in Finder（Windows 为
  Open in File Explorer）。两项均由 Main 按被右击的 sessionId 解析同一目录；不切换会话，
  不停止回合。打开使用系统文件管理器，复制/打开失败都有可见反馈，不把本地提示写入 prompt/历史。
- 历史没有保存的内容不从 UI 回填、不伪造。这里只接通现有诊断日志：当前记录宿主的
  `prompt` 文本和 `turn_end` 诊断，**不等于完整 provider 请求/响应或工具 I/O**。
- SQLite 保存应用会话与宿主摘要，JSONL 用于诊断；本地路径提示只存在 renderer，
  由独立 `localOnly` 标记在后续保存时排除，也不封口正在输出的 assistant。
  `promptExcluded` 仅控制模型上下文，不替代持久化边界。
- 保留既有分卷与清理策略：每卷 8 MiB，历史最多 20 个目录/200 MiB；活桶豁免。
  本次不扩日志采集、命令别名、工作区字段或历史迁移。

## 验证与人工测试

已通过（2026-09-15）：

- `node --test tests/maestro/maestroSessionIoPath.test.mjs tests/maestro/maestroContextExport.test.mjs`：14 项。
  真实日志模块与临时目录覆盖首轮无需 reset 即落盘、opening/写入期间复制等待、并行会话隔离、
  重启查找、空/失败目录、只读导出路径，以及原生菜单和系统打开失败。
- `node --test tests/maestro/maestroSessionManagement.test.mjs tests/maestro/maestroSessionsDrawerLifecycle.test.mjs`：14 项。
  实际编译抽屉/搜索结果触发右键，验证目标 sessionId、事件拦截、稳定挂载和无选择副作用；
  成功/取消/失败反馈保持单例，不写入会话历史。
- `node --test tests/maestro/maestroComposerCleanup.test.mjs`：20 项。新增行为验证确认本地提示
  在下一次正常保存中被排除，其他 `promptExcluded` 错误/压缩记录仍保存；真实 TurnService 的
  streaming sink、已缓冲和后续 delta 均保持，提示本身不更新会话时间或触发保存。
- 临时 scope 配置的 Control `vue-tsc --noEmit` 通过（包含 Control 源码与两个 renderer env 声明）。
- 临时 scope 配置的 Node `tsc --noEmit` 通过（日志模块、原生会话菜单和 shared coach API）。
- renderer i18n 与 `git diff --check` 通过。

未启动 Electron、调用模型或运行 E2E/build/独立 review；未执行全仓类型检查。

人工测试：更新并重启 BL，旧会话执行 `/copy_session_path` 应准确提示无留存；
发送一条新消息后执行该命令，应复制 `<userData>/agent-io/<时间戳>-<sessionId>`，
会话回显同一路径。重启后应仍可复制已保存且未清理的会话目录。
在抽屉和标题搜索结果右击另一条会话，分别复制和打开目录；当前选择、进行中的回合应保持不变。

## 保留的独立问题

`copyNextTurnContext()` 仍未向 `pending.workspace` 传值，因此独立的 `workspace:` 头可能为
`(none)`；这与日志入口无关，本次不修改。

## 2026-09-16 追加：New chat 与 workflow 的未覆盖入口

9月15日修复覆盖普通 BaseAgent 回合的日志落点，但新建聊天只存在 renderer、workflow 子 Agent 使用独立内存 Pi 会话，这两条路径不会经过普通 prompt 日志。用户要求 New chat 即可复制路径，因此当前契约扩展为：新建时保存真实当前系统提示与配置快照；复制缺失旧日志时创建明确标记历史缺失的当前快照，不假装恢复旧输入。已有日志目录只读返回，不重置已有模型会话。

Workflow 通过 agent.io 事件把完整诊断归入所属 chat；停止过程的消息也保留。BaseAgent 没有实际 runtime 时的配置 reset 不再创建无归属日志目录。此前章节中“缺失即提示再发送、不创建目录”的限制保留为9月15日历史行为，以本节与最新 feature 文档为准。
