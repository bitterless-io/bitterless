# Agent cwd follows the workspace

Status: implementing — 2026-09-17.

Owner decision: Ral, 2026-09-16 (`areas/agent-runtime/chat/prompt-structure.html`, PQ-CWD) —
"cwd 设计按你的建议开始实施, bl cowork 都改".

Apply the same behavior to BL and COWORK.

## The defect

The shipped system prompt ends with `Current working directory: /` while the same turn's D2 line says
`- Active workspace: /Users/ral/Documents/projects/overmind`. Measured from the host's own capture
(`agent-io/…/part-001.jsonl`, note `session-configuration`): `detail.cwd = "/"`,
`detail.workspace = "/Users/ral/Documents/projects/overmind"`.

`runtimeSystemPrompt.ts:20` is `options.cwd ?? process.cwd()`, and none of BL's five agent
construction sites pass `cwd`. So the value is whatever launched the app — `/` for a Finder-launched
`.app`, the project directory for a terminal `yarn dev`. The model reads two contradictory answers to
"where am I", and every relative path it forms resolves against `/`.

## What cwd actually is

Not a capability boundary. An agent that needs another directory uses `bash` with `cd` or an absolute
path; that is a per-call argument. Widening cwd to `/` grants nothing and narrowing it to the
workspace removes nothing.

It is three things, all proven against pi 0.85.1:

| | what cwd does | evidence |
|---|---|---|
| relative-path base | all 7 builtins resolve `ctx?.cwd \|\| cwd` | `pi-coding-agent/dist/core/tools/{read,edit,write,grep,find,ls}.js`, `path-utils.js:42-44` |
| bash child cwd | passed straight to `spawn`; a missing directory throws before spawning | `tools/bash.js:51`, `:44-47` |
| the prompt's last line | **pi appends it itself** from `AgentSession._cwd` | `core/system-prompt.js:33` |

So this is a **behavior change, not a prompt-only change**. Relative-path semantics move with it.

`runtimeSystemPrompt.ts:29` does not send that line to pi — it is a *mirror* the host asserts against
(`piRuntimeSession.ts:100-102`). There is exactly one line in the final prompt, and pi owns it.

## Behavior

**cwd is resolved when the pi session is created, from that session's project root.**

- Project bound → `cwd = <project root>`, the same absolute path A6 reads `AGENTS.md` from and D2
  prints.
- No project bound → `cwd = ensureDefaultWorkspace()`, the one shared default workspace every
  workspace tool already falls back to (`workspaceFile.service.ts:345`,
  `maestroWindow.controller.ts:971`). D2 already tells the model "the ONE shared default workspace is
  in use"; now cwd says the same directory instead of contradicting it.
- Never `process.cwd()`. `resolveRuntimeSystemPrompt()` requires an absolute cwd and throws on a
  missing or relative one, so the value can never again depend on how the app was launched.

Timing is what makes this work with only pi's public API: the pi session is created lazily inside
`prompt()` (`BaseAgent.ts:313 ensureSession()`), and `setProjectRoot()` already runs immediately
before it on every turn (`maestroAgent.service.ts:1900` → `:1912`). The first session of a chat is
therefore created *after* the turn's workspace is known. No `reset()`, no lost conversation.

### Workspace switched mid-chat — known limit

pi has no cwd setter: `AgentSession._cwd` is assigned once (`agent-session.js:145`) and the builtin
tools are baked with it (`:2191`). Changing cwd on a live session is impossible through the public
API.

So when the workspace changes between turns of an existing chat, **A6 re-reads the new project's
`AGENTS.md` (unchanged, non-destructive) while cwd keeps the value it had at session creation.** The
prompt's last line goes stale until the chat is reset.

