import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const bundle = await build({ stdin: { contents: "export * from './src/main/maestro/drive/agentBrowserUse'; export * from './src/main/maestro/drive/agentBrowserSession'", resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node' })
const real = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const members = (path, names, bindings = {}) => {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true)
  const found = source.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]).filter(node => names.includes(node.name?.getText(source)))
  assert.equal(found.length, names.length)
  const code = ts.transpileModule('class Actual {' + found.map(node => node.getText(source)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(bindings), code + ';return Actual')(...Object.values(bindings))
}
const controllerPath = 'src/main/maestro/windows/main/maestroWindow.controller.ts'
const browserPath = 'src/main/maestro/windows/main/maestroBrowserView.service.ts'
const Browser = members(browserPath, ['newTabsBySession', 'clearNewTabsNote', 'drainNewTabsNote', 'openTabWithUrl', 'describeAgentTab', 'controlDepth', 'activeBrowserUseTabs', 'setTabControlled', 'setActiveBrowserUseTabs', 'clearTabControl'], { hostnameOf: url => new URL(url).hostname })
const Controller = members(controllerPath, ['browserSessions', 'browserUse', 'browserToolOwners', 'tabs', 'activeTabId', 'beginBrowserTurn', 'endBrowserTurn', 'agentBrowserSession', 'setBrowserUseMarker', 'withAgentBrowserTarget', 'browserTabsChanged', 'browserPopupOwner', 'browserPopupOpened', 'browserPopupActivity', 'browserUseGeneration', 'browserPopupStillOwned'], { ...real, xpcMain: { broadcast() {} } })
const controllerSource = ts.createSourceFile(controllerPath, read(controllerPath), ts.ScriptTarget.Latest, true)
const toolObjects = new Map()
let wrapper
const walk = node => {
  if (ts.isCallExpression(node) && node.arguments[0]?.getText(controllerSource).includes('const scoped =')) wrapper = node.arguments[0].getText(controllerSource)
  if (ts.isObjectLiteralExpression(node)) {
    const name = node.properties.find(p => p.name?.getText(controllerSource) === 'name')?.initializer?.text
    if (['start_browser_use', 'end_browser_use'].includes(name)) toolObjects.set(name, node.getText(controllerSource))
  }
  ts.forEachChild(node, walk)
}
walk(controllerSource)
const tool = (c, name, sessionKey = 'task') => new Function('sessionKey', 'return (' + toolObjects.get(name) + ')').call(c, sessionKey)
const setup = () => {
  const tabs = ['a', 'b', 'c'].map(id => ({ id, kind: 'browser', title: id, url: 'https://same.example/', debuggerEnabled: true, view: { webContents: { isDestroyed: () => false, isCrashed: () => false } }, capture: { isAttached: () => true }, replay: {} }))
  const b = new Browser(), c = new Controller(), calls = [], events = []
  Object.assign(b, { tabs, activeTabId: 'c', displayUrl: t => t.url, broadcastTabs: () => { events.push(tabs.filter(t => t.controlled).map(t => t.id)); c.browserTabsChanged() }, requireAgentTab: async id => { calls.push('prepare:' + id); return tabs.find(t => t.id === id) } })
  Object.assign(c, { browserView: b, requestExec: { withBrowserTarget: async (tab, work) => { calls.push('operate:' + tab.id); return work() } } })
  c.beginBrowserTurn('task', 'a')
  return { c, b, tabs, calls, events, use: c.browserUse }
}

test('both registered status tools require tab_id and preserve target, foreground and recording membership', async () => {
  assert.equal(toolObjects.size, 2)
  const { c, b, calls, use } = setup()
  const scope = ['a']; c.drillTrio = { run: { ownerSessionId: 'task', isDrilling: true }, host: { exploreSessionOrNull: () => ({ refreshTabScope() {}, activeTabIds: () => scope }) } }
  const before = c.agentBrowserSession('task')
  const start = tool(c, 'start_browser_use'), end = tool(c, 'end_browser_use')
  assert(start.params.some(p => p.name === 'tab_id' && p.required))
  assert(end.params.some(p => p.name === 'tab_id' && p.required))
  await start.execute({ tab_id: 'b' }); await start.execute({ tab_id: 'b' })
  assert.deepEqual(use.tabIds('task'), ['b'])
  assert.equal(b.tabs.find(t => t.id === 'b').controlled, true)
  assert.deepEqual(c.agentBrowserSession('task').tabs, before.tabs)
  assert.equal(c.agentBrowserSession('task').selectedTabId, before.selectedTabId)
  assert.equal(b.activeTabId, 'c'); assert.deepEqual(scope, ['a']); assert.deepEqual(calls, [])
  await end.execute({ tab_id: 'b' }); await end.execute({ tab_id: 'b' })
  assert.equal(b.tabs.find(t => t.id === 'b').controlled, false)
  assert.deepEqual(scope, ['a']); assert.equal(b.activeTabId, 'c'); assert.deepEqual(calls, [])
})

test('invalid starts fail without preparation; repeat end of a closed ID succeeds', async () => {
  const { c, tabs, calls, use } = setup(), start = tool(c, 'start_browser_use'), end = tool(c, 'end_browser_use')
  for (const tab_id of [undefined, '', '  ', 1, 'missing']) assert.match(await start.execute({ tab_id }), /^ERROR:/)
  tabs[0].kind = 'onlypreview'; assert.match(await start.execute({ tab_id: 'a' }), /^ERROR:/)
  tabs[1].view.webContents.isCrashed = () => true; assert.match(await start.execute({ tab_id: 'b' }), /^ERROR:/)
  assert.doesNotMatch(await end.execute({ tab_id: 'missing' }), /^ERROR:/)
  assert.match(await end.execute({ tab_id: '' }), /^ERROR:/)
  assert.deepEqual(use.allTabIds(), []); assert.deepEqual(calls, [])
})

test('two task owners and independent transient work do not extinguish one another', () => {
  const { c, b, use } = setup()
  use.start('task', 'a'); use.start('other', 'a'); use.start('task', 'b')
  b.setTabControlled('a', true)
  use.end('task', 'a'); assert.equal(b.tabs[0].controlled, true)
  use.end('other', 'a'); assert.equal(b.tabs[0].controlled, true)
  b.setTabControlled('a', false); assert.equal(b.tabs[0].controlled, false)
  assert.equal(b.tabs[1].controlled, true)
  c.endBrowserTurn('task'); assert.equal(b.tabs[1].controlled, false)
})

test('actual page work begins use across thinking gaps; explicit end and terminal cleanup release it', async () => {
  const { c, b, use } = setup()
  assert.deepEqual(use.allTabIds(), [])
  await c.withAgentBrowserTarget('task', undefined, async () => 'ok')
  assert.deepEqual(use.tabIds('task'), ['a']); assert.equal(b.tabs[0].controlled, true)
  assert.equal(b.controlDepth.size, 0)
  use.end('task', 'a'); assert.equal(b.tabs[0].controlled, false)
  await c.withAgentBrowserTarget('task', 'a', async () => { throw new Error('work failed') })
  assert.equal(b.tabs[0].controlled, true)
  c.endBrowserTurn('task'); assert.deepEqual(use.allTabIds(), []); assert.equal(b.tabs[0].controlled, false)
  assert.equal(b.activeTabId, 'c')
})

test('drill members share the task marker across continuation; unchanged scope cannot undo explicit end', () => {
  const { c, b, use } = setup()
  use.syncDrillMembers('task', ['a', 'b'])
  c.endBrowserTurn('task'); assert.deepEqual(use.tabIds('task'), ['a', 'b'])
  use.end('task', 'a'); use.syncDrillMembers('task', ['a', 'b'])
  assert.equal(b.tabs[0].controlled, false); assert.equal(b.tabs[1].controlled, true)
  use.start('task', 'a'); assert.equal(b.tabs[0].controlled, true)
  use.syncDrillMembers('task', ['a']); assert.equal(b.tabs[1].controlled, false)
  use.start('task', 'c'); use.syncDrillMembers('task', null)
  assert.deepEqual(use.allTabIds(), []); assert(b.tabs.every(t => !t.controlled))
})

test('drill pause releases this task without changing membership; later real reuse can restart', () => {
  const { use } = setup()
  use.syncDrillMembers('task', ['a', 'b']); use.end('task')
  use.syncDrillMembers('task', ['a', 'b']); assert.deepEqual(use.tabIds('task'), [])
  use.start('task', 'a'); assert.deepEqual(use.tabIds('task'), ['a'])
  use.syncDrillMembers('task', []); assert.deepEqual(use.allTabIds(), [])
})

for (const reason of ['close', 'crash', 'replacement', 'kind']) test(reason + ' releases active use while history survives', async () => {
  const { c, b, tabs, use } = setup()
  await c.withAgentBrowserTarget('task', 'a', async () => 'ok')
  if (reason === 'close') tabs.splice(0, 1)
  if (reason === 'crash') tabs[0].view.webContents.isCrashed = () => true
  if (reason === 'replacement') tabs[0].view = { webContents: { isDestroyed: () => false, isCrashed: () => false } }
  if (reason === 'kind') tabs[0].kind = 'onlypreview'
  c.browserTabsChanged()
  assert.deepEqual(use.tabIds('task'), []); assert.equal(c.agentBrowserSession('task').tabs.length, 1)
  assert(b.tabs.every(t => !t.controlled))
})

test('a historical target cannot own or mark a human popup after the ordinary turn ends', async () => {
  const { c, use } = setup()
  await c.withAgentBrowserTarget('task', 'a', async () => 'ok')
  c.endBrowserTurn('task')
  assert.equal(c.browserPopupOwner('a'), undefined)
  assert.equal(c.agentBrowserSession('task').tabs[0].id, 'a')
  assert.deepEqual(use.allTabIds(), [])
})

test('same-URL IDs stay distinct and clear removes every task/run marker', () => {
  const { use, b } = setup()
  use.start('task', 'a'); use.start('other', 'b'); use.syncDrillMembers('drill', ['c'])
  use.end('task', 'a'); assert.equal(b.tabs[1].controlled, true)
  use.clear(); assert.deepEqual(use.allTabIds(), []); assert(b.tabs.every(t => !t.controlled))
})

test('renderer and catalog reuse the existing controlled favicon contract, and lifecycle tools bypass page wrappers', () => {
  const view = read('src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue'), css = read('src/renderer/maestro/home/src/components/MenuBar/MenuBar.less')
  assert(view.indexOf('v-if="tab.controlled"') < view.indexOf('v-else-if="tab.loading"'))
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /maestro-controlled-orbit/)
  const controller = read(controllerPath), scoped = controller.match(/const scoped = \[([^\]]+)\]/)[1]
  assert(!scoped.includes('start_browser_use') && !scoped.includes('end_browser_use'))
  for (const name of toolObjects.keys()) assert(read('src/main/agent/hostToolCatalog.ts').includes("name: '" + name + "'"))
  assert(read('src/main/agent/runtime/agentPrompt.ts').includes('active_use_tab_ids'))
})


