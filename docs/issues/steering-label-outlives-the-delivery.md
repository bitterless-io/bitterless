# steering 留痕在消息送达之后还挂着「已加入当前轮次」

**状态：** 🔧 已修，**待 Ral 人工验收**
**报告：** Ral 2026-09-22（在 `micromeet-cowork` 上看到的现场），「queue 也不该再显示了」
**配对：** `micromeet-cowork` `docs/issues/drill-continuation-hijacks-another-chat.md`
—— 那边还有一半是本仓**不存在**的缺陷，见下。

## 问题

回合内 steering 的留痕（`ResponseStatus.vue` 的 `steeringLabel`）有两态：投递中说
`addingToTurn`，送达后换成 `addedToTurn`（`已加入当前轮次 · N`），而后者会**一直挂到回合结束**。

回合可以在送达之后再跑很久 —— 钻探能跑几小时 —— 所以屏幕上那一行会长时间停在一个
**早就不成立**的状态。它要回答的问题（「我刚才那句话进去了没有」）在送达的那一刻就已经有答案了，
而更可靠的答案就在时间线上：那条人类消息不再是 `promptExcluded`。

## 修改

`steeringLabel` 只在 `pending` 时说话，送达后返回空串；随之删掉已无人引用的
`responseStatus.addedToTurn`（en/zh）。

```ts
return props.session.turn?.steering?.pending ? i18nHelper.maestroControl.responseStatus.addingToTurn : ''
```

## 本仓**没有**的那一半

姊妹仓那条缺陷的主因是 `DrillService.continueAfterTurn` 缺少归属判断：钻探是全局单例，
任何会话结束一轮都会替别人那轮钻探催进度、并且催到自己头上，于是回合迟迟不结束，
留痕也跟着一直挂着。**本仓早就有这道闸**：

```ts
// Ordinary chats may finish while another chat owns the singleton drill.
if (this.run.ownerSessionId !== params.sessionId) return reply
```

（`src/main/maestro/sitemap/drillTools.host.ts`）。核对属实，本次不动它 ——
按配对规则，另一仓已修好/本来就对的缺陷需要的是核实，不是为了对称再改一次代码。

## 验证

`typecheck`：`renderer/maestro` 的 8 条错全在 `TabAliasApp.vue` / `renderer/home`，与本次无关。
`tests/workflowUi/workflowActivityStatus.test.mjs` 有 1 条**先于本次改动**就失败的断言
（它按字面匹配旧的 `v-if="status || canRetry || …"`，而 `action` 行是更早一次状态条重构加的）——
陈旧守卫，不在本次范围内。**未跑 Electron / E2E**。
