# `/view_context` 包含已被压缩的旧全文

**状态**：已实现，定向代码验证完成；待人工验收，2026-09-15。Ral 要求 BL 与 CoWork 同步修复。

## 根因

导出调用 `surface.entries()`，pi 对应 `SessionManager.getEntries()` 的全部历史树。
这包含已被摘要吸收的正文、旧压缩记录与其他分支，不等于当前模型有效上下文。

安装的 pi SDK 提供 `SessionManager.buildContextEntries()`：按当前 leaf 取分支，再保留最新
compaction 摘要、`firstKeptEntryId` 起的尾部以及摘要之后的条目。缺失 keep ID 表示合法空尾部。

## 修复契约

- 新增只读 `contextEntries()`，pi 直接使用 SDK 的 `buildContextEntries()`；不复制 SDK 算法。
- 原始 `entries()` 保持完整历史语义，供压缩候选与结构图统计使用。
- `/view_context` 使用有效入口；现存 runtime 不支持有效读取时明确失败，不回退完整历史。
  尚未创建 runtime 的会话仍明确显示没有模型侧历史。
- 导出保留有效 user/assistant、工具调用/结果、自定义模型消息、最新摘要和分支摘要正文。
  模型切换、thinking 设置、label、session info 等元数据不冒充模型消息。
- 读取不发送消息、不创建/重置 runtime、不触发压缩、不改 SQLite/JSONL/leaf/运行时消息。
  系统提示与待发草稿继续沿用原有构建器及媒体/大小限制。
- `existingContextSurface({ readOnly: true })` 允许读取正在运行的已有会话，默认压缩写入口仍受
  busy 门保护；已有 runtime 不支持读取或读取失败时明确报错，不能显示为“没有历史”。
- 宿主手动压缩曾只 append manager 树。每次成功 append compaction/custom message 后，
  通过 SDK 公开 `agent.state.messages` 同步 `buildSessionContext().messages`，与 SDK 原生压缩一致。
  不具备同步能力时写入直接失败。用户原话链与清单是明确重新加入的有效上下文，仍保留并导出；
  不能把它们与已被摘要吸收、且没有重新加入的原始正文混为一谈。

## 验证

用真实 pi `SessionManager.inMemory()` 验证压缩前、一次/多次压缩、空尾部、工具条目、
分支 leaf 与分支摘要。导出不能出现旧唯一正文；只保留最新摘要和有效尾部，读取前后状态不变。
不启动 app、不请求模型、不跑 E2E/build/独立 review。

2026-09-15 结果：

- `maestroContextExport.test.mjs`：14/14 通过，其中 6 项直接使用已安装的 `SessionManager` 与 `Agent`。
- `maestroRuntimeAdapterContract.test.mjs`：12/12 通过，覆盖原始/有效入口分流、原生 append
  参数、每次写入后的 live 同步、缺少同步能力时零写入，以及 append/投影失败不报成功。
- `maestroCompactionHandler.test.mjs`：9/9 通过，验证摘要 → 用户链 → 清单的写入顺序与失败中止。
  旧夹具补齐 `llmModels`、`maestroUserChainDir`，并从 main 用户链读取边界提供合成记录；
  不再用已被宿主替换的 renderer `userChainText` 冒充 main 原话链。产品 handler 未改。
- 临时配置继承 `tsconfig.node.json`，仅包含 `BaseAgent.ts`、`piRuntimeSession.ts`、
  `runtime.types.ts`、`contextExport.service.ts`，`tsc --noEmit` 通过；配置运行后移除。
- `git diff --check` 通过。

人工验收：在发生过一次/多次压缩的会话执行 `/view_context`，确认仅有最新有效摘要、保留尾部、
后续消息及明确重新加入的用户链/清单；已被吸收且未重新加入的旧全文不再出现。运行中执行导出应
读取当前快照；失败会显示现有错误消息，不写剪贴板。继续发送时应沿用同一压缩后的 live 上下文。
