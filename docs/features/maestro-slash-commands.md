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
History follows the current branch and latest compaction: include its summary, kept tail and later
entries; omit absorbed originals, earlier summaries and non-model metadata. Use the runtime's readonly
`contextEntries()` projection; keep raw `entries()` for compaction candidates and graph statistics.
Branch summaries retain their text. An unavailable effective-read capability fails explicitly.
Host compaction and supplemental-message appends also synchronize the live pi messages with the native
session projection. Explicitly reintroduced user-chain/manifest content remains effective and visible.
Reuse existing send prompt builders and BL's first-turn memory/preamble semantics; export itself does
not change the prompt actually sent. Remove only the slash token when deriving the pending draft. Pending references
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
  宿主启动后将它接到 `<userData>/agent-io`；日志记录初始化快照、宿主 prompt 文本和回合诊断，
  不代表完整 provider 请求/响应。`/view_context` 也会只读附上已保存日志的目录。
- **不要求 runtime 活着。** `dirForSession()` 活桶优先、拿不到就按目录名后缀在盘上找最近的一个，
  所以**重启后翻旧会话也拿得到路径** —— 这正是它作为取证工具的价值，因此实现里**故意不调**
  `assertAgentRuntimeActive()`（`/view_context` 需要它，因为那条要读活着的 runtime 上下文；
  这条只问盘上的路径）。查找先等该会话已有的 opening 和写队列，只返回包含非空日志文件的目录。
  2026-09-16 更新：New chat 即写入当前系统提示与模型配置的初始化快照，不调用模型；复制/打开缺失日志的旧会话时，初始化当前诊断记录，并标明此前原始日志不可还原。已有目录只读返回，不换卷、不创建 runtime。保存失败可见且不改剪贴板。
- **同时进剪贴板与时间线。** 只发 toast 不够：toast 会消失，而这个路径正是要拿去 audit 的东西，
  得留在会话里可选中、可回翻。那条留痕 `promptExcluded: true` ——
  少了它，一句给人看的路径会占进下一轮提示词，还会被 `/view_context` 导出成"模型看过的历史"，那是假的。
  它也不落库、不改 `updatedAt`：一条本地留痕不值得让会话变脏。
  留痕带 renderer-only 的 `localOnly` 标记，后续正常保存也必须排除；不能只靠“不主动保存”。
  它不封口正在 streaming 的 assistant。其他 `promptExcluded` 错误卡或压缩记录仍可正常持久化。
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

## Skills in the slash menu (2026-09-18)

