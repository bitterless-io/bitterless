# Maestro Default Workspace

**Status:** implemented 2026-09-10; owner E2E pending.

Owner decision 2026-09-10 (Ral:「不要区分会话,实际工作的时候 n 个会话都在做一个事情,干脆就搞一个大的
默认工作空间得了」). With no workspace bound to a chat, every workspace tool resolves against **one
shared directory**:

```
~/.bitterless_<edition>/default_workspace
```

## 目录名带环境,和 userData 同一条轴(2026-09-18)

Ral 2026-09-18:「~/.micromeet 或 .bitterless 文件名要带上环境例如 bitterless_preview 和 userdata
类似……具体参考现在的情况」。

profile 的 `appName` **就是** userData 的目录名,所以工作空间根直接取它的小写形式 ——
一条轴、一个来源,不存在第二张表可以走偏:

| profile id | userData(`appName`) | default workspace |
| --- | --- | --- |
| `production` | `Bitterless` | `~/.bitterless/default_workspace` |
| `production-preview` | `Bitterless_PREVIEW` | `~/.bitterless_preview/default_workspace` |
| `production-debug` | `Bitterless_DEBUG_PROD` | `~/.bitterless_debug_prod/default_workspace` |
| `test-debug` | `Bitterless_DEBUG_DEV` | `~/.bitterless_debug_dev/default_workspace` |
| `test-release` | `Bitterless_DEV` | `~/.bitterless_dev/default_workspace` |

生产取裸名,其余版本一律带后缀 —— **Preview 因此不会写进 Production 的文件**,两者本来就持有
不同的真实数据。从 `appName` 推导而不是从 `id` 推导是刻意的:要求是「和 userdata 类似」,
而 `appName` 正是给 userData 命名的那个值;将来新增版本自动获得自己的目录,两张清单不可能对不上。

目录名与文件名的写法保持 owner 给的形态:`default_workspace`(下划线)。

The root resolves through `app.getPath('home')`, not `os.homedir()`, because E2E redirects the home
path (`BITTERLESS_E2E_HOME_DIR`) — a test run must not touch a real `~/.bitterless*`。
**这条保留**:测试隔离是工程纪律,不是产品决定。

## 进系统提示词(2026-09-18)

Ral:「默认 workspace 要进系统提示词,且 onlypreview 和 chat 默认都不选中 default_workspace」。

- 提示词那一行原来只说「有一个默认工作空间在用」却**不说是哪个**,模型因此不知道自己写的文件落在哪。
  现在带上绝对路径:`- Active workspace: none selected — the shared default workspace is in use: <path>`。
- **界面仍然显示「未选择」**:默认工作空间只出现在主进程的 cwd / 文件根回退里,从不写进任何
  workspace ref —— 它是隐式回退,不是一次选择。`tests/maestro/defaultWorkspace.test.mjs` 有守卫:
  渲染层一旦引用 `defaultWorkspaceRoot` / `ensureDefaultWorkspace` 就判红。

验证:`yarn test:default-workspace`(3/3)—— 五个版本的目录逐个对照、ensure 幂等(已存在就复用,
不重建)、以及渲染层守卫。micromeet-cowork 侧同一套规则。

## Contract

- **Ensured, never asked.** `mkdir -p` at boot (`src/main/app.main.ts`, after `configureE2EUserData()`
  and skipped in helper processes) and again on every resolve. "Pick a workspace first" is no longer a
  reachable answer.
- **Not per session.** It replaces the per-chat `<userData>/cowork/chat_workspaces/<chat id>` fallback:
  n chats working on one job were writing into n directories nobody could find again. Old per-chat
  directories are left where they are; nothing is moved.
- **It is the workspace, not a narrow fallback.** `resolveWorkspacePath` — the single door — answers
  with it, so `list_workspace_files`, `search_files`, `read_file`, `write_file`, `create_artifact`, the
  archive tools and `open_workspace_folder` all take it. `WorkspaceArchiveService.resolveWritablePath`
  existed only to give the archive tools a fallback the write tools were denied; it is deleted.
- **An explicit workspace always wins.** Binding one is still a real choice; this is only what
  "nothing chosen" resolves to. Only an explicit reference can go stale, so only that one is cleared
  on a missing directory.
- **Reads and writes share one base.** A relative `read_file` path used to resolve against `~` while a
  write resolved against the workspace, so the agent could write `notes.md` and then fail to read it
  back by that name. Both now resolve against `effectiveWorkspaceRoot` (explicit, else default).
  Absolute reads stay unconfined — the OS remains the gate.
- **The boundary is unchanged.** The default root goes through the same `resolve + relative` and
  `realpath` checks, so `../` still fails as `outside-workspace`.
- **The composer still shows `Choose workspace`.** An unmade choice stays unmade — the chip reports
  what the owner picked, not where the tools landed. Every write already names its absolute
  destination in the reply, which is how the owner finds it.

## Files

| file | role |
| --- | --- |
| `src/main/maestro/files/defaultWorkspace.ts` | `defaultWorkspaceRoot()` + `ensureDefaultWorkspace()` |
| `src/main/maestro/windows/main/workspaceFile.service.ts` | `effectiveWorkspaceRoot()`, `resolveWorkspacePath`, `resolveReadPath` |
| `src/main/maestro/files/workspaceArchive.service.ts` | archive tools now use the host door only |
| `src/main/agent/prompt/maestroSysPrompt.ts` · `src/main/agent/runtime/agentPrompt.ts` | the agent is told writes always have a home |

Cowork carries the same contract against `~/.micromeet-<env>/default-workspace`
(`micromeet-cowork/docs/features/cowork-workspace-files.md` § Default Workspace); the two apps are
deliberately separate roots.


## 进系统提示词(2026-09-18)

Ral:「默认 workspace 要进系统提示词,且 onlypreview 和 chat 默认都不选中 default_workspace」。

- 提示词里那一行原来只说「有一个默认工作空间在用」却**不说是哪个**,模型因此不知道自己写的文件
  落在哪、也没法把路径告诉人。现在带上绝对路径:
  `- Active workspace: none selected — the shared default workspace is in use: <path>`。
- **界面仍然显示「未选择」**。默认工作空间只出现在主进程的 cwd / 文件根回退里,
  从不写进任何 workspace ref —— 它是隐式回退,不是一次选择。
  `tests/maestro/defaultWorkspace.test.mjs` 有一条守卫:渲染层一旦引用
  `defaultWorkspaceRoot` / `ensureDefaultWorkspace` 就判红。

验证:`yarn test:default-workspace`(3/3)—— 固定路径、ensure 幂等(已存在就复用,不重建)、
以及上面那条渲染层守卫。micromeet-cowork 侧同一套规则,路径为 `~/.micromeet/default_workspace`。
