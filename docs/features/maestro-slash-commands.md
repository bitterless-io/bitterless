# Maestro composer slash commands

Status: implemented; owner testing pending (2026-09-08, task169). Ral requested the Cowork screenshot's `/clear` and
`/view_context` menu in Bitterless. Cowork is reference-only in this change.

## UI and keyboard

```text
┌ /clear         Start a fresh chat; keep this conversation ┐
│ /view_context  Copy model context and pending input       │
└───────────────────────────────────────────────────────────┘
[ /vie|                                                ]
[ workspace ] [attach]             [model] [voice] [send]
```

Use the existing BL font, Royal Blue selection, white surface, muted hint and compact rounded
border. A single flat list opens above the composer; names are monospace, descriptions truncate.
No extra commands, categories, snippets or unrelated layout changes. State belongs to a local
reactive shortcut store with sibling types; the component displays it and preserves textarea focus.
Fit the current 380–480px chat width, using the input's full width rather than a fixed popup width.
Reuse canvas `#f8fafc`, surface `#ffffff`, ink `#465467`, muted `#6f7487`, accent `#4e5882` and
soft selection `#eceef7`. Empty matches hide the list; a pending command disables repeat execution
without freezing text editing. Expose selected option and expanded state to assistive technologies.

- Only a slash word at the start of the current line before the caret opens the menu; paths,
  dates and slashes in prose must not trigger it. Derive query/filtering without rewriting input.
- Filter name/description case-insensitively and sort names by ASCII; select first match on change.
- Up/Down wrap selection; Enter or click executes, never sends the command to the model. Tab
  completes the selected name; Escape closes without altering input. IME and repeat-key guards
  remain. Commands must not run twice while pending.
- Dispose menu state when switching/unmounting chat. A late async result must not erase newly
  typed text or a different session's draft. Failures are visible and retain retryable input.

## Commands

`/clear` calls the same BL New chat action as its button/shortcut. It does not delete conversation
history or reset the current model runtime in-place. Preserve BL's workspace inheritance,
archive and storage behavior. A running turn must not block New chat or /clear; the old task keeps
running in its own session. Rejected stale/unsupported requests show a reason and retain the draft.
See [running New chat contract](../plan/tasks/browseruse-new-chat-003.md).

`/view_context` uses a typed Coach XPC request and Main clipboard write. Export current model-side
history (including tool calls/results), system/preamble context and pending draft/workspace/attachment
references. Use the actual runtime context, not renderer transcript text masquerading as model history.
Reuse existing send prompt builders and BL's first-turn memory/preamble semantics; do not change the
prompt actually sent. Remove only the slash token when deriving the pending draft. Pending references
are included without reading/uploading attachments or executing tools. Clearly distinguish any
not-yet-resolved media or first-turn runtime state from the available context snapshot; do not label
an incomplete snapshot an exact future provider wire request.

No existing runtime means explicitly report no model-side history yet. Existing runtime with no
supported read surface is an explicit error, not a false empty-history success. Reading context must
not create/reset a runtime, send a model request, trigger compaction, mutate attachments or workspace,
replay a skill, or persist chat contents to logs/files. Text goes only to the user-requested clipboard;
return bounded metadata/status to renderer, not full contents. No new JSONL audit subsystem.
Represent inline binary media as labeled metadata, not megabytes of base64 in the clipboard.
An export exceeding its 8MiB text budget must fail visibly without replacing the clipboard;
do not silently truncate text/tool history or allocate an unbounded serialized copy on Main.

`/copy_session_path`（Ral 2026-09-09 追加）把这个会话的**模型 I/O jsonl 目录绝对路径**写进剪贴板，
并在会话里回一条本地留痕。它是取证工具：要 audit「模型到底看到了什么」，第一步是知道去哪看。

- **复制目录，不是单个文件。** 一个会话的 io 按 `part-NNN.jsonl` 分卷（`modelIoLog.append` 到量换卷），
  给单个文件名等于只交出其中一段。
- **不新建审计子系统** —— `modelIoLog` 本来就在往那儿写，这条命令只是把位置说出来。
  它是 `modelIoLog.dirForSession()` 的第一个真实调用者：那个函数上的注释一直写着
  「`/view_context` 用它」，但全仓**没有任何调用者**，那句注释是过时的。
- **不要求 runtime 活着。** `dirForSession()` 活桶优先、拿不到就按目录名后缀在盘上找最近的一个，
  所以**重启后翻旧会话也拿得到路径** —— 这正是它作为取证工具的价值，因此实现里**故意不调**
  `assertAgentRuntimeActive()`（`/view_context` 需要它，因为那条要读活着的 runtime 上下文；
  这条只问盘上的路径）。没有日志目录时明确报「还没有」，不给空串让人以为复制成功了。
- **同时进剪贴板与时间线。** 只发 toast 不够：toast 会消失，而这个路径正是要拿去 audit 的东西，
  得留在会话里可选中、可回翻。那条留痕 `promptExcluded: true` ——
  少了它，一句给人看的路径会占进下一轮提示词，还会被 `/view_context` 导出成"模型看过的历史"，那是假的。
  它也不落库、不改 `updatedAt`：一条本地留痕不值得让会话变脏。
- 名字用下划线（`/copy_session_path`）而不是空格：开菜单的 token 正则是 `\/([\w-]*)`，
  带空格的名字根本不会被识别成命令。与既有的 `/view_context` 同一个写法。

**顺带修掉一个会静默跑错的分派。** `ShortcutStore.commit()` 原来是「不是 `/clear` 就当
`copyContext`」的兜底 —— 加第三条命令的那一刻它就会静默执行错的那条，而且**不会有任何类型错误**。
已改成 `switch` 显式分派，漏接一条的表现是可见的 `unknown command`，不是跑错。

## Verification and handoff

Unit/source tests cover triggers and non-triggers, filtering/order, keyboard/click/IME behavior,
single execution, async draft/session fencing, `/clear` delegation/refusal, and truthful context
export through the runtime/API boundary including missing history and failures. Compile affected
Vue/Less/TypeScript and run focused existing composer/runtime regressions. No Electron/E2E, live
app, packaging, installation, independent review or Git sync; Ral tests the loaded new code.

Completed: 32/32 focused tests across composer/history, workspace UI and context export passed.
ChatPanel/SlashMenu script/template/Less compilation, 15 related TypeScript transforms and the
AI-CRMS runtime guard passed. Scoped diff checks passed. Scoped lint retains two pre-existing
unused `AgentConversationContext` imports in controller/handler and existing formatting warnings.
The old agent-runtime guard still fails its outdated steering prompt string assertion at line151;
it was not changed as part of this task. No Electron/E2E, full build, installation or sync was run.
