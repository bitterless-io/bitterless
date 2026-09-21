#!/usr/bin/env node
// 历史记录行 = **后台**新 tab(docs/features/history-row-opens-background-tab.md #3.1 / #3.2)。
// Cowork 侧同构守卫:`apps/cowork/scripts/check-history-background-tab.mjs`,两份一起改。
//
// 为什么要一条源码守卫:这条契约的一半住在**主进程**,而主进程那半**没有可执行的回归网** ——
// renderer 的单测只能证明"它请求了 `background: true`",证明不了 main 真的照做。
// 2026-09-20 的独立 review 用变异实测过:把 `openTab` 里整个 `if (params.background)` 分支删掉,
// `maestroBrowserHistoryInput.test.mjs` 16 项全绿 —— 而那个变异体正是这次要去掉的旧行为。
//
// 钉的是形状,不是实现细节。少任何一条,症状都是**不报错的**:
//   · 少 return / 混进 activateTab → 人被拽走(旧行为回来了);
//   · 少 applyBounds            → 响应式页面按 0×0 布局;
//   · 少 broadcastTabs          → 慢站点上"点了历史记录,tab 条上什么都没发生";
//   · 判据落在 hide() 之后       → `entries` 已被清空,后台分支永远不成立,而所有断言照旧全绿。
import { assert, readMaestro, readProject } from './_harness.mjs'

/** 去掉行注释与块注释:断言里的 needle 不能被**注释里提到它**这件事喂饱。 */
const codeOnly = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * 方法体:从签名起,到同缩进的收尾 `\n  }` 为止。
 *
 * `startAfter` 给**参数表自己就是多行对象字面量**的方法用 —— 那个参数表的收尾会先命中,把方法体
 * 整段切没,而**反向断言**(`!body.includes(...)`)会因此静默变成永远为真。
 */
const methodBody = (source, marker, startAfter) => {
  const at = source.indexOf(marker)
  if (at < 0) return ''
  const from = startAfter ? source.indexOf(startAfter, at) : at
  if (from < 0) return ''
  const end = source.indexOf('\n  }', from)
  return end < 0 ? '' : source.slice(at, end)
}

const api = readMaestro('shared/coach.api.ts')
const view = readMaestro('main/windows/main/maestroBrowserView.service.ts')
const history = readMaestro('renderer/home/src/components/MenuBar/browserHistory.store.ts')
const menuBar = readMaestro('renderer/home/src/components/MenuBar/menuBar.store.ts')
const pkg = readProject('package.json')

// ── ① 契约参数要在共享 API 上 ────────────────────────────────────────────────────────────
assert(
  /openTab\(params: \{ url: string; background\?: boolean \}\)/.test(api),
  'shared/coach.api.ts: openTab 的参数要带 `background?: boolean`'
)

// ── ② main 侧:后台分支存在,且排在 activateTab **之前**并 return ─────────────────────────
const openTab = codeOnly(methodBody(view, '  async openTab(params: { url: string'))
assert(openTab.length > 0, 'maestroBrowserView.service.ts: 找不到 openTab 的方法体')
const branchAt = openTab.indexOf('if (params.background)')
const activateAt = openTab.indexOf('await this.activateTab(')
const returnAt = openTab.indexOf('return', branchAt < 0 ? 0 : branchAt)
assert(branchAt >= 0, 'maestroBrowserView.service.ts: openTab 缺 `if (params.background)` 分支')
assert(
  activateAt > branchAt && returnAt > branchAt && returnAt < activateAt,
  'maestroBrowserView.service.ts: 后台分支必须在 `await this.activateTab(` 之前 return —— 落到它上面就是旧行为'
)

// ── ③ 后台分支的三件事,一件都不能少;并且不许出现 activateTab ────────────────────────────
const background = openTab.slice(branchAt, activateAt)
for (const [needle, why] of [
  ['applyBounds', '建完的 slot 没摆过位置,零尺寸视口会让响应式页面按 0×0 布局'],
  ['this.broadcastTabs()', 'claimSpareTab 不播;不补这一下,chip 要等 loading 翻真才出现'],
  ['startTabNavigation', '后台 tab 也要真的把页面加载完']
]) {
  assert(background.includes(needle), `maestroBrowserView.service.ts: openTab 的后台分支缺 \`${needle}\` —— ${why}`)
}
assert(
  !background.includes('activateTab'),
  'maestroBrowserView.service.ts: openTab 的后台分支里不许出现 activateTab'
)

