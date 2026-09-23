# 右键菜单要等索引线程才弹,重命名保存要等一次全量重建

**状态：** 🔧 已修,**待 Ral 人工验收**
**报告：** Ral 2026-09-22 —— 「右击目录中的某个文件时,有时会卡住,右击菜单不会立刻显示……
右击的操作可以延迟,但是右击展示菜单不应该出现延迟,不应该出现阻塞」;
「Rename 激活了 input,但是 input 中的内容没有被 focus……还得再点击一下」;
「保存文件名时也会卡住被阻塞」,并要求保存失败时分清「文件已不存在」与「重名」两种原因。
**全过程与实测：** `areas/agent-runtime/preview/menu-processes.html`
**配对：** `micromeet-cowork` `docs/issues/onlypreview-context-menu-and-rename-wait-on-the-index-thread.md`
**姊妹：** [`onlypreview-delete-refreshes-the-wrong-index.md`](./onlypreview-delete-refreshes-the-wrong-index.md)
(同一个病根的删除版:树画的是 browse projection,不是搜索索引)·
[`onlypreview-delete-waits-behind-index-rebuilds.md`](./onlypreview-delete-waits-behind-index-rebuilds.md)

## 问题

索引引擎跑在隐藏的 fileSearch 渲染进程主线程上,而那条线程同时负责应答 Main 发来的每一次授权 RPC。
实测那条线程的事件循环延迟(真引擎,9,739 文件语料,20 ms 一次探针):

| 时段 | 中位 | p90 | p99 | 最大 |
| --- | --- | --- | --- | --- |
| 冷建索引(遍历,自带 8ms/4ms 让步) | 0 ms | 20 ms | 48 ms | 131 ms |
| 删除一个 8,000 文件的目录(清索引) | 0 ms | 2 ms | **6,362 ms** | **6,362 ms** |

四个缺陷都由此展开:

**A · 菜单弹出前要做一次授权 RPC。** `showFileContextMenu` 在拼模板之前
`await fileSearchWindowService.authorizeProjectItem(...)`,只为拿 `nodeKind` 和名字。
根目录菜单的 `authorizeProjectRoot` 同理。于是菜单的出现时间被绑在索引状态上。
**对照:书签条的 `showBookmarkContextMenu` 不做这次 RPC,所以它从来不卡。**

**B · 重命名保存后调的是 `refreshIndex()`** —— 那是 `xpc:search.refresh` → 引擎 `refresh()` →
**整个工作区重新计数 + 重建索引**(真机一轮 10–13 秒)。而树画的是 browse projection,
重建搜索索引对它没有任何帮助。删除那条路径早就记过这一课
(`onlypreview-delete-refreshes-the-wrong-index.md`),重命名这一支没跟上。

**C · 行内编辑器拿不到键盘焦点。** `registerEditInput` 在 `nextTick` 里 `focus()` 并选中主干,
但原生菜单刚释放焦点,shell 那个 WebContentsView 并没有拿到键盘焦点 —— 于是选区看得见、打不了字。

**D · 保存失败只有三条文案。** `renameEntry` 其实<strong>已经分别判过</strong>「目标不存在」
(`resolveItem` → `PATH_NOT_FOUND`)与「重名」(比对 inode → `NAME_EXISTS`),
但 `showRenameFailure` 只给 `NAME_EXISTS` / `NAME_INVALID` 单独文案,`PATH_NOT_FOUND` 落进兜底那条。

**E · 清索引的批处理循环不让步。** `forgetPathsIndexed` 每 10 条一个事务,
**整段没有一个 `await`**,所以 8,000 行清理 = 6.4 秒里事件循环一次都没跑。
这期间任何授权 RPC(菜单、重命名、预览取字节、Reveal)都没人应答。

## 修改

### M1 —— 菜单不再等索引(缺陷 A)

渲染进程把右击那一行的 `nodeKind` 一起发给 Main(它画这一行时就有),Main 用它拼模板并立刻
`popup()`,删掉弹出前那次 `authorizeProjectItem` / `authorizeProjectRoot`。

**为什么安全:**模板只用到 `nodeKind` 和名字(名字 = 路径最后一段),而**每一个菜单项点下去时
本来就会重新授权一次** —— Preview / Open externally / Reveal / Copy / Rename / Delete / New Folder
无一例外。所以这次 RPC 换不来任何安全性,只换来对索引状态的依赖。一个伪造的 `nodeKind`
最多让菜单多一项或少一项,点下去仍然被授权挡住。

`nodeKind` 进请求契约时按 `'file' | 'directory'` 校验,非法值按 `'file'` 处理(最小菜单)。

### M2 —— 重命名保存不再重建索引(缺陷 B)

`OnlyPreviewProjectAuthoringController.settle()` 里的 `refreshIndex()` 换成只重载受影响父目录的
browse listing —— 用删除那条路径已经在用的 `browseProjection.reloadParentListings(...)`,
旧名字那一行随之消失、新名字出现。搜索索引交给 watcher 的增量(它本来就会收到两条 rename 事件)。

