# 排队消息顺延成下一回合时：换了 id、提前「转正」、等待期间从屏幕上消失

- **来由**：2026-09-24 复查 `turnSteeringDelivery.test.mjs` 从 8/9 掉到 4/13（cowork）。变化与
  `87e2132 chore: sync 2026-09-23 09:07` 对得上 —— 那次同步带进了 9-22 的「二次改造：排队中的话不再是一条消息」
  （`docs/features/steering-take-back.md`）。
- **状态**：已修复（2026-09-24），见文末「修复与验证」
- **被破坏的契约**：9-22 `docs/issues/enter-does-nothing-while-the-turn-is-stopping.md` 修复契约 P1 ——
  「没投出去 ≠ 失败，它还在队列里；回合结束后把**同一条**消息作为下一个回合发出去」。

## 二次改造本身是对的，只是没把顺延那条路改完

改造把排队中的 steering 从 `session.messages` 挪进 `session.pendingSteering`（照 pi：未投递的 steering
不是条目），渲染时投影回原位；**只有 `mergedIntoTurn` 那一支才建真正的消息**。直接送达、取回、失败这三条路
都改对了。**顺延成下一回合**这条路没改完：

| | 改造前（9-22） | 改造后 |
| --- | --- | --- |
| 顺延时交给 `send()` 的 | 时间线上**那一条**排队消息（`acceptedMessage`） | `acceptedMessage` —— 对第一次排队的话它是 `undefined` |
| 于是 `send()` 看到的是 | 一条「顺延回来的」消息：沿用 id；`promptExcluded` 等 dispatch 真的发出去才转正 | 一次**普通的新发送**：新建消息、**新 id**、**当场**标成「模型看过」 |

## 三个后果（实测，不是推断）

用 `turnSteeringDelivery.test.mjs` 自己的 `rendererFixture` 实测：

1. **身份丢了。** 两条排队消息顺延后成了 `message-6` / `message-8` —— 新分配的 id。main 侧收件箱
   （`TurnSteeringInbox.enqueue`）按 `messageId` 去重、认领；换了 id 就认不出是同一条，重投时可能被当成两条注入。
2. **提前「转正」。** 顺延出去的那一轮在准备阶段又失败（工作区不可用）时，`"second"` 在时间线上是
   `promptExcluded = false` —— 声称模型看过，而模型一个字都没收到。这正是 9-22 修掉的那种谎报。
3. **等待期间从屏幕上消失。** 进入「没送达」分支的**第一句**就是出队，然后才等回合收尾。停止那一档回合当场结束，
   看不出来；**自然跑完**那一档要等压缩、落盘 —— 这几秒里这句话既不是投影也不是消息，人看到自己刚打的字没了。

### bitterless 同样中招，还多一个

bitterless 做了同样的改造，顺延路径同样交出 `existingMessage`（第一次排队时为 `undefined`），`send()` 追加消息后
**无条件** `promptExcluded = undefined` —— 同样的 1、2。另外：

4. **停止后顺延那一支没有出队。** 它先调 `send()`（新建一条消息），**整轮跑完**后直接 `return`，
   `dequeue()` 一次都没调 —— 重发期间投影和新消息**并排出现**，之后投影（带撤回按钮）**一直留在时间线上**，
   直到会话重载。bitterless 的守卫 `queuedMessageOutlivesTheTurn.test.mjs` 从改造落地起就是红的（断言的正是
   「顺延时交出同一条消息」），没人看见。

## 4 条失败测试的归类

| 测试 | 归类 | 依据 |
| --- | --- | --- |
| `preparation failure marks queued text excluded …`（:213） | **行为回归**（后果 2） | 实测 `promptExcluded = false`，模型从没收到 |
| `two late sends … same human IDs and no duplicate timeline`（:229） | **行为回归**（后果 1、3）+ 取样方式过期 | 实测 id 变成 6 / 8；取样时 `pendingSteering` 已是 `[]`（后果 3） |
| `renderer accepts during attachment preparation …`（:193） | **测试过期** | 断言「排队中的话是一条时间线消息」—— 改造有意取消了这一点 |
| `停止之后那条排队消息顺延成新回合 …`（:259） | 前半通过；后半**测试过期** | 换了主人时那条话失败出队、正文退回输入框，按新模型本就不该是一条消息 |