test('ordinary terminal cleanup discards only its own undelivered popup notes', () => {
  const { c, b } = setup()
  b.newTabsBySession.set('task', [{ id: 'old-popup', url: 'https://old.example' }])
  b.newTabsBySession.set('other', [{ id: 'other-popup', url: 'https://other.example' }])
  c.endBrowserTurn('task')
  assert.equal(b.drainNewTabsNote('task'), '')
  assert.match(b.drainNewTabsNote('other'), /other-popup/)
})

test('late preparation after turn abort cannot resurrect use or own a popup', async () => {
  const { c, b, use, tabs } = setup()
  let ready
  b.requireAgentTab = () => new Promise(resolve => { ready = resolve })
  const work = c.withAgentBrowserTarget('task', 'a', async () => 'ok')
  c.endBrowserTurn('task')
  assert.equal(c.browserPopupOwner('a'), undefined)
  ready(tabs[0]); await work
  assert.deepEqual(use.tabIds('task'), [])
  assert.equal(tabs[0].controlled, false)
})

test('a delayed popup attribution is invalid after the ordinary turn ends, while a live drill member stays owned', () => {
  const { c, use } = setup()
  const version = use.generation('task')
  c.endBrowserTurn('task')
  assert.equal(c.browserPopupStillOwned('task', 'a', version), false)
  c.drillTrio = { run: { ownerSessionId: 'task', isDrilling: true }, host: { exploreSessionOrNull: () => ({ ownsActiveTab: id => id === 'a' }) } }
  assert.equal(c.browserPopupStillOwned('task', 'a', version), true)
  assert.equal(c.browserPopupStillOwned('task', 'c', version), false)
})

