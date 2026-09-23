# 网页下载 —— 落到系统下载目录，并把落地结果交给 agent

**状态:** ✅ **已实现**(2026-09-23)，两仓齐；单测 + 接线守卫 + 类型检查已过；**真实会话验收未做**（需要重启应用、用真实站点点一次下载，见 #5）。**来源:** Ral 2026-09-23，看完 Cowork 的
`20260923121623152-hj2g7k2sxolmudlc8dg` 会话后提的两条：

> 1. cowork 和 BL 网页中下载资源时，应该默认下载到系统下载的目录中，并且在设置中可以修改默认的下载目录。
> 2. 在自动化操作网页时，下载完资源之后，应该把资源下载成功的消息放到上下文中告诉 Agent，
>    这样 Agent 才能进行后续的操作，不像这里已经卡住了。一直 tooling。

两条是**同一个故障的两半**：第一条决定文件去哪，第二条决定 agent 知不知道它去了哪。
Paired with `micromeet-cowork`（同一份规格，见
[`micromeet-cowork/docs/features/browser-downloads.md`](../../../micromeet-cowork/docs/features/browser-downloads.md)）。

## 0 · 证据 —— 一次点击换来 5 分 38 秒的空转

会话：`~/Library/Application Support/COWORK_TEST_DEBUG/agent-io/20260923121623152-hj2g7k2sxolmudlc8dg`
（任务：导出 ChatGPT 9 月账单；`part-001.jsonl` 第 66–83 行）。主日志：
`COWORK_TEST_DEBUG/logs/main-2026-09-23.log`。两边时间戳对得上，下面是合并后的实录：

| 时刻(UTC) | 发生了什么 | 证据 |
|---|---|---|
| 04:30:45 | `ui_act` 点 Stripe 发票页的 **Download invoice**，结果只有 `{"ok":true,"action":"click"}` | jsonl #75 |
| 04:30:49 | agent 开始**盲猜**：`bash ls -lt ~/Downloads; find ~/Downloads -iname "*invoice*" -mmin -5` | 日志 `coach:activity:tool` |
| 04:30:52 | `will-download` 才触发（点击后 **7 秒**，Stripe 服务端现生成 PDF） | 日志 `download allowed (not recording): Invoice-0CSZ9QB2-0007.pdf` |
| 04:31:14 | `read_file ~/Downloads/Invoice-0CSZ9QB2-0007.pdf` —— 路径是猜的 | 日志 |
| 04:33:14 | 上一步失败：`Converting this document took longer than 120s and was stopped` | jsonl #76 |
| 04:33:24 | 又猜一次，`read_file` 同一个路径 | 日志 |
| 04:35:24 | 再次 120 秒超时失败 | jsonl #78 |
| 04:35:54 | 改用 `bash stat/file/pdftotext` 自己刨 | 日志 |
| 04:36:23 | 回合结束 | jsonl #83 |

**结论三条，都由上表直接读出：**

1. **文件确实落盘了**（`~/Downloads/Invoice-0CSZ9QB2-0007.pdf`，37,054 字节），**agent 全程不知道**。
   `ui_act` 的返回里没有任何关于下载的字段，`will-download` 只写了一行主进程日志 ——
   那行日志 agent 看不见。
2. **于是它只能猜路径。** 这一次猜对了目录（`~/Downloads` 是 Electron 的默认落点）也猜对了文件名
   （从页面标题倒推）。两次 120 秒超时的直接原因是 PDF 转换（见下面的补充），但 agent **无从分辨**
   失败是因为"还没下完"、"路径错了"还是"文件本身" —— 所以它先原样重试一次，再转去 `bash stat`
   验证文件在不在。这两步都是在补一条宿主本该直接给它的事实。
3. **7 秒的延迟是常态，不是意外。** 导出类按钮普遍是"点击 → 服务端生成 → 才开始传"。
   任何"点完立刻看一眼"的方案都会漏掉它，这一条直接否掉了 #3.2 的方案。

补充一条不属于本文、但同一现场暴露的缺陷：`read_file` 对一个 **37 KB** 的 PDF 转换超时 120 秒，
两次都是。现场在 cowork，已在那边另立
[`micromeet-cowork/docs/issues/read-file-pdf-conversion-timeout.md`](../../../micromeet-cowork/docs/issues/read-file-pdf-conversion-timeout.md)
（本仓是否同样受影响，排查时一并确认），本文不处理。

