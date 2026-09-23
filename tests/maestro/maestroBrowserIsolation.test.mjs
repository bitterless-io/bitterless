import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const members = (path, names, bindings = {}) => {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true)
  const found = source.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]).filter(node => names.includes(node.name?.getText(source)))
  assert.equal(new Set(found.map(node => node.name.getText(source))).size, names.length, `actual members of ${path}`)
  const output = ts.transpileModule(`class Actual { ${found.map(node => node.getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(bindings), `${output};return Actual`)(...Object.values(bindings))
}
const bundle = await build({ entryPoints: [resolve(root, 'src/main/maestro/drive/agentBrowserSession.ts')], bundle: true, write: false, format: 'esm', platform: 'node' })
const { AgentBrowserSessions } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const Browser = members('src/main/maestro/windows/main/maestroBrowserView.service.ts', ['activeBrowserUseTabs', 'controlDepth', 'clearTabControl', 'MAX_WARM', 'newTabsBySession', 'enforceWarmCap', 'performCoolTab', 'performCloseTab', 'openAgentTab', 'openTabWithUrl', 'drainNewTabsNote'], { hostnameOf: url => new URL(url).hostname })
const Owner = members('src/main/maestro/windows/main/maestroWindow.controller.ts', ['browserToolOwners', 'browserPopupOwner', 'browserPopupActivity'])
const Capture = members('src/main/maestro/capture/capture.service.ts', ['drillTabIds', 'drillScopeRevision', 'isCaptureTab', 'setDrillCaptureTabs', 'isCapturableTab', 'captureTargetTab', 'currentCaptureTarget', 'switchCaptureTarget', 'pageSnapshotForAgent', 'toolStartRecording', 'startCapture', 'getCaptureState', 'stopCaptureIfAgentStarted'], {
  normalizeCaptureToolMode: v => v, join: (...parts) => parts.join('/'), maestroDataRoot: () => '/memory', mkdirSync() {}, createWriteStream: () => ({ write() {}, end() {} }), xpcMain: { broadcast() {} }
})
const Explore = members('src/main/maestro/sitemap/exploreSession.service.ts', ['tabMembers', 'tabScopeActive', 'tabPauseError', 'homeTabId', 'currentDrillTabId', 'branchStack', 'branchSeenTabs', 'tabsDrilled', 'unthrottledTabIds', 'activeTabIds', 'ownsActiveTab', 'tabState', 'admitBranch', 'refreshTabScope', 'finishTabScope', 'drillWc', 'readPageOnce', 'firstUndrilledSameSiteTab', 'visitTab', 'openBranchIfNewTab', 'closeBranchFor', 'prepareDrillTab', 'onAnchorTabChanged', 'applyDrillThrottling', 'restoreDrillThrottling', 'anchorTabId'], { NAV_EXTRACT: 'mock extraction' })
const Exec = members('src/main/maestro/drive/requestExec.service.ts', ['interceptionByTab', 'browserInterceptionRules', 'applyBrowserInterceptionRules'])

const surface = (id, calls = []) => ({ id, kind: 'browser', debuggerEnabled: true, url: `https://site.example/${id}`, title: id, lastActive: 1,
  view: { webContents: { isDestroyed: () => false, isCrashed: () => false, close: () => calls.push(`close-${id}`), getURL: () => `https://site.example/${id}`, setBackgroundThrottling() {}, debugger: { sendCommand: async () => ({ result: { value: { title: id, links: [], controls: [], totals: {}, diag: {} } } }) } } },
  capture: { isAttached: () => true, prepareNavigation: async () => {}, startRecording: async () => calls.push(`start-${id}`), stopRecording: async () => calls.push(`stop-${id}`), detach() {}, snapshot: async () => ({ ok: true, title: id, yaml: `- button ${id} [ref=e1]`, nodeCount: 1 }) }, replay: {}
})
const setupDrill = () => {
  const calls = [], tabs = ['a', 'b', 'c', 'd'].map(id => surface(id, calls))
  let active = 'c'
  const capture = new Capture()
  Object.assign(capture, { _state: { getOperationTabs: () => tabs, getActiveOperationTabId: () => active, currentUrl: tabs[2].url, broadcastActivity() {} }, capturing: true, captureTargetTabId: 'a', captureTargetRequest: 0, captureStartedBy: 'agent', emitTrace() {}, setCaptureOptions: async () => {}, clearCaptureRecordEdits: async () => {}, stopCapture: async () => { capture.capturing = false; calls.push('stop-all') } })
  const e = new Explore()
  Object.assign(e, { open: true, host: 'site.example', homeTabId: 'a', currentDrillTabId: 'a', tabScopeActive: true, startUrl: tabs[0].url, visited: new Set(), counts: { visits: 0 }, trail: [],
    deps: { webContents: () => tabs.find(t => t.id === active)?.view.webContents, webContentsForTab: id => tabs.find(t => t.id === id)?.view?.webContents ?? null,
      describeTab: id => { const t = tabs.find(t => t.id === id); return t ? { id, url: t.url, status: 'ready' } : undefined },
      listTabs: async () => tabs, activeTabId: () => active, activateTab: async () => {}, pageSnapshot: id => capture.pageSnapshotForAgent(id),
      retargetCapture: id => capture.switchCaptureTarget(tabs.find(t => t.id === id)), onTabScopeChanged: ids => capture.setDrillCaptureTabs(ids), onMainTabUnavailable: error => calls.push(error) },
    hostOf: url => new URL(url).hostname, normalize: url => url, log() {}, settle: async () => {}, readPage: async () => null, touchTask() {}, noteProgress: () => '', navState: () => '', renderEvidence: () => '', renderKnownFunctions: () => '', trailSummary: () => ''
  })
  e.tabMembers.set('a', { id: 'a', role: 'main', url: tabs[0].url, status: 'active', wc: tabs[0].view.webContents })
  e.tabsDrilled.add('a')
  return { e, capture, tabs, calls, active: () => active }
}

