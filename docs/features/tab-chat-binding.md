# Tab ↔ 聊天会话绑定,以及 tab 信息在提示词里的分层

Status: contract — 待实现(2026-09-14,Ral:「new tab 不要触发 newchat,但是每个 tab 新建的时候都要通过
tabid 关联对应的 chat sessionid 就行」/「new chat 的时候需要更新当前 tab 对应的会话;通过 chat history
switch 的时候也要能更新当前 tab 对应的 chat,chat 切换后也要动态调整提示词中对应的 tab 的信息」/
「当前所有打开了的 tab 信息(id url title)也都得放到表 2 的部分,当前激活的 tab 信息在表三」)。

分层口径的上游是 `overmind:areas/agent-runtime/chat/prompt-structure.html` #2(表 1 / 表 2 / 表 3)。
姊妹契约:[micromeet-cowork `docs/features/tab-chat-binding.md`](../../../micromeet-cowork/docs/features/tab-chat-binding.md) ——
两仓同构,除文件路径与产品名外逐字相同,**改一边就要改另一边**。

## 2026-09-14 操作目标补充

后续需求 [Browser tools keep per-chat operating tabs](../issues/agent-browser-session-tabs.md)
给表 3 增加独立的结构化会话操作集合。本文的 `Active tab` 仍表示用户前台页面；
涉及「表 3 只含激活 tab」的旧表述由此补充：表 3 同时包含 `selectedTabId` 与该会话
正在操作的 tabs（ID、title、URL、health、error）。工具默认目标来自会话操作集合，
不能再由前台 `Active tab` 推导。`tabId → sessionId` 的界面关联仍只负责记账；
手动切 tab、new chat/history 切换或重新关联，都不得改写已有会话的操作集合。
显式工具选择与由操作源 tab 产生的弹出页可加入集合，已失效的 tab 保留错误供 AI 决定恢复。
该操作集合本次仅 Main 进程内保留，不把运行时 tab ID 当作跨重启持久身份。

## #0 目标

| # | 目标 | 判据 |
|---|---|---|
| G1 | 新建 tab **不**创建聊天 | 开 10 个 tab,会话列表条数不变 |
| G2 | 每个 tab 记着"我当前属于哪条聊天" | `tabId → sessionId`,建 tab 时写入当时的活跃会话 |
| G3 | new chat 改写**当前 tab** 的绑定 | ⌘N 后当前 tab 指向新会话,别的 tab 不动 |
| G4 | history 切换会话也改写当前 tab 的绑定 | 从抽屉选一条旧会话 → 当前 tab 指向它 |
| G5 | 切 tab **不**切聊天 | 面板显示的会话与 tab 切换无关(既有契约,本次不推翻) |
| G6 | 所有打开的 tab(id/url/title)进**表 2** | system 槽位可见完整 tab 清单 |
| G7 | 当前激活的 tab 进**表 3** | 每条 user 消息前缀里的 `- Active tab:` 那一行,随消息进历史 |
| G8 | 切换聊天后表 2 立刻反映新绑定 | 不需要重启会话、不需要重开 app |

## #1 绑定是什么,不是什么

**是**:一张 `tabId → sessionId` 的小账。它回答的是「这个 tab 上的活,是在哪条聊天里谈的」。

**不是**:
- **不是"一个 tab 一条会话"**。那个绑定 Ral 2026-09-02 亲手拆过,理由写在
  `src/renderer/maestro/control/src/store/channel.store.ts` 顶部:多会话下它自相矛盾。拆掉时连带删掉的
  关 tab GC、`openedByDrill` 例外、「忙碌时冻结切换」**都不要复活** —— 它们是那个绑定的并发症。
- **不是面板的驱动器**。切 tab 不切聊天(G5)。`syncOperationTabs()` 保持空操作。
- **不是一对一**。两个 tab 可以指向同一条会话(在 tab A 聊了几句,开个新 tab 接着聊,就是这种)。
  反向查 `sessionId → tabId` 因此**不成立**,任何实现都不许依赖它。

