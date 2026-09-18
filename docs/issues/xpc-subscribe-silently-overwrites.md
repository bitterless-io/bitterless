# Issue — 同一 renderer 里两处订阅同一频道，后者静默顶掉前者

**Status:** 🔧 Fixing — 2026-09-18
**Reported:** 2026-09-18 (Ral)，出自 xpc broadcast 全量审查
**Area:** `electron-xpc` 的订阅语义 + 两个仓的裸 `subscribe` 调用点

Apply the same behavior to BL and COWORK.

## 机制

`electron-xpc` 的订阅在 preload 里是**按频道名覆盖**的：

```js
// node_modules/electron-xpc/dist/preload/index.js:21-22, :62-63
var xpcSubscribers = new Map()
var subscribe = (handleName, callback) => { xpcSubscribers.set(handleName, callback) }
```

分发时 `.get(handleName)` 只取**一个**回调。

**这是设计意图**（Ral 2026-09-18：「监听我设计的是可以覆盖的」），对"同一个消费者重复订阅"是对的——它保证不会累加。
但它对"**两个不同消费者订阅同一频道**"是有害的：后注册的会**永久、静默**顶掉先注册的，没有报错、没有警告。

main 侧也看不出来：`addSubscriber` 按 `(type, id)` 去重，两次订阅来自同一个 webContentsId，所以它只记一条，
一切看起来正常。

## 三处在线失效（审查时逐个验证）

| 频道 | 输家 | 赢家 | 后果 |
|---|---|---|---|
| `cowork/tabs` | `MenuBar/menuBar.store.ts` | `MenuBar/tab.store.ts` | 见下 |
| `cowork/workbench-visibility` | `MenuBar/menuBar.store.ts` | `store/workbench.store.ts` | `clearSuggest()` 永不触发 |
| `agent/workflows` (BL) | 先 init 的那个 | 后 init 的那个 | 两个消费者只有一个活着 |

init 顺序来自 `MenuBar.vue`：`menuBarStore → tabStore → updateStore → captureStore → layoutStore → workbenchStore`。

### `cowork/tabs` 的具体后果

`menuBarStore.activeLocked` 只在 `applyTabs()` 里赋值，而 `applyTabs` 只剩 init 时的那一次真实调用
（`this.applyTabs(await coach.getTabs())`）——广播那条订阅从来没生效过。于是它**停在开机那个 tab 的状态**。

它在 `openTarget()` 里被读：

```ts
const newTab = this.activeLocked || workbenchStore.visible
if (newTab) await coach.openTab({ url })
else await coach.navigate({ url })
```

所以**当前是 miniapp / pinned tab 时，在地址栏输入网址不会开新 tab，而是把那个 miniapp tab 直接导航走**。
而 `MenuBar.vue:535` 的 `:disabled` 绑定读的是 `tabStore.activeLocked`（活的那个），
所以输入框的禁用状态是对的、行为是错的——这正是它一直没被发现的原因。

## 改动

**不改库的覆盖语义**（那是 Ral 的设计），改成让需要多消费者的频道走扇出：

1. **BL `controlSubscriptions.service.ts`**：把 `ControlSubscriptionScope.subscribe` 内部的 relay 逻辑抽成
   `attach(channel, listener)`，并新导出 `subscribeControlChannel()` —— 渲染进程生命周期的扇出订阅，
   与 scope 共用同一条底层订阅、只是没有 disposer。给"一次性订阅、不拆除"的 store 用。
   `message.store.ts` 与 `workflow.store.ts` 的 `agent/workflows` 都改走它。
2. **CoWork `menuBar.store.ts`**：删掉那两条从未生效的订阅；
   `activeLocked` 改读 `tabStore.activeLocked`（唯一活的真相，`MenuBar.vue` 已经在用它），
   删掉本地那份陈旧副本；`workbench-visibility` 改成 `watch(() => workbenchStore.visible, …)`
   —— 该 store 本来就已经 import 了 workbenchStore，不新增依赖方向。

## 刻意不做

**不给库加扇出。** 覆盖是 Ral 定的语义，改它会影响所有既有调用点。
**建议**（未做，等 Ral 定）：在库的 `subscribe()` 里，当 `xpcSubscribers.has(handleName)` 已为真时打一条
`console.warn`。这样下一次冲突当场暴露，而不是等半年后有人发现某个功能不响应。
按本次结论，加上之后每次启动应该恰好打印三次（修完则为零）。

## 验收

- 当前 tab 是 miniapp / pinned 时，地址栏输入网址**开新 tab**，不再导航走该 miniapp。
- Workbench 显隐变化时 MenuBar 的候选弹层被清掉。
- BL 的 workflow 完成消息与任务栏**同时**更新（此前只有一个）。
- 同一 renderer 内不再有两处裸 `subscribe` 抢同一频道。

## 验证

单元/源码测试、typecheck。**不启动 Electron、不跑 E2E、不打包。**
渲染端行为需 Ral 在真实窗口点验（仓规：未经要求不得自行启动 Electron）。
