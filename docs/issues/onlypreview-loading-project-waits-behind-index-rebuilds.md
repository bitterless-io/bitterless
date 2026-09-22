# 「Loading project」等的是索引写锁,不是目录

Status: root cause confirmed (evidence below); fix #1 implemented, owner testing pending.

Ral 2026-09-22:「preview loading 的时间太久了,如何优化呢 才能做到几乎秒开」,以及
「preview 的 tab 和独立窗口来回切换会导致重复的 loading project ⋯ 独立窗口中 loading 还没结束
又切回到 tab 中 需要优化」。

完整的阶段拆解、时间轴与实测分布见
[`areas/agent-runtime/preview/loading-process.html`](../../../../areas/agent-runtime/preview/loading-process.html)。

## 结论

转圈的时长和「读这个目录要多久」无关。UI 结束 loading 的唯一判据是收到根目录列表
(`onlyPreviewShell.store.ts` 的 `projectListingLoading` → `browseProjection.ready`),
而那次列表实测 **11–33 ms**(中位 16 ms,38 条)。

慢的是它前面那段:根目录列表被写在 `initializeIndexed` 的第 9 步,而整段 `initialize`
是**一个**索引写任务,排在 `index-queue.mjs` 的严格 FIFO 队列里,和后台 reconcile 抢同一条队。

## 证据

参考机 `COWORK_TEST_DEBUG` 的 `main-2026-09-22.log`,01:39–06:52(5 小时 13 分),workspace 是
overmind(41,855 个文件,索引 2.75 GB)。

`initialize-start` → `sqlite-open` 的等待(也就是用户看到的转圈),n=11:
中位 **1.9 s**,最大 **306.7 s**。另有一次排了 **9 分 42 秒**后直接失败。

04:42 那次的原文:

```
04:42:08.120 event=initialize-start tag=i32        ← 用户打开项目
04:42:45.366 event=candidate-plan   tag=i33        ← 用户在等,后台又起了一轮
04:43:51.335 event=candidate-plan   tag=i34
04:44:58.867 event=candidate-plan   tag=i35
04:46:16.309 event=candidate-plan   tag=i36
04:47:14.559 event=promotion-commit tag=i36
04:47:14.846 event=sqlite-open      tag=i32 elapsedMs=255
04:47:15.417 event=root-listing     tag=i32 count=38 elapsedMs=28
```

五轮 reconcile 插在一个已经在等的用户请求前面,每轮只发现 `count=41854 → 41855`
(差一个文件),却各自拷了 2.75 GB。当天共 **149 次** `candidate-plan`,平均每 2 分 6 秒一次。

## 三个根因

1. **写队列没有优先级。** `index-queue.mjs` 每库一条、并发 1、严格 FIFO。它刻意把**读**排除在外
   (注释写得很清楚:把读排进来会让搜索框冻两分钟),但没有区分「用户正在等的写」和
   「后台自己发起的写」。`initialize` 是写任务,只能排在后台 reconcile 后面 —— 而且用户已经在等时,
   后台还在继续入队。

2. **根目录列表被埋在写任务里。** `emitRootBrowseListing()` 走 `this.browseIndex`
   (`createOnlyPreviewBrowseIndex`),是一次文件系统读,**既不读 SQLite 也不写 SQLite**。
   `initializeIndexed` 的注释解释了整段为什么必须是一个任务:两次提交之间另一个引擎可能完成提升、
   把库文件改名换走,本引擎就只剩一个指向旧 inode 的句柄。**这个理由对改库的步骤成立,对列目录不成立。**

3. **每次 initialize 必然触发一次全量 reconcile。** 当天每条 `sqlite-open` 都是
   `reusable=true reconcile=true`,随后必跟一条 `candidate-plan mode=reconcile`。
   tab ↔ 独立窗口每切一次就重走一遍 initialize,于是每切一次 = 拷一次 2.75 GB + 遍历一次 41,855 文件。

## 切换未完成时的实际后果

Ral 猜的情形在 05:00 发生了,结局不是变慢而是**双双失败并拆掉运行时**:

```
05:00:43.021 event=initialize-start tag=i3j
  (期间 i3k / i3l / i3m / i3n 四轮 reconcile 插队,一次都没轮到)
05:10:14.715 event=candidate-plan   tag=i3o mode=fresh freeMiB=4918
05:10:24.899 event=runtime-terminal tag=r3i outcome=failure elapsedMs=581878
05:11:47.626 event=runtime-stop     by=FileSearchLifecycleFence.onFailure
05:11:48.045 event=xpc-terminal     tag=x8  outcome=failure elapsedMs=83176
```

第二次 `initialize` 既没有取消也没有合并第一次,而是让第一次判失败,接着自己也失败。
`mode=fresh` 那行还说明:堆积的候选把可用空间压到 4.9 GB,reconcile 已经放不下 ——
那正是 2026-09-17 `SQLITE_FULL → SQLITE_CORRUPT` 的入口。

## 修法

按「先让转圈消失」到「让后台别再自残」的顺序,四步各自独立:

1. **把根目录列表提到队列之前**(本次实现)。`initializeInternal` 在 `submitIndexTask` 之前建
   `browseIndex` 并发一次根列表。目录令牌是 `randomUUID()` 且**按实例**存在
   `tokenByPath` 里,所以不能用一个临时实例发了就扔 —— 必须是同一个实例,后续 `rootListing()`
   经 `issueDirectoryToken` 复用同一个令牌,重发是幂等的。
2. 同一 workspace+generation 的重复 `initialize` 合并到同一个 promise,而不是让后来者把前一个判失败。
   这一条在 runtime/relay 层,不在引擎层。
3. reconcile 去抖 + 合并:监听触发的 reconcile 先攒一个静默窗口;队列里已排着一个未开始的 reconcile 时不再入队。
4. 队列区分交互式与后台,有人在等时后台不再抢先启动。

第 1 步单独就能达成秒开,且不改变任何索引语义 —— 锁、串行化、崩溃恢复原封不动。

## 不在本 issue 范围

候选库拷贝本身(`buildAndPromoteCandidateExclusive`)另有在途改动,把 SQLite `backup()` 换成
文件级克隆(APFS `clonefile`,95 ms vs 26.5 s)。那是第 12 步的成本,与本文四步不重叠。
