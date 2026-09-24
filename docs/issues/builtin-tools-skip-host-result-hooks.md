# pi 自带工具(`bash` / `read` / …)绕过宿主的结果处理：下载 NOTE 挂不上

Status: 已修 2026-09-24 —— 下载 NOTE(`builtin-tool-results-204`)与 agent-io 补记(PQ-1:`agent-io-tool-results-205` / `-206`)· 真实会话验收待 Ral

Paired with `micromeet-cowork`:`docs/issues/builtin-tools-skip-host-result-hooks.md`(现场、时间线与完整修法在那边;本文只写本仓的差异)。

## 本仓的情况(已核)

- **下载 NOTE:同样的缺陷。** 本仓启用同样的 7 个自带工具(`src/main/agent/BaseAgent.ts` 的 `DEFAULT_PI_BUILTIN_TOOLS`,`bash` 同样是宿主的可中断替身),
  NOTE 同样只在 `executeHostTool` 追加(`src/main/agent/runtime/hostToolExecution.ts`,另有 builtin-wait-197 未提交的 `downloadSettleMs` 改动),
  `downloadManager.ts` 与 Cowork 逐字节相同。所以 agent 在下载落地后跑 `bash` / `read`,结果里不会有 NOTE。
- **agent-io:比 Cowork 严重。** 本仓 `toRuntimeTools()` 不包计量壳(`src/main/agent/runtime/hostToolRegistry.ts`),整个仓里没有写 `tool_result`、
  也没有 `inputBudget.record` 的地方：磁盘上 31 个 agent-io 文件 0 条 `tool_result`;BL_PREVIEW 会话 `2n6mbjo9h5hmudg8q41` 的 pi 文件有 52 次工具结果
  (含 `bash` ×4、`grep` ×3),每个 `turn_end` 却都写「本轮工具结果 0 tok / 0 次」。

## 修法(已定：下载 NOTE)

- 同一个钩子文件 `src/main/agent/runtime/builtinToolResultHook.ts`,与 Cowork **逐字节相同**:包一层 `session.agent.afterToolCall`(先调 pi 自己的),
  只对不经 `executeHostTool` 的工具追加 `drainDownloadNote()`(默认预算);host 工具原样放过。
- 接线在 `src/main/agent/runtime/piRuntimeAdapter.ts`,**不传记录回调**(记录回调由 `agent-io-tool-results-206` 接上，见下一节)。该文件与
  `piRuntimeSession.ts`、`hostToolExecution.ts` 都有别的会话未提交的改动：只加接线那几行，不碰其它。
- `docs/features/browser-downloads.md` #1.2「挂在哪」与 Cowork 同步改成两条路(两仓逐字相同)。

## 修法(已定:agent-io 补记)

Ral 2026-09-24 定 PQ-1:「要不上,这个会话帮我做了」(即补上)。按下表补齐，口径与 Cowork 相同;`builtin-tool-results-204` 的范围不变。
负责：overmind 会话 2ddacc6d(做 -204 的会话不做这两项)。

