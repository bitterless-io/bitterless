# Zellij 多实例:仍然共享的那几样东西

Status: fixed and verified, 2026-09-13 (task 176)
Owner: Ral
Date: 2026-09-11
关联:`docs/features/zellij-multi-tab.md`(多 tab / per-surface 会话 / 恢复,已落地)

`src/main/zellij/zellijTerminalView.ts` 里的注释指向本文件。

2026-09-12：Ral 已明确选择主动关 tab 就结束其会话；应用退出则保留会话。
[任务 176](../plan/tasks/zellij-auto-open-directory-176.md) 已完成 per-surface 状态、
精确会话清理和 stop/start 并发隔离。相关测试及真实开发版关闭/恢复检查通过，证据见
[审查报告](../plan/reviews/zellij-auto-open-directory-176-1.md)。以下是原始问题记录，当前契约见
[自动打开与目录记忆](../features/zellij-auto-open-directory.md)。

## 1. 已经拆开的

`docs/features/zellij-multi-tab.md` 落地之后,以下已经是 per-surface 的:

- 会话名(`resolveZellijSessionName(profile, surfaceId)`);
- surface 本体与它的 tab host(`ZellijWindowService` 的 `Map<surfaceId, …>`);
- 几何(`setContentBounds` 带 `surfaceId`);
- tab 身份与恢复(Maestro 铸造并落盘的 `instanceId`)。

## 2. 还没拆开的

### 2.1 状态灯是应用级的

`src/renderer/zellij/src/zellij.store.ts` 是一个模块级单例 `reactive(new ZellijState())`,
每个 surface 的 chrome 各自有一份**自己的 renderer**,所以 `settingsOpen` / `draft` 这些其实天然
就是 per-surface 的。真正共享的是它们**映射的那个后端事实**:

- `ZellijSnapshot.status` / `.error` 来自 `getZellijRuntime()` —— 一个进程一台 web server 一个状态;
- `zellijTerminalView.ts` 里某一个 surface 的加载失败会把这个共享 status 翻成 `error`,
  于是**所有** surface 的状态灯一起变红,尽管其余终端还好好的。

要拆的是「server 的状态」与「这个 surface 的加载结果」两件事,现在挤在同一个 `status` 上。
做法:`ZellijSnapshot` 保留 server 侧状态,surface 侧的加载结果走一条 per-surface 的事件/字段。

### 2.2 孤儿会话没人回收

关掉一个 Zellij tab 会 `surface.dispose()`,但 Zellij 会话仍在 —— `zellij list-sessions` 里能看到,
而且每开一个新 surface 就永久多一个 `bitterless-<instanceId>`。

这是**故意**留下的,不是疏忽:恢复(`docs/features/zellij-multi-tab.md` #7)靠的正是会话在应用退出
后仍然活着。「关 tab 就杀会话」和「重启能恢复」是同一个开关的两头,先保住后者。

可选的收口方向,按侵入性排序:

1. 只回收**没有对应 saved tab** 的 `bitterless-*` 会话 —— 启动时对一次账;
2. 给会话加保留期(N 天未被贴回就删);
3. 关 tab 时区分「关掉」与「退出应用时一起没的」,前者杀会话。

需要 Ral 决定的是第 3 条:关掉一个终端 tab 到底算不算「我不要这条 shell 了」。

### 2.3 `stop()` 不清 `pending`

`src/main/zellij/zellijRuntime.service.ts`:`stop()` 之后 `this.pending` 仍然留着上一次启动的
promise。单实例时它被后续的 `initialize()` 覆盖掉,看不出来;多 surface 并发调用时它会让一次
stop→start 往返读到上一轮的结果。一行改动,但要连同一个回归测试一起做。

## 3. 不做这些会怎样

都不会让当前功能坏掉 —— 所以这是记账而不是回归单。影响是:

- 2.1:多终端时状态灯不可信(一个坏了看起来全坏);
- 2.2:`zellij list-sessions` 会越来越长,盘上会话元数据只增不减;
- 2.3:并发 stop/start 下有一次读到陈旧结果的窗口。
