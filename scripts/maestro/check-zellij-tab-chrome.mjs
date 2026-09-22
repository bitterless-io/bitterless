/* eslint-disable @typescript-eslint/explicit-function-return-type, no-regex-spaces --
   守卫脚本是 `.mjs`(没有类型标注),而这里的正则逐字匹配源码缩进,`  \}` 里那两个空格是**判据本身**
   ——写成 ` {2}\}` 只会让「我在匹配两级缩进的闭合花括号」这件事更难读。 */
// ══ 行为守卫 ══ Cowork 条上 Zellij tab 的两件事:关闭确认,与双击就地改名
//
// 契约:`docs/features/maestro-zellij-close-confirm.md`、`docs/features/zellij-tab-inline-rename.md`。
//
// 这里每一条钉的都是「漏了不报错」的坑 —— typecheck 看不见,视觉验收也只在某一个入口才复现:
//  ① 确认闸必须开在**范围算完之后、第一次 closeTab 之前**。开进 `closeTab` 里,一次
//     `Close other tabs` 关三个 Zellij 就弹三次(违反 G4),而且 agent 取页收尾、drill 分支回收
//     这些**程序发起**的关闭会挂在一个没人会看的对话框上(违反 G6)。两件事都不抛异常。
//  ② 人点的四个入口一个都不能漏:`×` / 右键 Close / Close others / Close right / Cmd+W。
//     漏一个的症状是「从这个入口关就不问」,而从另一个入口关又问 —— 最难被复现的那种。
//  ③ 覆盖层起不来时确认要**放行**。照抄别名那一路的「什么都不改」会让这扇窗里的 Zellij tab
//     再也关不掉,而且没有任何提示。
//  ④ 就地改名只给 Zellij,而且 main 侧要自己判一次:XPC 是独立入口,渲染层那一判不是保护。
//  ⑤ 编辑期间 chip 的拖拽与点击要让路,否则「选一段文字」会变成「把 tab 拖走」。
import { assert, readProject } from './_harness.mjs'

const BROWSER_VIEW = 'src/main/maestro/windows/main/maestroBrowserView.service.ts'
const ALIAS_VIEW = 'src/main/maestro/windows/main/maestroTabAliasView.service.ts'
const COACH_HANDLER = 'src/main/maestro/xpc/coach.handler.ts'
const CONTROLLER = 'src/main/maestro/windows/main/maestroWindow.controller.ts'
const TAB_STORE = 'src/renderer/maestro/home/src/components/MenuBar/tab.store.ts'
const MENU_BAR = 'src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue'
const TAB_ALIAS_API = 'src/shared/maestro/tabAlias.api.ts'

// 反向断言一律读去注释的源码:解释这条守卫为什么存在的注释本身会把它匹配红。
const codeOnly = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = (path) => codeOnly(readProject(path))

const browserView = read(BROWSER_VIEW)
const aliasView = read(ALIAS_VIEW)
const coachHandler = read(COACH_HANDLER)
const controller = read(CONTROLLER)
const tabStore = read(TAB_STORE)
const menuBar = read(MENU_BAR)

const slice = (source, pattern, what) => {
  const body = source.match(pattern)?.[0] ?? ''
  assert(body, `${what} — not found; this guard cannot check what it cannot slice`)
  return body
}