test('frozen initiating context remains A without enrolling a chat-only turn', () => {
  const tabs = [surface('a'), surface('c')]
  const sessions = new AgentBrowserSessions(id => ({ ...tabs.find(t => t.id === id), status: 'ready' }), () => {})
  sessions.beginTurn('chat', 'a')
  assert.equal(sessions.snapshot('chat').initiatingTab.url, tabs[0].url)
  assert.deepEqual(sessions.snapshot('chat').tabs, [])
  sessions.target('chat', 'a')
  sessions.enroll('chat', 'c', true)
  assert.equal(sessions.snapshot('chat').initiatingTab, undefined)
  assert.equal(sessions.snapshot('chat').selectedTabId, 'c')
})

test('A and B survive LRU throughout model-thinking gaps; endTurn releases the protection', async () => {
  const calls = [], tabs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ ...surface(id, calls), lastActive: i + 1 }))
  const sessions = new AgentBrowserSessions(id => ({ id, title: id, url: id, status: 'ready' }), () => {})
  sessions.beginTurn('chat', 'a'); sessions.target('chat'); sessions.enroll('chat', 'b', false)
  const browser = new Browser()
  Object.assign(browser, { tabs, activeTabId: 'f', _state: { protectedBrowserTabIds: () => sessions.protectedTabIds() }, setTabLoading() {}, coolTab: t => browser.performCoolTab(t) })
  await browser.enforceWarmCap()
  assert(tabs[0].view && tabs[1].view)
  assert.deepEqual(calls, ['close-c', 'close-d'])
  sessions.endTurn('chat')
  assert.deepEqual(sessions.protectedTabIds(), [])
  browser.MAX_WARM = 2
  await browser.enforceWarmCap()
  assert.deepEqual(calls.slice(2), ['close-a', 'close-b'])
})

test('agent open_tab initial popup retains owner and session-specific notice without a popup focus jump', async () => {
  const browser = new Browser(), owner = new Owner(), a = surface('a'), popup = surface('popup')
  owner.browserUse = { generation: () => 0 }
  const focus = [], enrolled = []
  Object.assign(browser, { tabs: [a, popup], _state: { browserPopupActivity: (...args) => owner.browserPopupActivity(...args), browserPopupOpened: async (s, id) => enrolled.push([s, id]), broadcastActivity() {}, emitTrace() {} },
    claimSpareTab: async ({ url }) => url === a.url ? a : popup, setTabControlled() {}, broadcastTabs() {}, activateTab: async ({ id }) => focus.push(id), requireAgentTab: async () => a, applyBounds() {},
    startTabNavigation: async t => { if (t === a) await browser.openTabWithUrl(popup.url, owner.browserPopupOwner('a'), 'a') }
  })
  await browser.openAgentTab(a.url, () => {}, 'chat-a')
  assert.deepEqual(enrolled, [['chat-a', 'popup']])
  assert.deepEqual(focus, [])
  assert.equal(browser.drainNewTabsNote('chat-b'), '')
  assert.match(browser.drainNewTabsNote('chat-a'), /tab_id=popup/)
  assert.equal(owner.browserPopupOwner('a'), undefined)
})

