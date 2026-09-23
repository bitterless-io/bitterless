# ask_user:答完之后屏幕上什么都不剩，多选事实上用不了

- **报告**：Ral 2026-09-23 ——「1. 需要 ask user 的 JSON schema 支持多选。2. Ask user 用户在选择
  答案之后，答案并没有渲染在 UI 上。应该将答案渲染在 UI 上，而且这应该是一个单独的渲染组件去
  渲染答案用的，可能需要为消息类型增加一个标识。」
- **状态**：根因已定（逐条定位到源码），修复见文末「修复契约」
- **功能契约**：[`docs/features/agent-decision-sheet.md`](../features/agent-decision-sheet.md)

## 问题 ①：答案没有落点 —— 答完就消失

**现象。** 人在拍板卡上选完、按提交，卡收起来，时间线上**什么都没有**。既看不到刚才被问了
什么，也看不到自己选了什么；滚回去也找不到。模型收到了答案并继续往下跑，而人这一侧没有任何
凭据 —— 「我刚才选的是哪个？」只能靠记。

**根因不是数据丢了，是没人画。** 三段代码各自都对，接缝上空了一块：

| 位置 | 现状 |
| --- | --- |
| `message.store.ts` `applyDecisions()` | 广播来的 decision **已经**投影成一条时间线消息：`type:'decision'` + `decision` 载荷 |
| `message.store.ts` `answerDecision()` | 人一答，`picked` / `cancelled` **已经**写回那条消息 |
| `MessageItem.vue` | 只有 `isTaskRow`(`type==='task'`) 与 `isConfirmRow`(`type==='confirm'`) 两个分支，**没有 `decision`** |
| `DecisionSheet.vue` | `v-if="decision && !answered"` —— 答完自己收起来（这是对的，它是底面的操作区） |

所以那条消息一直躺在 `session.messages` 里，`content` 是空串，走到 `showBubble` 那一支渲染成一个
空气泡。**留档那一半从来没有被实现过** —— 功能文档里写的「时间线留档、底面留操作」只兑现了后半句。

**为什么值得修。** 这张卡存在的理由是「这一步卡住了，需要人拍板」。一个卡住流程的决定，事后
查不到当时问的是什么、答的是什么，等于这次交互没有发生过。对照物很清楚：`confirm` 有
`ChatConfirm.vue` 在时间线里留档，`task` 有 `TaskPart`；`decision` 是三者里唯一没有的。

## 问题 ②：多选写在契约里，但事实上用不了

**字段是有的**，从上到下都接着：

- `AgentDecisionQuestion.multiSelect?: boolean`（`shared/agentDecision.api.ts`）
- `normalizeDecisionQuestions()` 读 `item.multiSelect === true` 并原样带下去
- `DecisionSheet.toggle()` 按它分单选 / 多选两条路

**坏在两头**：

1. **模型这一头：说明里只出现了一次 `"multiSelect": false`，还是写死在示例里的。** 工具说明
   通篇没有一句解释它是什么、什么时候该设成 true。一个模型读到的是「这个字段的值是 false」，
   不是「你可以把它设成 true」。对照 Claude 自己的 `AskUserQuestion`，那边明写着
   *"Use multiSelect: true to allow multiple answers to be selected for a question"* 和
   *"If multiSelect is true, phrase it accordingly"* —— 少的就是这两句。
2. **人这一头：卡上看不出来。** 单选和多选渲染得一模一样：同样一列按钮、同样的高亮。人没有
   任何线索知道自己可以点第二个，点了第二个又发现第一个没被取消，只能靠试。

**净效果**：这条能力从两侧都够不着 —— 模型不会开，人开了也不知道。

## 修复契约

**F1 · 时间线留档用一个独立组件画。** 新增 `DecisionRecord.vue`（与 `ChatConfirm.vue` 并列），
`MessageItem.vue` 增一个 `isDecisionRow` 分支。它画三态：

- **待答** —— 问题原文 + 「等你拍板」，操作仍然只在底面（避免两处都能点，前车之鉴
  `chat-duplicate-stop-bypasses-drill-confirm.md`）；
- **已答** —— 每一问的 header、问题、以及**选中的答案**；「其他」显示人打的原文；
- **已取消** —— 明说「你看到了这个问题并选择不回答」，与返回给模型的那句话同义。

**消息类型不需要新增标识** —— `type: 'decision'` 早就有了（`message.type.ts:52`、
`messageClass.ts:55`），缺的只是渲染分支。这里刻意不新造一个 `decision-answer` 类型：
同一次拍板的问与答是一条记录的两个阶段，拆成两条消息会让时间线出现一问一答两个条目，
而人回头找的是**那一次拍板**。

**F2 · 把多选说清楚，两头都说。**

- 工具说明补上 multiSelect 的语义与用法，逐句对齐 Claude 的 `AskUserQuestion`；
- 卡上多选的那一问显式标出「可多选」，并且选中态用可累加的记号，让「还能再点一个」看得见。

**F3 · 守卫。** 现有 `agentDecisionSheet.test.mjs` 只钉了契约校验与底面位置。补三条：
时间线分支存在且画的是答案、多选与单选的 toggle 语义、工具说明里有 multiSelect 的用法。

## 落点

| 文件 | 改动 |
| --- | --- |
| `renderer/**/task/DecisionRecord.vue` | 新增，时间线留档组件 |
| `renderer/**/MessageItem.vue` | `isDecisionRow` 分支；`showBubble` 排除它 |
| `renderer/**/task/DecisionSheet.vue` | 多选提示 + 可累加的选中记号 |
| `main/agent/tools/decisionTools.ts` | 说明补 multiSelect 语义 |
| i18n | 新增文案 |
| `tests/**/agentDecisionSheet.test.mjs` | 补 F3 三条 |

两仓同形（bitterless / micromeet-cowork 配对开发）。