### 0.1 · 现在的下载落点是"Electron 的默认routine"

`will-download` 里若没人调 `item.setSavePath()`，Electron 的行为是 *"use the original routine to
determine the save path; **this usually prompts a save dialog**"*（`electron.d.ts` 的 `setSavePath`
文档原文）。也就是说今天的落点**不是我们选的**，是 Chromium 兜的底，而且**随时可能是一个模态保存框**。

模态保存框在自动化里是致命的 —— 这一点仓库里早有结论：`net/downloadGuard.ts`（cowork 侧）为了
钻探能跑，专门在录制期间 `preventDefault()` 掉整个下载，注释写得很清楚："它挡住整个窗口，
钻探的下一步 CDP 操作全部打在对话框上，这一轮就地卡死"。本文要做的是**另一半**：非录制期间
不该靠运气 —— 明确 `setSavePath`，框永远不弹，路径永远是我们写下的那一个。

BL 侧连 `downloadGuard` 都没有：`src/main/net/` 下没有任何 `will-download` 监听，
所以 BL 的下载**完全**交给 Chromium 兜底。这是历史缺口，本次一并补上落点这一半
（录制期拦截是 cowork 独有的钻探功能，不在本次范围）。

## 1 · 行为

### 1.1 · 落点

| | |
|---|---|
| 默认目录 | `app.getPath('downloads')` —— 系统下载目录。**不自建 app 专属目录** |
| 可改 | 设置里一项「下载目录」，选目录 / 恢复默认 / 在访达中打开 |
| 落盘 | 每一次 `will-download` 都 `item.setSavePath(...)`，**保存框永不弹出** |
| 重名 | `报表.pdf` → `报表 (1).pdf` → `报表 (2).pdf`（Chrome 的做法），**绝不覆盖已有文件** |
| 目录不可用 | 配置的目录被删/外置盘拔了/不可写 → **回落到系统下载目录**并在给 agent 的消息里说明。绝不因为一个过期设置让下载整个失败 |
| 录制期间 | 不变：cowork 的录制拦截优先，被拦的下载不进本文的台账（它根本没落盘） |

### 1.2 · 交给 agent 的消息

一条 `will-download` 从触发到结束会产生**两个**事实，agent 两个都要：

```
NOTE: 1 file finished downloading:
  - /Users/ral/Downloads/Invoice-0CSZ9QB2-0007.pdf (36 KB, application/pdf)
Read it at that exact path — do not guess a filename.
```

在途时（文件还在传）则是：

```
NOTE: Invoice-0CSZ9QB2-0007.pdf is still downloading into /Users/ral/Downloads. It will be reported here as soon as it lands — do not guess the path.
```

没下成（`cancelled` / `interrupted`）也要说：

```
NOTE: the download of Invoice-0CSZ9QB2-0007.pdf did not finish (interrupted). Nothing was saved.
```

**挂在哪：** `executeHostTool()` —— 每一个 host 工具的返回都经过它，所以无论 agent 下一步调的是
`page_snapshot`、`bash` 还是 `read_file`，消息都送得到。**失败路径也要挂**：抛错结束的那次返回
（被中止、被宿主闸拒绝、工具自己炸了）同样是 agent 下一眼看到的东西。实录里的 `read_file` 并不属于
这一类 —— 它把超时**作为文本返回**（`fileReader.service.ts` 的 `You can retry once…`），走的是成功路径。

**等待：** 台账里有在途下载时，`executeHostTool` 最多等 **15 秒**让它落地，好让同一次工具返回就带上
最终路径；没有在途下载时**一秒都不等**（常态零开销）。等待有上限 —— 一个 500 MB 的下载不该把
每一次工具调用都拖住。

**排空语义：** 已结束的条目报一次就清（同 `drainNewTabsNote`）；在途的**不清**，下一次还要报。

### 1.3 · 拿实录回放一遍：它治什么、不治什么

点击在 :45，`will-download` 在 :52 才触发。

- agent 在 :49 调 `bash` 刨 `~/Downloads` → 那一刻**下载还没开始**，台账是空的 → 不等待、不报。
  这一步任何机制都救不了：文件在那一刻确实不存在。
- 下载 :52 开始、随即结束（37 KB）。
- 之后**第一个结束的工具返回**就带上落地消息。实录里那是 :31:14 开始的 `read_file`，
  它 120 秒后才返回 —— 消息挂在那条返回的末尾。

