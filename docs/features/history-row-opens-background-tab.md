# 历史记录行一律开**后台**新 tab(Maestro)

Status: **designed + implemented 2026-09-20;code-verified, human testing pending。**

姊妹落地:`micromeet-cowork:docs/features/history-row-opens-background-tab.md`(Cowork 侧同构,**两份要一起改**)。
上游契约:[`browser-history-suggestions.md`](./browser-history-suggestions.md)(弹窗本体)、
[`maestro-new-tab-focus-address-bar.md`](./maestro-new-tab-focus-address-bar.md)(谁该抢焦点)。

## #1 需求(Ral 2026-09-20 口述)

> 历史记录先改成统一通过 new tab 打开

同日追问定稿的两条边界,**不再讨论**:

| 问 | 答 |
|---|---|
| 范围到哪 | **只改历史记录行**。Google 搜索候选行、地址栏直接回车**维持现状** |
| 新 tab 要不要切过去 | **后台打开,人停留在当前页** |

"统一"针对的是**旧行为的条件分支**:同一条历史记录,当前 tab 是 `browser` 就原地跳转、
是 composite / mini-app 就开新 tab —— 同一个动作两种结果。现在只有一种。

## #2 改动前的现状(实码核对 2026-09-20,`dev/next`;**本节行号是改动前的**)

### #2.1 一个 `accept`,两类行共用

[`browserHistory.store.ts:176`](../../src/renderer/maestro/home/src/components/MenuBar/browserHistory.store.ts):

```ts
if (action.action === 'accept') {
  this.hide('accept');
  await coach.backgroundWorkbenchTab();                              // :178
  const active = (await coach.getTabs()).find((tab) => tab.active);  // :179
  if (active?.kind === 'browser') await coach.navigate({ url });     // :180
  else await coach.openTab({ url });                                 // :181
}
```

`accept` 是 Google 候选行与历史记录行的**共用出口**:`candidateUrls`(`:24`)= `[googleUrl?, ...entries.map(url)]`。
两者在这里可以分开 —— `remove` 分支(`:182`)已经在用同一个判据:`this.entries.some((entry) => entry.url === url)`。

鼠标点行、键盘 `Enter`(`:221`)都落在同一个 `accept`。地址栏直接回车不走这里
(`keydown()` 对未选中候选的 `Enter` 返回 `false`,交回 MenuBar 原有的导航路径)。

### #2.2 `openTab` 是**前台**开

[`maestroBrowserView.service.ts:2215`](../../src/main/maestro/windows/main/maestroBrowserView.service.ts):
`claimSpareTab()` → `activateTab({ deferNavigation: true })` → `startTabNavigation()`。
`activateTab` 把新 tab 设为 active 并显示出来 —— 这正是 #1 第二条要改掉的那一半。

### #2.3 后台建 tab 的既有先例

不是新机制。`openAgentTab(url, opened, sessionId, show = false)`(改动后 `:2554`)已经这么干:
**跳过 `activateTab`(只有 `show` 为真时才调,`:2568`),但手动 `applyBounds()`(`:2563`)** ——
新建的 slot 建完不可见也没摆过位置,零尺寸视口会让响应式页面按 0×0 布局。
`openTabWithUrl` 的后台分支(`:2161`)同理。

## #3 契约

### #3.1 历史记录行 = 后台新 tab,无条件

- `accept` 的 url 属于 `this.entries`(即它是一条**存下来的历史记录**)→
  **一律** `coach.openTab({ url, background: true })`,不看当前 tab 的 `kind`。
- 新 tab **不 activate**:当前 tab 仍是 active、仍在前台。
- 新 tab 在 tab 条上**立刻可见**(建出来就 `broadcastTabs()`),并在后台把页面加载完。
- **不调 `coach.backgroundWorkbenchTab()`。** 旧路径在开 tab 前先把 Workbench 收到后台,
  那对"切过去"是对的;对"停留在当前页"是错的 —— 收掉 Workbench 会露出**上一个**浏览器 tab。

