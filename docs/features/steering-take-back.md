# 取回 —— 趁排队的话还没送到模型手上，把它拿回输入框

**状态：** 🔧 已实现，**待 Ral 人工验收**（2026-09-22）
**由来：** Ral 2026-09-22 看完 `overmind:areas/agent-runtime/chat/steer/auto-steer.html` #7 的三方对照后
指定要做的「缺口 1」。
**配对：** `micromeet-cowork` 同名文档 —— 两仓同形实现。

## pi 里已经有这件事

不是新发明，是把 pi 自己 TUI 的做法接进来（`@earendil-works/pi-coding-agent@0.85.1`）：

| pi 的哪一处 | 做什么 |
|---|---|
| `core/keybindings.js` `app.message.dequeue` | 默认键 **`alt+up`**（Windows `alt+q`），说明文字 `Restore queued messages` |
| `modes/interactive/interactive-mode.js` `handleDequeue()` | → `restoreQueuedMessagesToEditor()`；一条都没有时提示 `No queued messages to restore` |
| 同上 `restoreQueuedMessagesToEditor()` | `clearAllQueues()` → `[queuedText, currentText].filter(Boolean).join("\n\n")` 放回编辑器 |
| 同上 `updatePendingMessagesDisplay()` | 编辑器上方逐条列 `Steering: …` / `Follow-up: …`，末行常驻提示 `↳ alt+up to edit all queued messages` |
| SDK `clearQueue()` | 注释原话：「Clear all queued messages and return them. **Useful for restoring to editor when user aborts.**」 |

**整批，不是挑一条。** pi 的 API 只有 `clearQueue()`，没有「删掉其中某一条」；本仓照它的语义做，
不自造一个运行时兑现不了的动作。

## 本仓的形状（2026-09-22 当天被 Ral 改过一次）

> **第一版做成了状态条上的一个全局按钮，被当场推翻**（Ral：「take back 不应该只有这么一个按钮，
> 人工发送的消息底部需要有个 footer，对于可以 take back 的消息，footer 下要显示一个撤回的 iconbtn」
> 「queueing 的状态栏展示 steering 状态栏去掉吧，UI 并不友好」）。现在是下面这一版：
> **按钮长在每条消息自己身上，状态并进状态词那一档。**

入口是**每条消息自己的 footer**：一条排队中的人类消息，气泡下面挂一个无边框的撤回
`IconBtn`（tabler `IconArrowBackUp`）。判据只有 `ChatMessage.steeringPending` —— 入队时置位，
送达 / 失败 / 被取回时清掉，按钮随之消失；再加一个「回合还在」的条件，免得重启后从库里读回一个
按了没用的按钮。所以在 Ral 那张截图里：`hi` 已经答完 → 没有按钮，`你能做什么` 还在排队 → 有。

**状态并进状态词那一档**（`status-bar.html` #2 的枚举表新增两个词）：
`Queueing`（排进去了、模型还没看见）与 `Steering`（已并入当前回合）。
判据是**最后触发的赢**：`turn.steeringEvent` 由 `sendSteering` 置位，而下一条 agent 事件
（活动行 / 流式增量 / thinking 翻面）会把它清掉 —— 所以「thinking 中插一句 → 显示 Steering →
模型又动了 → 回到 Tooling/Answering」是自然发生的，不需要再排一次优先级。
原来那条单独的 `Queueing into the current turn…` 行已删。

一次点击发生四件事：

1. **main：把这一条从 pi 手里拿回来。** `TurnSteeringInbox.withdraw(messageIds)` 先等在飞的
   `pump()` 落地，再 `takePendingSteering()`（pi 的 `clearQueue()` + 宿主镜像队列 + 压缩期扣住的）。
   **pi 只能整批清**，所以「取回其中一条」= 全部拿走 + 把其余的按原顺序 `requeueSteering()` 放回去
   （放回时**不重打断 bash** —— 它们第一次入队时各自打断过一次了）。
   pi 没还回来的那条 = 模型已经读走了，原样留着等它自己的回执。
2. **回执是第三种结果。** `SteeringDelivery.outcome` 增加 `withdrawn`，main 回报
   `error: steer-withdrawn`。它**既不是 delivered 也不是 failed**：混进 failed 会让渲染端把这条
   消息顺延成下一个回合 —— 等于替人重发了他刚拿回去的话。
3. **渲染端：时间线上那条当场摘掉**（它从来没进过提示词）。
4. **正文回到输入框**，顺序照 pi：取回的排在前面，正在打的排在后面。

## 2026-09-22 二次改造：排队中的话不再是一条消息

按 pi 的条目模型改（`overmind:areas/agent-runtime/chat/message-types.html` #3 建议 3）。
pi 里**未投递的 steering 根本不是 entry**：它在队列里，投递那一刻才进上下文、成为条目。

