# agent-io 证据链改成单文件 —— 一个会话一份 jsonl

**状态：** 🔧 已实现（工作树，**未提交**），待 Ral 验收（2026-09-23）
**由来：** Ral 2026-09-23：「bl cowork 的 jsonl 不要在分多个 part 了，就往一个 jsonl 总录制」
「派在压缩的时候如何处理 jsonl 的，BL 和 cowork 就该如何处理」。
**配对：** `micromeet-cowork` 同名文档 —— 两仓同形实现。
**上游讨论：** `overmind:areas/agent-runtime/chat/rewind.html` #2.3（那一节记录了"哪几份 jsonl 是分片的"的核对结果）。

## 现在是什么形状

一个聊天会话在盘上不是一份文件，是**两层分片**：

| 层 | 规则 | 结果 |
|---|---|---|
| 目录 | 每次 `openSession()`（agent reset / 换 provider / 换 workspace / 新钻探）建一个 `<17位时间戳>-<sessionId>/` | 同一个会话散成 N 个目录 |
| 文件 | 每写满 `PART_MAX_BYTES = 8MB` 换一卷 `part-NNN.jsonl` | 每个目录里 M 份 part |

盘上实测（2026-09-23）：`agent-io/20260921121810589-x57fqbsfremuaqitxq/part-001.jsonl`。
读一个会话的完整证据要先 `dirsForSession()` 找齐所有轮次目录，再在每个目录里按 `part-\d{3,}` 排序。

## 改成什么

**`agent-io/<17位时间戳>-<sessionId>/session.jsonl`** —— 目录一个会话**只建一次**，文件**只有一份**，
永不换卷。

| 决定 | 理由 |
|---|---|
| 目录名保留 `<17位时间戳>-` 前缀 | `prune()` 按**名字排序**当时间序（它的注释写明了这条依赖），也按这个模式过滤。去掉前缀就要改成按 mtime 排，而 session id 的字典序与时间无关 —— 那是一条没必要引入的风险 |
| 目录**复用**而不是每轮新建 | 这正是"不再分片"的那一半。`openSession()` 先在盘上找这个会话已有的目录，找到就接着写，找不到才建 |
| 文件名固定 `session.jsonl` | 与旧的 `part-NNN.jsonl` 字典序天然分开，且 `part-001 < session.jsonl`，读的时候按名排序就是正确的时间序 |
| 旧数据**不迁移、不改名** | 证据链不做破坏性动作。reader 改成读目录里所有 `*.jsonl`，老 part 照样读得到 |

## 体积怎么控制 —— 参考 pi 的压缩

**pi 在压缩时对 jsonl 做什么：** `SessionManager.appendCompaction(summary, firstKeptEntryId, …)`
**追加**一条 `compaction` 条目，`firstKeptEntryId` 划出保留起点，
**被摘要掉的条目一条都不删**，文件只增不减（`session-manager.js:204`、`buildContextEntries`）。
换句话说：pi 从不靠删文件、也不靠换卷来控制这份 jsonl 的体积。

对照本仓：

| 这一份 | 压缩时的处理 | 状态 |
|---|---|---|
| pi 会话 jsonl | `compactionRun.ts` 直接用 pi 自己的 `findCutPoint` / `generateSummary`，再 `appendCustomMessageEntry` × 2 + `appendCompaction` 落回去 | ✅ 已经和 pi 一模一样 |
| **agent-io jsonl** | **压缩发生时什么都不记** —— 事后翻这份日志，看到的是提示词突然变短，却没有任何一行说明为什么 | ❌ 本次补上 |

所以本次同时做一件事：pi 原生压缩结束（`compaction_end`）的那一刻，往 agent-io 追加一条
`{ kind: 'note', name: 'compaction', … }`，带上压缩前后的 token 数、触发原因与成败。
（本仓自己那条宿主压缩路径 `compaction.handler.ts` `applyToSession` 只在 ai-crms 下可达，
而 ai-crms 的 `appendCompaction` 固定返回 null —— 挂在那里等于永不触发，所以挂在 pi 事件上。）
**只追加、不截断、不换卷** —— 和 pi 对自己那份 jsonl 的做法逐字相同。

体积因此由两件事兜底，都不是截断：
1. **压缩本身**。每轮提示词被压下去之后，agent-io 的增速自己就降了。
2. **既有的两道闸**：`RETAIN_SESSIONS = 20`（只留最近 20 个会话）+ `MAX_TOTAL_BYTES = 200MB`（历史总量）。
   当前会话永不删、其体积也不计入历史预算 —— 这两条不变量原样保留。

