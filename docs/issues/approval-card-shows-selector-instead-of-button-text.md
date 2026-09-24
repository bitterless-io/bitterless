# 审批卡片上的动作显示成选择器，而不是按钮上的字

Status: 根因已证实(2026-09-24 会话审核 P2-01),修法已定，随 `docs/features/decision-maker-naming-and-approval-card.md` #4 一起做

Paired with `micromeet-cowork`:`docs/issues/approval-card-shows-selector-instead-of-button-text.md`。

## 现象

`ui_act` 的不可逆闸弹出的审批卡片写着 `执行这个不可逆操作?click [data-coach-ref="e25"]`,人看不出点的是什么。
decision maker 拿到的也是这串选择器：在 ChatGPT 设置页点「Billing」这样的无害 tab,置信度只有 0.43,被当成「判不准」弹卡问人，人拒绝了。

## 根因(已证实)

`uiActGate.ts` 的 `describeUiAction` 用 `readText(selector)` 取元素上的字。`readText` 的实现是「有 `value` 属性就取 `value`,否则取 `textContent`」;
`<button>` 天生有 `value` 属性、默认是空串 → 返回空串 → 描述回落成选择器。

证据:overmind `areas/agent-runtime/chat/audit-report/20260924-121036-12d3vuybr8oemuezgfot-review.md` P2-01(运行日志里的卡片原文 + 源码 + jsdom 内存复现，
复现脚本 `tmp/review-session/readtext-repro.cjs`)。

## 修法(已定)

闸单独用一个取标签的读法：`aria-label` → 可见文字(`innerText`,规整空白)→ `value` → `title`,截 120 字。**不改 `readText`**:
技能脚本的 `page.read(sel)` 依赖它「输入框取值」的语义。
