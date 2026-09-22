# `bash` 工具没有超时 —— 一条 grep 把回合钉死 11 分钟，期间 steer 不进去

- 报告：Ral 2026-09-22「tooling 为啥卡主，按理不该 tooling 这么久」「消息无法发出去不能 steer」
- 状态：**P0 / P2 / P3 已实施**；P1（兜底超时）经 Ral 决定先不做
- 证据：`~/Library/Application Support/COWORK_TEST_DEBUG/agent-io/20260922172300506-3livgggcegdmucgup78`
  与 `logs/main-2026-09-22.log`

## 不是「状态没及时更新」

Ral 提的另一种可能（UI 计时器没刷新）**已排除**。三条各自独立的证据都说它真的在跑：

| 证据 | 内容 |
| --- | --- |
| 活进程 | `PID 57986` 存活 **10m57s**，CPU 76.9% |
| main 日志 | 最后一条 `agent-tool-end` 停在 `17:24:26`（那是同批的 `read`），**`bash` 那条从来没有 end** |
| agent-io | 会话文件自 `17:24:10` 起 **11 分钟零新增记录** |

UI 上的 `Tooling 10m17s` 是**准确**的。

## 时间线

| 时刻 | 发生了什么 |
| --- | --- |
| `17:23:15` | 会话开始，turn 1「介绍页面内容」——`page_snapshot` 18ms、`end_browser_use` 1ms，53s 正常完成 |
| `17:24:10` | turn 2「给我邓小玲的联系方式」 |
| `17:24:18` | round 1：`grep` 工具 38ms、`read .agents/skills/talk_to_contacts/SKILL.md` 11ms |
| `17:24:26` | round 2：`read areas/contacts/contacts.index.md` 9ms **✓**；`bash` **✗ 至今未返回** |
| `17:35` | 仍在跑，仍停在 8 个名字里的**第 1 个** |

## 卡住的那条命令

```bash
cd /Users/ral/Documents/projects/overmind && \
for p in "邓小玲" "鄧小玲" "小玲" "Xiaoling" "xiaoling" "XIAOLING" "Hsiao-ling" "xiaolinda"; do
  echo "=== $p ==="
  grep -rli -- "$p" . --include='*' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=tmp 2>/dev/null | head -20
done
```

工作区是 **93 GB**。`--include='*'` 强制读**每一个文件**（含二进制）；那三个 `--exclude-dir` 挡不住
`projects/*/out`、`dist`、OnlyPreview 的 SQLite 索引、各 submodule 的构建产物。
11 分钟只啃完第 1 个名字 ⇒ 整个循环按这个速度要 **40 分钟以上**。

`head -20` 也救不了它：匹配数不足 20 时不会触发 SIGPIPE，grep 会把整棵树扫完。

## 三条缺陷，量级不同

### 1. `bash` 没有上限，而且宿主拿不到它的 signal（根因）

单条命令就能把整个回合钉死，界面只显示「Tooling」，没有「它已经跑了多久 / 在跑什么 / 还要不要等」。
这不是模型写坏了一条命令的问题 —— **任何**一条慢命令都会是同样的结果。

更要紧的是第二半：`bash` 是 pi 的 builtin，**宿主手上没有它那次调用的 `AbortController`**，
于是想「只停这条命令、保留回合」也做不到。下面 P0 要的能力就卡在这一点上。

### 2. steer 送不进去，而且回车被静默吞掉

两层叠加：

- **pi 只在工具边界投递 steering**（`agent-loop.js:158`：`turn_end` 之后、下一次 LLM 调用之前，
  而 `executeToolCalls` 是整批跑完才回来）。bash 不返回 ⇒ 没有边界 ⇒ 排队的消息永远投不出去。
  这是 pi 的设计，不是缺陷 —— 但它意味着「工具无上限」会直接吃掉 steering 能力。
- **渲染端 `sendInFlight` 被永不 resolve 的投递承诺卡死**：`send()` 开头是
  `if (sendInFlight.value) return`，**静默**；而 steering 的那次 `sendAgentMessage` 一直 await 到
  「投递成功」。于是第一次回车之后 `sendInFlight` 永远为 `true`，**之后每一次回车都什么都不发生**。

