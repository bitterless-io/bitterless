# Background workflows, active tasks, and conversation control

Status: implemented; code verification complete (2026-09-16). Human Electron testing pending.

## User contract

- Bottom task bar shows only active Agents (queued/running/waiting/approval/retrying/pausing/stopping); exclude completed/failed/stopped/paused. Zero active Agents means zero bar height. Preserve the existing chat status bar.
- Replace New chat text with a borderless Tabler plus icon. Add a borderless vertical-dots icon immediately to its left. Menu item Tasks opens a closable modal containing this chat's complete task history, including paused/completed/failed/stopped Agents.
- Existing inline task popover is active-only. History modal keeps bounded height and internal scrolling. Remove workflow rows such as mini-demo · Stopped and Scroll to see more; keep per-Agent detail/output/error/control. Identify concurrent runs in Agent detail using workflow name + short run ID, without the removed status row.
- Two workflows can run concurrently in the same chat. Starting a workflow does not reserve the ordinary chat turn for its lifetime. Normal messages during workflows use the main Agent's existing steering/preparation queue, with no busy rejection just because a workflow exists.
- workflow_run becomes a background start with immediate run receipt. Main Agent can list tasks, pause/resume/stop an exact task, steer an exact active Agent with a changed requirement, and start an additional single-Agent task through structured tools. All controls are session-owned, resolve explicit runId + agentId, and reject ambiguous/foreign IDs. No brittle natural-language command matching.
- Added subagent task runs independently in the same session (a single-step builtin), so it need not rewrite an executing TypeScript workflow graph. Link an optional parent run as context only; its output returns to the chat. Explain this behavior in tool descriptions and docs.
- Task steering uses the same Pi context and explicit runId/agentId; buffer through startup and pause, reject terminal tasks, never claim a delivered update after completion. Main chat routes user intent through structured controls rather than broadcasting unrelated conversation to every subagent.
- Pause is cooperative and preserves the Pi attempt/context. Show Pausing while an already active model request/tool finishes; then Paused. No new model request/tool or dependent workflow step may proceed after the safe boundary until Resume. Freeze Agent timeout while paused, resume remaining budget, and permit Stop while paused. Do not claim an in-flight network request or external command was suspended immediately; do not implement pause as stop+restart or OS SIGSTOP.
- Workflow completion/failure/stop emits one durable, deduplicated chat message keyed by runId, visible to the user and included in main Agent conversation context. During a live main turn queue/inject the result safely; when idle it must remain visible and available to the next turn. Do not silently discard a completion in a preparation/settled/reload gap. Do not rerun the user's request or replay history on completion.
- Narrowly correct workflow system tool descriptions to match actual activeTools and pass original task/role/read-only facts into mini-demo synthesis; keep concise Chinese summary and avoid invented consensus.

## Layout

    [session controls]                  [⋮] [+]
      ⋮ → Tasks → modal (all tasks for this chat)
    conversation messages (includes workflow completion)
    [3 tasks ^]  Agents are working       (only if active > 0)
    existing chat status bar              (independent)
    composer

Use current typography/theme tokens and Tabler icons, borderless controls, background/spacing hierarchy. Modal max height around 70vh, task area internally scrollable. English and Chinese strings; stable name/BEM selectors, keyboard closing/focus, reduced motion preserved.

## Verification contract

- Unit/integration tests with fake utility workers: simultaneous same-session starts; chat admission while running; pause before start/during model/tool/result, resume same context, paused timeout exclusion, Stop while paused, late messages and owner boundaries.
- Completion delivery: success/failure/stop, duplicate events, concurrent main turn/preparation and idle, persistence/reload or reconnect, no cross-chat injection.
- Main Agent tools: immediate workflow receipt, exact task control, additional task receipt; validate missing and foreign identifiers.
- Renderer tests: active-only count/zero height, Tasks history modal/menu, plus-only header, removed workflow-status/footer rows, pause/resume actions, concurrent workflows and status bar independence.
- Focused typecheck and existing affected suites. No Electron E2E or live model calls; hand over exact human test prompts. No independent review agent requested.

## Implementation and verification

- Host tools return background receipts, preserve exact chat/run/Agent ownership, and provide task list, cooperative pause/resume, steer, stop and independent added tasks. Two workflows and an ordinary main chat turn can coexist.
- Pause holds the same Pi session at model/tool/result boundaries; paused time is excluded from the remaining Agent budget. Stop drains paused waits. Main chat steers its active turn through its existing inbox, and can route follow-up intent to a particular task with `workflow_steer`.
- Persisted terminal run snapshots are the completion outbox. Renderer projects stable `workflow-result:<runId>` messages and retries failed saves; main Agent queues or safely appends matching context exactly once per runtime. Reopened chats replay persisted results without replaying the user request.
- Additional tasks use read-only `agent-task`; they do not rewrite another workflow graph. Per-task detail keeps the workflow name and short run ID. Task history remains accessible from the vertical-dots menu when the bottom active count reaches zero.
- Verification: 117 workflow engine/host/UI tests; 37 actual message store/SQLite fixture tests; focused Vue and strict engine/inbox typechecks passed. Root also verified compiled Vue + Less in an isolated headless browser. No Electron E2E or live-model calls.
- Broader main-surface check currently has 64 diagnostics outside the newly added implementation, including an existing SessionIoPathResult narrowing error in MaestroAgentService. Focused changed engine/inbox and renderer checks pass.
