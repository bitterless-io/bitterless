# Maestro 会话列表与未读蓝点

`status: 已实现`
`decided: 2026-09-09（Ral：「(ii) 照 cowork 建常驻会话列表再挂 —— 对齐最彻底」「以 cowork 为准就是蓝点」）`
`对齐来源: micromeet-cowork docs/features/cowork-multi-session.md #2 #3`

## 0. 先说清楚「常驻」在 cowork 里到底指什么

读完 cowork 的实现，它并**不是**一个常驻的侧边栏列表。它是两个部分：

| 部分 | 在哪 | 常驻吗 |
|---|---|---|
| **计数区块** —— Sessions 图标 + 未读角标 + 在跑计数 | 工具条那一行 | **常驻**，一直看得见 |
| **列表本体** —— 每行带转圈/蓝点 | Cmd+H 抽屉里 | 打开才看得见 |

这个划分是有道理的：未读的意义是「不看也知道」，所以**只有计数必须常驻**；一旦你要挑一个会话切过去，
那是一次明确的动作，抽屉就够了。全列表常驻会在 chat 面板里长期占掉一列宽度，
而 maestro control 面板本来就窄。

所以本次给 bl 加的「新 UI 区块」= **工具条上的计数区块**。bl 的 Cmd+H 抽屉已经存在，
只是把数据源从 `historySessions` 换成 `sessionListItems`，并给每行加上指示物。

## 1. 数据设计（照搬 cowork，键名换成 bl 的）

```
unreadSessionIds: string[]        // 持久化到 localStorage: 'bitterless.maestro.unreadSessions'
activeSessionId: string           // 由 channel.store 单向写入
markUnread(id) / markRead(id)
get sessionListItems(): SessionListItem[]
get runningSessionCount(): number
get unreadSessionCount(): number
```

`SessionListItem { id, title, preview, updatedAt, running, unread }`。

**排序三态互斥：`unread` → `running` → 已读**，段内按 `updatedAt` 倒序。
未读排在进行中之前的理由（cowork 的注释，照抄这个判断）：进行中的**还会自己回来找你**
（它结束时会变成未读），而未读是已经等着你、且没人会再提醒的那些。

**列表数据来自两处并合**：内存里活着的会话（带 `turn`，只有内存有）+ 库里的概要（标题/预览/时间）。
两处都遍历、用 `seen` 去重，否则「刚新建还没落库的会话不在列表里」。归档的不进列表。

### 为什么 `activeSessionId` 是 channel.store 单向写进来的

`channel.store` 已经 import 了 `message.store`。反向 import 会成环，而 `iocHelper.bind()`
的即时 `container.get` 会把环变成**启动崩溃** —— cowork 那侧在 `serviceBag.types.ts` 顶部记过同一个坑。
所以 `message.store` 不读 `channel.store`，由后者在切换时写入。

**2026-09-14 更新：两边均由独立的当前会话选择决定显示内容，不再按 operation tab 存会话。**
BL 原来的 `maestroSessionByTabId` 绑定已取消，见
[tab/chat 解耦](../issues/reference-link-tab-chat-tooltip.md)。`channel.store` 仍单向把实际显示的
会话写给 `message.store`，并在明确切换聊天时置读；普通浏览器 tab 更新不切会话、不新建会话。
BL 的 `activeSource === 'connector'` 分支仍返回 undefined，保留该分支原有的可见性语义。

连接器 tab 活跃时 `activeSessionId` 为空串，于是那时候结束的回合**会**置未读。
这是对的：人正看着 connector，那条结论他确实没看到。

## 2. 什么时候置未读

cowork 有两个触发点。**bl 只移植了第一个** —— 第二个在 bl 没有可挂的地方，理由见下：

1. **回合在它不是当前会话时结束** → 未读。
   条件是 `!wasAborted && (有正文 || 有文件)` —— 一次被停止、或失败到没有正文的回合置未读，
   只会让蓝点变成噪声。
2. ~~**补回来的结论**（cowork 的 `recoverReply`）→ 一定置未读。~~
   **这一条 bl 没有可挂的地方，没有移植。** bl 不存在 cowork 那条 lost-reply 恢复通道
   （全仓无 `recoverReply` / `delivery` 广播的对应物），bl 的 `finishFromMain` 直接委托给
   `finishReply`，所以触发点 1 已经覆盖它能覆盖的全部。等 bl 真的有了那条恢复通道再补。

