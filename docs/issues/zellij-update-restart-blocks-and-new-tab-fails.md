# Issue — 更新重启后 Zellij 阻塞半天，新开 tab 报 operation-failed

**Status:** R1–R6 + R9 已落盘；2026-09-17 接手补齐 [更新后的文件身份识别](zellij-update-owner-file-identity.md)、
[renderer 加载超时（R8）](zellij-renderer-load-timeout.md) 与
[有限恢复后重建兜底](zellij-bounded-session-recovery.md)，实现与代码验证完成；打包后由 Ral 实机复验。
**Reported:** 2026-09-17（Ral：「AGENT ZELLIJ 在打开多个 ZELLIJ 的情况下，点击 update 重启后，阻塞半天，
还出现了：The terminal operation failed. Refresh settings or try again.」「更新后我打开的新 tab 出现报错」
「有日志就要看日志解决问题，没日志补日志我重新打包解决问题」）
**Area:** `src/main/zellij/**` + `src/main/logging/**` + `src/shared/diagnostics/diagnostic.service.ts`
**Build:** Preview `0.0.122` / `260917010242`（= `docs/plan/tasks/zellij-native-selection-copy-001.md` 那次发布）

## #0 症状与判据

| # | 症状 | 判据（可测） |
| --- | --- | --- |
| S1 | 点 Update 重启后整个应用「阻塞半天」，Zellij tab 一片空白 | 从新进程起来到 `zellij web --start` 被 spawn 的时间应回到秒级；卡住时 UI 必须给出可读状态而不是空白 |
| S2 | 更新后**新开**的 tab 报 `The terminal operation failed.` | 同一动作在日志里能定位到具体 surface / session / 请求 / 阶段 |
| S3 | 整条 prepare 链在日志里是黑的 | `prepare-start` → 各 stage → `prepare-end` 每步一行，含 `elapsedMs`，成功也写 |

`operation-failed` 是 `zellijErrorCode` 对**任何**无法识别错误的兜底，也是 `assertActive` 在「这次准备被新一轮取代」
时抛的同一字符串（`src/main/zellij/zellijTerminalView.ts:114`）。两种相反情形今天写出完全相同的一行。

## #1 时间线（`~/Library/Logs/Bitterless_PREVIEW/main.log`，UTC，本地 = +8）

| 时刻 | 事件 |
| --- | --- |
| 01:36:41.513 | `UpdateService :: Requesting update install after host cleanup...` |
| 01:36:42.320 | `app :: Cleanup complete` → 01:36:42.321 `quitting and installing update...` |
| 01:36:42.330 | `zellij :: server requested-stop pid=84360 signal=SIGTERM`（**只有 web server 被停**，四个 native `--server` 守护进程按约定保留） |
| 01:36:56.398 | 新进程 `diagnostics :: logging initialized`（安装耗时 13.9s，正常） |
| 01:37:29.697 | `maestro-open :: boot-terminal outcome=failure reason=timeout elapsedMs=30506 pending=workbench,all-ready` |
| 01:38:12.764 | `omni-open :: renderer-terminal role=control outcome=timeout reason=diagnostic-timeout elapsedMs=30004` |
| 01:38:42.604 | `config.kdl` 模板升级落盘（备份名里的 `1789609122604` 即此刻） |
| 01:38:42.609 | `zellij :: server spawned pid=48190`（= 启动后 **106.2s**） |
| 01:38:58 | native session `bitterless-preview-d10e16c33b67` 的 `--server` 启动（来自 `native-sessions.json`） |
| 01:39:12.993 | `zellij :: surface preparation failed reason=operation-failed [error name=ZellijNativeIpcError code=*** message=Zellij rejected the request]` |

**基线对照**：两份日志里共五次 update 重启，`logging initialized` → `server spawned` 分别是
28.8s / 4.3s / 8.4s / 4.2s / **106.2s**。前四次里 `server spawned` 都紧跟 `maestro-open stage=workbench`
之后 14ms–2.18s；这一次 `stage=workbench` 和 `stage=all-ready` 整个文件里都没有出现过
——但那条缺失是 tracer 的构造造成的，不能当成「它没完成」，见 #3.1。