### M3 —— 开编辑器时把键盘焦点交给 shell 视图(缺陷 C)

Main 在广播改名意图之前,先把 shell 那个 WebContentsView `focus()` 一次。
窗口助手里已经有这个动作(`focus-project`、`find-in-file` 都在用),补一个按 hostToken 取用的入口即可;
非 standalone 挂载拿不到那个视图时静默跳过,渲染侧的 `focus()` + 选区保持不变。

### M4 —— 保存失败分清原因(缺陷 D)

`showRenameFailure` 增加 `PATH_NOT_FOUND` 分支,配套 `renameMissingMessage` 文案(en/zh)。
文案要说清两件事:这个文件已经不在了、重命名没有生效。`NAME_EXISTS` 的既有文案不动。

### M5 —— 清索引让步(缺陷 E)

`forgetPathsIndexed` 的批处理循环之间插入 `createBackgroundWorkSlicer` 的检查点
(遍历用的是同一套)。它在写闸内跑,读者本来就被挡着,让步不改变任何可见性;
代价是清理稍慢,换来这段时间里菜单与其它 RPC 仍然能应答。

## 守卫

- 菜单:断言 `showFileContextMenu` 这条路径上**不再调用** `authorizeProjectItem`
  (注入一个会抛的 authority 桩,菜单仍然要弹出来),并断言文件行/目录行/多选三种模板内容不变。
- 重命名:断言 `commit()` 成功之后**不再调用** `refreshIndex()`,而是调了
  `browseProjection.reloadParentListings`。
- 失败文案:`PATH_NOT_FOUND` → `renameMissingMessage`;`NAME_EXISTS` → `renameExistsMessage`。
- 让步:构造一次跨多批的 `forgetPaths`,断言期间事件循环至少被让出过一次(用一个
  `setTimeout(…, 0)` 的标志位,不用睡眠)。

## 实现时多发现的一条:删除收尾也在做全量重建

改 M2 时发现同一个文件里的 `settleDeletedEntries()`(删除广播的收尾)在就地摘掉行之后,
**也调了 `refreshIndex()`** —— 注释写的是「校正一次」,代价却是整个工作区重建。
于是即便 watcher 那条路已经不再因删除而重建(见
`onlypreview-delete-waits-behind-index-rebuilds.md`),渲染进程仍然每删一次就主动要一次全量。
一并改掉:两条收尾路径(删除、改名)现在共用 `reloadAffectedParents()`,只重新列受影响的父目录,
失败不抛 —— 收尾路径不该把一次已经落盘的操作报成失败。

## 验证

**typecheck。** bitterless `yarn typecheck`:本次改动的每一个文件**零诊断**
(仓库基线另有 97 条分布在别处,改动前后一致);cowork `yarn typecheck`(node + web)**全绿**。

**单测。** bitterless 受影响的一组 41/41 通过
(`onlyPreviewVanishedPathEscalation` / `onlyPreviewDeleteNoFullRebuild` /
`onlyPreviewDeleteInteractiveQueue` / `onlyPreviewDeleteIndexPurge` /
`onlyPreviewSearchEngineWatchBoundary` / `onlyPreviewProjectAuthoring` / `onlyPreviewDeleteDialog`);
cowork 对应的一组 11/11 通过。`yarn test:onlypreview` 整套仍然跑不完 —— 两个**既有**文件
(`onlyPreviewWarmSearchScale`、`controlLoginPreviewWorkspace`)跑完之后挂在退出,与本次无关。

**M5 的效果(事件循环探针,真引擎,`tmp/onlypreview-delete-bench/bench6-menu-lag.mjs`)。**
删一个 8,000 文件目录期间,那条要应答菜单 RPC 的线程:

| | 改之前 | 改之后 |
| --- | --- | --- |
| 最大停顿 | **6,362 ms**(整段只落了 11 次探针) | **137 ms**(落了 109 次) |
| 中位 / p90 | 0 ms / 2 ms(因为几乎没采到样本) | 56 ms / 103 ms |
| 清 8,000 行索引本身 | 6,379 ms | 7,471 ms(+17%) |

**守卫的缺口,说明白:**

- 菜单那条路(M1)**没有自动化守卫** —— 它现在直通 `Menu.buildFromTemplate().popup()`,
  要断言"不再依赖索引运行时"得起 Electron,按 root CLAUDE.md 不跑。
  代码层面的依据是:那次 RPC 的调用点已经删除,文件里对 `fileSearchWindowService` 的剩余引用
  全部在**菜单项点下去之后**的动作里。
- `settle()` / `settleDeletedEntries()`(M2)也没有 store 级守卫 —— 现有测试装置只 bundle 了
  纯函数那一层(`onlyPreviewProjectAuthoring.service.ts`),没有 store 的桩。
  这两处缺口是本次的已知代价,不是"测过了"。
- **未跑 Electron / E2E**,按 root CLAUDE.md。
