# Workflow 结构化结果提交重复失败

日期：2026-09-16。状态：修复及代码验证完成，待人工验收。

## 现象与证据

mini-demo 的 Agent 长时间显示 Thinking / Retrying，工作记录提示 the turn ended without calling workflow_submit_result，随后超时。实际保存的诊断表明：模型调用了提交工具，但 result 是 JSON 字符串而不是 schema 要求的对象。Pi SDK 在 execute 前拒绝参数，模型在同一个工具循环中重复提交；宿主没有收到成功提交，最终错误被表达为缺少调用。

## 修复与验收标准

- 在正式 prepareArguments 边界兼容一次 JSON 解码，仅当解码后严格匹配原结果 schema 时接受；不得把普通文本响应当成结果。
- 一次提交工具调用结束当前 Pi 工具循环；无效提交交回 Kimchi 的有界输出修复，并保留真实校验错误。
- 保留原有取消、超时和资源清理屏障，不靠增加 retries / timeout 延长等待。
- 失败 workflow 提供明确的人工重新运行入口，保留旧记录，启动新 run；使用当前聊天工作目录与模型。旧记录无入口数据时提示重新输入 /workflow。
- 实际 Pi SDK 本地 SSE 回归覆盖字符串结果、错误 schema、有界修复与取消；不运行真实模型或 Electron E2E。

验证：两端合计 286 项定向 Node 测试、严格 Node/Vue 类型、隔离构建通过。真实 Pi SDK + 本地 SSE 验证一次解码与有界 repair；未调用远端模型或运行 Electron E2E。人工步骤与证据见 /Users/ral/Documents/projects/overmind/areas/agent-runtime/workflow/workflow-context-and-retry-testing.md。
