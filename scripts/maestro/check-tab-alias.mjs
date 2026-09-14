// ══ 行为守卫 ══ Tab 别名(alias)与自定义固有 tab(Set as homepage)
//
// 契约:`docs/features/tab-alias.md`、`docs/features/custom-homepage-tab.md`。
//
// 这里每一条钉的都是「漏了不报错」的坑 —— typecheck 看不见,视觉验收也只在某一个入口才复现:
//  ① alias 是独立字段:它一旦出现在 `tab.title =` 的右边,就会被六个 title 写入方之一静默冲掉。
//  ② 落盘的四个环节缺一不可(DDL / 迁移 / DAO 三处列名 / 渲染层那个 `.map()`);漏 `.map()`
//     那一条尤其隐蔽 —— 一切正常,只是永远不落盘。
//  ③ 恢复要在 `openCompositeTab` **之后**补写:那条路径按 spec 盖 title,存下来的行它不看。
//  ④ 覆盖层的四条硬约束(不挂在子节点列表里 / 不 remove 再 add / 进两条摆位路径 / 取操作区矩形)。
//  ⑤ 安全谓词不许被功能改写:`isPinnedHomeTab` 仍然只认内置 Home,登出落地仍然无视自定义主页。
import { assert, readProject } from './_harness.mjs'

const BROWSER_VIEW = 'src/main/maestro/windows/main/maestroBrowserView.service.ts'
const CONTROLLER = 'src/main/maestro/windows/main/maestroWindow.controller.ts'
const ALIAS_VIEW = 'src/main/maestro/windows/main/maestroTabAliasView.service.ts'
const TAB_STORE = 'src/renderer/maestro/home/src/components/MenuBar/tab.store.ts'
const MENU_BAR = 'src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue'
const TABS_DAO = 'src/preload/maestro/sqlite/tabs.dao.ts'
const SQLITE_RELEASE = 'src/preload/maestro/sqlite/maestroSqlite.release.ts'
const TABS_API = 'src/shared/maestro/tabs.api.ts'
const COACH_API = 'src/shared/maestro/coach.api.ts'

// 反向断言一律读去注释的源码:解释这条守卫为什么存在的注释本身会把它匹配红。
const codeOnly = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = (path) => codeOnly(readProject(path))

/**
 * 「A 必须排在 B 前面」——先确认 A **真的在**。
 *
 * 裸写 `indexOf(a) < indexOf(b)` 会**失败开**:删掉 a 之后 `-1 < n` 恒真,这条守卫从此永远绿,
 * 而它要钉的那件事已经没了。顺序断言里最容易被删掉的恰恰是靠前的那个锚点。
 */
const assertOrder = (haystack, earlier, later, message) => {
  assert(haystack.includes(earlier), `${message} — missing anchor: ${earlier}`)
  assert(haystack.includes(later), `${message} — missing anchor: ${later}`)
  assert(haystack.indexOf(earlier) < haystack.indexOf(later), message)
}

const browserView = read(BROWSER_VIEW)
const controller = read(CONTROLLER)
const aliasView = read(ALIAS_VIEW)
const tabStore = read(TAB_STORE)
const menuBar = read(MENU_BAR)
const tabsDao = read(TABS_DAO)
const sqliteRelease = read(SQLITE_RELEASE)

// ── ① alias 是独立字段,永远不写进 title ────────────────────────────────────────────────────────
for (const [path, source] of [
  [TABS_API, read(TABS_API)],
  [COACH_API, read(COACH_API)],
  [BROWSER_VIEW, browserView]
]) {
  assert(/\balias\?: string/.test(source), `${path}: alias must be its own declared field`)
}
for (const [path, source] of [[BROWSER_VIEW, browserView], [TAB_STORE, tabStore]]) {
  assert(
    !/(?:tab|current|t)\.title\s*=\s*[^\n]*alias/.test(source),
    `${path}: an alias must never be assigned into a title — six writers overwrite title without asking, ` +
      'and every one of them would silently wipe the name the operator typed (tab-alias.md #1).'
  )
}