// ── ① 闸开在批量入口,不开在 closeTab 里 ───────────────────────────────────────────────────────
const closeTabsAsUser = slice(
  browserView,
  /private async closeTabsAsUser\([\s\S]*?\n  \}/,
  `${BROWSER_VIEW}: expected to find closeTabsAsUser()`
)
assert(
  /await this\.confirmCloseScope\(closable\)/.test(closeTabsAsUser),
  `${BROWSER_VIEW}: closeTabsAsUser must run the confirmation over the WHOLE set it is about to close before ` +
    'closing anything (maestro-zellij-close-confirm.md #1).'
)
assert(
  (closeTabsAsUser.match(/confirmCloseScope\(/g) || []).length === 1,
  `${BROWSER_VIEW}: exactly ONE confirmation per user close. Asking inside the close loop is the N-dialogs bug ` +
    'G4 exists to prevent — three Zellij tabs in range must still ask once.'
)
assert(
  closeTabsAsUser.indexOf('confirmCloseScope') < closeTabsAsUser.indexOf('for (const id of closable)'),
  `${BROWSER_VIEW}: the confirmation must precede the close loop — cancelling after the first tab is already gone ` +
    'is not a cancellation.'
)
// 先滤后问:`closeTab` 自己也拒 pinned 与「只剩一个」,但那是在**问完之后** —— 少了这一步,
// `Cmd+W` 停在一个 Zellij 主页上会弹确认,按了「关闭」却什么都不发生。
assert(
  /const closable = this\.tabs\.length > 1 \? ids\.filter\(/.test(closeTabsAsUser) &&
    closeTabsAsUser.indexOf('const closable') < closeTabsAsUser.indexOf('confirmCloseScope'),
  `${BROWSER_VIEW}: narrow the id set to what will ACTUALLY close (not pinned, not the last tab) BEFORE asking — ` +
    'otherwise Cmd+W on a pinned Zellij homepage asks a question whose answer changes nothing.'
)
for (const [method, pattern] of [
  ['closeTab', /async closeTab\(params: \{ id: string \}\): Promise<void> \{[\s\S]*?\n  \}/],
  ['performCloseTab', /private async performCloseTab\([\s\S]*?\n  \}/]
]) {
  const body = slice(browserView, pattern, `${BROWSER_VIEW}: expected to find ${method}()`)
  assert(
    !/confirmCloseScope|requestCloseConfirm/.test(body),
    `${BROWSER_VIEW}: ${method}() must stay silent. It is also called by the agent's fetch teardown, the drill ` +
      "branch reclaim, OnlyPreview's host swap and setAsHomepage — a dialog on that path hangs program code on a " +
      'question nobody is looking at (maestro-zellij-close-confirm.md #1).'
  )
}

// ── ② 人点的每一个入口都走闸 ───────────────────────────────────────────────────────────────────
for (const [what, pattern] of [
  ['the tab strip ×', /async closeTab\(params: \{ id: string \}\): Promise<void> \{\s*await maestroWindowHelper\.closeTabByUser\(params\)/]
]) {
  assert(pattern.test(coachHandler), `${COACH_HANDLER}: ${what} must route through closeTabByUser()`)
}
assert(
  /async closeTabByUser\(params: \{ id: string \}\): Promise<void> \{\s*await this\.browserView\.closeTabByUser\(params\)/.test(
    controller
  ),
  `${CONTROLLER}: closeTabByUser must exist and delegate — leaving only closeTab() means the × silently skips the ` +
    'confirmation.'
)
const closeActive = slice(
  browserView,
  /async closeActiveTab\(\): Promise<void> \{[\s\S]*?\n  \}/,
  `${BROWSER_VIEW}: expected to find closeActiveTab()`
)
assert(
  /closeTabByUser\(/.test(closeActive),
  `${BROWSER_VIEW}: Cmd+W closes a tab the operator is looking at — it is a user close and must ask.`
)
for (const [method, pattern] of [
  ['closeTabsExcept', /private async closeTabsExcept\([\s\S]*?\n  \}/],
  ['closeTabsToRight', /private async closeTabsToRight\([\s\S]*?\n  \}/],
  // Workbench chip 的两项批量关闭共用这一个范围。它也是人点的,所以同一道闸。
  ['closeClosableTabs', /private async closeClosableTabs\([\s\S]*?\n  \}/]
]) {
  const body = slice(browserView, pattern, `${BROWSER_VIEW}: expected to find ${method}()`)
  assert(
    /await this\.closeTabsAsUser\(/.test(body),
    `${BROWSER_VIEW}: ${method} must hand its id set to closeTabsAsUser — a bare close loop here is G2/G3 broken ` +
      '(the range, not the right-clicked tab, is the criterion).'
  )
  assert(
    !/await this\.closeTab\(/.test(body),
    `${BROWSER_VIEW}: ${method} must not close tabs itself — that path skips the confirmation entirely.`
  )
}
const tabMenu = slice(browserView, /async showTabMenu\([\s\S]*?\n  \}/, `${BROWSER_VIEW}: expected to find showTabMenu()`)
assert(
  /label: 'Close', enabled: canClose, click: \(\) => void this\.closeTabByUser\(/.test(tabMenu),
  `${BROWSER_VIEW}: the context menu's Close must go through closeTabByUser()`
)

// ── ③ 判据是 Zellij,而且覆盖层起不来时放行 ────────────────────────────────────────────────────
const confirmScope = slice(
  browserView,
  /private async confirmCloseScope\([\s\S]*?\n  \}/,
  `${BROWSER_VIEW}: expected to find confirmCloseScope()`
)
assert(
  /tab\.kind === MAESTRO_ZELLIJ_TAB_ID/.test(confirmScope),
  `${BROWSER_VIEW}: the criterion is "this close range contains a Zellij tab" — spelled with the shared id, not a ` +
    'literal that drifts when the spec id changes.'
)
assert(
  /if \(!terminals\.length\) return true/.test(confirmScope),
  `${BROWSER_VIEW}: no Zellij in range ⇒ return BEFORE touching the dialog seam. Every non-Zellij close must stay ` +
    'byte-for-byte what it was (G5).'
)
assert(
  /if \(!this\._state\.requestCloseConfirm\) \{[\s\S]*?return true/.test(confirmScope),
  `${BROWSER_VIEW}: a missing dialog seam must FAIL OPEN. Refusing instead would make every Zellij tab in this ` +
    'window unclosable from all three entries, with nothing on screen to explain it (#4).'
)
assert(
  /\.catch\(\([\s\S]{0,200}?return true\s*\}\)/.test(confirmScope),
  `${BROWSER_VIEW}: a throwing confirmation must also fail open, for the same reason.`
)
const requestConfirm = slice(
  aliasView,
  /requestCloseConfirm\(params[\s\S]*?\n  \}/,
  `${ALIAS_VIEW}: expected to find requestCloseConfirm()`
)
assert(
  /\{ confirmed: true, value: '' \}/.test(requestConfirm),
  `${ALIAS_VIEW}: the unavailable-layer fallback for the close confirmation is CONFIRMED. Copying the alias form's ` +
    '"change nothing" here is what locks the tab shut (#4).'
)
const requestAlias = slice(aliasView, /requestAlias\(params[\s\S]*?\n  \}/, `${ALIAS_VIEW}: expected to find requestAlias()`)
assert(
  /\{ confirmed: false, value: '' \}/.test(requestAlias),
  `${ALIAS_VIEW}: the alias form's fallback stays "change nothing" — the two dialogs degrade in OPPOSITE directions ` +
    'and neither may inherit the other.'
)
assert(
  /variant: 'closeConfirm'/.test(readProject(TAB_ALIAS_API)),
  `${TAB_ALIAS_API}: the overlay carries a discriminated dialog union; the close confirmation is one of its variants.`
)

// ── ④ 就地改名只给 Zellij,main 侧自己判一次 ───────────────────────────────────────────────────
const setTabAlias = slice(
  browserView,
  /async setTabAlias\([\s\S]*?\n  \}/,
  `${BROWSER_VIEW}: expected to find setTabAlias()`
)
assert(
  /tab\.kind !== MAESTRO_ZELLIJ_TAB_ID\) return/.test(setTabAlias),
  `${BROWSER_VIEW}: setTabAlias must refuse anything that is not a Zellij tab IN MAIN. XPC is an independent entry ` +
    'and any renderer can call it, while this one writes to settings and sqlite (zellij-tab-inline-rename.md #2).'
)
assert(
  /MAESTRO_TAB_INLINE_RENAME_MAX_LENGTH/.test(setTabAlias),
  `${BROWSER_VIEW}: setTabAlias must clamp to the INLINE limit — the 64-char form cap belongs to the overlay card, ` +
    'not to a chip whose width the strip already budgeted.'
)
// ── ⑤ 双击改名已撤回:这个手势不许回来 ─────────────────────────────────────────────────────────
//
// Ral 2026-09-22:「取消 tab 双击改名的功能,只能右击点击 alias 改名」。改名入口从此**只有**右键
// 菜单的 `Alias…`(tab-alias.md G1);Zellij chip 上那个双击口子连同整套就地编辑状态一起删了
// (zellij-tab-inline-rename.md 已标撤回)。
//
// 钉成**反向**断言,而不是删掉了事:这类手势最容易被"顺手加回来"(它看起来只是一行 `@dblclick`),
// 而加回来之后不会有任何测试变红 —— 就地编辑的每一处状态都得跟着回来才会有人发现。
assert(
  !/@dblclick/.test(menuBar),
  `${MENU_BAR}: tab chip 不许再绑 dblclick —— 改名只走右键 Alias…(Ral 2026-09-22 撤回双击改名)。`
)
for (const gone of ['isRenaming', 'renameDraft', 'renamingTabId', 'beginRename', 'commitRename', 'canRename']) {
  assert(
    !new RegExp(gone).test(tabStore) && !new RegExp(gone).test(menuBar),
    `${TAB_STORE} / ${MENU_BAR}: 就地改名已撤回,不该再出现 \`${gone}\` —— 要恢复的话先回到 ` +
      'docs/features/zellij-tab-inline-rename.md 看它为什么被撤回。'
  )
}

console.log('[check-zellij-tab-chrome] ok')
