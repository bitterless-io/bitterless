# 工具审批没有可点的按钮

Status: fixed 2026-09-18. Ral 截图:状态条写着「Waiting on you · 允许 agent 运行 run_skill_file」,
面板上一个能点的地方都没有,只能在输入框里打「允许」——而那条消息又被当成 steer 排进当前回合,
显示成「Queued into the current turn · 1」。

## 两只脚

**① 确认卡从来没生成过。** `askOperator` 建的是 `transient` 任务(审批只是一次挂起,不该在时间线上
占一张卡:`approval-task-card-is-timeline-noise.md`)。但渲染端的 `applyTaskSnapshot` 是这个顺序:

```ts
const bound = this.taskBindings.get(task.id) || this.registerTaskBinding(task)
if (!bound) continue          // ← transient 任务在这里就出局了
this.syncTaskConfirm(session, task)   // ← 永远到不了
```

`turn.service.bindTask` 对 `transient` 直接返回 `null`,于是 `continue` 先走一步,
**`type: 'confirm'` 消息一条都没建**。而底部操作面 `ChatConfirmSheet` 只认这种消息:

```ts
(session.messages || []).filter((m) => m.type === 'confirm' && m.confirm && !m.confirm.answer)
```

→ 面板判空,不渲染,按钮不存在。状态条 `ResponseStatus.vue` 读的是任务注册表本身
(`confirm.state.pendingConfirm`),所以它照常显示「等你确认」—— 一个指向不存在按钮的提示。

bitterless 没有这个洞:它的 `applyTaskSnapshot` 把 `syncTaskConfirm` 排在绑定**之前**,
`transient` 只跳过任务卡那一段。这是一次纯粹的 cowork 侧漏实现。

**② 详情没有天花板。** `confirmHostToolCall` 的 `detail` 是 `clipText(JSON.stringify(…), 4_000)`。
四千字符在 11px 行距下比窗口还高,而这张面板是 `#before-composer` 里的 `shrink-0` ——
它顶出去的不是自己,是下面那排按钮。即便 ① 修好,长 payload 仍会把「允许一次」挤出可视区。

## 修复

- `message.store.applyTaskSnapshot`:确认卡的归属解析独立于任务卡绑定(`confirmSessionFor`),
  在 `if (task.transient) continue` 之前同步。归属优先取任务自带的 `sessionId`;registry 包起来的
  宿主工具审批拿不到会话 id,退到「正在跑回合的那个会话」;已经画过的以持有那条消息的会话为准
  (否则撤回时关不掉,卡永远停在等待态)。
- `ChatConfirmSheet`:`detail` 封顶 + 自己滚(cowork `max-h-40`,bitterless `max-height: 160px`),
  `overscroll-behavior: contain` 让滚到底的手势不要接着卷聊天。

## 顺带被这条打掉的闸

`run_skill_file` 是**唯一**绕开宿主工具策略表的工具 —— 它不走 `HostToolRegistry` 的闸,而是在自己的
`execute` 里调宿主给的 `confirmScript`,那条回调在 `mainWindow.controller.ts` 里**写死**
`mode: 'confirm'`。策略表的缺省本来就是 `bypass`(`HostToolRegistry.add`),bitterless 那侧也从来
没有为它设过闸。Ral 2026-09-18:「我们要默认 agent 是 full access，run_skill_file 不需要 confirm」
「其实不应该出现 默认要 full access，除非有些技能通过 hook 触发 confirm」。

现在 `confirmScript` 查策略(`coworkAgent.hostToolMode`):`bypass` 直接放行、`disabled` 拒绝、
`confirm` 才问。要重新上闸,把该工具的策略调成 `confirm` 即可,那条路完整保留。