### 转圈与蓝点可能同时成立 —— cowork 的注释在这点上说得过强

cowork 写「两者不会同时出现，因为回合结束的那一刻才置未读」。在 `finishReply` 里
`markUnread` 与 `session.turn = undefined` 之间没有 await，所以那一条路径上确实观察不到并存。
但**另一条路径可以**：一个已标未读的会话，被 main 广播/恢复出来的回合重新点着
（`applyAgentTurnUpdate`），此刻它 `running` 与 `unread` 同时为真。

处置照 cowork 的代码（不是照它的注释）：行内 `v-if running / v-else-if unread` ⇒
**显示转圈**（在跑是更强的信号），而排序按未读把它排最上。这是有意的，不是漏判。

置读只有一个地方：**切到那个会话时** `markRead`。物理删除会话时也顺手清掉它的未读，
否则那个 id 会永远留在 localStorage 里。

## 3. 蓝点用哪个蓝

**`#165dff` —— cowork 的那个蓝。** Ral 2026-09-09 两次裁决：「以 cowork 为准就是蓝点」，
随后「按你的建议修复」时确认取 cowork 色值。

我先前用的是 bl 自己的强调色 `#4e5882`（发送按钮那个），理由是「不想在同一面板里出现第二种蓝」。
**那个理由本身是错的** —— 换色时才发现 `ChatPanel.less` 里**早就有三处 `#165dff`**：
`chat-panel__workspace-action` 的 hover 色（434、462 行）与 workspace 控件的 focus-visible 描边（477 行）。
所以这个面板一直在用 cowork 的蓝，改成 `#165dff` 是让它**更**一致，不是引入新的冲突。

另一个我当时没想到的点：未读点要的正是**跳出来**。与发送按钮同色反而让它退进背景 ——
发送按钮是常驻的，眼睛已经把那个色学成「这里有个按钮」。

色值收成一个 Less 变量 `@session-unread-blue`，三处指示物（角标底、行内转圈描边、行内蓝点）共用。

在跑的转圈是**灰的**，这一点照 cowork：在跑是「还没到你」，未读才是「等你看」，
只有后者用强调色抢注意力。

未读角标压在 Sessions 图标边缘上，需要一圈白色分隔（`box-shadow: 0 0 0 2px #fff`）——
没有它两个深色形状会糊成一块。这是分隔手段而不是装饰边框。

## 4. 改了什么

| 文件 | 改动 |
|---|---|
| `store/message.type.ts` | 新增 `SessionListItem` |
| `store/message.store.ts` | 未读机制 + `sessionListItems` / `runningSessionCount` / `unreadSessionCount`；删除会话时清未读 |
| `store/channel.store.ts` | `syncActiveSession()`：写 `activeSessionId` + 切换时 `markRead` |
| `store/turn.service.ts` | 一处 `markUnread` 触发（回合在非当前会话结束时；cowork 的第二处 bl 无对应通道） |
| `ChatPanel.vue` | 工具条计数区块；抽屉行改用 `sessionListItems` 并加转圈/蓝点 |
| `ChatPanel.less` | 计数区块与行内指示物样式（BEM 扁平、`.less`、无边框） |
| `i18n/{en,zh}.ts` | 4 个新键（无硬编码文案）：`unreadSessions` / `runningSessions` / `sessionRunning` / `sessionUnread` |

## 5. 验证

排序与并合逻辑单独跑过 11 项断言（三态排序、段内倒序、未落库的新会话在列表里、
库与内存并合去重且取内存实时值、归档不进列表、双态排序取未读）—— 全过，脚本是一次性的、已清理。

`typecheck:web` 33 = 基线（零新增）、`typecheck:node` 0 错、`check:chat-composer` 绿、
`check:renderer-i18n` 绿。Electron E2E 未跑（项目规则：不自行发起）。

**未做真机验收** —— 角标偏移、抽屉行右侧指示物的位置这类目视几何，需要你看一眼。
一处已知的取舍：行右侧统一留 28px 给指示物（**所有行都留**），否则带指示物的那行文字会横向抖一下，
与左侧 20px 箭头位同理。
