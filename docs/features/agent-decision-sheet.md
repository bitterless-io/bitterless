# Decision sheet —— agent 需要人拍板时，唤起一张有选项的卡

**状态：** ✅ 已实现（两端）—— 2026-09-22，待人工验收
**提出：** Ral 2026-09-22
**范围：** chat 是共通功能 → **bitterless + micromeet-cowork 两端**（命名分别是 Maestro / Cowork）

## Ral 的原话

> 1. agent 让人做选择，这个只是对话消息最后一个步让人做选择
> 2. statusbar 转换成 waiting on you 这个容易给人困扰，需要一个内置技能 当前会话唤起一个
>    decision sheet 像 claude 那样，给用户选项，最后一个选项是包含 input 让人去输入自己其他的
>    决定的，有 submit 和 cancel 按钮

## 今天是什么样

**agent 要人选的时候，它只能把选项写进正文。** 一段散文问「你想要 A 还是 B」，回合就结束了；
人要在输入框里打字回答。没有可点的东西，选项之间没有结构，答案也不是结构化的。

已有的 `confirm` 卡**不是**这个东西，虽然看起来像：

| | 今天的 `confirm` | 要做的 decision sheet |
|---|---|---|
| 发起方 | **任务**（工具审批，带 `taskId`） | **agent 自己**，作为一次工具调用 |
| 选项数 | 恒为 2（`confirmLabel` / `cancelLabel`） | N 个 |
| 自由输入 | 无 | **最后一项带 input** |
| 答案形状 | `'confirm' \| 'cancel' \| 'elsewhere' \| 'expired'` | 选中项（或自由文本） |
| 语义 | 「这个动作准不准」 | 「这几条路走哪条」 |

契约见 cowork `src/shared/coworkChat.api.ts` 的 `CoworkChatConfirm`;bl 侧是同构的 `MaestroChatConfirm`。

## 必须继承的一条既有不变量

`confirm` 那套里有一条来之不易的规矩，decision sheet 必须照搬：

> **「有事等你」只有一个判据，卡片、状态条、会话列表「待确认」三处共用。**
> —— `message.store.ts:207 pendingConfirmMessages()`

它是被两次真实故障逼出来的（注释里记着）：

- 卡还没生成、状态条已经喊「等你确认」，而底下一个能点的地方都没有
  （`issues/tool-approval-has-no-clickable-button.md`）；
- 人点完之后答案落在卡上，但注册表里的 `pendingConfirm` 没清，状态条一直挂着，指向一个已经
  答过的问题。

所以判据落在**消息**上（未被回答的 `type: 'confirm'` 消息），不落在任务注册表上。
decision sheet 若另起一套自己的「待回答」判断，这两个故障会原样复发。

## 形状（待确认）

```
┌─ 这一步怎么走？ ───────────────────────────┐
│ ○ 先把索引重建完再继续                      │
│ ○ 跳过索引，直接跑                          │
│ ○ 其他： [____________________________]     │  ← 最后一项带输入框
│                              [取消] [提交]   │
└────────────────────────────────────────────┘
```

- 选中「其他」时输入框才可编辑；提交时它的文本就是答案。
- 提交 / 取消之后卡立即变为已回答，状态条与「待确认」同时消失（同一判据，自动成立）。

## 定案（Ral 2026-09-22：按建议 + 以 pi/claude 交互为准）

**先说一个核查结果：pi 没有这个机制。** 它的 7 个内置工具是 read / bash / edit / write / grep /
find / ls，全仓没有 elicit / ask-user 任何形态（查过 `dist/core/tools/` 与全量 grep）。
所以"以 pi claude 交互为准"落到实处就是：**照 Claude Code 的 `AskUserQuestion` 契约，
做成一个宿主工具** —— 这也正是本仓所有业务工具的既有形态（`AgentToolSpec` 经 `buildTools` 注入）。

| # | 定案 | 依据 |
|---|---|---|
| ① 阻塞 | **阻塞**。工具调用挂着不返回，直到人提交或取消；回合一直活着 | Claude 的 AskUserQuestion 即如此；也是"agent 卡在这里等一个决定"的字面含义 |
| ② 状态条 | **换措辞**，与工具审批分开 | 两件事后果差一个量级，今天却长得一样 |
| ③ 取消 | **「我不选」** —— 工具返回"用户取消了选择"，agent 自己决定怎么办；**不等于 Stop** | Claude 那边取消也只是把结果交回模型，不中止回合 |
| ④ 选择 | 单选 + **多选**都支持；`answer` 形状从一开始就是数组 | Claude 的 `multiSelect`；留成数组才不会有破坏性改动 |

### 契约（逐项对齐 Claude 的 AskUserQuestion）

```ts
interface AgentDecisionOption { label: string; description?: string }
interface AgentDecisionQuestion {
  header: string          // ≤ 12 字的短标签，卡片上做 chip
  question: string        // 完整问句
  multiSelect?: boolean
  options: AgentDecisionOption[]   // 2–4 项
}
// 一次最多 4 问
```

三条**必须照搬**的行为，它们不是装饰：

1. **「其他」由界面自动提供，调用方不许自己声明。** Claude 的 schema 里写得很直白
   （"There should be no 'Other' option, that will be provided automatically"）。
   让模型自己造一个"其他"，它就会把它写成一个普通选项，那一项点下去没有输入框。