test('a popup allocated after its ordinary turn ends cannot leave a new marker or stale notice', async () => {
  const { c, b, tabs, use } = setup()
  let allocated
  Object.assign(b, {
    _state: { browserUseGeneration: id => c.browserUseGeneration(id), browserPopupStillOwned: (...args) => c.browserPopupStillOwned(...args), browserPopupOpened: (...args) => c.browserPopupOpened(...args), browserPopupActivity: (...args) => c.browserPopupActivity(...args), broadcastActivity() {}, emitTrace() {} },
    claimSpareTab: () => new Promise(resolve => { allocated = resolve }), applyBounds() {}, startTabNavigation: async () => {},
    activateTab: async () => assert.fail('an old agent popup must not change the human foreground')
  })
  const opening = b.openTabWithUrl('https://same.example/result', 'task', 'a')
  c.endBrowserTurn('task')
  const popup = { ...tabs[0], id: 'popup' }; tabs.push(popup); allocated(popup)
  await opening
  assert.deepEqual(use.tabIds('task'), [])
  assert.equal(b.drainNewTabsNote('task'), '')
  assert.equal(c.browserPopupOwner('popup'), undefined)
  assert.equal(b.activeTabId, 'c')
})

test('every exploration tool rejects another task while status markers remain shared and nonexclusive', async () => {
  const { c } = setup()
  c.drillTrio = { run: { ownerSessionId: 'other', isDrilling: true }, host: { exploreSessionOrNull: () => ({ refreshTabScope() {} }) } }
  const compiled = ts.transpileModule('const wrap = (' + wrapper + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const wrap = new Function('sessionKey', compiled + ';return wrap').call(c, 'task')
  for (const name of ['explore_session', 'explore_visit', 'explore_record']) {
    const wrapped = wrap({ name, execute: async () => assert.fail('must not enter another task\'s drill') })
    assert.match(await wrapped.execute({ action: 'state', tab: 'a' }), /^ERROR: another chat/)
  }
  const start = tool(c, 'start_browser_use')
  assert.doesNotMatch(await start.execute({ tab_id: 'a' }), /^ERROR:/)
  const other = tool(c, 'start_browser_use', 'other')
  assert.doesNotMatch(await other.execute({ tab_id: 'a' }), /^ERROR:/)
  await tool(c, 'end_browser_use').execute({ tab_id: 'a' })
  assert.deepEqual(c.browserUse.tabIds('other'), ['a'])
})
