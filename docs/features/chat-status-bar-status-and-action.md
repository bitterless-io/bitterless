# 状态条重构：status 收成一组词，action 单独一行，停止不再有「失败」这一态

**日期**：2026-09-22。**来源**：Ral 当场口述的规格（原文见 #1）。**状态**：implemented 2026-09-22；
owner testing pending。**配对**：`micromeet-cowork`（同名文档）。

## 1. Ral 的规格（原话）

> status bar status 本身需要分类，例如 thinking wait for response 算一类，如果是执行工具不要展示
> 工具的命令字符串了，统一用 tooling 还有 compacting 这一类统一就叫做 status
>
> statusbar 中增加个 action 组件显示 agent 最新的 action
>
> workflow subagents 都是单独的一栏
>
> 另外只有需要人确定的才是 wait 否则先都用 run
>
> 停止失败 就不该有 stop 必须能停止成功

## 2. 四条改动

### G1 `status` 是一组**枚举词**，不再夹带自由文本

原来主句里混着三种东西：状态词（`Thinking…`）、工具调用原文（`read_file · src/main.ts`）、
任务标题（`Drill · 正在探索 /orders`）。于是同一行有时是状态、有时是细节，**人不能只看一眼就
知道现在处于哪一档**。现在 `status` 只出这几个词，先匹配先赢：

| 序 | status | 条件 | tone |
| --- | --- | --- | --- |
| 1 | `Needs your call` | 本会话有**未回答的 decision 卡** | `wait` |
| 2 | `Waiting on you` | 本会话有**未回答的 confirm 卡** | `wait` |
| 3 | `Compacting` | `session.compacting` | `run` |
| 4 | `Retrying` | `turn.retry`（自动重试进行中） | `run` |
| 5 | `Thinking` | `turn.thinking` | `run` |
| 6 | `Tooling` | 本会话有在跑的任务，或本回合最近一条活动是工具调用 | `run` |
| 7 | `Answering` | `turn.phase === 'streaming'` | `run` |
| 8 | `Waiting for response` | 有回合，但以上都不是 | `run` |
| — | （整条隐藏） | 没有回合、没有任务、没有别的行 | — |

### G2 `tone` 的判据换成「要不要人动手」

> 「只有需要人确定的才是 wait 否则先都用 run」

只有 1 / 2 是 `wait`（琥珀、不呼吸、带时钟）。**压缩、重试、任务在等外部环节 —— 全部是 `run`。**
原来它们是 `wait`，而 `wait` 在这条状态条上的含义一直是「它不会自己往前走了」 —— 压缩和重试都会
自己往前走，用琥珀色是在喊一个不需要人处理的狼。

### G3 新增 `action` 行：agent 最新的动作

工具调用的原文从 `status` 里搬出来，单独一行。内容按优先级：

1. 有在跑的任务 → `{任务} · {它此刻的标题}`；任务在等外部环节 → `{任务} · waiting on: {原因}`
2. 否则 → `turn.activity` 最后一条的 label
3. 都没有 → **不渲染这一行**

`action` 是**变化最快**的一行，所以它排在 `status` 上面 —— 贴着输入框的那一行留给最稳定的信息。

### G4 停止不再有「失败」这一态

> 「停止失败 就不该有 stop 必须能停止成功」

配套的 main 侧改动见
[`issues/chat-stop-never-confirms-and-the-ui-has-no-escape.md`](../issues/chat-stop-never-confirms-and-the-ui-has-no-escape.md)：
停止现在是**同步**的（发取消信号 + 同步放行，清理后台排干），照 pi 的做法。既然它不会失败、
也不会「停到一半」，界面上这三样就都没有存在的理由，一并删除：

* `Stopping…` 相位 —— 它的生命周期现在是 0ms；
* `Still stopping · {elapsed}` 与 `stopStalledAt` —— 本次会话早些时候加的，前提被 G4 取消；
* `stopError` 的渲染、状态条里的 `Retry` / `Release this chat` 按钮、
  `ChatPanel` 里 `aborting` 相关的禁用与三态标签。

renderer 的 `stop()` 因此变成两句：**先本地收尾，再把取消信号发出去**，不等 IPC 往返。

> 保留的：main 侧 `ActiveAgentTurn.stopError` 只服务于**退出应用**那条路
> （workflow 清理未确认 → 拒绝退出的对话框），与聊天的停止按钮无关。

## 3. 行的完整清单（改动后）

自上而下，每行独立 `v-if`：

| 行 | 何时 | 内容 |
| --- | --- | --- |
| roster 浮层 | 点 `+N` | 同时在跑的其它任务 |
| `retry` | 上一轮临时错误且自动重试用满 | `retried: n/max` + `try again` |
| `workflow / subagents` | 有后台 Agent 或已声明等待 | 计数或 main 写的那句话（**单独一栏**，不进 status 链） |
| `steering` | 回合内发过消息 | `Queued into the current turn · n` |
| **`action`** | 有任务或有工具活动 | agent 最新的动作 |
| `status` | 见 G1 | 一个枚举词 + meta（计划进度 / 任务进度 / 计时） |

## 4. 验证

* `yarn typecheck:node`、`yarn typecheck:web`：零诊断。
* `yarn check:renderer-i18n`：本仓该守卫在 HEAD 上就是红的（见配对的 issue 文档），与本次无关。
* 本仓没有等价的 renderer 测试装置（见配对文档），未新增守卫。
* 未跑 E2E（桌面 E2E 需 Ral 当场要求才跑）。
