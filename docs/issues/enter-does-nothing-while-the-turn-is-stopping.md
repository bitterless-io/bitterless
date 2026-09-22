# 按过 Stop 之后，回车什么都不发生

- 状态：已修复（2026-09-22；修复形状当天被 Ral 换过一次，见文末「修复契约（2026-09-22 修订）」）
- 报告：Ral 2026-09-22 ——「我想问：他的紧急联系人是》，然后发现我自己有 typo 所以重新输入了"谁?"，
  但是此时无法回车发消息，无法进行 steer」
- 证据：`~/Library/Application Support/COWORK_TEST_DEBUG/agent-io/20260922143654108-i21dqhp2dtrmucax32t`
- 设计文档：[`areas/agent-runtime/chat/steer/auto-steer.html`](../../../../areas/agent-runtime/chat/steer/auto-steer.html)

## 时间线

| 时刻 | 发生了什么 |
| --- | --- |
| `14:40:18` | 发出 `他的紧急联系人是》`（打错了，句子没写完） |
| 随即 | 按 Stop → `turn.aborting = true`，界面显示 **Stopped.** |
| 之后 **18 秒** | 打了 `谁？`，**按回车没有任何反应**：不发送、不排队、不报错、不提示 |
| `14:40:36` | 收尾结束，这句话才作为一个全新回合发出去 |

## 根因

发送闸里有一行**静默 return**：

```ts
// 回合正在收尾(按过 Stop)→ **不发**。…… 挡在清空输入框**之前**:字原样留着,停完再按一次就发出去了。
if (props.session.turn?.aborting) return
```

**这行的判断本身是对的，而且有案底**：此刻策略会选 `followUp`，main 照样回报 `delivered`，
但 `BaseAgent.abort()` 的 `finally` 会 `reset()` 掉整个 pi 会话**连同队列** —— 状态条会说
「已排入当前回合」而模型这一轮永远看不到它（steer-002 review F5）。写这行的人是在
**宁可不发，也不撒谎**。

漏掉的是第三个选项。pi 自己给的那条写在 `clearQueue()` 的注释里 ——
*"Useful for restoring to editor when user aborts"*：**把话还给人，并说清为什么现在发不出去**。

静默的代价是具体的：人分不清是键盘坏了、应用卡了、还是自己漏按了。Ral 的原话就是
「无法回车发消息」—— 他甚至无法判断这是功能限制还是 bug。

### 为什么这一档特别值得修

它命中的正是 steer 最有价值的场景：**人发现自己刚才说错了**。这种时候人一定先按 Stop 再改口，
也就是说「按过 Stop 之后」恰好是改口最集中的时刻，而这正是唯一一个完全不给反馈的时刻。

## 顺带查出来的（各自独立，不在本条范围内）

1. **Cowork `check-behavior-turn-steering.mjs` 跑不起来**
   （`Cannot find module './steering/backgroundContextInbox'`）。它挂在 `check:steering` 与
   `check:behavior` 两条命令下，两条现在都是红的。它第 267 行正好断言「策略从 `steeringPolicy`
   引入，不在适配器里就地拍脑袋」——**守卫跑不起来，是下面第 2 条没被发现的直接原因**。
2. **Cowork 的 `decideStreamingBehavior` 是死代码**：全仓只有守卫脚本引用它，产线一次都没调；
   `prompt()` 调的是 `session.prompt(message.text)`，**没有传 `streamingBehavior`**。
   BL 的同名文件**接了**（`session.prompt(text, { streamingBehavior: decision.behavior })`）——
   这是一处配对漂移。
3. **`followUp()` 两仓零调用**：策略表第 2/3/4 行都写着「选 followUp」，没有任何代码真的调它。

## 修复契约（2026-09-22 修订）

**P1 · 一次按键不能什么都不发生 —— 但「留在输入框里等」这个形状已被否掉。**

第一版按上面写的做了:字留在输入框、弹一句「正在停止,停下后自动发出」、`watch` 到 `aborting`
落回 false 再自己 `send()`。Ral 当天看过后换了形状 ——

> 「回合收尾中(aborting)仍可输入,应该要支持的。**静默吞掉和按钮禁用都不对**,这种情况就
>  类似于 followup 了,**先进 queue 等结尾完结再发出去就行**…… UI 上直接拼到结尾那个消息下面,
>  貌似 queue 现有的 UI 配合起来更方便。」

**现在的形状:队列是看得见的。** 收尾中按下回车,和回合活跃时**走同一条路** —— 进 steering:
那条人类消息**当场进时间线**(先标 `promptExcluded`,表示模型还没看见它),接在收尾那条消息
下面;它投不进这个将死的回合,于是 `turn.service` 把**同一条**消息作为**下一个回合**发出去,
不重建气泡、不退回输入框、不要人再按一次。

判据从「某个具体的 retry 码」收成一句话:**没并进这一回合 = 模型一个字都没看见它 ⇒ 它不是
一次失败,是还在队列里。** 原来只有「回合先自己跑完了」那一档能顺延,被**停止**的那一档写成
⚠ 红字失败 —— 可这两档对模型是同一件事。

落点:
- `renderer/**/ChatPanel.vue` —— 删掉 `aborting` 那道闸(连同第一版的 `holdUntilStopped`)。
- `renderer/**/store/turn.service.ts` —— `sendSteering` 的收尾改成「先顺延、顺延不成才留痕」。
- 守卫 `queuedMessageOutlivesTheTurn.test.mjs`(两仓同名),已红检。

**P2 · `clearQueue()` 的返回值还给输入框。**(已做)顺延失败、真的没有落点时才走到这一步 ——
它现在是最后一道兜底,不再是常规路径。

**P3 · Cowork 补上策略表的实际调用 + 修好守卫。**(已做)消掉与 BL 的配对漂移;
`prompt()` 里的 `reload()` 也一并对齐成「流式 / 压缩中不重载」。

**P4 · `followUp()` 暂不接。** 形式上有一个「存放投不进去的消息」的队列,但那些消息都是在
**能 steer 的时候 steer 过去**的,而不是等回合结束再补发 —— 所以它不是 followUp
(Ral 2026-09-22 的判断,见设计文档 #6)。

**P5 · 订阅 `queue_update` 让 pi 侧的排队也可见。**(待排期,见设计文档 #5)
