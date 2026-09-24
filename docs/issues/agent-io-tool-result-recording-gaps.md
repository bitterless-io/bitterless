# agent-io 的工具结果记录：几处口径问题(两仓相同)

Status: 已登记 2026-09-24(bitterless 审查 `agent-io-tool-results-205-1` F5 与 Observations)· 第 1 条修法已定(lead),其余待定 · 排在 Decision Helper 之后

Paired with `micromeet-cowork`:`docs/issues/agent-io-tool-result-recording-gaps.md`(同一份)。

| # | 问题 | 现状 | 定了什么 |
|---|---|---|---|
| 1 | 抛错的工具调用，agent-io 记的是**原始**报错;模型看到的是 `sanitizeRuntimeError` 处理过的(JWT / Bearer / 密钥字段已脱敏，截到 300 字) | agent-io 里可能留下模型从没见过的凭据 | 改成记模型看到的那一版 —— agent-io 的定位本来就是「模型真实看到的内容」(`modelIoLog.ts`,Ral 2026-08-20)。两仓一起改 |
| 2 | 计量本身抛错(例如结果里有循环引用，`JSON.stringify` 失败)会把一次成功的工具调用变成失败 | 两仓的计量都写在工具调用的 `try` 里;现在的工具都返回字符串，实际碰不到 | 待定：计量单独包一层，失败只记日志，不影响调用结果 |
| 3 | 工具超时：模型看到的是超时文本,agent-io 记的是 `This operation was aborted` | 与第 1 条同类：记的不是模型看到的那一版 | 待定，随第 1 条一起看 |
| 4 | `inputBudget` 全进程一份，并发回合(上限 4)互相串数 | 「本轮工具结果 X tok / N 次」只在同一时间只跑一个回合时才准 | 已知残留，暂不修 |
| 5 | 不在 `runInAgentSession` 里的调用(BL 的 `delegateMessage`)落进 `unattributed` | BL 界面上没有调用方;Cowork 已包好 | 已知残留 |

## 验收(第 1、2 条)

- 单测：抛错的工具调用，agent-io 的 `<name> (threw)` 文本等于模型看到的文本(含脱敏与截断);计量抛错时工具调用照样成功。两仓同一套。不跑 E2E。