test('interception add/clear affects only the resolved tab', async () => {
  const calls = [], a = { id: 'a' }, b = { id: 'b' }, exec = new Exec()
  const captureA = { setInterceptionRules: async rules => calls.push(['a', rules.map(r => r.id)]) }
  const captureB = { setInterceptionRules: async rules => calls.push(['b', rules.map(r => r.id)]) }
  let target = { tab: a, capture: captureA }
  exec.browserTarget = { getStore: () => target }
  exec.browserInterceptionRules = [{ id: 'rule-a' }]
  await exec.applyBrowserInterceptionRules()
  target = { tab: b, capture: captureB }
  assert.deepEqual(exec.browserInterceptionRules, [])
  exec.browserInterceptionRules = []
  await exec.applyBrowserInterceptionRules()
  target = { tab: a, capture: captureA }
  assert.equal(exec.browserInterceptionRules[0].id, 'rule-a')
  assert.deepEqual(calls, [['a', ['rule-a']], ['b', []]])
})

test('human foreground C is excluded from drill capture and page evidence remains entirely A', async () => {
  const { e, capture, tabs, calls } = setupDrill()
  await capture.setDrillCaptureTabs(['a'])
  await capture.switchCaptureTarget(tabs[2])
  assert.equal(capture.captureTargetTabId, 'a')
  assert.equal(capture.isCaptureTab('c'), false)
  assert.equal(capture.isCaptureTab('a'), true)
  const evidence = await e.readPageOnce()
  assert.equal(evidence.url, tabs[0].url)
  assert.equal(evidence.snapshot, '- button a [ref=e1]')
  assert.deepEqual(calls, [])
  assert.equal(await e.firstUndrilledSameSiteTab(), null)
})

test('member-source popups become branches; a human C popup remains excluded', async () => {
  const { e, capture, calls } = setupDrill()
  await capture.setDrillCaptureTabs(['a'])
  await e.admitBranch('b', 'a', 'https://site.example/b')
  await e.admitBranch('d', 'c', 'https://site.example/d')
  assert.deepEqual(e.activeTabIds(), ['a', 'b'])
  assert(calls.includes('start-b'))
  assert(!calls.includes('start-d'))
  await e.openBranchIfNewTab()
  assert.equal(e.currentDrillTabId, 'b')
  assert.equal(e.homeTabId, 'a')
  assert.deepEqual(e.branchStack.map(t => t.tabId), ['b'])
})

test('explicitly selecting human C takes it over, preserving main A and recording both', async () => {
  const { e, capture, active } = setupDrill()
  await capture.setDrillCaptureTabs(['a'])
  await e.visitTab('c')
  assert.equal(e.homeTabId, 'a')
  assert.equal(e.currentDrillTabId, 'c')
  assert.equal(active(), 'c')
  assert.deepEqual(e.activeTabIds(), ['a', 'c'])
  assert(capture.isCaptureTab('a') && capture.isCaptureTab('c'))
  assert.equal(e.tabState().tabs.find(t => t.id === 'c').parentTabId, 'a')
})

test('closing a branch removes its active ID; losing main pauses with diagnostics and no foreground takeover', async () => {
  const { e, capture, tabs, active } = setupDrill()
  await capture.setDrillCaptureTabs(['a'])
  await e.admitBranch('b', 'a', 'https://site.example/b')
  tabs.splice(tabs.findIndex(t => t.id === 'b'), 1)
  e.refreshTabScope()
  assert.deepEqual(e.activeTabIds(), ['a'])
  assert.equal(e.tabState().tabs.find(t => t.id === 'b').status, 'closed')
  tabs.splice(tabs.findIndex(t => t.id === 'a'), 1)
  e.refreshTabScope()
  assert.deepEqual(e.activeTabIds(), [])
  assert.match(e.tabState().paused, /main tab a/)
  assert.equal(e.drillWc(), null)
  assert.equal(capture.isCaptureTab('c'), false)
  assert.equal(active(), 'c')
})

for (const failure of ['crash', 'replacement']) test(`main ${failure} pauses the drill instead of silently accepting another page instance`, () => {
  const { e, tabs } = setupDrill()
  if (failure === 'crash') tabs[0].view.webContents.isCrashed = () => true
  else tabs[0].view.webContents = surface('a').view.webContents
  e.refreshTabScope()
  assert.deepEqual(e.activeTabIds(), [])
  assert.match(e.tabState().paused, /main tab a/)
})