This is deliberate: the alternative is `reset()`, which drops the conversation and compaction state —
exactly what `setProjectRoot()` was built to avoid (`BaseAgent.ts:219`). Losing a conversation because
someone switched workspace is worse than a stale path. **Open for Ral:** accept this, or reset on
switch, or reach into `session._cwd` + `session._extensionRunner.cwd` (both `private` in the `.d.ts`,
both ordinary JS at runtime — tools would follow immediately, the prompt on the next
`setActiveToolsByName`). The third option needs a guard test that fails on the next SDK bump.

Agents that are not the chat agent keep their own cwd on purpose: the session-title worker
(`sessionTitle.service.ts:54`) and the workflow activity summarizer
(`workflowEngine/activitySummary.ts:188`) are tool-free (`tools: []`, `builtinTools: []`) and pass
`cwd = agentDir`. They have no workspace and need none. The workflow engine already resolves cwd from
the project root and already fails closed (`maestroAgent.service.ts:293-295`) — unchanged.

## Prerequisite — close the project-settings channel first

Pointing cwd at a user-chosen directory opens a code-execution surface that does not exist while cwd
is `/`.

pi reads `<cwd>/.pi/settings.json` as **trusted** project settings when the host passes no
`settingsManager` (`sdk.js:73`, `settings-manager.js:55`, `:169` `projectTrusted ?? true`), and those
settings supply the bash tool's `shellCommandPrefix` and `shellPath`
(`agent-session.js:2184-2185` → `tools/bash.js:156`). Measured on a scratch directory: a planted
`.pi/settings.json` yielded `getShellCommandPrefix() === "echo PWNED"`, prepended to every bash
command.

Today cwd is `/` or `<userData>/skills`, where that file cannot plausibly exist. The moment cwd
follows the workspace, **any repository opened in Bitterless could inject a shell wrapper into every
bash call.**

Fix, one line, shipped before the cwd move: pass `settingsManager: pi.SettingsManager.inMemory()` in
`piRuntimeAdapter.createSession()` — which is already what the workflow path does
(`workflowEngine/piAgentSession.ts:82`). Zero semantic change today.

Disk auto-discovery stays off and cwd cannot re-enable it: skills / `AGENTS.md` / `SYSTEM.md` /
project extensions are reached only through `DefaultResourceLoader`, which the host replaces
(`sdk.js:75-78` is a branch BL never enters).

## Acceptance

- A fresh chat with a bound project ends its system prompt with
  `Current working directory: <that project root>`, equal to the path D2 prints in the same turn.
- A fresh chat with no project bound ends with the default workspace root, and D2 says the shared
  default workspace is in use. The two agree.
- The value never changes with how the app was launched.
- `resolveRuntimeSystemPrompt()` throws on an absent or relative cwd rather than substituting one.
- A planted `<workspace>/.pi/settings.json` does not affect the bash tool.
- The session-title and activity-summary workers still pass `agentDir`; the workflow engine still
  fails closed when no project is selected.
- `/view_context` shows the same final system prompt the runtime sends, cwd line included — see below.

## `/view_context` must show the cwd line

`prompt-structure.html` records "该查看入口尚不包含公共模块随后添加的 cwd 行". Ral intends to verify
this change through view context, so the viewer must show the line the runtime actually sends;
otherwise the fix is invisible where he looks for it. `composedSystemPrompt()` returns table 1 + table
2 only — the viewer has to render `resolveRuntimeSystemPrompt().finalSystemPrompt` instead.

## Verification

Unit/source tests, typecheck and the runtime guards only. No Electron, no E2E, no packaging — the
repo rule bars unprompted Electron runs.

`scripts/maestro/check-agent-runtime.mjs:180` is the only guard pinning the cwd wiring and it does not
execute today — it throws `Cannot find module './steering/backgroundContextInbox'` at load
(`:105-118` stub table), taking `yarn check:maestro` red with it
(`docs/plan/tasks/maestro-guard-revival-075.md`). Repair it in this change, otherwise the cwd wiring
lands unguarded.

`tests/maestro/maestroRuntimeAdapterContract.test.mjs:105-109` currently asserts the `process.cwd()`
fallback by name and is green (12/12). It must be rewritten to assert the throw, not deleted.