**治的：** agent 不再需要猜，也不再面对那个它无法区分的二义性（"没下完" 还是 "路径错了"）；
下载目录改到别处、或者重名变成 `… (1).pdf` 时，它拿到的是**真实**路径，不是凭页面标题倒推的那个。
这一次它碰巧猜对了，下一次不会。

**不治的：** 实录里真正吃掉时间的是 `read_file` 对这个 37 KB 的 PDF 转换超时（两次共 240 秒）。
那是另一个缺陷，见上面 #0 的补充。只修本文、不修那条，这次回放仍会慢在那里 —— 这里如实写下，
不把它算成本功能的收益。

## 2 · 落点(文件)

| | `bitterless` | `micromeet-cowork` |
|---|---|---|
| 下载管理 | `src/main/net/downloadManager.ts`(新) | `apps/cowork/src/main/net/downloadManager.ts`(新，同内容) |
| `will-download` 装配 | 同文件的 `installDownloadManager()`，装在 `defaultSession` + `MAESTRO_PARTITION` | 复用既有的 `net/downloadGuard.ts`：**放行分支**改为交给 manager |
| 给 agent | `src/main/agent/runtime/hostToolExecution.ts` | 同名文件(路径一致) |
| 设置项 | `CoachSettings.downloadDir`(`@shared/maestro/coach.api`) + `maestro/settings/coachSettings.service.ts` | `CoworkSettings.downloadDir`(`@shared/cowork.api`) + `main/settings/coworkSettings.service.ts` |
| xpc | `src/main/xpc/downloadSettings.handler.ts`(新) + `xpc/xpc.helper.ts` 加一行 import | 同名文件、同类名 —— 渲染端 emitter 字符串两仓一致 |
| 设置界面 | `renderer/home/src/views/setting/components/GeneralSetting/`(General 页) | `renderer/workbench/src/views/settings/DownloadsSettings.vue`(左侧分区「Downloads」;Workbench 设置同日拆成了分区,见 `workbench-settings-sections.md`) |
| 文案 | `renderer/common/i18n/{en,zh}.ts` | `renderer/common/i18n/workbench/catalog.ts`(en/id/zh-CN/zh-TW 四份) |
| 守卫 | `scripts/maestro/check-download-destination.mjs` | `scripts/check-download-destination.mjs` |

**设置为什么存在 `coach-settings.json`（主进程 JSON）而不是 BL 的 sqlite `setting` 表：**
消费者是**主进程**，而且是在 `will-download` 回调里**同步**要用。BL 的 sqlite 跑在一个隐藏渲染进程的
preload 里，主进程读它得走一次 xpc 往返 —— 那个窗口在下载发生时不保证活着，而 `setSavePath` 必须
同步调用（晚一步框就弹了）。`coach-settings.json` 是主进程自己的文件，`readFileSync` 就拿到。
代价是它与 General 页其它项（`general/showChatMenu` 走 sqlite）存储位置不同 —— 这是**刻意的分歧**，
不要"顺手统一"回 sqlite。

## 3 · 决策与否决

### 3.1 · ✅ 台账 + 工具返回追加，而不是新增一个 `wait_for_download` 工具

新工具要模型**记得调**。实录里它连"下载会落到哪"都不知道，指望它先意识到"我该等一下"是同一类
奢望。追加到工具返回里则是**宿主主动给**，模型不必先想到 —— 与 `drainNewTabsNote`
（新开 tab 主动播报）、`STALE REFS`（ref 失效时宿主自己重取快照）同一条纪律：
**枚举与观察归宿主**。

### 3.2 · ❌ 在 `ui_act` 点击后原地等下载

`ui_act` 已经有一段 700 ms 的 `wait.popup`，顺手在那里等下载看起来最省事。**但 #0 的实录直接否掉它**：
Stripe 是点击后 **7 秒**才开始传。要盖住它得给每一次点击都加 7 秒 —— 一轮钻探几百次点击，
等于凭空多出十几分钟。而"点了会不会下载"事前无法判断。

所以等待放在**台账有在途条目时**才发生，而不是"点完就等"。

### 3.3 · ❌ 下载到 app 自己的目录（`userData/downloads` 之类）

Ral 明确说的是"系统下载的目录"。而且 app 专属目录对人是隐藏的：文件下完了，人在访达的
"下载"里找不到它。

### 3.4 · ❌ 覆盖同名文件