其余旧失败（`Sign in to Cowork to use AI chat.`、`reading 'get'`）是主进程侧装置跟不上，与本条无关。
bitterless 的 `maestroQueuedSteering.test.mjs` 0/14（`Unexpected dependency: @main/net/downloadManager`，装置的依赖白名单
没跟上新依赖）同样与本条无关，另行处理。

## 修复契约

把 9-22 的契约放进队列模型里说一遍：**一条没送达的排队消息留在队列里（看得见、id 不变），直到它 ① 送达
（成为一条同 id 的消息）、② 顺延成下一回合（成为那一回合同 id 的根消息，dispatch 发出去之前标「模型还没看见」）、
③ 被人取回，或 ④ 确定失败。**

- **F1 等待期间不出队。** 队列项标 `awaitingTurnEnd`，投影照常显示。
- **F2 等待期间可以取回。** 这时它已不在 pi 手里（main 已回过话），`withdrawSteering` 就地从队列摘掉并把正文还回去 ——
  否则投影上那个撤回键按下去什么都不发生。等完之后若发现已被取回：不顺延、不留失败气泡。
- **F3 顺延保身份、不提前转正。** 顺延成下一回合时用**同一个 id** 建消息、`promptExcluded: true`，作为「顺延回来的消息」
  交给 `send()`；`send()` 只在 dispatch 真的发出去那一刻转正（bitterless 的 `send()` 补上这条规矩）。
  插进顺延出来的回合（cowork 的续跑分支 / bitterless 的 `continueSteeringAfterCompletion`）同样沿用 id。
- **F4 bitterless：顺延那一支出队。** 与上一条合并实现 —— 出队发生在建消息的同一步。
- **F5 测试。** :193 与 :259 后半改成新模型的表述；:213、:229 不改期望（它们是对的），靠修复转绿；:229 的 id 取样
  改为同时读 `pendingSteering`。

## 修复与验证（2026-09-24）

**状态**：已修复（两仓）；未启动应用目测，未跑 Electron E2E。

| | micromeet-cowork | bitterless |
| --- | --- | --- |
| 落点 | `store/turn.service.ts`（`sendSteering` 等待期不出队 / 顺延同 id 建消息 / 续跑沿用 id；`withdrawSteering` 就地取回等收尾的项）· `store/message.type.ts`（`PendingSteering.awaitingTurnEnd`） | 同左，外加 `continueSteeringAfterCompletion` 沿用 id；`send()` 对顺延回来的消息只在 dispatch 那一刻转正；停止后顺延那一支先出队（后果 4） |
| 回归测试（期望不变，靠修复转绿） | `turnSteeringDelivery` :213、:229 ✅；修复前的源码上两条都转红 | 新增行为测试 `requeuedSteeringKeepsIdentity.test.mjs` 4/4（跑真源码：停止后顺延、等待期取回、自然跑完后顺延、`send()` 转正时机）；修复前的源码上 4 条全红 |
| 过期测试（改成新模型的表述） | `turnSteeringDelivery` :193、:259 后半 ✅ | —— |
| 守卫 | `steeringWithdraw` 7/7、`queuedMessageOutlivesTheTurn` 6/6（后者按新模型重写了顺延那几条断言） | `queuedMessageOutlivesTheTurn` 4/4（从改造落地起一直是红的，现已重写并转绿）、`steeringWithdraw` 5/5 |
| `turnSteeringDelivery` 整体 | 8/9，回到 9-22 的水平；余下 9 条是主进程侧装置跟不上（`Sign in to Cowork…`、`reading 'get'`） | —— |
| 类型检查 | exit 0 | 改动文件 0 条 |

`steeringWithdraw` 那条「发之前先入队」按字面串定位入队语句 —— 实现保持了它认得的写法，没有改那条守卫。

### 顺带看到、未处理

- cowork `scripts/check-behavior-turn-steering.mjs` **在打印任何结果之前就崩溃**：`this._state.selectedWorkspaceForSession is not a function`
  （`buildSessionTurnPrompt` 改用了新名字，守卫手搭的 `pageState` 桩只有旧的 `projectRootForSession`）。与本条无关，撤掉本次改动照样崩。
- bitterless `tests/maestro/maestroQueuedSteering.test.mjs` 0/14：`Unexpected dependency: @main/net/downloadManager`（装置的依赖白名单没跟上）。
