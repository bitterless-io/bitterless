import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
function methods(path, names, bindings = {}) {
  const ast = ts.createSourceFile(path, readFileSync(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true)
  const nodes = ast.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]).filter(node => names.includes(node.name?.getText(ast)))
  assert.equal(nodes.length, names.length)
  const output = ts.transpileModule(`class Actual {${nodes.map(node => node.getText(ast)).join('\n')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(bindings), `${output}; return Actual`)(...Object.values(bindings))
}
const Browser = methods('src/main/maestro/windows/main/maestroBrowserView.service.ts', ['describeWindowTabs', 'describeTabContent'], { isAbsolute })
const labels = { homeTab: '主页', newTab: '新标签页', workbenchTab: 'Workbench' }
const Controller = methods('src/main/maestro/windows/main/maestroWindow.controller.ts', ['describeWindowTabs'], { i18nHelper: { getMessages: () => ({ menuBar: { maestro: labels } }) } })
function fixture(tab) {
  const browser = new Browser()
  Object.assign(browser, { tabs: tab ? [tab] : [], activeTabId: tab?.id, compositeTabs: new Map(), compositeHosts: new Map() })
  const controller = new Controller()
  Object.assign(controller, { browserView: browser, workbenchView: { getState: () => ({ open: false, visible: false }) } })
  return { browser, controller, snapshot: () => controller.describeWindowTabs().activeTab, windowSnapshot: () => controller.describeWindowTabs() }
}

test('D3 preserves real foreground id, URL and visible alias as values independent of tool targets', () => {
  const tab = { id: 'actual-tab', kind: 'browser', title: 'Page title', alias: ' My alias ', url: 'https://visible.example/p?q=1#part' }
  const f = fixture(tab)
  f.browser.agentTarget = { id: 'other-chat-target', url: 'https://target.example' }
  const before = f.snapshot()
  assert.deepEqual(before, { tab_id: tab.id, kind: 'web', title: 'My alias', url: tab.url })
  tab.alias = ''; tab.title = '  '; tab.url = 'https://other.example:8443/p'
  assert.equal(f.snapshot().title, 'other.example:8443')
  assert.equal(before.title, 'My alias'); assert.equal(before.url, 'https://visible.example/p?q=1#part')
  tab.url = ''
  assert.equal(f.snapshot().title, labels.newTab)
})

test('D3 trusts confirmed file facts only, with miniapp fallback for pending, invalid and expired presentation', () => {
  const tab = { id: 'preview-tab', kind: 'onlypreview', title: 'OnlyPreview', alias: 'Project files', compositeDisplayUrl: 'file:///old/A.md' }
  const f = fixture(tab)
  let displayedPath = null
  f.browser.compositeHosts.set(tab.id, {})
  f.browser.compositeTabs.set(tab.id, { id: 'onlypreview', getDisplayedFile: () => displayedPath })
  const miniapp = { tab_id: tab.id, kind: 'miniapp', title: 'Project files', miniapp: 'only-preview' }
  assert.deepEqual(f.snapshot(), miniapp)
  displayedPath = '/project/B.md'
  assert.deepEqual(f.snapshot(), { tab_id: tab.id, kind: 'file', title: 'Project files', path: displayedPath })
  displayedPath = 'unconfirmed-relative.md'
  assert.deepEqual(f.snapshot(), miniapp)
  f.browser.compositeTabs.get(tab.id).getDisplayedFile = () => { throw new Error('host closed') }
  assert.deepEqual(f.snapshot(), miniapp)
  f.browser.compositeHosts.delete(tab.id)
  assert.deepEqual(f.snapshot(), miniapp)
  tab.kind = 'file'
  f.browser.compositeTabs.set(tab.id, { id: 'file' })
  assert.deepEqual(f.snapshot(), miniapp, 'standalone file tabs use the same unconfirmed-preview fallback')
})

test('D3 has stable miniapp keys, Workbench overlay priority, and null only when no foreground exists', () => {
  const tab = { id: 'home-tab', kind: 'home', title: 'Home', url: '' }
  const f = fixture(tab)
  assert.deepEqual(f.snapshot(), { tab_id: tab.id, kind: 'miniapp', title: labels.homeTab, miniapp: 'home' })
  for (const kind of ['trench', 'zellij']) {
    tab.kind = kind; tab.title = kind
    assert.deepEqual(f.snapshot(), { tab_id: tab.id, kind: 'miniapp', title: kind, miniapp: kind })
  }
  tab.kind = 'browser'; tab.url = 'https://underneath.example/'
  f.controller.workbenchView.getState = () => ({ open: true, visible: true })
  assert.deepEqual(f.snapshot(), { tab_id: null, kind: 'miniapp', title: 'Workbench', miniapp: 'workbench' })
  f.controller.workbenchView.getState = () => ({ open: false, visible: false })
  f.browser.activeTabId = null
  assert.equal(f.snapshot(), null)
})

test('D4 follows the full user tab strip, preserving duplicates and background Workbench while excluding hidden surfaces', () => {
  const home = { id: 'fixed-home', kind: 'home', title: 'Home', pinned: true, url: '' }
  const f = fixture(home)
  const webTabs = Array.from({ length: 51 }, (_, i) => ({ id: `web-${i}`, kind: 'browser', title: `Page ${i}`, alias: i === 0 ? 'Alias' : '', url: 'https://same.example/' }))
  f.browser.tabs.push(...webTabs)
  f.browser.spareSlot = { id: 'hidden-prewarm', url: 'https://hidden.example/' }
  f.browser.temporaryDeepFetch = { id: 'hidden-fetch', url: 'https://hidden.example/' }
  f.controller.workbenchView.getState = () => ({ open: true, visible: false })
  const result = f.windowSnapshot()
  assert.deepEqual(result.openTabs.map(tab => tab.tab_id), ['fixed-home', null, ...webTabs.map(tab => tab.id)])
  assert.equal(result.openTabs.length, 53, 'no deduplication or truncation')
  assert.equal(result.openTabs[2].title, 'Alias')
  assert.equal(result.openTabs[1].miniapp, 'workbench')
  assert.equal(result.activeTab, result.openTabs[0], 'D3 reuses the exact same sampled foreground value')
  f.browser.tabs = [webTabs[1], webTabs[0]]
  assert.deepEqual(f.windowSnapshot().openTabs.map(tab => tab.tab_id), ['web-1', null, 'web-0'], 'Workbench follows first item when there is no pinned tab')
  assert.equal(result.openTabs.length, 53, 'later tab mutations do not rewrite the old snapshot')
  f.browser.tabs = []; f.browser.activeTabId = null
  f.controller.workbenchView.getState = () => ({ open: false, visible: false })
  assert.deepEqual(f.windowSnapshot(), { activeTab: null, openTabs: [] })
})

test('D4 samples each file tab own presentation once, including pending background files', () => {
  const a = { id: 'file-a', kind: 'file', title: 'A.md', url: '' }
  const b = { id: 'file-b', kind: 'file', title: 'B.md', url: '' }
  const f = fixture(a)
  f.browser.tabs.push(b)
  let pathB = null
  const calls = []
  for (const [tab, path] of [[a, () => '/project/A.md'], [b, () => pathB]]) {
    const host = { instanceId: tab.id }
    f.browser.compositeHosts.set(tab.id, host)
    f.browser.compositeTabs.set(tab.id, { id: 'file', getDisplayedFile: owner => { assert.equal(owner, host); calls.push(tab.id); return path() } })
  }
  const pending = f.windowSnapshot()
  assert.deepEqual(calls, ['file-a', 'file-b'])
  assert.equal(pending.activeTab.path, '/project/A.md')
  assert.deepEqual(pending.openTabs[1], { tab_id: b.id, kind: 'miniapp', title: 'B.md', miniapp: 'only-preview' })
  pathB = '/other/B.md'
  assert.deepEqual(f.windowSnapshot().openTabs.map(tab => tab.path), ['/project/A.md', '/other/B.md'])
  assert.equal(pending.openTabs[1].kind, 'miniapp', 'B becoming ready leaves the earlier message intact')
})