### #3.2 地址栏必须回到当前页

后台开 tab 时当前 tab **没有导航**,所以 `coach/nav` 不会播,`menuBar.store.ts:63` `applyTabs()` 的
`id !== activeTabId || url !== activeTabUrl` 也不成立 —— 地址栏会留着刚才输入的查询词,
而它下面显示的还是原来那个页面。

**落点必须在 `menuBarStore` 一侧,不能反向 import。** `menuBar.store.ts:3` 已经
`import { browserHistoryStore }`,所以 `browserHistory.store.ts` 不许 import `menuBarStore`
(会成环)。沿用已有的同向接缝(`bindAddressInput` → `browserHistoryStore.bind()` /
`setActiveTab()`):menuBarStore 注册一个复位回调,历史记录行走后台路径之后调用它。

### #3.3 不在本次范围内(**刻意保留原行为**)

| 行为 | 保留原因 |
|---|---|
| Google 候选行 | Ral 明确划在范围外,继续走 `backgroundWorkbenchTab` + `navigate`/`openTab` 的老分支。**分流按行身份,不按 URL 文本** —— 见 #3.5 |
| 地址栏直接回车 | 同上;`navigate()` 还是 schemeless 补全、内部地址、跨 profile 的唯一收口 |

### #3.5 两类行按**身份**分流,不按 URL 文本

`accept` 是 Google 候选行与历史记录行的共用出口,而**两者的 URL 会重合**:搜过一次 `cats`,
结果页 `https://www.google.com/search?q=cats` 就被 `browserHistoryRecorder` 原样记进
`browser_history`(`normalizeBrowserHistoryUrl` 保留 query string,没有任何一层过滤 Google 搜索)。
下次再输 `cats`,`candidateUrls` = `[googleUrl, ...entries]` 里两项是**同一个字符串**。

所以判据不能是 `entries.some((entry) => entry.url === url)` —— 那会把 Google 行误判成历史记录行,
当前 tab 不导航、Workbench 不收、地址栏被复位,#3.3 当场作废,而两类行各自的单测照旧全绿。

落点:`BrowserHistoryPopupAction` 增加 `row?: 'google' | 'history'`,弹窗的两个 accept 按钮各自填
(它知道自己渲染的是哪一行);键盘回车没有这个字段,由 home 侧的 `rowKindAt(selectedIndex)` 推
(有查询词时第 0 项就是 Google 行);两者都拿不到时才退回 URL 归属。

> Cowork 侧天然没有这个问题:它的弹窗动作本身就是 `type: 'choose' | 'search'`
> ([`historySuggestions.api.ts`](../../apps/cowork/src/shared/historySuggestions.api.ts) 里的
> `HistorySuggestionsAction`),行身份一直跟着动作走。这次是把 BL 对齐到同一个语义,
> 不是给 BL 发明一套新机制。

### #3.4 代价(已知、接受)

同 Cowork:没有 URL 去重(点三次得三个 tab)、warm cap 会冷却更老的 tab、
非 pinned 的 http(s) tab 会被持久化并在下次启动恢复。

## #4 落点

