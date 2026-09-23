# 删除一个文件要等十几秒 —— 它排在索引重建后面,而且每删一次还附赠一轮全量重建

**状态：** 🔧 已修,**待 Ral 人工验收**
**报告：** Ral 2026-09-22,「AGENT PREVIEW 删除的时候做了什么耗时挺久」→
`areas/agent-runtime/preview/deleting-process.html`(全过程十六步 + 实测)→「把优先级比较高的地方优化一下」
**配对：** `micromeet-cowork` `docs/issues/onlypreview-delete-waits-behind-index-rebuilds.md`
—— 这条路径两仓核心文件逐字节相同,同形同修。
**姊妹：** [`onlypreview-loading-project-waits-behind-index-rebuilds.md`](./onlypreview-loading-project-waits-behind-index-rebuilds.md)
(打开项目的同一个病根)·
[`onlypreview-watch-update-resets-project-and-preview.md`](./onlypreview-watch-update-resets-project-and-preview.md)
(已经记下 macOS 上每个事件都是 `rename`,但只修了升级之后的症状,没碰升级本身)

## 问题

删一个文件真正的活是 **14 毫秒**(实测:写删除日志 6 ms + 隔离改名并 `unlink` 0 ms + 清一行索引 8 ms)。
但屏幕上那个不可取消的「删除中」可以挂十几秒。两个原因,都与删除本身无关:

### ① 删除要穿两次索引写队列,而它没有优先级

`commitDelete` 的编排是「`beginDeleteTask`(写日志)→ 删文件 → `finishDeleteTask`(清索引)」,
第一段和第三段各向 `index-queue.mjs` 提交一次。那条队列每个索引库只允许一个写任务,
全量重建走的也是它。`index-queue.mjs` 已经支持交互式插队,但**目前只有 `initialize` 打开
`interactive: true`** —— 删除的两跳都是后台优先级,尽管用户正盯着一个没有关闭按钮的进度条。

实测(真引擎 + 真队列,语料 `src` 的拷贝):队列空闲时 `beginDeleteTask` 6 ms;
队列里有一轮重建在跑时,同一个调用 **290 ms** —— 等待量恰好等于那一轮的剩余时间。
真机上(overmind,22,798 文件 / 1.38 GiB 索引)一轮 reconcile 是 **10–13 秒**,
冷启动那次 fresh 重建是 **211 秒**,而 `commitDelete` 的上限是 `PROJECT_DELETE_TIMEOUT_MS = 150 s`,
超时会 `stop()` 掉整个 fileSearch 运行时 —— 文件已经删了,用户看到的却是删除失败加预览崩掉。

### ② 每删一次,附赠一轮全量重建,而那一轮拿不到任何新信息

macOS 上 `fs.watch` 把删除报成 `rename`(`onlypreview-watch-update-resets-project-and-preview.md`
已经核实过:改文件、临时文件落盘、删文件、建目录,全部是 `rename`)。
`watch-reconciler.mjs` 对「路径已不在盘上 + 带 rename 提示」的判定是直接升级成整库重建:

```js
if (error?.code === 'ENOENT') {
  if (renameHint || replacesNonFile) { requiresFullReconcile = true; break; }
```

于是每一批删除后面都跟着一轮完整的 `candidate-plan → traversal-index → promotion-commit`
(bench 里一次不落)。而删除路径的 `forgetPaths` 在第三段已经把这些行**连同子孙**精确清掉了,
那一轮重建能得到的结论和已经落地的结果完全一致 —— 它唯一的实际效果是把队列占住 10–13 秒,
让下一次删除、下一次打开项目去等它。

这不只影响删除:编辑器的「临时文件 → rename」保存、终端里的 `rm`、`git checkout`
带走一个文件,走的都是这条升级。参考机 5 小时 13 分里的 149 轮全量,主要来源就是它。

## 修改

### 修改 1 —— 删除的两跳标成交互式

`search-engine.mjs` 的 `beginDeleteTask` / `finishDeleteTask` 在 `runIndexTask` 上传
`{ interactive: true }`(第三个参数是队列键,必须显式传 `this.databasePath`)。
同时更新 `index-queue.mjs` 顶部那段注释 —— 它现在写着「后台的 reconcile、删除清理一律不打开」,
规则变了,注释是这条规则的唯一出处。

队列的 `pump` 不做抢占,所以这一条把最坏等待从「一串排队任务」降到「一轮在途任务」,
不改变任何索引语义:锁、串行化、崩溃恢复全部原封不动。

