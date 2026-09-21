# 会话中途换工作区，cwd 不跟着走 —— 内置工具和宿主工具落在两个目录

**状态：** ✅ 已修 — 2026-09-21（Ral 拍板 **A · cwd 跟随工作区**），待人工验收
**发现：** 2026-09-21，修 `projectInstructions.test.mjs` 时撞出来的
**影响：** bitterless 与 micromeet-cowork **两端同构**，同一个缺陷

## 症状

一个会话里先绑工作区 A、发过消息，再换到 B（或清空）。之后：

| 看哪儿 | 说的是 |
|---|---|
| system 末行 `Current working directory:` | **A** |
| 每轮 D2 `- Active workspace:` | **B** |
| 宿主工具（`write_file` / `list_workspace_files` / `search_files` …） | **B** |
| pi 内置工具（`read` / `write` / `edit` / `grep` / `find` / `ls`）的相对路径 | **A** |
| `bash` 的 spawn cwd | **A** |

于是 `read notes.md` 读的是 A 的，`write_file notes.md` 写的是 B 的 —— 同一个相对路径，两个文件。

## Root cause

**cwd 是会话级的，在建会话那一刻冻死；换工作区只改提示词，不重建会话。**

三段拼起来：

1. **BaseAgent 记住了新根，但不丢会话。**
   ```ts
   async setProjectRoot(projectRoot?: string): Promise<void> {
     if (this.busy) return
     this.projectRoot = projectRoot          // 记下来
     const instructions = await readProjectInstructions(projectRoot)
     if (this.busy || instructions === this.projectInstructions) return
     const live = this.sessionPromise
     if (live) await (await live).setSystemPrompt(this.fullSystemPrompt(instructions))
   }
   ```
   它调的是 `setSystemPrompt`，**不是 `reset()`**。对比 `setTarget()`（换 provider）—— 那条明确写着
   「Drops the session so the next turn rebuilds it」并调 `this.reset()`。换工作区没有这一句。

2. **cwd 只在建会话时读一次。**
   ```ts
   private resolveCwd(): string { return this.projectRoot ?? this.opts.cwd }
   // …只在 createSession() 里被读：runtime.createSession({ …, cwd: this.resolveCwd() })
   ```

3. **pi 把它冻在构造函数里，并且烤进了工具定义。**
   `@earendil-works/pi-coding-agent/dist/core/agent-session.js`：
   - `:145` `this._cwd = config.cwd` —— 构造函数里赋一次，全文件**没有任何 setter**；
   - `:2191` `createAllToolDefinitions(this._cwd, …)` —— 内置工具的定义直接带着它生成；
   - `:1933` 资源发现也用它。

   所以 `setSystemPrompt` 能换掉系统文本，换不动 `_cwd`。

而宿主工具走的是另一条路 —— `resolveWorkspacePath(sessionKey, rel)`
（bl 侧是 `maestro/windows/main/workspaceFile.service.ts` 的同名方法），读的是**会话当前的绑定**，所以它跟着 B 走。两条路自此分叉。

## 一处**不是**缺陷的地方，别顺手"修"

system 里那行 `Current working directory: A` 是**对的**：它由 pi 自己从 `_cwd` 追加，宿主侧的
`resolveRuntimeSystemPrompt().finalSystemPrompt` 只是它的镜像，并在 `PiRuntimeSession.setSystemPrompt`
里断言一致。所以系统提示词没有撒谎 —— 它忠实报告了运行时真正在用的目录。

**撒谎的是这两者之间的不一致**：system 说 A，同一轮的 D2 说 B。这正是
`agent-cwd-follows-workspace.md` 要消灭的那类缺陷（当年是 system 说 `/`、D2 说真实工作区），
只是这次的触发条件从"启动方式"变成了"会话中途切换"。

## 这就是 PQ-CWD

`overmind:areas/agent-runtime/chat/prompt-structure.html#pending-questions` 里那条 **PQ-CWD**
（「会话中途换 workspace 时 cwd 该怎么走」）由本条结案。它是那个问题的**实测后果**：
文档此前只定义了机制（绝对路径、adapter 显式传、同文本同 cwd 同结果），没定义中途切换的语义。

