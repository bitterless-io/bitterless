# `ui_act` 拿着别的 tab 的 ref 点了当前 tab,还报成功

Status: 根因已证实(2026-09-24 会话审核 P1-01),修法已定，任务见文末

Paired with `micromeet-cowork`:`docs/issues/ui-act-refs-not-bound-to-tab.md`。

## 现象(2026-09-24 会话 `12d3vuy…`)

agent 在发票 tab 上拍了快照、读了 ref,随后 6 次 `ui_act` 都没带 `tab_id`,`activate_tab` 也指向 ChatGPT 那个 tab。
结果全部动作落在 ChatGPT tab 上(运行日志 15 次 `ui_act` 全记在 `tab-mudk1qys-2`):它按发票页的编号，两次点了 ChatGPT 设置里的「Data controls」,两次都 `ok:true`。
Ral 贴的那张「执行这个不可逆操作?click [data-coach-ref="e25"] … #settings/DataControls」审批卡片就出自这里。

## 根因(已证实)

1. **ref 与世代号不认 tab。** 世代号是每个页面自己的计数器(`<html data-coach-epoch>` 上 s1 → s2 …),ref 在任何一页都能「命中」某个元素。
   `ui_act` 只拿自己目标 tab 的世代号去比，比不出「这些 ref 是另一个 tab 的」。
2. **过期报错把当前世代号印了出来。** 报错写「页面现在是 s5」;agent 把 s5 抄进下一次调用，校验就放行了 —— 校验被它自己的提示绕过。
3. **`ok` 不说落在哪。** 结果只有 `{tag, id, name}`,看不出动作落在哪个 tab、哪个页面，agent 无从发现点错了。

证据:overmind `areas/agent-runtime/chat/audit-report/20260924-121036-12d3vuybr8oemuezgfot-review.md` P1-01;`browser-use-tools.html` #3.2(原先的推断，现已证实)。

## 修法(已定)

| 件 | 行为 |
|---|---|
| 世代号改由主进程分配 | 每拍一次快照，主进程发一个**全局递增**的号(不再由每个页面自己从 s1 数),写进页面，并记住「这个号是哪个 tab 拍的」。不同 tab 永远不会同号;页面刷新后页面上的号没了，旧 ref 一律作废 |
| `ui_act` 校验 | 带了 `snapshot` 时：号属于**别的 tab** → `ERROR: these refs come from the snapshot of tab <X>, but this call acts on tab <Y>. Pass tab_id="<X>" (or page_snapshot this tab and use its refs).`;号属于本 tab 但不是最新 → 说「过期，重拍一次」,**不再印出当前号** |
| 结果写明落点 | 成功的结果带上动作落在的 `tab_id`、页面标题和 URL(只到路径，不带查询串),agent 一眼能看出是否点错 |
| 不改 | `snapshot` 仍是可选(不带就不校验，老用法照旧);技能脚本走选择器，不受影响 |

关联：修好之后，同样的流程在「从未显示过的 agent 弹窗」上还会撞到已知的点击无效问题(`ui-act-on-background-tab-stalls-and-click-has-no-effect.md`),两者要一起验收。

## 验收

- 单测：两个 tab 各拍一次快照，拿 A 的 ref + A 的号去操作 B → 报错并点名 A;同一 tab 旧号 → 过期报错且不含当前号;刷新后旧号作废;成功结果带 tab / 标题 / 路径。
- 两边 typecheck。不跑 E2E;真实会话验收待 Ral。

任务:micromeet-cowork `docs/plan/tasks/ref-tab-binding-001.md` · bitterless `docs/plan/tasks/ref-tab-binding-200.md`(都排在 Decision Helper 之后)。