`prune()` 原来挂在换卷上（"每写满 8MB 至多一次，成本有界"）。换卷没了，改成挂在
**累计写入 8MB** 上（`PRUNE_INTERVAL_BYTES`），触发频率与成本一个字都没变。

## 改动清单

| 文件 | 改什么 |
|---|---|
| `src/main/agent/runtime/modelIoLog.ts` | 去掉 `PART_MAX_BYTES` 与 part 计数；`openSession()` 复用已有目录；`append()` 写 `session.jsonl`；`prune()` 触发器换成累计字节；`hasSavedParts` → `hasSavedLog`（认所有 `*.jsonl`） |
| `src/main/agent/BaseAgent.ts` | 订阅 pi 原生的 `compaction_end`（自动压缩与 `/compact` 都走这里），补一条 agent-io `note` / `name: 'compaction'`，失败与中止也记 |
| `src/main/agent/maestroAgent.service.ts` | 手动 `/compact` 包进 `runInAgentSession(key, …)` —— 它不在任何回合里，不包的话这条记号会落进 `unattributed` 桶 |
| `src/main/agent/sessionReviewReader.ts` | `scan()` 从只读 `part-\d{3,}\.jsonl` 改成读目录里所有 `*.jsonl` 按名排序；README 文案跟着改 |
| （无守卫脚本） | 行为守卫 `check-behavior-model-io-log.mjs` 只存在于 `micromeet-cowork`，本仓从来没有过这一份 —— 按配对规则里的「历史缺口不回补」，这次不新建。本仓的验证是 `yarn typecheck` + `yarn build`，加上 `modelIoLog.ts` / `sessionReviewReader.ts` 与 cowork 保持同形 |

## 不做的事

- **不迁移旧 part。** 它们是已经落盘的证据，改名 / 合并都是对证据做写操作。
- **不改 `agent-io` 之外的任何 jsonl。** `chain/`、`context-audit/`、pi 会话文件本来就是一会话一份，
  这次一个字都不动（核对见 `rewind.html` #2.3）。
- **不动保留策略的阈值。** 20 个会话 / 200MB 沿用。
- **不动录制（`traces/<id>/{api,ui}/part-NNN.jsonl`）。** 那一份也是分片的（`captureSession.writer.ts`
  每 128KB 换一卷，一次 27MB 的录制 = 204 个 part），但它是浏览器网络 / 页面动作录制，不是消息存储，
  也和压缩无关。要不要一起合并，等 Ral 单独确认。

## 验证（2026-09-23，工作树，未提交）

| 检查 | 结果 |
|---|---|
| `micromeet-cowork` `node apps/cowork/scripts/check-behavior-model-io-log.mjs` | ✅ 50 条全过（其中新增：一份 `session.jsonl` 写到 12MB 不换卷、同一会话 24 轮目录数不变、同一会话新一轮复用目录且上一轮的行还在、旧格式目录被续写且旧 part 一字节不动） |
| 守卫的变异反验（改源码 → 守卫必须变红 → 还原） | ✅ 三个变异体全被杀：每轮新建目录 → 7 条红；恢复换卷 → 2 条红；去掉累计字节清理 → 5 条红。还原后 0 红、源文件逐字节一致 |
| `review-session.cjs --run` 真跑（旧 `part-001.jsonl` + 新 `session.jsonl` 同目录） | ✅ 两仓各读到 2 条、顺序 part 在前。**对照 HEAD 版**：只读到 1 条（旧过滤器只认 `part-*`）—— 这条测试确实能分辨新旧 |
| `micromeet-cowork` `yarn typecheck:node` | ✅ 0 error |
| `bitterless` `yarn typecheck:node` | main 面 64 个 error，**全部是基线**：落在本次改动文件里的只有 `maestroAgent.service.ts` 的 `result.error`（HEAD 第 1137 行就有），本次新增 0 |
| Electron E2E | ⏸ 未跑（按 overmind 规则不主动跑） |

## 已知代价

**同一次启动里，被写过的会话整份豁免清理。** `prune()` 豁免所有活桶（删正在写的目录会 ENOENT，
而写失败只报一次 ⇒ 之后整轮静默不落盘）。原来一个会话的**旧轮次目录**不是活桶，可以被清掉；
现在一个会话只有一个目录，它的全部历史都在活桶里。所以 `MAX_TOTAL_BYTES` 在"同一次启动里反复 reset
同一个会话、且历史超过 200MB"这一种情形下约束变弱；跨启动不受影响（重启后没有活桶，全部是历史）。
真要收紧，做法是让 `append` 在 ENOENT 时补建目录，然后把豁免收窄到"有未完成写入的桶"—— 这次不做。