// ── ④ 新 tab 不许在出生瞬间被 warm cap 冷掉 ──────────────────────────────────────────────
// 冷掉之后 `startTabNavigation` 撞自己的存活闸静默返回:chip 在条上,永远不加载,一行日志都没有。
// 前台路径看不出来(activateTab 会重建 view),所以这个洞只在后台路径现形 —— 而后台路径没有
// 可执行的回归网。Cowork 侧 2026-09-21 才把同一个参数补上(它原来无参,新 tab 真的会被冷掉),
// 两仓现在同构。
// 断言锚在 `claimSpareTab` 体内,并且另钉一次 `enforceWarmCap` 自己把 `extraProtectedIds` 并进
// `protectedIds` —— 只做全文 grep 的话,调用点文本原地不动、而参数在被调方被改名/丢弃时,
// 保护会静默消失而守卫照旧全绿。
const claimSpare = codeOnly(methodBody(view, '  private async claimSpareTab('))
assert(claimSpare.length > 0, 'maestroBrowserView.service.ts: 找不到 claimSpareTab 的方法体')
assert(
  /enforceWarmCap\(\[tab\.id\]\)/.test(claimSpare),
  'maestroBrowserView.service.ts: claimSpareTab 必须把新 tab 传给 `enforceWarmCap([tab.id])` —— ' +
    '否则后台开出来的 tab 可能出生即被冷掉,永远不加载'
)
const warmCap = codeOnly(methodBody(view, '  private async enforceWarmCap('))
assert(
  /enforceWarmCap\(extraProtectedIds/.test(warmCap) && warmCap.includes('...extraProtectedIds'),
  'maestroBrowserView.service.ts: enforceWarmCap 要接受 `extraProtectedIds` 并把它并进 protectedIds'
)

// ── ⑤ renderer:判据取在 hide() 之前 ─────────────────────────────────────────────────────
const action = codeOnly(methodBody(history, '  async action('))
assert(action.length > 0, 'browserHistory.store.ts: 找不到 action() 的方法体')
const judgeAt = action.indexOf('const isHistoryRow')
const hideAt = action.indexOf("this.hide('accept')")
assert(judgeAt >= 0, 'browserHistory.store.ts: accept 分支缺 `isHistoryRow` 判据')
assert(
  hideAt > judgeAt,
  "browserHistory.store.ts: `isHistoryRow` 必须取在 `this.hide('accept')` **之前** —— " +
    'hide() 会清空 entries,放在它之后这条分支永远不成立,而所有既有断言照旧全绿'
)

// ── ⑥ 历史记录行一律后台开,且不碰 Workbench;复位排在 await 之前 ────────────────────────
const historyBranch = action.slice(action.indexOf('if (isHistoryRow)'), action.indexOf('await coach.backgroundWorkbenchTab()'))
assert(
  /coach\.openTab\(\{ url, background: true \}\)/.test(historyBranch),
  'browserHistory.store.ts: 历史记录行必须一律 `coach.openTab({ url, background: true })`'
)
assert(
  !historyBranch.includes('backgroundWorkbenchTab'),
  'browserHistory.store.ts: 历史记录行不许收起 Workbench —— 人要留在当前页'
)
const restoreAt = historyBranch.indexOf('this.restoreAddress?.()')
const awaitAt = historyBranch.indexOf('await coach.openTab(')
assert(
  restoreAt >= 0 && awaitAt > restoreAt,
  'browserHistory.store.ts: 要在 `await coach.openTab` 之前复位地址栏 —— 当前 tab 不导航,coach/nav 不会播'
)

// ── ⑦ 复位回调真的被 menuBarStore 注册了(方向固定:menuBar → history,反过来会成环) ─────
assert(
  /browserHistoryStore\.setAddressRestorer\(\(\) => \{ this\.url = stripScheme\(this\.activeTabUrl\) \}\)/.test(
    codeOnly(menuBar)
  ),
  'menuBar.store.ts: `bindAddressInput` 必须注册地址栏复位回调 —— 不注册的话 `restoreAddress?.()` ' +
    '是个静默 no-op,地址栏会留着查询词而页面没变'
)

// ── ⑧ Google 候选行刻意没改,仍走老分支 ──────────────────────────────────────────────────
assert(
  action.includes('await coach.backgroundWorkbenchTab()') && action.includes("active?.kind === 'browser'"),
  'browserHistory.store.ts: Google 候选行仍要走原来的 backgroundWorkbenchTab + kind 分支 —— ' +
    'Ral 2026-09-20 把范围只划到历史记录行'
)

// ── ⑨ 两类行按**身份**分流,不按 URL 文本 ────────────────────────────────────────────────
// 搜过一次 `cats`,结果页就被记进 browser_history;下次再输 `cats`,`candidateUrls` 的第 0 项
// (Google)与某条 entry 是同一个字符串。退回 `entries.some(...)` 就会把 Google 行误判成历史
// 记录行,#3.3 当场作废,而两类行的单测都各自照旧全绿。
const popupApi = readMaestro('shared/browserHistoryPopup.api.ts')
assert(
  /row\?: 'google' \| 'history'/.test(popupApi),
  'shared/browserHistoryPopup.api.ts: BrowserHistoryPopupAction 要带 `row?: \'google\' | \'history\'`'
)
const app = readMaestro('renderer/history/src/HistoryApp.vue')
assert(
  app.includes("historyStore.action('accept', historyStore.googleUrl, 'google')") &&
    app.includes("historyStore.action('accept', entry.url, 'history')"),
  "HistoryApp.vue: 两个 accept 按钮必须各自带上自己的 row('google' / 'history')"
)
assert(
  action.includes('action.row ??') && action.includes('this.rowKindAt('),
  'browserHistory.store.ts: accept 要先认 `action.row`,键盘回车再按 selectedIndex 推(rowKindAt)'
)

// ── ⑩ 守卫自己得挂在 package.json 上 ────────────────────────────────────────────────────
assert(
  pkg.includes('"check:history-background-tab": "node scripts/maestro/check-history-background-tab.mjs"'),
  'package.json 要暴露 check:history-background-tab'
)

console.log('[check-history-background-tab] ok')
