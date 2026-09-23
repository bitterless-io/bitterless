# 去掉 `type: 'error'` —— 两仓的消息类型统一到 cowork

**状态：** 🔧 已实现，**待 Ral 人工验收**
**由来：** Ral 2026-09-22：「Cowork 与 BL 先统一一下，按更好的实现方式去做。我觉得 type error 是没有必要的，以 cowork 为准吧」。
**范围：** 仅 `bitterless`（cowork 本来就是目标形状，一个字没动）。

## 改了什么

`ChatMessage.type` 的枚举从 7 个收成 6 个，与 cowork 逐字相同：

```
'text' | 'files' | 'compact' | 'task' | 'confirm' | 'decision'
```

失败消息改用 cowork 的形状 —— `type: 'text'` + `error: true` + `promptExcluded: true`，
**由正文自己把失败说清楚**（cowork 既有写法就是把 detail 写进正文）。

随之删除：`ChatErrorCard` 接口、`MaestroChatMessage.errorCard` 落库字段、
`ChatErrorCard.vue` / `ChatErrorModal.vue`（含各自的 `.less`）、store 上的
`errorDetail` / `showErrorDetail` / `closeErrorDetail`、`ChatPanel` 里的弹窗挂载与
Escape 遮罩判据里的 `.chat-error-modal`。

**保留的是那条真正有价值的决定**：`pushErrorCard()` 仍然是所有失败路径的**唯一出口**
（Ral 2026-09-10：「需要统一的返回 error 的函数封装」）。`errorCard.service.ts` 也留着，
只是从「造一张卡」变成「拼一段正文」——`buildErrorCard` → `formatChatError`，
三段分工不变：第一行说是什么坏了、`— 副标题`说在哪一步、代码块放全文含栈。

## 一个要说清楚的取舍

卡片时代，几十行栈放在**弹窗**里，时间线上只占一行。现在没有弹窗了，全文只能进正文 ——
所以一条带栈的失败消息在时间线上会**比以前长**。两个选择里我选了留栈：

- 丢掉栈 = 这条消息退化成一行红字，而错误卡当初存在的理由之一就是「点开能看全」；
- 留着栈 = 气泡变长，但信息不丢，且与 cowork 的既有写法一致（它也是把 detail 直接写进正文）。

如果 Ral 更想要短气泡，下一步就是把 detail 收进一个折叠块或干脆只进日志 —— 一行改动。

## 老库兼容

库里已经存在的 `type: 'error'` 行**不迁移文件，在读回时归一**：
`type` 读成 `'text'`，正文为空时用那张卡的 `title` / `subtitle` / `detail` 拼回去
（`storedErrorText()`）。不做这一步的话，那些历史消息读回来是一个渲染不出的类型 —— 一条空白气泡。

## 验证

分面 `typecheck`：`main` 64 条、`renderer/maestro` 8 条，**与改动前逐条一致、零新增**
（过程中先出现过 4 条新错，都是我删得不干净：`isErrorRow` 的两处残留与两处类型引用，已修）。
**未跑 Electron / E2E**（仓库规则）。

## 文档

`overmind:areas/agent-runtime/chat/message-types.html` 的「Cowork 与 BL 之间的差异」一节
**已整节删除** —— 差异磨平之后留着它就是在描述一个不存在的分叉（Ral 同日指定）。