### 修改 2 —— 消失的普通文件走增量,不再升级整库重建

`watch-reconciler.mjs` 的 ENOENT 分支去掉 `renameHint` 这个升级条件,只保留 `replacesNonFile`。

**判据不是"树里是什么",而是"它名下还有没有索引行"。**

初版写的不变量是「树里是普通文件、或树里根本没有 → 增量」,并断言这本来就成立。
**那是错的,独立复核当场复现了反例**(2026-09-22):一条「先排除 `artifacts/**`、
再用 `!artifacts/keep/**` 重新包含」的规则,会让 `artifacts` **不进树**
(`readTreeSnapshot` 对目录按 `isExcludedDirectoryPath` 过滤)、而 `artifacts/keep/**`
**照常进 `files`**。把 `artifacts` 整个移出工作区时 macOS 只送来它自己那一条 rename 事件
(子孙没有事件),增量 `remove` 只删掉它自己那一行(目录本来就没有行),
于是 `artifacts/keep/kept.txt` 永远留在索引里 —— 树里没了、却仍然搜得到。
这正是 `forgetPaths` 注释里警告的半删状态,而且拿 `HEAD` 的源码 A/B 过:旧代码会升级成整库重建,
所以它是本次改动引入的回归。

修好之后的判据分三支:

- **树里是目录**(`replacesNonFile`):整库重建。它其实在进入循环之前就被
  `normalizedPaths.some(entry => entry.nodeKind !== 'file')` 那道闸拦下了,留着是因为它就是不变量本身。
- **树里是普通文件**:增量 `remove` 就是完整的 —— 一个文件只有它自己那一行。
- **树里根本没有**:去查一次索引 —— `collectIndexedAncestorPaths()` 把已索引路径的全部祖先目录收成
  一个 `Set`(一次 `apply()` 最多建一次,而且只在真遇到这种路径时才建),
  名下有行就交回整库重建,没有才走增量。

删除自己清过的路径落在最后一支且查不到行(`forgetPaths` 和这次 reconcile 排同一条队列,
轮到 reconciler 时清理必然已经落地),所以删除依然不会触发整库重建 —— 这一条实测复核过。

`renameHint` / `renamePathSet` 去掉之后在本文件内不再有读者;`apply()` 的
`renamePaths` 形参保留 —— 它是控制器派发载荷的一部分,
`onlyPreviewSearchEngineWatchBoundary` 逐字钉着那个形状。

### 不需要改的:回收目录的那两个事件