**一个决定性的旁证**：同一时刻 `/copy_session_path` 是**可用**的（截图里连续两条
`Session path copied`）。斜杠命令走 `commitShortcut()`，不经过 `send()` —— 所以死的不是键盘、
不是焦点、不是输入框，**只有 `send()` 那一条路**。这正好指向 `sendInFlight`。

与 `issues/enter-does-nothing-while-the-turn-is-stopping.md` 是同一类缺陷的另一个入口：
**一次按键什么都不发生**。那条修的是「按过 Stop 之后」，这条是「工具卡住期间」。

### 3. 检索策略：不该对 workspace 根做无范围递归搜索

agent 明明已经 `read` 了 `talk_to_contacts/SKILL.md`（17:24:18，11ms），也 `read` 了
`contacts.index.md`（17:24:26，9ms），却没有按技能走，而是自己编了一个八种写法的暴力全库搜索。

而且方向本身就错了 —— Ral 要的是**当前网页上**那个人的联系方式（他随后补的那句
「我是指网页中找邓小玲的联系方式」正是因此发出，却再也送不进去）。

## pi 是怎么做的（查过源码，不是推测）

| 问题 | pi 的做法 |
| --- | --- |
| bash 超时 | `timeout` 是**模型自己传**的参数，schema 描述原文 `"optional, no default timeout"`；`resolveTimeoutMs(undefined)` 直接 `return undefined`，**不传就一个定时器都不装**（`core/tools/bash.js:14-16, 28`） |
| bash 能不能被杀 | **能**。它接 `AbortSignal`，abort 时 `killProcessTree(child.pid)` 杀**整个进程组**（`bash.js:37-42`） |
| 能不能只停这一个工具 | **不能**。交互模式里 `app.interrupt` 的语义就是 “Cancel autocomplete / abort streaming” —— 只有「abort 整个回合」一档，没有「只杀这个工具、保留回合」 |
| tooling 期间发的消息 | 进 steering 队列，**只在工具边界投递**（`agent-loop.js:158`，`executeToolCalls` 整批跑完才回来）。工具不返回 ⇒ 没有边界 ⇒ 永远投不出去 |

**结论：pi 给了原语（bash 可被 abort 杀死），没给策略（按工具打断）。** 策略必须宿主自己做。

## 一条必须先认下来的既有决定

宿主**刻意取消过**「对所有工具一刀切的 120 s 默认超时」（`BaseAgent.ts:150-162`），理由写得很清楚：

> 被切断时工具**本身还在跑**，宿主只是不再看着它 —— 模型收到「timed out」，真实世界里那件事却还在继续，这比慢更糟。

所以本条**不是**要把那个默认值加回来。那条决定的前提是「切断 ≠ 停止」；而 `bash` 恰恰是**反例** ——
pi 的实现在 abort 时真的 `killProcessTree`，切断就是停止。**bash 属于可以安全设上限的那一类，
它是例外，不是对那条决定的翻案。**

## 修复契约

**P0 · tooling 期间发的消息必须能送到模型，由模型决定要不要停。**（Ral 2026-09-22 的原话：
「当我发消息干涉的时候，ai 判断要不要停止这个 bash 并重新判断该如何操作」）

落点：**把 `bash` 包成宿主工具**，宿主因此持有那次调用的 `AbortController`
（宿主工具契约本来就有 `execute(args, { signal })`，`agentRuntime.types.ts:24`）。拿到 signal 之后：

- 有 steering 排队时 → 立刻 abort 当前 bash（pi 的实现会 `killProcessTree`），
  工具以「被操作者打断，已运行 Ns，命令是 …」**如实返回**；
- 工具一返回就出现**边界** → pi 在那里投递排队的 steering → 模型同时看到「用户说了什么」和
  「刚才那条命令被打断了」，自己决定重来、换方式、还是继续。

**不是 abort 整个回合** —— 回合、上下文、已完成的工具结果全部保留，只有那一条命令被杀掉。

**P1 · bash 的兜底超时 —— Ral 2026-09-22 决定：先不做。**（原话「60s 不可以，超时设置先不做」）
一个猜出来的秒数会把「一条慢但正确的命令」判成失败，而它**本身还在跑** —— 那正是宿主当初刻意
取消一刀切超时的理由。P0 落地之后人随时能一句话叫停，这条兜底的紧迫性也就下来了。
要做的时候单独立条，先量一批真实命令的耗时分布再定数。

