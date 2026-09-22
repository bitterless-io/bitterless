# 发消息之后最后一条被顶出视野 —— 状态条是在滚动**之后**才出现的，没人再滚一次

**报告日期**：2026-09-22（Ral：「当我发消息时，我发现消息列表滚动条不是滚动到最底部的，
statusbar 显示在视窗外……说明发消息滚动条是滚动了，但是 statusbar 从不显示到显示，是发生在后面，
这个时候应该再往底部滚动一次」）。**状态**：fixed 2026-09-22；owner testing pending。
**配对**：`micromeet-cowork`（同名文档）。

## 1. 症状

按下发送 → 列表滚到底 → **然后状态条出现**，把消息列表的可视高度吃掉一截，于是刚发的那条
（以及状态条自己）被顶到视窗外面。人要手动再往下滚一下才看得到。

## 2. 根因：滚动发生在布局变化之前，而布局变化之后没有第二次滚动

`turn.service.ts` 的 `send()` 里顺序是对的 —— 先置 `session.turn`，再滚：

```ts
session.turn = { id: uid(), phase: 'accepted', … }   // 状态条的 v-if 从这一刻起为真
…
store.stickToBottom = true
store.scrollToBottom(true)                            // nextTick + 一次 rAF
```

问题不在这一次滚动，而在**它之后状态条还会继续长高**：

| 时刻 | 状态条 | 列表可视高度 |
| --- | --- | --- |
| 发送瞬间 | 一行 `Waiting for a response` | −26px |
| 模型开始思考 | 换成 `Thinking…` | 不变 |
| 有任务在跑 | 多出 `action` 一行 | 再 −22px |
| 后台 Agent / steering 也在 | 再多两行 | 再 −44px |
| 文案换行 | 单行变两行 | 再 −13px |

**每一次变高都只缩小可视区，不触发 `scroll` 事件** —— 所以 `stickToBottom`
（阈值 120px，由 scroll 事件驱动）既不会被重算，也没有任何东西去补一次滚动。
下一次滚动要等到第一个 stream delta 到达；在那之前屏幕就是停在被顶上去的位置。

`scrollToBottom` 自己的 `nextTick` + 一次 rAF 也救不了：它们只覆盖**当下这一帧**的布局，
而后面几次变高发生在几百毫秒甚至几秒之后。

## 3. 改动

**让状态条自己负责。** 它是唯一知道自己什么时候变高的人，而且这个 bug 的所有成因
（行出现、行消失、文案换行）在它那里是同一件事：**根元素的高度变了**。

`ResponseStatus.vue` 里加一个 `ResizeObserver`：根元素高度一变，就补一次
`messageStore.scrollToBottom()`。

三个要点：

* **不 force。** 非强制的那一版由 `stickToBottom` 把关 —— 人自己往上滚过就不该被拽回来。
  这里安全的原因正是 #2 的那条：**改高度不触发 `scroll` 事件**，所以 `stickToBottom`
  还保持着变高之前的值；它是 `true` 就说明变高之前人就在底部。
* **观察的是 ref 而不是在 `onMounted` 里 observe。** 根元素带 `v-if`，空闲时压根不存在。
  `watch(rootEl, …, { flush: 'post' })` 在它出现的那一刻接上 —— 而 `ResizeObserver`
  在 `observe()` 时会立刻回调一次，所以「从不显示到显示」这一跳自然被覆盖，不用另写一条。
* **`typeof ResizeObserver === 'undefined'` 要兜住。** 姊妹仓的 `tests/unit/chatEscape.test.mjs` 用 linkedom
  挂载这个组件，那里没有 `ResizeObserver`；不兜就是整个守卫套件红。

## 4. 验证

* `yarn typecheck:node`、`yarn typecheck:web`：零诊断。
* 本仓没有等价的 renderer 测试装置（见配对文档），未新增守卫。
* 未跑 E2E（桌面 E2E 需 Ral 当场要求才跑）。

## 5. 还没有守卫

「变高之后要补一次滚动」需要一个能量高度、能驱动 `ResizeObserver` 的装置，
linkedom 给不了。本次没补。
