# 发出消息后「滚到底」没有滚到真正的底

- **报告**：Ral 2026-09-24 ——「消息列表的渲染有时序问题……先触发了滚动到底部，然后新的消息才渲染出来。
  然后新的消息并没有完全显示出来，因为底部的空间在新的消息渲染出来之后又增加了。」
  补充：「现在的错误现象是新消息发出去之后，滚动到底部的操作没有完全滚动到底部」「setTimeout 当然尽量
  能不用就别用」。
- **状态**：根因已定（源码逐条），修复见文末「修复契约」

## 先排除的

- **不是「没等渲染就滚」。** `scrollToBottom()` 早就是 `nextTick` + 一帧 `requestAnimationFrame` 双写，
  Ral 建议的「新消息加进来之后的下一个 tick 再滚」已经在里面了。
- **不是刚发出去那条人类消息。** 它是纯文本（`whitespace-pre-wrap`），Vue 一渲染完高度就定了；
  而且 `send()` 里滚动发生在 `refreshWorkspace` / `stageAttachments` / 压缩几次 await **之后**，
  那时它早就画好了。
- **不是 markstream 的 `typewriter`。** 入场过渡只动 `opacity`（`.typewriter-enter-active{transition:opacity …}`），
  不改高度。

## 根因：黏底只在发送那一刻钉了一次，之后的高度变化没人跟

「滚到底」= 让 `scrollTop` 追上 `scrollHeight - clientHeight`。这两个量在钉完之后**还会继续变**，
而两种变化都**不触发 `scroll` 事件**：

| 变化 | 来源（都发生在钉底之后） | 有人跟吗 |
| --- | --- | --- |
| **内容变高**（`scrollHeight`↑） | AI 回复的 markdown：markstream 默认 `batchRendering`，先 40 个节点，其余每帧一批 + 16ms 延迟 + idle 切片；代码块高亮；状态条换文案 | 只有状态条自己挂了 `ResizeObserver`（2026-09-22 补的）；其余没有 |
| **可视区变矮**（`clientHeight`↓） | 回合中出现在滚动容器**外面**的 `ChatConfirmSheet` / `DecisionSheet`（`before-composer` 插槽） | **没有** |

第三个洞让前两个更糟：

**`onListScroll` 不看方向。** 注释写的是「scrolling up past it turns auto-scroll off」，代码却只算离底距离：

```ts
const next = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX
```

程序滚动产生的 `scroll` 事件是**异步**派发的。钉底之后、事件到达之前内容只要长高超过 120px
（AI 第一段回复、一张拍板卡），这次事件就算出「离底很远」，把 `stickToBottom` 置 false ——
**人一下没往上滚，黏底却被内容增长解除了**，之后所有不带 force 的补滚（流式、状态条观察者）全部失效。

## 为什么不用 setTimeout（Ral 同意）

晚到的高度没有固定期限：markstream 的批次是 rAF + 16ms、idle 切片最长 120ms，代码块高亮更慢，
拍板卡什么时候出现取决于 agent。任何时长都是猜 —— 短了照样漏，长了多一段可见的「先停在半截、
再跳一下」。**高度真的变了才补滚**，才是这件事唯一正确的触发条件。

## 修复契约

**F1 · 一个观察者，两件事都盯。** `MessageList` 把消息与尾部插槽包进一个内容元素，用**一个**
`ResizeObserver` 同时观察**滚动容器**（可视区变矮）和**内容元素**（内容变高）。任何一个尺寸变了，
且 `stickToBottom` 为真 → 立刻把 `scrollTop` 钉到底。回调里**同步**写：`ResizeObserver` 在布局之后、
绘制之前回调，同步写就落在同一帧，不会先画出半截再跳。

**F2 · 只有「往上滚」能解除黏底。** `onListScroll` 记住上一次的 `scrollTop`：离底在阈值内 → 黏住；
否则只有 `scrollTop` **变小**（人往上滚）才解除；内容增长、程序钉底都不会让 `scrollTop` 变小，也就
不再能误解除。内容缩短被浏览器夹回底部时离底为 0，走第一条，照样黏住。

**F3 · 不动的。** `scrollToBottom(force)` 保持原样，负责发送 / 挂载那一次强制钉底；状态条自己的
观察者被 F1 覆盖，但保留（无害），不在本次清理范围。

**F4 · 守卫。** 钉住：观察者同时 observe 两个元素、回调受 `stickToBottom` 把关、`onListScroll` 的方向规则
（行为测试：内容增长 150px 不解除、往上滚解除、夹回底部仍黏住）。

## 落点（两仓同形）

| 仓 | 文件 |
| --- | --- |
| micromeet-cowork | `renderer/control/src/MessageList.vue` · `renderer/control/src/store/message.store.ts` |
| bitterless | `renderer/maestro/control/src/MessageList.vue`(+ `.less`) · `renderer/maestro/control/src/store/message.store.ts` |