| # | 文件 | 改动 |
|---|---|---|
| 1 | [`shared/maestro/coach.api.ts:188`](../../src/shared/maestro/coach.api.ts) | `openTab(params: { url: string; background?: boolean })` |
| 2 | [`main/maestro/xpc/coach.handler.ts:117`](../../src/main/maestro/xpc/coach.handler.ts) | 透传 |
| 3 | [`main/maestro/windows/main/maestroWindow.controller.ts:1939`](../../src/main/maestro/windows/main/maestroWindow.controller.ts) | 透传 |
| 4 | [`main/maestro/windows/main/maestroBrowserView.service.ts:2215`](../../src/main/maestro/windows/main/maestroBrowserView.service.ts) | `background` 分支:`claimSpareTab` → `applyBounds` → `broadcastTabs` → `startTabNavigation`,**跳过 `activateTab`**。不需要 Cowork 那句 `ensureWarm` —— 本仓 `claimSpareTab` 已经 `enforceWarmCap([tab.id])`,新 tab 不在驱逐名单里 |
| 7 | [`scripts/maestro/check-history-background-tab.mjs`](../../scripts/maestro/check-history-background-tab.mjs) | 新守卫(`yarn check:history-background-tab`),与 Cowork 侧同构 |
| 5 | [`renderer/maestro/home/src/components/MenuBar/browserHistory.store.ts:189`](../../src/renderer/maestro/home/src/components/MenuBar/browserHistory.store.ts) | `accept` 按 `entries.some(...)` 分流出历史记录行的后台路径 + 调复位回调。**判据取在 `hide()` 之前** —— `hide()` 会清空 `entries`,放在它之后这条分支永远不成立,而所有既有断言照旧全绿(实际踩到过) |
| 6 | [`renderer/maestro/home/src/components/MenuBar/menuBar.store.ts:76`](../../src/renderer/maestro/home/src/components/MenuBar/menuBar.store.ts) | `bindAddressInput` 里注册地址栏复位回调(`setAddressRestorer`) |

`background` 只作用于"带 URL 出生的普通网页 tab"。空 URL(委派 `newTab()`)与
`bitterless://workbench`(单例前台化)两条分支照旧前台。历史记录只存 http(s),走不到它们。

## #5 验证

仓库根下:

```sh
node --test tests/maestro/maestroBrowserHistoryInput.test.mjs \
             tests/maestro/maestroBrowserHistoryPopup.test.mjs \
             tests/maestro/maestroBrowserHistoryTabs.test.mjs \
             tests/maestro/maestroBrowserHistoryClick.test.mjs \
             tests/maestro/maestroBrowserHistory.test.mjs
yarn check:history-background-tab
yarn typecheck:node && yarn typecheck:web
```

新增/改写的断言:

1. 历史记录行 `accept` → `openTab({ url, background: true })`,且**没有** `navigate`、
   没有 `backgroundWorkbenchTab`(改写 `maestroBrowserHistoryInput.test.mjs:105`)。
2. 当前 tab 是 `composite` 时,同一条路仍然是 `background: true` 的 `openTab`
   (改写 `:143` 那条 "locked addresses" 用例 —— 证明 `kind` 分支真的没了)。
3. 键盘选中历史记录行后 `Enter` 与鼠标点击走同一条路。
4. Google 候选行仍走旧分支(`browser` tab → `navigate`,并且仍先 `backgroundWorkbenchTab`)。
5. 接受历史记录行之后,`menuBarStore.url` 复位成当前 active tab 的地址 —— 这条用**真的**
   `menuBarStore`(`menuCode` + `bindAddressInput`)跑,不是断言测试自己装的回调计数器:
   删掉生产代码里那行 `setAddressRestorer(...)` 注册必须变红。
6. 主进程那半由守卫 `check:history-background-tab` 钉住(分支存在、排在 `activateTab` 之前
   return、含 `applyBounds`/`broadcastTabs`/`startTabNavigation`、分支内不出现 `activateTab`),
   并额外钉住 `claimSpareTab` 的 `enforceWarmCap([tab.id])` **以及 `enforceWarmCap` 自己把
   `extraProtectedIds` 并进 `protectedIds`** —— 那是"新 tab 不会出生即被冷掉"的唯一前提,
   只钉调用点文本的话,参数在被调方被改名/丢弃时保护会静默消失。
7. Google 候选行的 URL 与某条历史记录**逐字节相同**时(搜过同一个词两次),点 Google 行仍走老
   分支、点历史记录行仍开后台 tab;键盘选中第 0 项回车判为 Google 行。守卫第⑨条另钉住
   `row` 字段、弹窗两个按钮各自填它、以及 home 侧先认 `action.row` 再退回 `rowKindAt`。

**不跑 Electron / E2E / 打包冒烟。**
