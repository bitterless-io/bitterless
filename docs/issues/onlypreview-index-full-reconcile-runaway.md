# Issue — OnlyPreview 后台索引全量 reconcile 自激，整机被拖慢

**Status:** Fixed（源码 + 回归测试已验证；打包重启后由 Ral 实机确认）
**Reported:** 2026-09-16（Ral：「巨卡,导致别的程序都受到影响,巨大的性能漏洞」）
**Area:** OnlyPreview 搜索索引 / `watch-controller.mjs`

## 症状

Bitterless Preview 的两个 `fileSearch` renderer 长期占用 30–120% CPU 并持续重压磁盘，整机变慢，
波及无关进程（同机的 `micromeet-cowork` `yarn dev` 启动时 `getTabs` 一次要 12 秒，15 秒看门狗
迟到 46 秒才触发 —— 那只有在事件循环/CPU 被饿死时才会发生）。

## 证据

`~/Library/Logs/Bitterless_PREVIEW/main.log`，2026-09-15T09:20Z → 2026-09-16T11:37Z（26 小时）：

| 事件 | 次数 |
| --- | --- |
| `event=candidate-backup` | 239 |
| `event=traversal-index mode=reconcile` | 238 |
| `event=promotion-commit` | 237 |
| 增量 reconcile | **0** |

单轮实测（工作区 97,914 个文件，已排除 `node_modules`/`.git`/`dist`/`out` 等）：

```
event=candidate-backup  mode=backup            elapsedMs=15810
event=traversal-index   mode=reconcile count=97914 elapsedMs=42871
event=promotion-commit  buildRevision=41       elapsedMs=1434
```

≈ 60 秒一轮，`buildRevision` 连续递增（31 → 42 只用了 15 分钟），首尾相接从不空闲。

## 根因

全量 reconcile 的代价随工作区大小线性增长，而**触发它的两条路都是固定节奏**，与代价无关：

1. `fallbackIntervalMs = 30_000` —— 没有 watcher 时每 30 秒一次全量兜底轮询
   （`scheduleFallback()` → `fullReconcile = true; flush()`）。
2. macOS 上 `fs.watch(root, { recursive: true })` 走 FSEvents；事件队列溢出时 Node 送来
   `filename === null`，`attachWatcher()` 的回调据此直接升级成全量，而升级只隔一个 400ms 的尾抖动
   （`WATCH_TRAILING_MS`）。工作区越大越容易溢出，于是越大越频繁地全量。

两条路的排程间隔（30s / 0.4s）都**短于它们所排的工作**（这棵树上约 60s），所以一旦工作区大到一轮
超过间隔，系统就进入自激：上一轮刚落地，下一轮立刻开跑，永远跑不完也永远停不下来。小工作区看不到
——一轮几百毫秒，30 秒间隔绰绰有余，所以这个缺陷只在大树上显形。

日志里**一次增量 reconcile 都没有**，印证了每一轮都是被上述两条路之一升级成的全量，而不是真有
97,914 个文件改动。

## 修复

[`watch-controller.mjs`](../../src/preload/onlypreview/search/core/watch-controller.mjs)：一次全量
结束后，至少静置 `上次全量实际耗时 × 4`（上限 5 分钟）才允许下一次全量开始。

- 按**上次实际耗时**退避，而不是调大那个固定间隔：小工作区一轮几百毫秒，冷却被 `Math.max(0, …)`
  吃掉，行为与修复前一致；只有大到会自激的工作区才被拉开。这棵树上 ≈ 60s × 4 → 占空比从 ~100%
  降到 ~20%。
- 冷却期间**待办不清空**：`fullReconcile` 与 `pendingPaths` 原样留着，冷却结束由自己的定时器补跑，
  不需要新事件来推。
- **只挡全量**。增量 reconcile 的代价与改动数成正比，不是自激源头，挡它只会让索引无谓地陈旧。
  `flushNow({ force: true })`（调用方明确要求"现在跑完"）和失败重试（本就带指数退避）同样不受限。

索引是搜索的便利，不是正确性要求；大工作区上晚几分钟新鲜，换整机不被一个后台索引吃满，是正确的取舍。

## Verify

- `node --test tests/onlypreview/onlyPreviewSearchEngineWatchBoundary.test.mjs`：11/11 通过，含两条
  新增回归：
  - 全量在上一轮结束后的冷却窗口内不得重启，冷却结束自行补跑；
  - 冷却不影响增量 reconcile。
- `node --test tests/onlypreview/*.test.mjs`：1319 tests / 1291 pass / 28 fail。同一命令在**移除本
  次改动后**是 1317 / 1289 / **28 fail** —— 28 条失败是既有的（来自同期并行进行中的 workflow 改动），
  本次改动新增 2 条测试且全部通过，未引入任何失败。
- 同一份文件被 `micromeet-cowork` 逐字节 vendor（`apps/cowork/src/preload/onlypreview/search/core/`），
  已同步同一修复；`node --test tests/unit/onlyPreview{RecentEntrySearch,BackgroundIndex,CorruptIndex,IndexRecovery}.test.mjs`
  36/36 通过。
- 未启动 Electron，未跑 E2E。

## 尚未处理

- 单轮全量本身很贵：`candidate-backup` 每轮要把索引库整份备份一次（10–16s），随后再走一遍
  97,914 个文件。退避把频率压下来了，没有降低单轮成本。真正的下一步是让 FSEvents 溢出后走
  **路径范围内的增量**而不是整树升级。
- 这棵树上曾出现 `initialize-failure phase=rebuild sqliteCode=11`（SQLITE_CORRUPT），另见
  [onlypreview-background-index-corruption.md](onlypreview-background-index-corruption.md)。