**P2 · 回车不许静默。** 渲染端 `sendInFlight` 不能被一个永不 resolve 的投递承诺卡死；
送不进去要显式说「当前工具已跑 N 分钟」，并把字留住。与
`issues/enter-does-nothing-while-the-turn-is-stopping.md` 是同一条不变量：
**一次按键不能什么都不发生。**

**P3 · 工具纪律。** 禁止对 workspace 根做无范围递归搜索；找文件内容优先用宿主自带的 `grep`
（有 gitignore 感知，17:24:18 那次 38ms 就返回了）。找人先走 `talk_to_contacts`；页面上的信息先看页面。

## P0 的机制已经验证（不用重写 bash）

原本担心「包一层 bash 要把 spawn / killProcessTree / 截断全部重写一遍」。**不用** ——
pi 的 bash 工具本来就是**可插拔**的：

```ts
// pi-coding-agent/dist/core/tools/bash.d.ts
/** Pluggable operations for the bash tool. */
export interface BashOperations {
  exec: (command, cwd, { onData, signal, timeout, env }) => Promise<{ exitCode: number | null }>
}
export declare function createLocalBashOperations(options?): BashOperations   // pi 自己的本地实现
export declare function createBashToolDefinition(cwd, options?: { operations?: BashOperations, … })
```

两个都从包根导出（`index.d.ts`）。所以做法是：

1. 用 `createLocalBashOperations()` 拿到 pi 自己的实现 —— spawn、`killProcessTree`、输出截断全部照旧；
2. 把它的 `exec` **包一层**：宿主为每次调用建一个 `AbortController`，与传入的 signal 合并后交给 pi；
3. 用 `createBashToolDefinition(cwd, { operations: 包装后的 })` 造一个宿主版 bash，
   把 pi 的 builtin `bash` 从工具清单里排掉（`createAgentSession` 的 `tools` 白名单 / `excludeTools`）；
4. steering 一入队 → 触发那个 controller → pi 的实现杀掉整个进程组 → 工具以
   「被操作者打断，已运行 Ns」返回 → **边界出现** → pi 投递排队的消息。

宿主这边**一行 shell 逻辑都不用写**，只多一个 controller 和一次「有没有排队消息」的查询。

## 当场的解堵（已执行）

2026-09-22 17:47 杀掉 `57985`/`57986`。会话在 `17:35:40` 收到 `turn_end`，回合退出。
留档是因为**这正是 P0 要自动做的事** —— 人不该需要去终端里 `kill` 才能把一句话送进对话。

## 实施记录（2026-09-22）

| | 状态 |
| --- | --- |
| **P0** tooling 期间发的消息能送到模型 | ✅ 两仓已实施 |
| **P1** bash 兜底超时 | ⏸ Ral 决定先不做 |
| **P2** 回车不许静默 | ✅ cowork 已实施；bitterless **本来就没有这个缺陷**（见下） |
| **P3** 工具纪律 | ✅ 两仓提示词已加 |

**P0 的落点**：新增 `runtime/piInterruptibleBash.ts`（两仓同一份）——
`createInterruptibleBash(pi.createLocalBashOperations())` 把 pi 自己的本地实现包一层，
宿主因此持有每次调用的 `AbortController`；`piRuntimeAdapter` 用
`pi.createBashToolDefinition(cwd, { operations })` 造出同名 `bash` 放进 `customTools`
（按名字覆盖 builtin，`agent-session.js:2119`）；`piRuntimeSession.enqueueSteering` 排完队后调
`interrupt(...)`。杀的只是那一条命令，回合与已完成的工具结果都留着。

**为什么不用 `excludeTools`**：它过滤的是「活跃工具名单」（`sdk.js:144`），会把我们自己那一个
同名 bash 一起关掉。

**P2 在 bitterless 不需要动**：BL 的 `send()` 根本没有 `sendInFlight` 这道再入闸 ——
那条静默 return 是 cowork 独有的，BL 不存在这个缺陷（配对规则：已不存在的缺陷需要的是核实，
不是为对齐而改代码）。BL 的同类风险是「连按回车会叠出多条 steering」，量级不同，另记。

**守卫**：`steeringInterruptsBash.test.mjs`（cowork `tests/unit/` 9 条 · bitterless
`tests/maestro/` 7 条），都做过红灯验证 —— 拿掉打断、把回合级 abort 认领成「被操作者打断」、
把 `sendInFlight` 还原成静默 return，各判红。