| 件 | 行为 | 任务 |
|---|---|---|
| host 工具 | `hostToolRegistry.ts` 的 `toRuntimeTools()` 给**每个**工具包一层计量壳(不只需要确认的那些),照 Cowork 的 `measuredTool`:结果转成文本(字符串原样，其它 `JSON.stringify(out ?? '')`),`inputBudget.record(name, 字节数, subjectOf(args))`,`modelIoLog.append({ kind: 'tool_result', name, subject, text, turn })`;抛错时记 `<name> (threw)` 与错误文本，再原样抛出。BL 的 `execute(args, signal, extra)` 三个参数原样透传(`extra.confirm` 不能丢)。**界面直接调用不计量**:Skills 页的 `manageSkillInstallation`(`maestroWindow.controller.ts`,每次进页面都会 `list` 一次)借 host 工具策略跑 `skill_install`,它不是模型输入 —— 走只套策略、不包计量壳的 `toUnmeasuredTools()`(`wrapHostToolsUnmeasured`),否则 agent-io 会多出 `unattributed` 记录，正在跑的回合的统计也会被算进去(BL 独有,Cowork 没有这条路)。**工作流子 agent 的 host 工具同样不计量**(`maestroAgent.service.ts` 给工作流建工具的那个 registry):它们的结果已由工作流 worker 记进聊天那一份 agent-io(`piAgentSession.ts` → `supervisor.ts` → `hostIntegration.ts`);再计量就是同一次调用记两份，还会给每个工作流 agent 新建一个 agent-io 目录，挤掉保留名额(20 个)里的旧聊天记录(审查 205-1 F1;Cowork 同构，见 Cowork `docs/issues/workflow-tool-results-recorded-twice.md`) | `agent-io-tool-results-205` |
| 自带工具 | 在 -204 接线处给钩子传入记录回调，口径同 Cowork `builtin-tool-results-001`:写一条 `tool_result`,文本是**模型最终看到的**(含 NOTE),计入 `inputBudget`;报错结果记 `<name> (threw)`。host 工具由上一行记，钩子不重复记 | `agent-io-tool-results-206`(依赖 -204、-205) |
| 回合统计 | 不改代码。两条路接上后,`turn_end` 的「本轮工具结果 X tok / N 次」就是真数 | — |

**不做 / 已知残留**(与 Cowork 相同):立即返回的结果(工具不存在、参数不合法、被中止)不经这两条路，仍不记;host 工具「先记录、后追加 NOTE」,
agent-io 里看不到模型收到的 NOTE(Cowork `browser-downloads.md` #6.10 末条);不改 `executeHostTool`。

**验收：**
- 205:单测覆盖成功 / 抛错各写一条 `tool_result` 并计入 `inputBudget`、需要确认的工具也计量、`signal` 与 `extra.confirm` 透传、被拒绝的确认也按抛错记;
  `scripts/maestro/check-agent-runtime.mjs`、`check-agent-activity.mjs` 与已有 session-io 测试不回归;typecheck 以 HEAD 基线对比。
- 206:单测覆盖一次 `bash` 写一条 `tool_result`(文本含 NOTE)、host 工具不被重复记、报错记 `bash (threw)`。
- 都不跑 E2E。真实会话验收待 Ral:agent-io 的 `tool_result` 条数等于 pi 会话里真正执行过的工具调用数,`turn_end` 不再是 0。

## 验收(下载 NOTE)

- 单测：与 Cowork 的钩子单测同一套(1、2、5 条;记录回调不传时不记录、不报错);`scripts/maestro/check-download-destination.mjs` 补一条自带工具路径也 drain;
  已有 `tests/downloads/downloadManager.test.mjs`、`tests/maestro/steeringInterruptsBash.test.mjs` 不回归;typecheck 以 HEAD 基线对比;两仓 `cmp` 钩子文件。不跑 E2E。

任务:`docs/plan/tasks/builtin-tool-results-204.md` · micromeet-cowork `docs/plan/tasks/builtin-tool-results-001.md`。

## 已定(原「待定」)

PQ-1 已定：补上(Ral 2026-09-24)。原问题留档如下。

| ID | 问题 | 推荐 | 拍板需要什么 | 不拍板的后果 |
|---|---|---|---|---|
| PQ-1 | 本仓 agent-io 要不要补记工具结果(host 工具 + 自带工具，外加输入统计)? | 补上：同一个钩子传入记录回调即可覆盖自带工具,host 工具另加一个计量壳;至少别再打印「0 次」这种假数 | 这算「修现有功能」还是「补一边才有的历史缺口」(配对规则里后者不必补) | 本仓会话只能靠 pi 会话文件审核;agent-io 里看不到任何工具输出，`turn_end` 的统计一直是 0 |