Ral, 2026-09-18: 「bl cowork 中 技能要能用/触发,及将技能列表拼到现有 slash short cut 后面
不需要单独的 skill select 组件」. Same contract as micromeet-cowork's
[#10](../../micromeet-cowork/docs/features/cowork-slash-commands.md); this section records BL's own
file placement. Paired change, implemented in both.

**Third item kind.** `ShortcutItem` becomes a discriminated union on `kind`:
`command` (the existing closed set of literal names, unchanged behaviour) and `skill`. A `skill` row
carries `{ reference, name, layer, path }` — the exact shape the composer already keeps in
`session.detail.draft.skill`.

**Ordering.** Commands first in ASCII order, then skills in ASCII order. Two flat blocks, no group
header and no separator between them, so the menu keeps its single-list look. With no skills the menu
is byte-identical to before.

**Committing a skill attaches it; it does not execute.** The `/xxx` token is removed and the rest of
the draft is left alone — a skill almost always needs a sentence of intent with it. The attachment
rides the mechanism that already exists end to end: `draft.skill` → `context.selectedSkillRef` →
`selectedSkillPrompt(registry, ref)` in `src/main/maestro/skills/skillSelection.ts`, which reads that
skill's current `SKILL.md` body into the turn and states that the user chose this exact one,
*including when it is explicit-only*. So "技能要能用/触发" needs no new machinery — this change moves
the entry point, not the execution.

**Catalog source.** `ChatPanel` fetches `coach.skillCatalog({ sessionId })` when the session changes and
maps the usable rows (no `status !== 'ready'`, no `scope === 'unassigned'`, no `enabled === false`) into
skill rows. `ShortcutStore` stays dependency-free — it receives a prepared array and never calls XPC,
which is what lets the guard run it outside any DOM.

A catalog fetch that fails leaves the skill block empty and the commands working. Same requirement as
[no institution must not block normal function](../plan/tasks/skills-pi-native-loading-001.md).

**Height.** Ral, 2026-09-18:「高度最高 420px，内容太多就滚动」. The list length now follows the skill
catalog instead of a fixed handful of commands, so the panel is capped at **420px** and scrolls
(`SlashMenu.less`), with `overscroll-behavior: contain` so a wheel gesture that reaches the end does
not scroll the conversation behind it. A cap alone would have been half a fix: once the list scrolls,
`SlashMenu.vue` scrolls the active row into view (`block: 'nearest'`, not centring — centring makes the
list jump on every keypress) or the arrow keys walk the selection off-screen and the panel looks frozen.

**Removed.** `src/renderer/maestro/control/src/store/skillPicker.store.ts` and the
`chat-panel__skills` dialog it drove. The **selected-skill chip** (`chat-panel__selected-skill`) stays —
it is the receipt for "this send will carry this skill", not a picker; without it the attachment would
be invisible state.

Verification: `tests/maestro/slashSkills.test.mjs` drives the real `ShortcutStore` outside any DOM —
command/skill ordering, empty-skill byte-identity, commit returning the skill rather than running a
command, and skills never entering the command registry.

## `/export` — zip this session's model I/O directory (2026-09-22)

`/copy_session_path` hands over the path; `/export` hands over **the thing you can actually send**:
the same directory, zipped, saved where the owner picks. Both resolve the directory through
`resolveSessionIoDirectory` — by **session identity**, never from a path the renderer supplies — so
copy-path, open-folder and export cannot point at different places.

The archive is written with `cwd` set to the directory's **parent** and the directory name as input,
so it unpacks as one top-level folder instead of scattering files where someone extracted it.

### Two steps, not one call

Ral, 2026-09-22: there must be a waiting indicator while it compresses. That requirement decides the
shape of the interface — the command is split in two:

| Step | Method | Who is busy |
| --- | --- | --- |
| 1 | `pickSessionIoExportTarget` | the **person**, deciding where to save |
| 2 | `writeSessionIoArchive` | the machine, compressing and writing |

The indicator (Arco `Message.loading`, `duration: 0`) is raised only after step 1 returns and closed
only after step 2 does, so **it lasts exactly as long as the compression**. Done in one call, the
loading state would cover the whole time the save dialog is open — a fake "compressing" over a person
thinking.

Step 2 **re-resolves the directory** rather than taking step 1's `path`: the view may have switched
sessions in between, and the command means "export this session" — identity is the criterion, the
path is only a result. The `target` the renderer holds is a save location, not a source path that
could bypass the identity check.

### Cancelling is not a failure

The contract keeps `cancelled` and `error` on separate branches (`SessionIoExportTarget` /
`SessionIoExportResult`). Changing your mind in the save dialog is not a fault — nothing is written
to the timeline and nothing turns red. A `duration: 0` message never expires on its own, so it is
closed in a `finally`: success, failure and throw all have to clear it, or a "compressing" toast
hangs on screen forever.

### Verification

`tests/maestro/exportSessionArchive.test.mjs` (same shape in cowork's `tests/unit/`): each step stays
in its lane (step 1 never calls `createArchive`, step 2 never calls `showSaveDialog`), both go through
the same directory resolver, the cancel branch exists, the archive has one top-level folder, **the
indicator is raised after the pick and before the write**, and it is closed in a `finally`. 6/6 in each
repo, red-checked — moving the indicator before the pick, or folding compression back into step 1,
each turns one test red.