下载来的是**别人给的名字**（`Invoice-…pdf`、`export.xlsx`），重名是常态。覆盖会毁掉上一次的成果，
而且毁得无声。加序号是 Chrome 的行为，人有预期。

### 3.5 · ✅ 目录不可用时回落，而不是报错

一个指向已拔出外置盘的设置会让**每一次**下载失败，而失败点在 `will-download` 里 —— 人只会看到
"点了下载没反应"。回落到系统下载目录 + 在给 agent 的消息里说明，是唯一不会静默变砖的做法。

### 3.6 · 台账是**全局**的，不按 agent 会话切分

`will-download` 给得到 `webContents`，理论上能回溯到 tab、再回溯到 agent 会话。**本次不做**：
`drainNewTabsNote` 今天也是全局排空的（cowork `browser.controller.ts` 里那段注释正是在说
"B 会话开的 tab 会混进 A 的返回"），下载沿用同一口径，不在这个功能里单独引入一套归属。
两个 agent 会话同时下载时，两条消息可能都落到先返回的那个工具上 —— 记在这里，等归属问题
统一解决时一起收。

### 3.7 · `deep_fetch` 拦掉的下载会以 `did not finish (cancelled)` 出现 —— 接受

`deep_fetch` 自己在 session 上挂了一个 `will-download`，只拦它自己那个窗口（`from === wc` 时
`preventDefault`）。它与下载台账共用默认 session，而台账的监听器装得更早、先执行 —— 于是一次被
`deep_fetch` 拦掉的下载会先被接管、定好路径，随即被取消，台账记下 `cancelled`，下一个工具返回里
出现 `NOTE: the download of … did not finish (cancelled). Nothing was saved.`

**不为它加过滤。** 这句话与发生的事一致（那次下载确实被取消了），而且对 agent 有用：它说明那个 URL
是一个文件下载、不是网页。要把它滤掉，就得让本文件认识
`deep_fetch` 的窗口集合，而本文件是两仓字节相同的 vendored 件。

## 4 · 守卫(`check:download-destination`)

一条一条对着上面的决定断言，两仓各一份：

1. `will-download` 的放行路径**必须**调 `setSavePath`（否则保存框回来，而且是静默回来）。
2. 默认目录取自 `app.getPath('downloads')`，源码里**不许**出现写死的 `~/Downloads`。
3. 重名解析函数存在，且**不许**有任何 `unlinkSync`/覆盖写。
4. 目录不可用时有回落分支，且回落会进给 agent 的消息。
5. `executeHostTool` 的**成功与失败两条**返回路径都追加了下载消息。
6. 在途等待有上限常量，且"台账为空时不等待"这条早退存在。
7. cowork 侧额外：录制拦截分支仍然排在 manager 之前 —— 被拦的下载不许进台账
   （`check-download-blocked` 已有的次序断言不能被本次改动破坏）。

## 5 · 验证

| | `bitterless` | `micromeet-cowork` |
|---|---|---|
| 单测 | `yarn test:downloads` —— 6/6 | `node --test tests/unit/downloadManager.test.mjs` —— 14/14 |
| 接线守卫 | `yarn check:download-destination` —— 通过；8 处变异，每处都能打红 | `yarn check:download-destination` —— 通过；4 处变异都能打红；`check:download-blocked` 仍然通过 |
| 类型检查 | `main` / `renderer/home` / `renderer/maestro` 三个 surface：**改动文件零错误**（这三个 surface 在改动前就有 64 / 21 / 8 条存量错误，全在未触及的文件里） | `typecheck:node` + `typecheck:web` 全绿；`check:i18n-keys` 通过 |
| `yarn build` | **没跑** —— 另一个会话正在同一工作区改这个仓，而 BL 的 build 会改写 `package.json` 的 `name` | **没跑** —— `COWORK_TEST_DEBUG` 的 `electron-vite dev` 正从这个工作区跑着，build 会写进它正在用的 `out/` |
| E2E | 没跑（Electron E2E 须 Ral 当次明确要求） | 同左 |

**还差的一步（只能人做）：** 重启应用 → 在任意网页上点一次下载，确认 ① 不弹保存框、文件进了系统
「下载」；② 设置里改目录后再下一次，文件进了新目录；③ 让 agent 点一次下载按钮，它的下一个工具返回里
出现 `NOTE: 1 file finished downloading:` 和那个绝对路径。
