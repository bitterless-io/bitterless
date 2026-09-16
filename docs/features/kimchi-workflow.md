# Kimchi workflow engine and chat shortcuts

Date: 2026-09-16. Status: implemented; human model/UI verification pending. Owner authorized migration after source-backed engine selection. This replaces the local pi-workflow-engine runtime while retaining Pi SDK, process supervision and existing chat task UI.

## Contract

- Pin @kimchi-dev/kimchi-workflows 0.0.9 and use public flow/engine exports. No Pi CLI, external Bun or cloud workflow service.
- One workflow utilityProcess per run, one utilityProcess per active Agent attempt; Main owns process/tool cleanup and permission to start retries.
- Dynamic .ts/.mts exports a committed Kimchi WorkflowDefinition. A local author helper creates schema-checked AgentOutcome values: completed with output, stopped with reason, failed with reason. Single stop does not invent a successful result or cancel independent siblings.
- Whole run stop propagates to all work. A stopped/finished UI state requires cleanup acknowledgement; forced termination must verify owned resources. Retries cannot overlap previous uncleaned attempts.
- Preserve model/auth/cwd/tool policy. Session event content maps to each task; streaming work and final results/errors remain visible.
- Preserve task bar above existing ResponseStatus, a 360px maximum expanded list with internal scrolling, and single/all-stop actions.

## Trigger UX

| Input | Behavior |
|---|---|
| /workflow | List built-in names and invocation help through existing slash/chat UI |
| /workflow demo [requirement] | Deterministically start mini-demo; absent input uses the documented small todo-list example |
| /workflow <builtin> <input> | Deterministically start named built-in with explicit target |
| /workflow <absolute .ts/.mts path> [input] | Load an explicit TS workflow; quoted paths support spaces |
| Natural-language request | Main Agent may invoke workflow_run; same supervisor and cancellation behavior |

A shortcut is parsed before model submission. UI and Main both reject incompatible busy states; invalid input, unavailable model/auth, unknown workflow and load errors are visible. Shortcut origin is identified separately so tool invocation inside the current Agent turn is not incorrectly rejected as busy. There is no new independent popup or visual redesign.

Claude Code uses user-invocable skills exposed as /name, and model invocation can be controlled separately. Our shortcut starts the registered executable workflow directly. Reference: https://code.claude.com/docs/en/skills (checked 2026-09-16).

## Built-ins

mini-demo uses three real independent Pi Agents (implementation, acceptance, risks) without filesystem tools, followed by synthesis. A stopped branch is explicitly marked missing and remaining branches can finish. The test requires an authenticated Pi model; it is not a simulated success fixture.

Port code-review, refactor-scout, diagnose, perf-review and research. Keep each workflow's distinct purpose, evidence requirements, independent verification and structured results. They advise rather than silently edit project files. Do not claim the old functions are API-compatible.

## Verification / handoff

Behavior tests: loader, real Kimchi API with fake Agent boundary, schema/repair, single stop with sibling continuation, whole stop, late messages, cleanup failure, retry ordering, tools and usage, each builtin and shortcut parser. Run focused TypeScript/UI/i18n checks and both builds. No independent review or Electron E2E is requested this turn. Deliver exact human prompts and remaining real-model/packaging/platform checks.

Crash-resume of side-effecting workflows is not enabled in this migration. Preserve history, identify interrupted runs after restart, and require explicit rerun. Existing pi-workflow-engine tests are historical until migrated to the new contracts.

Code verification: 2026-09-16, combined workflow suite 173/173 (Bitterless 87, Cowork 86), both strict workflow TypeScript, focused Vue/SFC and i18n checks, both full builds and built-entry external-TS Node probes passed. No real model, Electron E2E, signed package or Windows run. See `/Users/ral/Documents/projects/overmind/areas/agent-runtime/workflow/kimchi-testing.md` for exact commands, remaining human tests and additional non-passing legacy checks.

## Startup error and empty task bar correction (2026-09-16)

Workflow startup failures must cross IPC as an explicit serializable result, preserving their actionable cause. The renderer must not replace a host validation error with a generic missing-acknowledgement error. Hide the entire task bar with zero layout height when no Agent exists; its count is the displayed Agent total so completed results remain accessible. The existing ResponseStatus is independent.

Cowork AI-CRMS workflows reuse the current signed-in session, authorized relay region/institution and selected model through an in-memory Pi provider bridge. Credentials go only from Main to the Agent worker, never to the workflow engine, renderer, saved workflow snapshots, auth.json or models.json. Desktop cancellation confirms local cleanup; existing relay code does not prove remote model compute has stopped.

Follow-up fix verification: 2026-09-16, combined workflow suites 193/193 (BL96/CW97), strict workflow and focused Vue types, isolated worker bundles passed. Includes actual installed XPC error roundtrip and real Pi SDK with loopback SSE transport; no live model, Electron E2E or replacement of the running developer build. Retest with Cowork AI-CRMS `/workflow demo`.

## Nested repository code-review scope (2026-09-16)

The scope Agent must return an explicit repository root alongside the allowlisted diff command. Resolve and verify that root within the selected workspace, then capture the diff in that repository without changing the global process or chat workspace. Finder/verifier context must identify the absolute repository root; finding locations remain repository-relative. A genuinely empty diff reports the repository and target instead of suggesting the workflow is still running. This remains a change review, not an unchanged-module static audit.

Nested-repository fix verified: 2026-09-16, workflow suites BL100/CW101 (201 total), strict workflow types and isolated worker bundles passed. Real temporary parent/nested Git fixtures cover actual diff capture and downstream evidence locations. No live model/Electron E2E rerun.

## 2026-09-16：workflow 会话的诊断路径

问题：仅执行 /workflow 的会话绕过 BaseAgent.prompt，Pi 子 Agent 又使用内存会话，因此任务面板有执行结果，agent-io 却没有该聊天的目录。两端的普通聊天日志入口与重启查找已接通；不能靠重新提示“发一条消息”修复 workflow 采集缺口。

修复契约：workflow 与普通聊天共用按 chat sessionId 分桶的 agent-io 日志。主进程在启动、派发和结束时记录生命周期，Agent worker 通过专用消息记录实际提示上下文、完整工具返回、assistant 消息与回合结果；主进程绑定 runId/agentId/attemptId 后串行落盘。诊断消息不进入 UI snapshot，不截成任务面板的 64KB 摘要；停止期间仍接收已产生的日志。仅记录模型内容和状态，不序列化 runtime/auth 配置，并移除 relay key。

已有日志的 /copy_session_path 仍只读、等待已提交的写队列、支持重启查找。New chat 即初始化诊断目录与当前系统提示快照；复制缺失旧日志时补当前初始化快照，并明确历史缺失。初始化不创建模型 runtime、不发模型请求；旧版本没有保存的原始输入输出无法补回，runs.json 的摘要不冒充完整模型日志。

本轮验证：workflow 215项、新聊天/日志路径/上下文/项目提示47项通过（两端合计262项）；相关Node/Vue类型检查、worker隔离构建、Cowork日志文件系统守卫通过。未运行Electron E2E。人工测试：新建→直接复制路径→hi→workflow demo→停止→重启后再复制。