**主循环没有被饿死**：`UpdateService` 的 60s 轮询在整段窗口里漂移 ≤251ms（0.42%），两个 30s 超时分别在
30004ms / 30506ms 触发。主进程是在 await，不是被 CPU 堵住。

**这次故障是首次**：`main.old.log`（23,443 行，09-15 09:20Z → 09-17 00:24Z）里
`surface preparation failed` / `ZellijNativeIpcError` / `cli failed` / `port-occupied` / `startup-timeout`
全部零命中。

## #2 实测证据（2026-09-17 在 Ral 本机，只读 / 私有 socket 目录 / 用完即清）

| 实验 | 结果 |
| --- | --- |
| 用**线上那份** `config.kdl` 新建一条 session（`zellijNativeSession.create()` 原样调用，真实 socket 目录） | `create=OK elapsedMs=468`，`exists=true`，`close=OK`，socket 与 cache 都清干净 —— **新 tab 这条路现在是通的** |
| `firstClientConnected` 的六种变体（二次 init / 缺失 layout 文件 / 非法 layout / 未知 builtin / 缺失 config） | **全部 connected**，0.45.1 的 server 对这些一概不拒 |
| 对四条存活 orphan session 做 `probe` + `list-panes` | 四条全部 `probe=ready`、`listPanes=ok`（6–8 个 pane） |
| 对同样四条做 `current-tab-info` | 四条全部 `ZellijNativeIpcError code=rejected`（2ms 内）。新建的空 session 同样被拒 —— 无 client 附着时没有「当前 tab」，属预期；这一路被 `refresh()` 吞掉 |
| `--server` 起来但**没做过** `firstClientConnected` 的守护进程 | `probe=ready`，紧接着 `listPanes` 就 `ECONNREFUSED`，随后守护进程自己死了 |
| 对 `native-sessions.json` 里五条记录做所有权审计 | 四条存活的全是 `inspect=null` `sameSocket=true` `alive=THREW operation-failed` |
| `lsof -t -- <socket>` 实测耗时 | 0.33–0.48s（代码里超时是 750ms） |