**方向只有一个:从聊天写向 tab。** 三个写入点(#2)全是"把**当前 tab** 的指针改成**现在面板上这条会话**"。
没有任何一条是反过来的 —— 这正是它不会把 G5 撞翻的原因。

## #2 三个写入点

| # | 时机 | 写什么 | 备注 |
|---|---|---|---|
| W1 | 新建 tab | `binding[newTabId] = 当前活跃 sessionId` | **只读取、不创建**会话。没有活跃会话(启动早期)→ 不写,留空 |
| W2 | new chat(⌘N / 面板按钮) | `binding[当前激活 tabId] = 新会话 id` | 走 `startNewMaestroSession` / `startFreshMaestroSession` 之后 |
| W3 | history 抽屉里选中一条会话 | `binding[当前激活 tabId] = 选中的 sessionId` | 走 `selectMaestroHistorySession` 之后 |

**删除面**:关 tab → 删该 tab 的绑定条目,**会话本身一个字不动**(它还在列表里,别的 tab 可能正指着它)。
会话被物理删除 → 指向它的绑定条目变成悬空,读的时候 fail-closed 当作"未绑定",不做级联清理 ——
级联清理要遍历全部 tab,而悬空指针本来就能被读侧一个判断吃掉。

**持久化**:跟 alias 一样进 sqlite 的 `tabs` 行(新增一列),跟着 tab 走。重启恢复 tab 时一并恢复;
恢复出来的 sessionId 若已不存在,按上一段当未绑定。**不进 localStorage** —— 绑定是 tab 的属性,
而 tab 是主进程持久化的,渲染层的 localStorage 装不住它(未读圆点那类纯 UI 状态才归 localStorage)。

**键不能是运行时的 `tab-N`** —— 而 bl 今天**没有**可以替代它的稳定身份,这是两仓在这条链上
唯一的实质差异,必须先补齐。

- 运行时 id 是 `tab-${++this.tabSeq}`(`maestroBrowserView.service.ts:361/391/669`),
  而 `tabSeq` **每次启动从 0 重来** —— 这一点 bl 自己在 `:155-156` 就写着:
  「a restored `tab-2` would address whatever `tab-2` happened to own last time」。
- bl 的 `SavedTab`(`src/shared/maestro/tabs.api.ts:4`)**没有 `id` 这一格**:普通网页行按 `url` 恢复,
  composite 行按 `instanceId` 恢复。于是「这个 tab 重启后还是它」对普通网页行不可表达。

**本契约的取法:给 bl 的 `SavedTab` 补上 `id`,语义逐字照抄 cowork 的
`src/shared/tabs.api.ts:17-22`**(跨重启稳定、老数据为空时恢复期现发一个)。理由是两仓本就同构,
而 cowork 已经为这件事付过学费(2026-08-12 的回归)—— 让 bl 再独立踩一次没有意义。

**替代方案(未采纳,留档)**:绑定只存在于本次运行的内存里,重启即失。它省掉一次
schema 变更,但也让 G2 在重启后整片失效 —— 而「重启后聊天还认得它那个 tab」正是绑定的价值所在。

### #2.1 不要复用 `session.operationTabId`

会话上**已经有**一格 `operationTabId`(`src/renderer/maestro/control/src/store/message.type.ts:111`,
`message.store.ts:1089` 写入、`turn.service.ts:455` 读出)。它是 2026-09-02 被拆掉的那个旧绑定留下的,
今天每条新会话都写 `DEFAULT_OPERATION_TAB_ID` 这个常量 —— 也就是说**它在跑,但不携带任何信息**。

**新绑定不落在它上面**,两个理由,第二个是决定性的:

1. **方向相反**。它是 `session → tab`,本契约要的是 `tab → session`(#1)。
2. **它表达不了 Ral 给的例子**。会话行上只有一格 tab id,而 A、B 两个 tab 同时绑 chat1 是
   **多对一**(#3 验收表第一、二行)—— 写在会话侧,第二个 tab 一绑就把第一个挤掉了。

**别和回合上那一格混了。** `ActiveAgentTurn.operationTabId`
(`src/main/agent/maestroAgent.service.ts:741`,`this._state.activeTabId || undefined`)是**活的、有意义的** ——
它记的是「这一回合是从哪个 tab 发起的」,per-turn,不是 per-session。它不是尸体,不要一起动。

所以:绑定新增在 tab 一侧,`operationTabId` **原样不动**。
它要不要一起清掉是独立一件事,归 Ral 单独裁决 —— 本次不顺手删。

## #3 表 2 / 表 3 的分工 —— 为什么是两张表而不是一张

Ral 2026-09-14 定的切法:**清单进表 2,焦点进表 3。**

| | 表 2(产品层 · system 槽位) | 表 3(动态前缀 · 随消息进历史) |
|---|---|---|
| 装什么 | **所有打开的 tab**:`id` / `url` / `title` | **当前激活的那一个** |
| 为什么在这 | 它是模型的**可寻址空间** —— 「我能切到哪儿去」。是能力边界,不是世界状态的快照 | 它是**这条消息发出时**人在看什么。会变,且变化本身有意义 |
| 被压缩 | 否(system 永不进消息列表) | 是(随 user 消息进历史),而这正是要的 —— 历史里留下一串"当时在哪个页面"的痕迹 |
| 已有实现 | `BaseAgent.composeSystemPrompt()` | `buildAgentTurnPrompt()` 的 `dynamicPrefix` |

**表 3 的那一行不因为绑定而改口径。** 它是「当前激活的 tab」,不是「这条聊天绑定的 tab」——
后者会让一条在后台的聊天在提示词里声称自己正看着某个页面,而人其实早就切走了。绑定负责记账,
表 3 负责报实况,两者不许混。

Ral 2026-09-14 逐字确认的三个例子(**这三条就是表 3 的验收用例**):

| 场景 | 表 3 的 `Active tab` |
|---|---|
| A、B 两个 tab 都绑 chat1,此刻激活 A | **A** |
| 同上,切到 B | **B** —— 同一条 chat1,上下文里的激活 tab 跟着人走 |
| 停在 A,把面板切到 chat2 | **A** —— chat2 的上下文里激活 tab 也是 A,因为人就在 A 上 |

第三行是这套口径的关键:**表 3 从不问"这条聊天绑了谁"**,它只报此刻前台是哪个 tab。
第一、二行则顺带证明了绑定是多对一的(#1),所以任何 `sessionId → tabId` 的反查都不成立。

**"chat 切换后动态调整提示词中对应的 tab 的信息"落在表 2。** 切会话 = W2/W3 改写了当前 tab 的绑定,
于是下一轮 system 槽位里这条会话对应的 tab 身份必须跟着变 —— 而这要求表 2 **不能是冻结的**(#4)。

## #4 拦路的事实:表 2 今天在建会话那一刻就冻住了

`BaseAgent.createSession()` 把 `systemPrompt: this.fullSystemPrompt()` **求值一次**传进去;
`src/main/agent/runtime/piRuntimeProtocol.ts:9` 的 loader 是:

```ts
export const createPiResourceLoader = (pi: PiModule, systemPrompt: string) => ({
  getSystemPrompt: () => systemPrompt,   // ← 闭包捕获的是一个字符串
  ...
})
```

pi 每一轮都会调 `_rebuildSystemPrompt()` → `getSystemPrompt()`,**口子本来就是通的**;
今天拿不到新值,纯粹是因为这里返回的是一个在建会话时就算好的常量。

**改法**:把第二个参数从 `string` 改成 `() => string`(或一个带 `systemPrompt` getter 的对象),
`getSystemPrompt: () => provide()`。`fullSystemPrompt()` 本来就是纯函数式的组装,
让它在每轮被调用一次即可 —— tab 清单与本会话绑定的 tab 都是现取。

改动面:`piRuntimeProtocol.ts` 一处签名 + `piRuntimeAdapter.ts:90` 一处调用点
+ `BaseAgent.createSession()` 传函数而不是值。**不新增状态、不改 pi、不动会话生命周期。**

## #5 代价:说清楚,不藏

把会变的东西放进 system 槽位,**会让整条缓存前缀在它变化时作废**
(`system → tools → 会话历史`,见 prompt-structure.html #2 原则①)。tab 清单变得很勤:
开/关 tab、每次导航改 `url`、页面自己改 `document.title` 都会动它。

这是 Ral 明确指定的落点(「所有打开了的 tab 信息也都得放到表 2」),不是推导出来的,**照做**。
但要把代价记在这儿,并按两条把损失压到最小:

1. **只放 `id` / `url` / `title` 三个字段**,不放 favicon、alias、loading、kind 之类 —— 每多一个
   会变的字段就多一个作废触发器。
2. **渲染成稳定顺序**(按 tab 条从左到右),不要按 Map 迭代序 —— 顺序抖动会造成"内容没变但字符串变了"
   的假作废。

如果日后实测缓存成本不可接受,退路是把清单降到表 3(它本来就每轮重发,不碰缓存前缀),
而不是把它砍掉。这条退路**现在不走**,记在这里是为了日后有人问"当时想过没有"。

## #6 表 2 里那一段长什么样

```
Open tabs (you can switch to any of these):
- <tabId> — <title> — <url>
- <tabId> — <title> — <url>
This chat is currently anchored to tab <tabId>.
```

- **`id` 必须给**,因为它是工具调用的入参 —— 给了 url 却不给 id,模型就只能靠 url 猜,
  而同一个 url 完全可以开两个 tab。
- mini-app / OnlyPreview 这类没有真实 `url` 的 tab,写它在地址栏里实际显示的那个串(`displayUrl`),
  与人看到的对齐;拿不到就写 `(no url)`,**不许编**。
- 最后那句 anchor 就是绑定在提示词里的唯一出口。当前 tab 未绑定 → 整句省略,不写 "none"。

## #7 验证

| 判据 | 怎么验 |
|---|---|
| G1 | 单测:连开 N 个 tab,`messageStore` 会话数不变 |
| G2/W1 | 单测:新建 tab 后 `binding[id] === 活跃会话 id` |
| G3/G4 | 单测:new chat 与 history switch 后,**只有当前 tab** 的绑定变了 |
| G5 | 既有守卫继续绿:`syncOperationTabs` 仍是空操作(加一条断言钉死它不许长出逻辑) |
| G6/G7 | 快照测:表 2 含全部 tab 三字段；表 3 含前台激活 tab 与独立的会话操作集合（见 2026-09-14 补充） |
| G8 | 单测:改绑定后再取 `getSystemPrompt()`,返回值**必须**已变 —— 这条直接钉死 #4 那个闭包不许退化回常量 |
| 持久化 | 重启恢复:绑定随 tab 回来;指向已删会话时读作未绑定且不抛 |

E2E 不跑(项目规则:Electron E2E 只在 Ral 当场要求时跑)。上面全部用单测与源码守卫覆盖。