// ── ② 落盘四环 ─────────────────────────────────────────────────────────────────────────────────
assert(
  /CREATE TABLE IF NOT EXISTS tabs[\s\S]*?alias TEXT NOT NULL DEFAULT ''/.test(sqliteRelease),
  `${SQLITE_RELEASE}: CREATE_TABS must declare the alias column — without it a FRESH install has no column at all.`
)
assert(
  /addMaestroColumnIfMissing\(db, 'tabs', 'alias'/.test(sqliteRelease),
  `${SQLITE_RELEASE}: a registered migration must add the alias column with addColumnIfMissing — CREATE_TABS covers ` +
    'a fresh install, this covers an upgrade, and shipping only one of the two breaks exactly half of the installs.'
)
const aliasColumnSites = [
  [/interface TabRow \{[\s\S]*?\balias: string/, 'the TabRow interface'],
  [/SELECT [^']*\balias\b[^']*FROM tabs/, 'the SELECT column list'],
  [/INSERT INTO tabs \([^)]*\balias\b[^)]*\)/, 'the INSERT column list']
]
for (const [pattern, what] of aliasColumnSites) {
  assert(
    pattern.test(tabsDao),
    `${TABS_DAO}: ${what} must name \`alias\`. The column list is hand-written in three places here — miss the ` +
      'SELECT and it reads back undefined, miss the INSERT and it writes the default. Neither one throws.'
  )
}
const persistMap = tabStore.match(/private persistSoon\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? ''
assert(
  /alias/.test(persistMap),
  `${TAB_STORE}: persistSoon() maps reactive rows to plain literals for XPC — a field missing from THAT map ` +
    'silently never persists, with no error anywhere.'
)

// ── ③ 恢复:alias 必须在 openCompositeTab 之后补写 ──────────────────────────────────────────────
const restoreBody = browserView.match(/async restoreTabs\([\s\S]*?\n  \}/)?.[0] ?? ''
assert(restoreBody, `${BROWSER_VIEW}: expected to find restoreTabs()`)
assertOrder(
  restoreBody,
  'await this.openCompositeTab(',
  '.alias = tab.alias',
  `${BROWSER_VIEW}: restoreTabs must re-apply the saved alias AFTER openCompositeTab returns — that path stamps ` +
    "spec.title and ignores the saved row entirely, so a composite tab's alias does not come back without it."
)
assert(
  /addTab\(\{ url: tab\.url[^)]*alias: tab\.alias/.test(restoreBody),
  `${BROWSER_VIEW}: a restored web tab must carry its alias into addTab()`
)

// ── ④ 覆盖层四条硬约束 ─────────────────────────────────────────────────────────────────────────
assert(
  !/removeChildView\([\s\S]{0,200}?addChildView\(/.test(aliasView),
  `${ALIAS_VIEW}: never removeChildView-then-addChildView to raise this overlay. addChildView on a child that is ` +
    'ALREADY attached is a reorder; detaching first takes the "newly attached" path, and a view that has not been ' +
    'painted yet sinks to the bottom on macOS — the dialog opens and you cannot see it (tab-alias.md #2.1).'
)
const attachBody = aliasView.match(/private attach\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? ''
assert(attachBody, `${ALIAS_VIEW}: expected to find attach()`)
for (const gate of ['closed', 'unloaded', 'bounds']) {
  assert(
    attachBody.includes(`'${gate}'`),
    `${ALIAS_VIEW}: attach() must name the '${gate}' gate. An unloaded transparent full-rect view left in the child ` +
      'list is an invisible click-and-keystroke sink, and "the dialog is behind something" vs "it was never attached" ' +
      'is otherwise pure guesswork.'
  )
}
assert(
  /private detach\(\): void \{[\s\S]*?removeChildView\(/.test(aliasView),
  `${ALIAS_VIEW}: the overlay must leave the child list when no dialog is open`
)
const applyContentBounds = controller.match(/private applyContentBounds\([\s\S]*?\n  \}/)?.[0] ?? ''
const layoutBody = controller.match(/\n  layout\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? ''
for (const [body, where] of [[applyContentBounds, 'applyContentBounds()'], [layoutBody, 'the first-frame layout() fallback']]) {
  assert(
    /tabAliasView\.setBounds\(content\)/.test(body),
    `${CONTROLLER}: ${where} must position the alias overlay on the OPERATION rect. Miss the first-frame fallback and ` +
      'the first dialog is 0×0; use the window rect instead and the control sidebar is unclickable while it is open.'
  )
}
assert(
  !/tabAliasView\.setBounds\(control\)/.test(controller),
  `${CONTROLLER}: the alias overlay is bounded to the operation rect, never the control rect`
)

// ── ⑤ 安全谓词与登出落地不许被这个功能改写 ─────────────────────────────────────────────────────
assert(
  /private isPinnedHomeTab\(tab\?: OperationTab\): boolean \{\s*return Boolean\(tab\?\.pinned && tab\.kind === 'home'\)/.test(
    browserView
  ),
  `${BROWSER_VIEW}: isPinnedHomeTab must keep meaning "the BUILT-IN Home tab". It guards preventPinnedHomeEscape, the ` +
    "ensureWarm home branch and buildPinnedHomeView's first-party preload — a custom homepage is a composite mini app " +
    'and must inherit none of them (custom-homepage-tab.md #1).'
)
assert(
  /private isDefaultHomeTab\(tab\?: OperationTab\): boolean/.test(browserView),
  `${BROWSER_VIEW}: "is this the DEFAULT homepage" needs its own predicate — that, not isPinnedHomeTab, is the ` +
    'criterion for the Alias / Restore-default menu items.'
)
const menuBody = browserView.match(/async showTabMenu\([\s\S]*?\n  \}/)?.[0] ?? ''
assert(menuBody, `${BROWSER_VIEW}: expected to find showTabMenu()`)
assert(
  /const canAlias = !this\.isDefaultHomeTab\(tab\)/.test(menuBody),
  `${BROWSER_VIEW}: Alias… is enabled unless the tab is the DEFAULT pinned Home tab — a user-chosen homepage CAN be ` +
    'aliased (Ral 2026-09-14), so the criterion is not `!tab.pinned`.'
)
for (const [label, why] of [
  ["'Alias…'", 'the rename entry'],
  ["'Set as homepage'", 'the homepage entry'],
  ["'Restore default homepage'", 'the restore entry']
]) {
  assert(
    menuBody.includes(`label: ${label}`),
    `${BROWSER_VIEW}: showTabMenu must offer ${why} ${label}`
  )
  // 直接拼进正则,不转义 —— 上面三个 label 逐字都没有正则元字符(`…` 是普通字符)。
  // 这里原本挂着一个 `label.replace(/[.*+?^${}()|[\\]\\\\]/g, …)`,那个字符类在 `\\]` 处就闭合了,
  // 实际是个**不做任何事**的 no-op:与其留一段假装在转义的死代码,不如把「为什么不需要」写清楚。
  // 将来 label 里真出现元字符,就在这里补一个真的转义。
  assert(
    new RegExp(`label: ${label},[\\s\\S]{0,80}enabled:`).test(menuBody),
    `${BROWSER_VIEW}: ${label} must be DISABLED rather than hidden when it does not apply — "why can't I click this" ` +
      'has to be visible, same discipline as the page-type menu.'
  )
}
assert(
  /const canSetHome = !tab\.pinned && Boolean\(getMaestroCompositeTab\(tab\.kind\)\)/.test(menuBody),
  `${BROWSER_VIEW}: only a registered composite mini app can become the homepage. Any remote web page in that slot ` +
    'turns every kind-keyed protection into a bug, two of them security-grade (custom-homepage-tab.md #1).'
)
const prepareForAuthShutdown = controller.match(/async prepareForAuthShutdown\(\): Promise<void> \{[\s\S]*?\n  \}/)?.[0] ?? ''
assert(
  /this\.tabs\.find\(\(tab\) => tab\.pinned\)/.test(prepareForAuthShutdown),
  `${CONTROLLER}: the pre-teardown activation must find the pinned tab by \`pinned\` ALONE. With a custom homepage ` +
    "there is no `kind === 'home'` tab on the strip at all, so a kind-filtered find returns undefined, the step is " +
    'silently skipped, and the teardown frame reveals whatever was on screen.'
)
assert(
  !/kind === 'home'/.test(prepareForAuthShutdown),
  `${CONTROLLER}: do not re-narrow the pre-teardown activation to the built-in Home. A8 ("logout lands on the local ` +
    'Home") is enforced by the NEXT boot — forcePinnedHomeIntentVersion plus the forcePinnedHomeBoot() branch in ' +
    'createPinnedHomeTab — not by which tab happens to be foreground while the window is being destroyed.'
)
const createPinnedHome = browserView.match(/createPinnedHomeTab\(\): WebContentsView \| null \{[\s\S]*?\n  \}/)?.[0] ?? ''
assert(createPinnedHome, `${BROWSER_VIEW}: expected to find createPinnedHomeTab()`)
assert(
  /forcePinnedHomeBoot\?\.\(\)[\s\S]{0,80}resolveHomeCompositeId\(\)/.test(createPinnedHome),
  `${BROWSER_VIEW}: the forced pinned-Home boot (logout / auth teardown) must IGNORE the custom homepage — otherwise ` +
    'signing out lands the operator inside a mini app instead of the first-party login gate.'
)
assert(
  /getMaestroCompositeTab\(id\) \? id : null/.test(browserView),
  `${BROWSER_VIEW}: resolveHomeCompositeId must fail CLOSED on an id the registry does not know (downgrade, rename, ` +
    'dirty data) — the pinned slot falls back to the built-in Home rather than coming up empty.'
)

// ── ⑥ 显示端:alias 优先于 home 短路 ───────────────────────────────────────────────────────────
const tabLabel = menuBar.match(/function tabLabel\(tab: TabInfo\): string \{[\s\S]*?\n\}/)?.[0] ?? ''
assert(tabLabel, `${MENU_BAR}: expected to find tabLabel()`)
assertOrder(
  tabLabel,
  'alias',
  "tab.kind === 'home'",
  `${MENU_BAR}: tabLabel() must prefer the alias BEFORE the fixed-Home short-circuit — a custom homepage is a pinned ` +
    'mini-app tab that is allowed to have one, and that short-circuit never reads the title at all.'
)
assert(
  /alias\?\.trim\(\)/.test(tabLabel),
  `${MENU_BAR}: a whitespace-only alias is no alias — "clear and save" must fall back to the page title (G4).`
)

// ── ⑦ 固有槽位的身份与别名:pinned tab 不进 SavedTab,设置是唯一落脚点 ─────────────────────────
//
// 这一组钉的是一件容易被看成「已经做完了」的事:自定义主页写了 `homeCompositeId` 就能重启存活
// —— 但那只还原了「装谁」。`tab.store.ts` 的 `isRestorableComposite` 要求 `!t.pinned`(那条过滤
// **不许放松**:放松了固有 tab 会在启动时被 restore 再开一份),所以固有槽位那个 tab 的
// `instanceId` 与 `alias` 一个字都不会落到 tabs 表里。少存 `instanceId` ⇒ 设主页时装在里面的那条
// Zellij 会话下次启动既不被接管也不被关掉(每设一次主页留一条孤儿);少存 `alias` ⇒ 用户起的
// 名字静默消失,而 `Set as homepage` 还顺手关掉了旧 Home tab,连第二份副本都没有。
const settingsService = read('src/main/maestro/settings/coachSettings.service.ts')
for (const field of ['homeInstanceId', 'homeAlias']) {
  assert(
    new RegExp(`${field}\\?: string`).test(read(COACH_API)),
    `${COACH_API}: the pinned slot's ${field} must be part of the settings contract — a pinned tab never reaches the ` +
      'tabs table, so anything about it that is not in the settings simply does not survive a restart.'
  )
  assert(
    new RegExp(`homeCompositeId && ${field} \\? \\{ ${field} \\} : \\{\\}`).test(settingsService),
    `coachSettings.service.ts: ${field} must be normalized TOGETHER WITH homeCompositeId — orphaned, it would be ` +
      "picked up by the NEXT custom homepage, handing it the previous one's live session or name."
  )
}
assert(
  /!t\.pinned/.test(tabStore),
  `${TAB_STORE}: isRestorableComposite must keep requiring \`!t.pinned\`. The pinned slot is rebuilt from the SETTING ` +
    'at boot; persisting it too would restore a second copy of the same mini app beside it.'
)
const setAsHomepage = browserView.match(/private async setAsHomepage\([\s\S]*?\n  \}/)?.[0] ?? ''
assert(setAsHomepage, `${BROWSER_VIEW}: expected to find setAsHomepage()`)
assert(
  /homeInstanceId: tab\.instanceId \|\| ''/.test(setAsHomepage),
  `${BROWSER_VIEW}: setAsHomepage must record the promoted tab's ACTUAL instanceId. Writing the sha-derived id ` +
    'instead leaves the session that was in the slot at promotion orphaned — never reattached, never closed.'
)
assert(
  /homeAlias: tab\.alias \|\| ''/.test(setAsHomepage),
  `${BROWSER_VIEW}: setAsHomepage must carry the tab's current alias into the setting (tab-alias.md G5).`
)
const createPinnedHomeSlot = browserView.match(/private readHomeCompositeSlot\([\s\S]*?\n  \}/)?.[0] ?? ''
assert(createPinnedHomeSlot, `${BROWSER_VIEW}: expected to find readHomeCompositeSlot()`)
assert(
  /instanceId \|\| this\.homeCompositeInstanceId\(id\)/.test(createPinnedHomeSlot),
  `${BROWSER_VIEW}: the sha-derived instance id survives ONLY as the fallback for a setting written before ` +
    'homeInstanceId existed. Make it the primary again and every promotion orphans a session.'
)
assert(
  /settings\?\.homeAlias/.test(createPinnedHomeSlot) && /alias \? \{ alias \}/.test(createPinnedHomeSlot),
  `${BROWSER_VIEW}: readHomeCompositeSlot must read the alias back as well as the instance id. Returning only the ` +
    'id is the half-done shape that leaves the name lost at every restart with nothing to notice.'
)
const buildPinnedComposite = browserView.match(/private buildPinnedCompositeTab\([\s\S]*?\n  \}/)?.[0] ?? ''
assert(buildPinnedComposite, `${BROWSER_VIEW}: expected to find buildPinnedCompositeTab()`)
assert(
  /instanceId: slot\.instanceId/.test(buildPinnedComposite) &&
    /slot\.alias \? \{ alias: slot\.alias \}/.test(buildPinnedComposite),
  `${BROWSER_VIEW}: the pinned composite tab must be rebuilt from readHomeCompositeSlot() — both halves. Reading ` +
    'back only the id is exactly the half-done state this section exists to catch.'
)
assert(
  /this\.buildPinnedCompositeTab\(compositeId\)/.test(createPinnedHome),
  `${BROWSER_VIEW}: createPinnedHomeTab must build the composite slot through buildPinnedCompositeTab() — the restore ` +
    'path builds the same shape, and a second hand-written copy drifts the first time the slot gains a field.'
)
const restoreDefault = browserView.match(/private async restoreDefaultHomepage\([\s\S]*?\n  \}/)?.[0] ?? ''
assert(restoreDefault, `${BROWSER_VIEW}: expected to find restoreDefaultHomepage()`)
assert(
  (restoreDefault.match(/homeCompositeId: '', homeInstanceId: '', homeAlias: ''/g) || []).length === 1,
  `${BROWSER_VIEW}: restoreDefaultHomepage must clear all three settings ONCE, ahead of every branch — a leftover ` +
    'instance id or alias is inherited by the next custom homepage, and a per-branch copy loses one of them.'
)
assertOrder(
  restoreDefault,
  "homeCompositeId: ''",
  'this.resolveHomeCompositeId()',
  `${BROWSER_VIEW}: restoreDefaultHomepage must clear the setting BEFORE asking who the default is — asking first ` +
    'answers with the custom homepage that is being restored away, and the slot lands back on itself.'
)
const promptAlias = browserView.match(/private async promptTabAlias\([\s\S]*?\n  \}/)?.[0] ?? ''
assert(promptAlias, `${BROWSER_VIEW}: expected to find promptTabAlias()`)
assert(
  /current\.pinned\) this\._state\.saveMaestroSettings\?\.\(\{ homeAlias/.test(promptAlias),
  `${BROWSER_VIEW}: renaming the tab that is ALREADY the homepage must write homeAlias too — persisting only at ` +
    'promotion loses every rename done afterwards, silently, at the next launch.'
)

// ── ⑧ 装不起来的自定义主页要有兜底,缺一列不能丢整条 tab 条 ────────────────────────────────────
const loadPinnedHome = browserView.match(/async loadPinnedHomeTab\(\): Promise<void> \{[\s\S]*?\n  \}/)?.[0] ?? ''
assert(loadPinnedHome, `${BROWSER_VIEW}: expected to find loadPinnedHomeTab()`)
assert(
  /catch \(err\) \{[\s\S]*?this\.demotePinnedTabToLocalHome\(tab\)/.test(loadPinnedHome),
  `${BROWSER_VIEW}: a homepage mini app that refuses to mount must fall back to the built-in Home for that boot. ` +
    'Zellij legitimately refuses while the Terminal switch is off; rethrowing leaves a contentless pinned tab AND ' +
    'skips openStartupTabIfNeeded, which hangs off the same promise (custom-homepage-tab.md A6: 不崩、不空条).'
)
assert(
  !/saveMaestroSettings/.test(loadPinnedHome),
  `${BROWSER_VIEW}: the boot fallback must NOT rewrite the setting — the refusal is usually recoverable (turn the ` +
    'Terminal switch back on), so the next launch has to try the custom homepage again.'
)
// Presence of the two strings is NOT enough: a later "simplify this branch away" that hard-codes the
// with-alias side (`const rows = db.prepare('SELECT … alias …')`) leaves both strings in the file and
// keeps a presence-only assertion green. So slice each method and require the DEGRADE PREDICATE to be
// consulted inside it — that is the thing whose removal reintroduces the bug.
const listAllBody = tabsDao.match(/async listAll\(\)[\s\S]*?\n  \}/)?.[0] ?? ''
const replaceAllBody = tabsDao.match(/async replaceAll\([\s\S]*?\n  \}/)?.[0] ?? ''
assert(listAllBody, `${TABS_DAO}: expected to find listAll()`)
assert(replaceAllBody, `${TABS_DAO}: expected to find replaceAll()`)
assert(
  /this\.hasAliasColumn\(\)/.test(listAllBody),
  `${TABS_DAO}: listAll must CONSULT hasAliasColumn(), not merely have a fallback SELECT sitting nearby — ` +
    'a hard-coded with-alias read keeps the fallback string in the file and sails past a presence-only check.'
)
assert(
  /this\.hasAliasColumn\(\)/.test(replaceAllBody),
  `${TABS_DAO}: replaceAll must CONSULT hasAliasColumn() too. A throwing INSERT is swallowed by the debounced ` +
    '`.catch()`, so the strip silently stops being saved at all — worse than losing just the aliases.'
)
assert(
  /PRAGMA table_info\(tabs\)/.test(tabsDao) && /'SELECT url, title, favicon, position, kind, instance_id FROM tabs/.test(tabsDao),
  `${TABS_DAO}: listAll must tolerate the alias column being ABSENT. runSqliteMigrations stamps a fresh DB with the ` +
    "BUILD's version_code and runs nothing, so a local build packaged before the alias column existed — but with a " +
    'LATER version_code — creates a database the alias migration will skip forever. The renderer swallows the read ' +
    'error with `.catch(() => [])`, turning one missing column into a silently empty tab strip on every launch.'
)

// ── ⑨ 默认固有 tab:默认值来自 registry,而「设过没设过」是三个判据的依据 ──────────────────────
//
// 契约:`docs/features/onlypreview-default-homepage.md`。
// 三条都是「改了默认值却漏了下游」的形状,而且都不报错:菜单项恒亮、名字改完就丢、
// 还原之后这一发与下一次启动两种说法。
const COMPOSITE_REGISTRY = 'src/main/maestro/windows/main/compositeTab.registry.ts'
const ONLY_PREVIEW_TAB = 'src/main/windows/onlyPreviewCoworkTab.ts'
const compositeRegistry = read(COMPOSITE_REGISTRY)
const onlyPreviewTab = read(ONLY_PREVIEW_TAB)
assert(
  /defaultHome\?: boolean/.test(read('src/shared/maestro/compositeTab.api.ts')),
  'src/shared/maestro/compositeTab.api.ts: "which mini app is the default homepage" belongs on the SPEC, beside ' +
    "`singleton` / `restorable` — check:maestro's alias boundary forbids Maestro from knowing any concrete mini app, " +
    'so it cannot be a literal in a default-settings object.'
)
assert(
  /defaultHomeMaestroCompositeTabId/.test(compositeRegistry),
  `${COMPOSITE_REGISTRY}: the registry must be able to answer which spec declared itself the default homepage.`
)
assert(
  /defaultHome: true/.test(onlyPreviewTab),
  `${ONLY_PREVIEW_TAB}: OnlyPreview is bl's default pinned tab (Ral 2026-09-14). Dropping the declaration silently ` +
    'reverts every machine that never set a homepage back to the built-in Home.'
)
const resolveHomeComposite = browserView.match(/private resolveHomeCompositeId\([\s\S]*?\n  \}/)?.[0] ?? ''
assert(resolveHomeComposite, `${BROWSER_VIEW}: expected to find resolveHomeCompositeId()`)
assertOrder(
  resolveHomeComposite,
  'this.homeCompositeSetting()',
  'defaultHomeMaestroCompositeTabId()',
  `${BROWSER_VIEW}: a homepage the user set must win over the registry default — reversing them pins every machine ` +
    'to the default and makes Set as homepage look like it did nothing after a restart.'
)
assert(
  /private homeCompositeSetting\(\): string/.test(browserView),
  `${BROWSER_VIEW}: "did the user set a homepage" needs its own reader. resolveHomeCompositeId() now answers with the ` +
    'registry default for a machine that never set one, so it cannot double as that question.'
)
const isDefaultHome = browserView.match(/private isDefaultHomeTab\([\s\S]*?\n  \}/)?.[0] ?? ''
assert(
  /!this\.homeCompositeSetting\(\)/.test(isDefaultHome),
  `${BROWSER_VIEW}: isDefaultHomeTab must key on whether the user set a homepage, not on \`kind === 'home'\` alone. ` +
    "bl's default slot is a mini app now, and coachSettings drops homeAlias whenever homeCompositeId is empty — so " +
    'letting the default slot be renamed is a name that is discarded on save, with nothing to notice.'
)
assert(
  /const canRestoreHome = tab\.pinned && Boolean\(this\.homeCompositeSetting\(\)\)/.test(menuBody),
  `${BROWSER_VIEW}: Restore default homepage must be enabled only when a CUSTOM value is stored. Keyed on ` +
    'resolveHomeCompositeId() it is now always true, so the item sits enabled and does nothing.'
)
assert(
  /hasLiveOnlyPreviewHost\(\)\) \{\n\s*throw new OnlyPreviewContractError/.test(onlyPreviewTab),
  `${ONLY_PREVIEW_TAB}: opening the composite while OnlyPreview already has a live host must THROW. openOnMount's ` +
    'reuse branch returns that host without attaching this mount, so `open` resolves onto a blank tab while the ' +
    'standalone window jumps to the front — and as the default homepage that is a boot-time path, not an edge case.'
)

console.log('[check-tab-alias] ok')