上游对账：`current_tab_info` 的 prost tag 105 与
[v0.45.1 `client_server_contract.rs`](https://raw.githubusercontent.com/zellij-org/zellij/v0.45.1/zellij-utils/assets/prost_ipc/client_server_contract.rs)
一致，协议投影没错。

## #3 根因

### #3.1 S1 —— 106 秒不在 zellij 里，zellij 只是下游（已证）

`prepareZellijTerminal` 之前的所有 await 都是有界的：`config.initialize()` 的 `setup --check` 走
`runZellijCli`（15s 上限 + 1s close 宽限），`probe()` 是 `AbortSignal.timeout(900)`，全新进程上
`retained.stop()` 直接跳过 —— spawn 之前的天花板约 17s，而实测 106.2s。

模板升级的备份文件名把时间钉死了：`ensureDefaults()` 在 `await validate(temporary)` 返回后的**下一条语句**
才生成 `config.kdl.bitterless-backup-${Date.now()}-…`，那个 `Date.now()` = 01:38:42.604，spawn 在 5ms 后。
所以整条 zellij 链最早也只在 01:38:27.6 才被进入 —— 前面约 90 秒，zellij 代码根本没在跑。

卡住的是**整个 boot 期的 renderer 加载**，不是某一个 renderer，也不是 zellij：同一窗口里 omni control
renderer 30s 超时、OnlyPreview 的 `renderer-reset` 卡了 118.3s（`onlypreview.log`）、maestro history 与
tab-alias 的 renderer 直到 01:38:45–48 才 bootstrap —— 全部在 01:38:42–58 这十几秒里一起解冻，
紧跟在 `fileSearch` 那轮 80.6s / 97,916 文件的全量 reconcile 结束（01:38:21.658）之后。

zellij 的 web server 挂在**它自己 surface 的 chrome 页面加载**后面：`zellijWindow.service.ts:62` 先
`await surface.load()`（`zellijSurface.ts:71` 的 `loadFile`，无超时），之后才 `surface.sync()` →
`prepareZellijTerminal`。`restoreTabs` 又是串行 await（`maestroBrowserView.service.ts:1304`），所以
**开着 N 个 Zellij tab 会把这个代价乘 N** —— 这正是 Ral 说的「打开多个 ZELLIJ 的情况下」。

两处需要更正之前的判断（经独立复核推翻）：

1. 不是「`workbench` stage 永远没 settle」。`stage=workbench` 在 `boot-terminal` 那行之后不再出现是
   **tracer 的构造使然**：`MaestroOpenBootTrace.completeStage()` 在 terminal 写过之后直接 return
   （`maestroOpenDiagnostics.service.ts:316`）。一个 01:38:4x 才完成的 workbench 加载，和一个永远没完成的，
   在日志里长得一样。
2. zellij 也不排在 workbench 后面。zellij 入口只 await `maestroWindowHelper.whenReady()`
   （`zellijWindow.handler.ts:18` → `homeReady`），而 `homeReady` 在 01:36:59.661 就满足了。
   zellij 迟是因为它自己的 chrome 加载被饿着，不是因为在等 workbench。
3. 「首次装完更新那一次 boot 的 renderer 特别慢」不是 0.0.122 才有：2026-09-15T10:28 那次装完更新的 boot
   同样是 `stage=workbench stageMs=22767`（22.8 秒），只是没撞破 30s 那道闸。

`ZellijSurface.load()` 和 `ZellijTerminalView.attach()` 的 `loadURL` 都没有任何超时，renderer 端 `idle`/`starting`
都显示成同一句「Opening…」，而这次 chrome 页面本身都没 mount，于是 tab 全白、日志零行。

### #3.2 S2 —— 更新会让应用认不出自己保留的 session（已证，且违反既有约定）

Squirrel.Mac 装更新时把旧 `.app` 整体挪进 `…/T/io.bitterless.desktop.preview.ShipIt.*/`。
守护进程的 argv 是 spawn 时冻结的（还指着 `/Applications/...`），但它的 text image 现在落在被挪走的旧 bundle 里：

```
lsof -a -p 10389 -d txt -F0pfn
  ftxt  n/private/var/folders/…/io.bitterless.desktop.preview.ShipIt.SBcW37A8/
        Bitterless Preview.app/Contents/Resources/maestro-tools/zellij
```

`processExecutable(pid)` 返回的就是这条路径，而 `inspectZellijNativeOwner` 要求它等于
`realpath(<当前 binary>)`，`isZellijNativeOwnerAlive` 在不等时**抛** `operation-failed`
（`zellijNativeOwner.service.ts`）。审计实测：四条存活 session 全部 `inspect=null` + `alive=THREW`。

后果，逐条都在活路径上：

- `close(session)`：`killSession` 之后第一句就是 `await isZellijNativeOwnerAlive(owner)` → 抛 →
  **`docs/features/zellij-auto-open-directory.md` 里「主动关 tab 就结束其会话」这条约定（Ral 2026-09-12 拍板）
  在更新之后失效**，cache 目录不删、`native-sessions.json` 记录不删。
- `finishZellijNativeShutdown`：同一句开头，所以失败清理也做不了。
- `exists(session)`：socket 在、守护进程已死的那条分支要靠 `isZellijNativeOwnerAlive` 判定才敢 `unlink`，
  现在会抛 —— 该 tab 从此再也建不起来。

保留 session 本身**不是缺陷**（Ral 2026-09-12：「主动关 tab 就结束其会话；应用退出则保留会话」，
见 `docs/issues/zellij-multi-instance.md` #2.2）。缺的是：更新之后仍然认得出这些是自己的进程。

#### 通俗解释与本轮建议

应用要判断的只是：“这个还在运行的终端，是不是我当初启动的那个？”
旧方法认程序所在的地址，更新把旧程序搬走，地址变了，就认不出来。
建议改为：首次严格确认归属时登记文件的 `device + inode`，以后核对系统报告的实际执行文件编号。
`device` 是磁盘/卷编号，`inode` 是该卷上的文件编号；同卷改名或搬目录不会把它变成另一个文件，
复制或替换则会得到另一份文件。它不是文件内容哈希或防篡改签名。

这一编号也不单独授权结束进程：还要核对进程号及其启动时间、所属用户、原始命令与 socket。
首次认领仍必须匹配应用自带的 Zellij；缺少记录或证据不完整的旧进程不因目录名称像 `ShipIt` 就被放行。
因此本轮针对的是“安装修复版本后，新建的会话在后续更新中仍可识别”；历史无法确认的会话继续保留。
实现合同见 [文件身份识别](zellij-update-owner-file-identity.md)。

### #3.3 S2 —— `exists()` 把瞬态答复当致命失败（已证）

`exists()` 先 `probe()`，`ready` 就紧接着 `listPanes()`。实测：`probe=ready` 之后下一个请求可以直接
`ECONNREFUSED`（守护进程在两次请求之间死了）。除 `absent` 以外的任何 IPC 错误都会原样抛出去，最终变成
「The terminal operation failed.」——而这种情形的正确语义是「这条 session 不可用 → 重建」，不是「这个 tab 废了」。

### #3.4 S2 —— 所有权审计在机器繁忙时输掉 750ms 竞速，于是「新 tab 失败、retry 又好了」（已证）

Ral 2026-09-17 补充：「更新后我打开的新 tab 出现报错」「但是点击 retry 也确实可以恢复」。**retry 能恢复**
说明是竞态而不是持久状态——这条线索直接指向 `create()` 里的所有权审计：

`inspectZellijNativeOwner` 用三次 `ps` / `lsof` 子进程判定归属，每次上限 **750ms**，而
`lsof -t -- <socket>` 在这台机器**空载**时实测 0.33–0.48s。更要命的是：审计里任何一次超时都走同一个
`catch { return null }`，所以「超时」和「这不是我们的进程」返回完全相同的结果，`create()` 于是抛
`operation-failed` → 「The terminal operation failed.」

这不是推测，本仓库自己的测试就是证据：`tests/zellij/zellijNativeSession.test.mjs` 的
`native creation, bridged discovery, exact close and service restart survive an unresponsive sibling`
**在测试与一次 typecheck 并跑时失败（`create()` → operation-failed），单独跑则通过**。而装完更新后的那次 boot
恰恰就是「机器繁忙」的定义：97,916 文件的全量索引 + 所有 renderer 同时启动。等机器闲下来再点 Retry，
自然就过了。

### #3.5 S3 —— `rejected` 的真正原因是我们自己擦掉的（已证）

两处，叠加起来正好把唯一那行错误变成不可诊断：

1. **zellij 自己说了原因，我们丢了**：`zellijNativeIpc.service.ts` 收到 `logError` 帧后，把
   `reply.logError.lines` 直接换成常量字符串 `'Zellij rejected the request'`；收到意外 `exit` 帧时
   `exit.exitReason` / `payload` 同样被丢。
2. **`code=` 这个字段名本身会被脱敏**：`log.setup.ts` 对每条记录跑**两遍** sanitize（hook + transport
   format），第二遍时已经拼好的 `code=rejected` 撞上凭据键名表里的 `code`，于是写成 `code=***`。
   这就是那行日志里 `code=***` 的来历 —— 不是原生层没给。

同一套脱敏还有一条 Preview 专属的坑：不透明 token 规则会把 24 字符以上的串打掉，而
`bitterless-preview-<12hex>` 是 31 字符、Production 形态是 23 字符 —— **任何打印完整 session 名的日志，
在 dev/Production 验证时是绿的，到 Preview 就变成 `***`**。

### #3.6 S2 补充 —— Retry 对同一个 tab 永久失败，New Tab 却正常（已证并已修，见 R9）

Ral 2026-09-17 再报（同一次故障延续）：「BL zellij tab 出现报错 `The terminal operation failed. Refresh
settings or try again.`，点 retry 无效，new tab 是好的，需要确保 retry 能恢复 zellij 的正常启动」。

**实测确认这仍是同一个未重启的旧进程**：`~/Library/Logs/Bitterless_PREVIEW/main.log` 里
`UpdateService :: Current versionCode` 从 01:38 的更新之后到本次排查全程都是 `260917010242`
——本 issue 第一次故障时装的那份、R1–R6 落盘之前的旧二进制，从未重启过。同一进程里在
04:39:36–41（六条，2.4s 内）与 05:39:04–05（两条）又各打出一批
`surface preparation failed reason=operation-failed [error name=Error message=operation-failed]`
——`Error`（不是 `ZellijNativeIpcError`），说明命中的正是 #3.3/#3.4 覆盖不到的那一类：
`zellijNativeSession.service.ts` 的 `auditStaleSocket()` 在 owner 审计**抛出**（而不是给出明确
存活/已死判定）时直接 `throw new Error('operation-failed')`，这类错误从不带 `ZellijNativeIpcError`，
从未进入过 `TRANSIENT_IPC_CODES` 那条自愈路径。

**为什么 retry 治不好，new tab 却行**：`sessionName(surfaceId)` 是纯函数
（`resolveZellijSessionName(profile, surfaceId)`），同一个 tab 每次准备都解析到同一个 session
名字、同一个 socket 路径。一旦这个 socket 记录的 owner 在本进程生命周期内被证明"审计不出结果"
（#3.2 的路径不匹配就是最常见的一种，但 `isZellijNativeOwnerAlive` 里其余几处 uid/command 不符、
kernel-exit 等不上的分支同样会永久抛错，只要那条守护进程本身不退出），`auditStaleSocket` 就永远
不会走到 `unlinkSync(socket)` 那一步——**它既不能证明活着好去复用，也不能证明死了好去清理**，
于是每一次 retry 都在对同一个已经证明用不了的 socket 重放同一个失败。New Tab 用的是全新
`surfaceId`，对应从未写过 native-sessions.json 记录的全新 socket 路径，`exists()` 一句
`!existsSync(socket)` 直接判 `absent`，压根不会碰审计代码，于是必然成功。

这条**不需要**、也**没有**改动 #3.2 要求 Ral 拍板的信任规则本身——owner 审计的判定逻辑
（`zellijNativeOwner.service.ts`）字节未动，`tests/zellij/zellijNativeOwner.test.mjs:134` 钉的那条
仍然生效。修的是上一层：既然这个 session 身份已经在本进程里被证明用不了，就不要让 Retry 重放
同一个必败的请求——把它当作和"关掉重开一个新 tab"同等的动作来对待。

## #4 上一轮修复记录

下表保留原轮次结果。R7、R8 和 R9 的最终行为已由本轮三个独立 issue 取代，当前状态见 #8。

| # | 改动 | 对应 | 状态 |
| --- | --- | --- | --- |
| R1 | `src/shared/diagnostics/diagnostic.service.ts` 错误链字段 `code=` → `errorCode=`，绕开凭据键名表（全应用受益：连 `ECONNREFUSED` 之前也被打成 `***`） | #3.5 | 已做 |
| R2 | `ZellijNativeIpcError` 新增 `detail`，携带 zellij 自己的拒绝文本（`logError.lines` 有界脱敏 / `exit.exitReason` + payload）。`message` **保持逐字节不变** —— `zellijNativeIpc.test.mjs:240`「native rejections omit native payloads」钉的是消费者看到的那个错误，那条边界是对的：错误会进 renderer 状态，日志不会 | #3.5 | 已做 |
| R3 | 新增 `zellijLog.service.ts` + 全链路 `[zellij] event=…` 行：prepare 每阶段（含 `elapsedMs`/`stageMs`）与终态、runtime probe/spawn/poll/auth/终态、config 决策·校验·备份·落盘、native exists/create/first-client/shutdown/close、启动时的会话清单对账、health 退役、退出时保留了什么。身份只写 `surface=` / `session=` 的 12 位 id + `profile=`，永不写完整 session 名（31 字符会被脱敏成 `***`）、token、pane/stdout | S3 | 已做 |
| R4 | `exists()`：`ready` 之后紧接着「端点消失」（`absent` / `disconnected`）判为 absent → 重建，而不是把整个 tab 判死 | #3.3 | 已做 |
| R5 | `prepareZellijTerminal` 对**瞬态** IPC 失败（`absent`/`disconnected`/`timeout`/`rejected`）自动重试一次（400ms 后），非瞬态错误第一次就上报 —— Ral 手点 Retry 能好，那就不该让他点 | #3.3 #3.4 | 已做 |
| R6 | `create()` 的所有权审计在返回 null 时**按同一规则**再审一次（150ms 后），使一次 `ps`/`lsof` 超时不再被读成「这不是我们的进程」。规则一点没放松 | #3.4 | 已做 |
| R7 | 记录被收养可执行文件的 device+inode（`executableDevice`/`executableInode`），为 #3.2 的修复备好数据；**当前无人读取** | #3.2 | 仅记录 |
| R8 | 共享 runtime 不再挂在单个 surface 的 chrome 加载之后；`surface.load()` 与 `attach()` 的 `loadURL` 各自设上限并给出独立错误码 | S1 | **未做**（见 #5） |
| R9 | `prepareZellijSurface` 在 `directory-prepare` 阶段判定**终局失败**（非 superseded、且外层 `prepareZellijTerminal` 不会再自动重试——即非 `TRANSIENT_IPC_CODES` 或已是最后一次 attempt）时，给该 surface 记一次"弃用"；下一次准备（Retry 点击、health-check 自愈、host 重新 sync）改用带 `-rN` 后缀的全新 session 身份，绕开已证明用不了的那个 socket。不读、不改 owner 审计本身，只是不再对一个已经在本进程里被证明失败过的身份重放同一个必败请求。**同一改动里顺带修的一处**：`zellijTerminalUrl`（renderer 实际 attach 的那个 URL）原来是用 `resolveZellijSessionName(profile, surfaceId)` 单独算一遍，没有经过带 `-rN` 后缀的 `sessionName()`——不修的话，native/bridge 层用的是新身份，但 webview 加载的还是旧的、已证明用不了的那个 session，Retry 表面成功、实际白修 | #3.6 | 已做 |

不动的东西：退出保留 native session 的约定（Ral 2026-09-12）、一个 web server + N 条 session 的结构、
per-surface session 命名、Darwin 上不做全局 `list-sessions` 枚举。

## #5 上一轮未完成项与本轮接手

Ral 2026-09-17 要求继续完成，并再次询问 #3.2 的含义与建议；此前已明确目标是新版本后每次更新正常，
允许无法确认归属的历史 tab 关闭后另开。随后明确“实在无法恢复也不应该无限 retry，应该重建会话兜底”。
本轮已实现上述三个独立 issue：原身份最多一次瞬态重试，仍不可用就在同一次操作里新建一次，
新建也失败则停止并报错；仅 renderer 失败不会毁掉仍健康的 native session。以下保留上一轮的停点，
其中“等待信任规则拍板”的结论由新的文件身份合同取代：应用本来就读取自己的归属记录，
首次认领仍需证明实际执行镜像是 bundled binary；复查同一进程时使用实际文件编号，
同时保留 PID 启动时间、UID、命令行及 socket 校验。文件编号不是签名，也不能验证被整体篡改的记录。
不采用仅凭 `ShipIt` 目录名称放行的方案。历史用户进程不自动清理。

### 上一轮停点（历史记录）

1. **#3.2 的修复要改信任规则，这条归 Ral。** 把「进程镜像」的判据从**路径**换成收养时记录的
   **文件身份（device+inode）**，才能让更新后仍认得自己的守护进程。但
   `tests/zellij/zellijNativeOwner.test.mjs:134`（「image and UID mismatches are unknown rather than
   proof of a dead recorded owner」）**故意钉住**现在这条路径判据，而被篡改过的记录与真实的「bundle 被挪走」
   在数据上形状完全一样，无法用第三个事实区分。所以本次只**记录** device+inode（R7）、并让
   `native-inventory` 把 `verdict=unverifiable` 写进日志，规则本身没动。
   代价：更新之后主动关 tab **仍然**结束不了它的会话，孤儿会一次更新多一个。R9 不改这条——
   R9 只让 Retry 能在同一个 tab 上拿到一个可用的新 session，原来那条 owner 审计不出结果的
   native 守护进程依旧是孤儿，直到 #3.2 的信任规则改掉、或那条进程自己退出。
2. **R8（阻塞那条）没做**：它要给 renderer 加载加超时并新增一个错误码 + i18n，且真正的慢因在 zellij 之外
   （boot 期 renderer 饿死）。建议单独一条 issue 做，连同 maestro boot 的可观测性一起。
3. 现存四个孤儿守护进程（Sep 15/16，各持 6–8 个 pane）要不要清，归 Ral —— 里面是他自己的 shell。

## #6 上一轮验证（历史记录）

- `yarn test:zellij` —— **220/220 通过**（含本次新增的 `tests/zellij/zellijDiagnosticLogging.test.mjs` 8 条
  与 `zellijGlobalLifecycle.test.mjs` 的重试用例）。并且**故意与一次 typecheck 并跑**再验一遍仍 220/220：
  这正是 R6 之前会翻车的那个条件。R9 落地后加了 `tests/zellij/zellijSessionRemint.test.mjs`（3 条，从
  `.ts` 源码里真实提取 `sessionName`/`surfaceSessionAttempt`/`zellijTerminalUrl`/`prepareZellijSurface`/
  `prepareZellijTerminal`，接入真实的 `resolveZellijSessionName`）——**223/223 通过**，与一次 typecheck
  并跑再验一遍仍 223/223。`zellijNativeSession.test.mjs` 在与 typecheck 并跑或整套并发跑时偶发 2–3 条
  超时类失败（每次失败的具体用例不同），单独跑该文件三次全绿——与本次改动无关的既有并发抖动。
- `yarn typecheck` —— 103 条跨 surface 诊断，与改动前基线**逐条相同**（基线本身是红的，见
  `docs/issues/typecheck-is-a-false-green.md`）。
- `yarn test:application-diagnostics` 20/20、`yarn test:zellij` 全绿。
- `yarn test:onlypreview` 有 3 条失败（`onlyPreviewWarmSearchLifecycle.test.mjs`）—— 与本次改动无关：
  把 R1 那个 patch 撤掉后同样失败，属既有问题。
- **没有跑 Electron E2E**（CLAUDE.md 明令），也没有跑 `yarn build`（它会改写 `package.json` 的 `name`）。
- 打包 Preview 由 Ral 实机复验 S1/S2。复验时 `[zellij]` 这条 scope 应能直接回答：哪个 surface、
  哪一阶段、多久、zellij 自己说了什么。

## #7 上一轮 Cowork parity（2026-09-17，历史记录）

配对开发规则（CLAUDE.md「bitterless + micromeet-cowork — paired development」）要求共享的 Zellij
基础设施两边同步。`micromeet-cowork` 现已携带本文档里的 R1、R2、R4、R5、R6、R9，逐条对齐；记录在
`projects/micromeet-cowork/docs/issues/zellij-retry-does-not-recover-native-session.md` `#5`。

两点值得回记到本文档：

1. **R5 与 R9 必须成对。** Cowork 先落了 R9 而没有 R5，结果 remint 对**任何**非 superseded 失败都换
   身份——包括本文档 `#3.3`/`#3.4` 那两类瞬态（`probe` 回 ready 后端点即消失、所有权审计 `ps`/`lsof`
   超时）。那等于一次抖动就把用户那条 session 里还活着的 shell 弃掉。所以 R9 的门槛必须是「外层不会
   再重试同一身份时才 remint」，两边现在都是这条。
2. **Cowork 那边的真机测试一直红在一个夹具口径错上**：夹具硬编码 `build/tools/zellij` 做所有权审计，
   而 runtime 未打包时解析到 `build/dev-tools/<arch>/zellij`——两个不同的文件，于是它永远认不出自己
   刚建的 session。这与 `#3.2` 是**同一类**错误（拿路径当文件身份），只不过发生在测试口径上而不是
   产品代码里。BL 侧的夹具没有这个问题（`tests/zellij/*` 用 `build/maestro-tools/zellij`，与
   `binaryPath()` 同源）。

BL 侧该轮复验：`yarn test:zellij` **223/223**，`yarn typecheck` 103 条诊断与改动前基线逐条相同。

## #8 本轮交付与验收（2026-09-17）

- **R7 / #3.2 完成：**首次严格认领后保存真实执行文件的 device/inode，后续校验实际映射的文件编号；
  保留 PID 启动时间、UID、argv 和 socket 校验。连续搬动、原路径替换及删除旧路径不会使同一进程失去归属。
- **R8 完成：**controls 和 terminal 的每次导航分别封顶 15 秒，并有独立错误码；controls 未能挂载时，
  当前窗口提供系统 Retry / Dismiss。页面重试复用 native 会话，迟到的加载结果不能重新挂回已销毁的 tab。
  此项提供失败边界，不代表已解决 #3.1 的整个应用启动期 renderer 变慢根因。
- **R9 收口：**原身份最多两次准备（第二次仅适用于瞬态失败），随后同次操作内新建一次。
  新建仍失败则停住，广播和切换 tab 不自动再试；只有主动 Retry 开始下一轮。
  新 native 成功后、bridge 附着前即持久化新身份，应用重启复用该会话。退出保留，成功显式关闭才删除映射。
  重建沿用记住的 cwd，但不会把旧进程里的运行任务搬过去；无法确认归属的旧会话保留。

代码验证：Bitterless 身份/生命周期 **31** 例、恢复 **45** 例、页面加载 **25** 例通过；
Cowork 对应 **45** 例（其中一条启动超时后定向重跑通过）、**47** 例、**14** 例通过。
额外 Cowork HostLifecycle 检查有一条 fixture 缺少 `shutdownWorkflows` 的失败，检查时该 fixture
及它唯一提取的源文件与 HEAD 相同。未把该项或整仓类型检查描述为通过。

最终类型检查快照：Bitterless main/shared 有 **65** 条诊断；Cowork `yarn typecheck:node` 有 **21** 条诊断，
均在本次 Zellij/i18n 范围之外。工作区同时存在其他任务修改；本轮未重跑整仓历史基线。
未运行 Electron E2E、实际应用或 Claude 会话，也未打包、提交或发布。

Ral 打包后的验收：

1. 两端各开多个终端，进入不同目录。普通退出再启动，应保留原 shell、pane 与 cwd。
2. 修复版本中新建的会话再经历一次应用更新，确认可重新连接；主动关闭 tab 能结束对应会话。
3. 再遇到无法恢复的 native 会话，确认同次操作只新建一次并回到记住的 cwd；重启应用后仍连接重建出的会话。
4. 若新建或页面加载也失败，确认显示错误后停止；切换 tab 不再反复恢复，只有 Retry 会重新尝试。

相关：`docs/features/zellij-multi-tab.md`、`docs/features/zellij-auto-open-directory.md`、
`docs/issues/zellij-multi-instance.md`、`docs/issues/zellij-terminal-no-error-trace.md`、
`docs/plan/tasks/zellij-session-lifecycle-177.md`、`docs/issues/application-file-logging-missing.md`、
`docs/issues/onlypreview-index-full-reconcile-runaway.md`