- 队列：`session.pendingSteering`（`{ id, text, ts }`），**不落库** —— 关掉应用就没了，pi 也是这个行为。
- 渲染：`messageStore.visibleMessages()` = `messages` + 队列投影，**位置与原来一模一样**，
  取回按钮照挂（投影对象带 `steeringPending: true` 当判据）。
- `sendSteering`：先入队 → 投递；**只有 `mergedIntoTurn` 那一支才 append 真正的消息**；
  取回与失败都只是出队（失败时若是顺延回来的那条，才标 `promptExcluded`）。

**为什么值得动**：原来「它到底算不算数」是一个每条路径都要记得维护的状态（送达清、失败清、
取回清、被停止清），9-22 的两个缺陷就是某条路径忘了清。现在**没投递就不存在，存在就一定算数**。

守卫：`steeringWithdraw.test.mjs` 最后一条 —— 钉住「建消息晚于 `mergedIntoTurn`」「入队那一步不许造
`promptExcluded` 消息」「队列不落库」。

## 2026-09-24 撤回按钮那一栏的尺寸（Ral 指定）

> 「将这个撤回按钮的消息操作栏的高度限制为 14px，只有顶部有个 2px padding，而且它要和用户的消息之间
>  没有 margin 间距」「撤回的按钮应该是靠在最右」

| 项 | 规格 | 为什么这样落 |
| --- | --- | --- |
| 操作栏高度 | **14px**（含 padding，两端都是 `box-sizing: border-box`） | 原来里面是 32px 的 `IconBtn`，一个撤回键把消息下方撑出一整行 |
| padding | **只有顶部 2px**，其余为 0 | —— |
| 与消息的间距 | **0** | 间距来自消息那一列的 `gap: 4px`。那一列里「任务 / 确认 / 拍板 / 气泡」是同一条 `v-if` 链，只会出现一个，`gap` 实际只作用在「消息和操作栏之间」，所以去掉 `gap` 就是零间距，不影响别的元素。以后这一列若再加并列元素，要自己带间距 |
| 按钮位置 | **靠最右** | 操作栏撑满这一列（`align-self: stretch`）+ `justify-content: flex-end`，不依赖这一列的 `align-items` |
| 按钮尺寸 | **12×12**，图标 12px（原 14px） | 14px 高、顶部 2px padding，留给按钮的只有 12px；图标保持 14px 会溢出操作栏 |

两个仓的 `IconBtn` 实现不同（cowork 是 Tailwind 的 `h-8 w-8`，bitterless 是 `.icon-btn.arco-btn` 固定 32px），
所以覆盖分别写在各自的 `MessageItem` 样式里，选择器都比 `IconBtn` 自己的更具体。无边框（Borderless UI）。

## 落点

| 层 | 文件 |
|---|---|
| 收件箱 | `src/main/agent/steering/turnSteeringInbox.ts` — `withdraw()`、`outcome: 'withdrawn'` |
| 服务 | `src/main/agent/maestroAgent.service.ts` — `withdrawSteering()`、receipt 的 `withdrawn` 分支 |
| 类型 | `src/main/agent/BaseAgent.ts` — `BaseAgentSteerOutcome` 增加 `'withdrawn'`（漏了它 `main` 面会多一条 TS2322） |
| 通道 | `src/shared/maestro/coach.api.ts` · `src/main/maestro/xpc/coach.handler.ts` · `maestroWindow.controller.ts` |
| 渲染 | `store/turn.service.ts`（`withdrawSteering()` + `steer-withdrawn` 分支）· `store/message.store.ts`（`composerRestore`）· `ResponseStatus.vue` + `ResponseStatus.less`（按钮，无边框纯文字）· `ChatPanel.vue`（接住正文） |
| 文案 | `responseStatus.takeBack`：`Take back` / `取回`（en·zh） |

## 守卫

`tests/maestro/steeringWithdraw.test.mjs`（3 条，已注册为 `yarn test:steering-withdraw`）：整批取回、
**已经送到模型那里的不算取回**、以及「取回这一支必须排在顺延之前」的次序断言。

## 验证

`node scripts/typecheck/surfaces.mjs main renderer/maestro`：`main` 64 条、`renderer/maestro` 8 条，
**与改动前逐条一致、零新增**（都是既有问题，分布在 `onlyPreviewWindow.helper` / `TabAliasApp.vue` 等处）。
新守卫 3/3。**未跑 Electron / E2E**（仓库规则），也未跑完整打包构建。

## 还没做的（明确不在本次范围）

- **快捷键**。pi 有 `alt+up`，本仓只有按钮。等 Ral 用过之后再决定要不要给键。
- **逐条取回**。pi 的 API 做不到，本仓也不做。
- **followUp**（auto-steer.html #7 的缺口 2）与**带图插话**（缺口 3）仍然没做。