test('agent recording is stamped correctly, and drill completion releases scope and recording', async () => {
  const { e, capture } = setupDrill()
  capture.capturing = false; capture.captureStartedBy = 'operator'
  await capture.toolStartRecording('api', 'a')
  assert.equal(capture.captureStartedBy, 'agent')
  await capture.setDrillCaptureTabs(['a'])
  await e.finishTabScope()
  assert.equal(capture.capturing, false)
  assert.deepEqual(e.activeTabIds(), [])
  assert.equal(capture.drillTabIds, null)
})

test('same-URL A and D retain distinct tab identities and accessibility refs after explicit takeover', async () => {
  const { e, capture, tabs, active } = setupDrill()
  const a = tabs.find(t => t.id === 'a'), d = tabs.find(t => t.id === 'd')
  d.url = a.url
  d.view.webContents.getURL = () => a.url
  await capture.setDrillCaptureTabs(['a'])
  await e.visitTab('d')
  assert.equal(active(), 'c')
  let evidence = await e.readPageOnce()
  assert.equal(evidence.url, a.url)
  assert.equal(evidence.snapshot, '- button d [ref=e1]')
  await e.visitTab('home')
  evidence = await e.readPageOnce()
  assert.equal(evidence.snapshot, '- button a [ref=e1]')
  assert.deepEqual(e.activeTabIds(), ['a', 'd'])
})

test('closing the currently recorded drill branch leaves main recording alive', async () => {
  const { e, capture, tabs } = setupDrill()
  await capture.setDrillCaptureTabs(['a'])
  await e.visitTab('b')
  const browser = new Browser()
  Object.assign(browser, { tabs, activeTabId: 'c', compositeTabs: new Map(), setTabLoading() {}, coolTab: tab => browser.performCoolTab(tab), broadcastTabs: () => e.refreshTabScope(),
    _state: { get capturing() { return capture.capturing }, get captureTargetTabId() { return capture.captureTargetTabId }, isDrillBranchTab: id => e.tabState().tabs.some(t => t.id === id && t.role === 'branch'), stopCapture: () => capture.stopCapture() }
  })
  await browser.performCloseTab(tabs.find(t => t.id === 'b'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(capture.capturing, true)
  assert.equal(capture.captureTargetTabId, 'a')
  assert.deepEqual(e.activeTabIds(), ['a'])
})


test('show=true displays an explicitly opened page while default opens remain background', async () => {
  const browser = new Browser(), tab = surface('new'), focus = []
  Object.assign(browser, { _state: { backgroundWorkbenchTab: async () => { focus.push('workbench:background') } },
    claimSpareTab: async () => tab, setTabControlled() {}, applyBounds() {},
    startTabNavigation: async () => {}, requireAgentTab: async () => tab, activateTab: async ({ id }) => focus.push(id) })
  await browser.openAgentTab(tab.url, () => {}, 'chat', true)
  // 先退 Workbench、再激活。反过来(或者不退)新 tab 会开在 Workbench **底下**,tab 模型报 active,
  // 人什么都看不到(docs/issues/agent-show-tab-hidden-behind-workbench.md)。
  assert.deepEqual(focus, ['workbench:background', 'new'])
})

test('an explicitly opened external tab becomes the current drill branch without changing foreground', async () => {
  const { e, capture, tabs, active } = setupDrill()
  const d = tabs.find(t => t.id === 'd')
  d.url = 'https://external.example/details'; d.view.webContents.getURL = () => d.url
  await capture.setDrillCaptureTabs(['a'])
  await e.admitBranch('d', 'a', d.url)
  await e.openBranchIfNewTab('d')
  assert.equal(e.currentDrillTabId, 'd')
  assert.equal(e.homeTabId, 'a')
  assert.equal(capture.captureTargetTabId, 'd')
  assert.equal(active(), 'c')
})

test('finishing a branch with a duplicate URL closes the current tab ID', async () => {
  const { e, tabs } = setupDrill(), closed = []
  const url = tabs[0].url
  e.branchStack = [{ tabId: 'b', parentTabId: 'a', url }, { tabId: 'd', parentTabId: 'a', url }]
  e.currentDrillTabId = 'd'
  e.deps.closeTab = async id => closed.push(id)
  e.observeLanding = async () => {}
  await e.closeBranchFor(url)
  assert.deepEqual(closed, ['d'])
  assert.deepEqual(e.branchStack.map(t => t.tabId), ['b'])
})
