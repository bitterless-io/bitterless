# `page_snapshot` 不说「页面还在加载」,agent 把没加载完的弹窗当成打不开

Status: 已修 2026-09-24(code-verified,review `docs/plan/reviews/snapshot-loading-203-1.md` pass),真实会话验收待 Ral

Paired with `micromeet-cowork`:`docs/issues/page-snapshot-silent-while-loading.md`(现场与证据在那边;本文只写本仓的差异与落点，契约相同)。

## 现象

Cowork 会话 `id8zf8ma51mufa61wh`:页面弹出的发票 tab 还在加载(`loading:true`),两次 `page_snapshot` 都只有 1 个 `status` 元素，头部不说加载中;
agent 以为弹窗打不开，绕了约 48 秒。今天 09:37 的会话 `n6kpenpgltjmuev3a2u` 是同一症状。

## 本仓的情况(已核)

- **头部相同**:`src/main/maestro/drive/requestExec.service.ts` `toolPageSnapshot` 的 `composed` 数组同样只有 5 行头部 + 空行 + 正文，从不读加载状态。
- **范围略窄**:agent 调用都经 `requireAgentTab` → `warmAndLoad` → `startTabNavigation`,对本仓自己导航的 tab(`open_tab`、经 `openTabWithUrl`
  进来的弹窗)会等到第一次 did-finish-load。但点击触发的导航、子框架加载、之后的重新加载都不等，头部照样不说。
- **状态就在手边**:tab 的 `loading`(`list_tabs` 经 `describeAgentTab().status` 报的就是它)。本仓 `_state.activeTabId` 是前台 tab,所以只用
  调用传进来的 `tab`(agent 的作用域包装总会传 `tab_id`),没有 `tab` 就不加。

## 修法(已定，与 Cowork 相同)

- 被快照 tab 的 `loading` 为 true 时，在空行之后、快照正文(含 `# INCOMPLETE` 等 NOTE)之前加一行，文案与 Cowork **逐字相同**:
  `# LOADING: this tab is still loading, so the tree below may be incomplete. Wait a few seconds, then page_snapshot this tab again before concluding that anything is missing.`
- 不在加载中：输出逐字节不变。5 行头部不动(`snapshotSegment.ts` 的 `splitHead` 按 5 行切);带 `goal` 分段时这一行照样保留，且不加「applies to the FULL snapshot」后缀，其它 NOTE 照旧加(`snapshotSegment.ts`,与 Cowork 同改)。
- 快照不自己等;本仓 agent 有 `wait {ms}` 可用。
- 不治：已 load 完、SPA 还没渲染的页面(交给 BJ4,`docs/features/ui-act-wait-hover-jev.md` #3.1)。

## 验收

- 单测：对真实 `toolPageSnapshot`,tab `loading: true` → 有 `# LOADING:` 行且在头部与空行之后;`false` → 逐字节不变;带 `goal` 分段 → 仍在。
  `tests/maestro/maestroAgentBrowserSession.test.mjs` 的桩表已跟不上现在的 import(不在任何 package 脚本里，很可能已加载不了),
  以能真正跑起来的那套夹具为准(可参考 `tests/maestro/decisionMakerCard.test.mjs` 的成员夹具)。
- 两边 typecheck;已有快照相关测试不回归。不跑 E2E。

任务:`docs/plan/tasks/snapshot-loading-203.md` · micromeet-cowork `docs/plan/tasks/snapshot-loading-001.md`。