删除会在目标同级建 `.bitterless-delete-recovery-<uuid>/`,于是一次删除在 `fs.watch` 里其实是
**三个** `rename` 事件(实测)。但以 `.` 开头的路径是物理排除的,
`apply()` 开头的 `pathIsDefinitelyPhysicallyExcluded` 预筛已经把这两个事件分流到
`commitPhysicallyExcludedPaths`,根本到不了升级分支。
(`deleting-process.html` 初版 #6.4 说这里也要改,是误读;该文档已随本次更正。)

## 守卫

- `tests/onlypreview/onlyPreviewDeleteNoFullRebuild.test.mjs`(新增):真引擎删一个文件之后,
  把控制器会派发的那份变更(`{ full: false, paths: ['x'], renamePaths: ['x'] }`)交给
  `applyWatchChangesInternal`,断言**不**返回 `REBUILD_REQUIRED`、**不**发出 `full: true` 的
  watch commit;并断言删掉的内容确实搜不到了。
- `tests/onlypreview/onlyPreviewDeleteInteractiveQueue.test.mjs`(新增):队列里先排一个后台任务
  (未开始)、再排删除的两跳,断言删除先跑。用 `indexQueueState` 观察,不依赖时序。
- `tests/onlypreview/onlyPreviewSearchEngineWatchBoundary.test.mjs`(**改**):
  「rename hints update a stable file incrementally but reconcile an actual rename」这条用例
  钉的是「真改名 ⇒ `commits.at(-1).full === true`」。本次把机制改成增量,所以它翻成
  `full === false`;**行为断言不变** —— 改名之后旧路径搜不到、新路径搜得到,仍然逐字保留。
  用例名与注释同步更新,说明为什么增量对改名的两端都是完整的。

## 复核之后补的两件事(2026-09-22)

独立复核(qa-critic)提了五条,两条改了代码,三条记在这里。

**已改:**

1. **CRITICAL —— 上面那条被复现的回归**,已按新判据修好,并加了守卫
   (`onlyPreviewVanishedPathEscalation.test.mjs` 的第二条:排除 + 重新包含 的目录被移出工作区之后,
   索引里不许有滞留的行)。回退修改这条用例会失败,已验证。
2. **守卫盲区** —— 改动前后两条新用例走的都是「树里是普通文件」或「名下没有行」,
   够不到出事的那一支。现在补上了。

**没改,记录为残留:**

3. **150 秒上限没有被这次改动关掉。** `pump` 不抢占,而一次在途的 fresh 重建真机 211 秒
   (参考机最坏 306.7 秒)——交互式插队把「排在一串任务后面」变成「排在一个在途任务后面」,
   那仍然可能超过 `PROJECT_DELETE_TIMEOUT_MS`,超时就会拆掉整个搜索运行时。
   要真正关掉它,得让删除的索引清理可以在超时后继续(日志本来就支持续做),
   或者把上限与在途任务的预计时长挂钩 —— 那是另一轮的事。
4. **增量删一个目录之后,只有父目录的列表被重发。** 子树里那些已经缓存的目录列表不会被作废
   (以前的全量提交会重发所有打开的列表)。影响有限:父列表里已经没有那一行,缓存到不了;
   但这是 Shell 现在会留着、以前不会留的状态。
5. **`renamePaths` 现在没有读者了。** 载荷形状由 `onlyPreviewSearchEngineWatchBoundary` 钉着,
   所以形参保留;那条 `eslint-disable-next-line` 是否真的被规则用到没有定论(复核说它是空的,
   实现说 eslint 报过)——两种情况下代码都正确,留着不花成本。

## 验证

**端到端(真引擎 + 真队列 + 真 `fs.watch`)** —— `tmp/onlypreview-delete-bench/bench4.mjs`,
语料是 `src` 的拷贝(1,741 文件 / 64 MiB 索引)。两仓的引擎各跑一遍,结果逐项相同:

| 观察项 | 改之前 | 改之后 |
| --- | --- | --- |
| 删一个文件之后的后台事件 | `candidate-plan → traversal-index → promotion-commit` | **无** |
| 删一个 180 文件目录之后的后台事件 | 同上,一轮完整重建 | **无** |
| 队列被占住时 `beginDeleteTask` 的等待 | 排在后台任务之后(bench 里 290 ms) | **102 ms**,只等在跑的那一个 |
| 删除本身的活 | begin 6 + fs 0 + finish 8 ms | begin 10 + fs 1 + finish 12 ms(同量级) |

第三行的造法:占位任务占住队列 → 再排一个 **1500 ms** 的后台任务 → 发起删除 → 100 ms 后放开占位。
删除只等了占位任务,没有等那 1500 毫秒。

**单测。** `yarn test:onlypreview` **跑不完** —— `onlyPreviewWarmSearchScale.test.mjs` 与
`controlLoginPreviewWorkspace.test.mjs` 跑完之后挂在退出(句柄泄漏),与本次改动无关:
拿 `HEAD` 的源码 A/B 过,失败集合与挂起完全一致,**是既有问题**。
去掉这两个文件跑其余 175 个:`1484 tests / 1445 pass / 39 fail`,而 `HEAD` 源码是
`1480 / 1441 / 39` —— 稳定的既有失败集合 **38 条,改动前后逐条相同**,另有 2 条在并行压力下
时好时坏(单独跑 3/3 通过)。定向复核:本次新增的 2 个文件 + 改过的 boundary 文件 +
`onlyPreviewDeleteIndexPurge` → **24/24 通过**。

**守卫确实有效**(逐个回退源文件、跑、再逐字节还原):回退 `watch-reconciler.mjs` →
`onlyPreviewDeleteNoFullRebuild` 两条**都失败**;回退 `search-engine.mjs` → 引擎两跳那条
**失败**(`delete-not-journaled`)。

**两仓逐字节相同**:`search-engine.mjs` / `index-queue.mjs` / `watch-reconciler.mjs` 与两个新测试
文件 `diff -q` 全部无输出,两边的 git diff 也逐行相同。

**typecheck 未跑** —— 改的三个都是 `.mjs`,本仓 `yarn typecheck` 走的是 TS surface 清单,
覆盖不到它们。**lint 不是可用的闸** —— 这几个 `.mjs` 在本仓本来就不是 lint 干净的
(未改动的兄弟文件 `traversal.mjs` 有 19 条),逐文件比对改动前后计数不变;两个新测试文件
lint **0 错**。**未跑 Electron / E2E**,按 root CLAUDE.md。