2. **每个选项带 `description`。** 光有 label 的选项，人得靠猜；description 才是让人能选的那部分。
3. **选项 2–4 个、问题 1–4 个。** 上限不是小气：选项一多，这张卡就变成一份问卷，
   而它要解决的是"卡在这里的一步"。

### 取消的确切语义

工具返回一个**明确的取消结果**（不是异常、不是空），措辞让模型知道"人看见了、选择不回答"，
而不是"没人在"。它不清空回合、不中止任务 —— agent 读到之后自己决定是改问法、按默认走、还是停下来问别的。

## 原始的四个待定（已由上面定案取代，保留以备追溯）



### ① 它阻塞回合吗？——**这条决定其余一切**

- **阻塞（像 Claude 的 AskUserQuestion）**：agent 调用这个工具，工具调用**挂着不返回**，
  直到人提交；回合一直活着。好处是 agent 拿到答案可以继续往下走，不用重新起一轮、不用重建上下文。
  代价是要定超时（挂多久算放弃）、要能被 Stop 打断、要处理人关掉应用的情况。
- **不阻塞**：agent 发完卡就结束这一轮，人的答案作为**下一条 user 消息**进来。实现简单得多，
  但 agent 得靠上下文自己认出「这是对刚才那问的回答」，而它刚刚才因为提示词太长栽过跟头。

**我的建议：阻塞。** 这个功能的意义就是"agent 卡在这里等一个决定"，不阻塞的话它和现在
「写一段话问你」的区别只剩下好看。

### ② 状态条该显示什么

你说「waiting on you 容易给人困扰」。但卡片摆在眼前时，状态条**仍然要说点什么** ——
否则回合挂着而界面看上去像卡死了。三种写法：

| 写法 | 代价 |
|---|---|
| 沿用 `Waiting on you · <标题>` + `On the panel below` | 与工具审批**长得一样**，而这两件事后果差很远 |
| 换措辞，例如 `需要你选一下 · <问题>` | 要新文案（四语言），但语义分得开 |
| 不显示 | 回合挂着却没有任何提示 —— 不可取 |

我倾向第二种。**但"容易给人困扰"具体困扰在哪，我得听你说：**是措辞不对，还是它出现得太频繁，
还是它出现时你不知道该点哪里？这三者的修法完全不同。

### ③ 取消意味着什么

- **「我不选」** → agent 收到"用户拒绝选择"，自己决定怎么办（可能改问法、可能按默认走）；
- **「别干了」** → 等价于 Stop，整轮中止。

两种都合理，但对 agent 是完全不同的输入。

### ④ 单选还是也要多选

Claude 那个两种都支持。你描述的是单选（"最后一个选项是包含 input"），先只做单选可以，
但如果将来要多选，`answer` 的形状现在就得留成数组，不然是一次破坏性改动。

## 已实现（2026-09-22，两端）

| 落点 | bitterless | micromeet-cowork |
|---|---|---|
| 契约 | `src/shared/agentDecision.api.ts` | 同（逐字相同） |
| 挂起注册表 | `src/main/agent/decisionRegistry.service.ts` | 同 |
| 宿主工具 `ask_user` | `src/main/agent/tools/decisionTools.ts` | 同 |
| 工具表注册 | `maestroWindow.controller.ts` `buildPiTools()` | `mainWindow.controller.ts` 同名方法 |
| XPC | `coach.handler.ts` + `coach.api.ts` | `cowork.handler.ts` + `cowork.api.ts` |
| 判据 | `message.store.ts` `sessionAwaitsAnswer()` | 同 |
| 卡片 | `maestro/control/src/task/DecisionSheet.vue` | `control/src/task/DecisionSheet.vue` |
| 状态条 | `ResponseStatus.vue`，`needsYourCall` | 同，`Needs your call · {title}` |
| 文案 | `i18n/{en,zh}.ts` `maestroControl.chat.decision` | 四语言目录 |
| Stop 收尾 | `maestroAgent.service.ts` `abortAgent()` | `coworkAgent.service.ts` 同名 |

### 三处实现中才浮出来的决定

1. **不设超时。** 它等的是人，而人可能去开会了。超时会让 agent 收到一个"没人回答"的假事实
   并继续往下走 —— 那比一直等更糟。要停就按 Stop。
2. **Stop 必须调 `cancelSession()`。** 写了不调用等于没写：`ask_user` 阻塞，没人 resolve 那个
   工具调用就永远挂着，而它所在的回合早就没了 —— 一条谁也够不着的泄漏。守卫单独钉了这一条。
3. **先写卡、再发 XPC。** 判据是"卡上有没有答案"，所以答案一落卡，状态条与「待确认」立刻消失。
   反过来先等主进程回，那几十毫秒里状态条还在喊「等你」而人已经点完了 —— 正是
   `tool-approval-has-no-clickable-button` 记的第二种自相矛盾。

### 验证

`agentDecisionSheet.test.mjs` 两端各 **9 条**（契约越界报错、「其他」不许自带、挂起与重复回答、
Stop 收尾、取消返回明确措辞而非异常、工具说明写死阻塞语义、空的「其他」不能提交、
哨兵不漏给模型、挂在滚动容器之外）。

cowork：typecheck **0**、`check-i18n-keys` 309 keys × 4 语言绿、build 绿、周边守卫 46/46。
bitterless：typecheck web **29 → 25**、node 64（均为既有）、build 绿、守卫 18/18。

**未跑 Electron / E2E** —— 真实模型调用 `ask_user` 之后卡长什么样、点下去手感如何，要 Ral 验一次。