## 定案：A · cwd 跟随工作区（Ral 2026-09-21）

**与 pi 的做法一致** —— 这不是我们发明的路线。pi 自己也**不在会话中途改 cwd**：

- `dist/main.js:527` 的注释写着「Decide the final runtime cwd **before creating cwd-bound runtime
  services**。`--session` 和 `--resume` 可能选到别的项目的会话，所以 project-local settings、
  resources、provider 注册、models 必须在**目标会话的 cwd 确定之后**才解析」。
- 它换 cwd 的唯一路径是 `:543`：
  `sessionManager = SessionManager.open(sessionFile, sessionDir, selectedCwd)` ——
  **换 override 重开，再重建 cwd-bound 服务**，会话文件不变。
- 整个 SDK 没有任何 in-session 改 cwd 的入口（`agent-session.js` 全文只有 `:145` 一次赋值）。

我们这一版就是同一套：`setProjectRoot` 发现 cwd 变了 → `reset()` 丢会话 → 下一轮用新 cwd 重建，
`opts.sessionFile` 不变。`SessionManager.open(path, dir, cwdOverride)` 里
`const cwd = cwdOverride ?? header 里的 cwd ?? process.cwd()` —— **override 优先**，
所以新 cwd 生效而历史从同一份 jsonl 接着读。

### 实现要点（三个都有守卫钉着）

1. **只在 cwd 真的变了时才丢。** `handleAgentTurn` 每一轮都用同一个值调一次 `setProjectRoot`；
   少了这道比较，每轮都会把会话推倒重来 —— 比原缺陷更糟。比较用 `resolve()` 归一化，
   `/a` 与 `/a/` 不算变化。
2. **等 abort 落定再返回。** `reset()` 触发的 `abortManagedSession` 是「同步置位、异步清除」，
   而 `prompt()` 开头那道闸会因 `abortPending` 拒掉这一轮。`handleAgentTurn` 正是
   `await setProjectRoot()` 之后紧接着发消息 —— 不等的话，用户换完工作区的**那一条**消息会回
   「agent is already handling a message」。这条是新守卫在实现过程中抓出来的。
3. **换根不再推 `setSystemPrompt`。** 会话马上要丢，往里推没有意义；新会话直接带上新指令。
   同一个根下**改 AGENTS.md 内容**仍走 `setSystemPrompt`，运行时拒绝更新时检视面仍停在
   最后一次成功应用的快照 —— 那条路径没变。

## 附：当初列的两条修法与代价

| | 做法 | 代价 |
|---|---|---|
| **A · cwd 跟随工作区** | `setProjectRoot` 在根**真的变了**时 `reset()`，下一轮重建会话 | 会话原生历史随之丢弃 —— pi 的对话状态在 session 里。要保历史就得先 compact 再重建，或者把历史重放进新会话。**这是真代价，不是实现细节** |
| **B · cwd 锁死，明说它锁死** | 保持现状，但在 D2 旁边写清"内置工具的工作目录是建会话时的那个，不随本行变"，并禁止相对路径混用 | 零风险，但把一个反直觉的行为永久写进提示词；用户切了工作区却发现 `read` 还在读旧的 |

## 守卫

`agentCwdFollowsWorkspace.test.mjs`（cowork `tests/unit/`、bl `tests/maestro/`，各 3 条）：

- 换根 → 丢会话，下一轮带新 cwd 重建；清空 → 回落构造值，同样重建；
- 根**没变**重复设置 5 次 → 只有一个会话（挡住"每轮推倒重来"这个反向坑）；
- `/a` 与 `/a/` 不算变化。

随之更新的既有守卫：`projectInstructions`（会话数由 1 变 2 / 3，各带自己的 cwd；reject-update 路径
改用"同一个根、文件变了"触发，否则它会变成永远通过的空测试）。

## 复现（修复前）

1. 新会话，绑工作区 A，随便发一句（会话被建起来，cwd = A）。
2. 换到工作区 B。
3. 问它 `ls` 或让它 `read` 一个 A、B 都有同名的文件。
4. 它读的是 A 的内容，而同一轮提示词里 D2 写着 B。

修复后：第 2 步会丢掉会话，第 3 步在新会话里执行，cwd = B，与 D2 一致。
