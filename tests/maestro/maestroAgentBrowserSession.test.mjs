import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import ts from 'typescript'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import less from 'less'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: { contents: `export * from './src/main/maestro/drive/agentBrowserUse'; export * from './src/main/maestro/drive/agentBrowserSession'; export * from './src/main/maestro/drive/browserNavigation'; export * from './src/main/maestro/drive/requestExec.helper'; export * from './src/main/maestro/drive/apiSafety'; export * from './src/main/maestro/capture/traceTimeline'; export * from './src/main/agent/runtime/agentPrompt';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', tsconfig: resolve(root, 'tsconfig.node.json')
})
const real = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

function load(path, dependencies) {
  const output = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(name => dependencies[name] ?? require(name), module, module.exports)
  return module.exports
}

function members(path, names, bindings = {}) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true)
  const found = source.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]).filter(node => names.includes(node.name?.getText(source)))
  assert.equal(found.length, names.length, `Missing actual members from ${path}`)
  const output = ts.transpileModule(`class Actual { ${found.map(node => node.getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(bindings), `${output};return Actual`)(...Object.values(bindings))
}

const Browser = members('src/main/maestro/windows/main/maestroBrowserView.service.ts', ['describeAgentTab', 'requireAgentTab', 'openAgentTab', 'activeBrowserUseTabs', 'controlDepth', 'setTabControlled', 'setActiveBrowserUseTabs'])
const Controller = members('src/main/maestro/windows/main/maestroWindow.controller.ts', ['browserSessions', 'browserUse', 'browserToolOwners', 'tabs', 'activeTabId', 'beginBrowserTurn', 'agentBrowserSession', 'browserTabsChanged', 'browserPopupOwner', 'browserPopupOpened', 'withAgentBrowserTarget', 'showAgentBrowserTab'], { AgentBrowserSessions: real.AgentBrowserSessions, AgentBrowserUse: real.AgentBrowserUse, xpcMain: { broadcast() {} } })
const { RequestExecService } = load('src/main/maestro/drive/requestExec.service.ts', {
  'node:async_hooks': { AsyncLocalStorage }, inversify: { injectable: () => target => target },
  './browserNavigation': real,
  '@maestro-main/capture/networkInterception': {}, '@maestro-main/capture/traceTimeline': real,
  '@maestro-main/drive/apiSafety': real, '@maestro-main/drive/skillScript': {},
  '@maestro-main/skills/apiProfile.service': { readApiProfile: () => [] },
  '@maestro-main/tasks/taskRegistry.service': { taskRegistry: {} },
  '@maestro-main/drive/confirmPayload': { buildUnknownConfirmPayload: () => ({}) },
  '@maestro-shared/iocHelper/ioc.helper': { CommonService: class {} }, './requestExec.helper': real
})

function setup() {
  const calls = []
  const tab = (id) => ({ id, kind: 'browser', title: `Title ${id}`, url: `https://${id}.example`, debuggerEnabled: true,
    view: { webContents: { isDestroyed: () => false, isCrashed: () => false } },
    capture: { prepareNavigation: async () => {}, snapshot: async () => ({ ok: true, title: id, nodeCount: 1, yaml: `- button ${id} [ref=e1]` }) },
    replay: { apiFetch: async () => { calls.push(id); return { ok: true, status: 200, data: id } }, runUiActions: async () => { calls.push(id); return { ok: true, results: [] } }, runCommands: async () => ({ ok: true, results: [] }) }
  })
  const a = tab('a'), b = tab('b'), popup = tab('popup')
  const browser = new Browser()
  Object.assign(browser, { tabs: [a, b, popup], activeTabId: 'a', _state: { opBounds: null }, warmAndLoad: async () => {}, displayUrl: tab => tab.url, applyBounds() {}, broadcastTabs() {} })
  const controller = new Controller()
  controller.browserView = browser
  const exec = new RequestExecService()
  exec._state = { tabs: browser.tabs, capture: a.capture, replayEngine: a.replay, currentUrl: a.url, activeTabId: a.id,
    broadcastActivity() {}, emitTrace() {}, lastAgentRun: {}, drainNewTabsNote: () => '', warmAndLoad: async () => {} }
  exec.broadcastApiActivity = () => {}
  exec.confirmApiRequest = async () => true
  controller.requestExec = exec
  controller.activateTab = async ({ id }) => { browser.activeTabId = id; exec._state.capture = browser.tabs.find(tab => tab.id === id)?.capture; exec._state.replayEngine = browser.tabs.find(tab => tab.id === id)?.replay }
  controller.beginBrowserTurn('chat-a', 'a')
  controller.beginBrowserTurn('chat-b', 'b')
  return { controller, browser, exec, a, b, popup, calls }
}

test('initial target is frozen before first tool, chat-only turns do not enroll tabs, and sessions stay independent', async () => {
  const { controller, calls } = setup()
  assert.deepEqual(controller.agentBrowserSession('chat-a').tabs, [])
  await controller.activateTab({ id: 'b' })
  await controller.withAgentBrowserTarget('chat-a', undefined, () => controller.requestExec.toolBrowserExec('[{"command":"fetch","url":"/data"}]'))
  controller.beginBrowserTurn('chat-a', 'b') // Next turn started while B/chat A is foreground.
  await controller.withAgentBrowserTarget('chat-a', undefined, () => controller.requestExec.toolBrowserExec('[{"command":"fetch","url":"/data"}]'))
  await controller.withAgentBrowserTarget('chat-b', undefined, () => controller.requestExec.toolBrowserExec('[{"command":"fetch","url":"/data"}]'))
  assert.deepEqual(calls, ['a', 'a', 'b'])
  assert.equal(controller.agentBrowserSession('chat-a').selectedTabId, 'a')
  assert.deepEqual(controller.agentBrowserSession('chat-a').tabs.map(tab => tab.id), ['a'])
})

test('snapshot and UI actions stay on A after foreground changes; explicit B adds a secondary target without selecting it', async () => {
  const { controller, exec, calls } = setup()
  const snapshot = await controller.withAgentBrowserTarget('chat-a', undefined, id => exec.toolPageSnapshot(id))
  assert.match(snapshot, /# tab: a/)
  await controller.activateTab({ id: 'b' })
  await controller.withAgentBrowserTarget('chat-a', undefined, () => exec.toolUiAct('[{"action":"click","ref":"e1"}]'))
  const secondary = await controller.withAgentBrowserTarget('chat-a', 'b', id => exec.toolPageSnapshot(id))
  assert.match(secondary, /# tab: b/)
  assert.deepEqual(calls, ['a'])
  assert.deepEqual(controller.agentBrowserSession('chat-a').tabs.map(tab => tab.id), ['a', 'b'])
  assert.equal(controller.agentBrowserSession('chat-a').selectedTabId, 'a')
  controller.browserSessions.enroll('chat-a', 'b', true)
  assert.equal(controller.agentBrowserSession('chat-a').selectedTabId, 'b')
})

test('API approval and command batches retain exact replay even while foreground changes', async () => {
  const { controller, exec, calls } = setup()
  let approve
  let reached
  const waiting = new Promise(resolve => { reached = resolve })
  exec.confirmApiRequest = async () => { reached(); return new Promise(resolve => { approve = resolve }) }
  const result = controller.withAgentBrowserTarget('chat-a', undefined, () => exec.toolBrowserExec('[{"command":"fetch","url":"/write","method":"POST"},{"command":"fetch","url":"/next"}]'))
  await waiting
  await controller.activateTab({ id: 'b' })
  approve(true)
  assert.equal(JSON.parse(await result).ok, true)
  assert.deepEqual(calls, ['a', 'a'])
})

test('web_nav goes back on the captured session target while foreground changes during navigation', async () => {
  const { controller, exec, a } = setup()
  const wc = Object.assign(new EventEmitter(), a.view.webContents, {
    getURL: () => a.url, getTitle: () => a.title, isLoadingMainFrame: () => false,
    navigationHistory: { canGoBack: () => true, canGoForward: () => false, goBack: () => {
      wc.emit('did-start-navigation', { isMainFrame: true })
      void controller.activateTab({ id: 'b' })
      a.url = 'https://a.example/previous'
      wc.emit('did-finish-load')
    } }
  })
  a.view.webContents = wc
  const result = JSON.parse(await controller.withAgentBrowserTarget('chat-a', undefined, () => exec.toolWebNav('back')))
  assert.equal(result.tab_id, 'a')
  assert.equal(result.url, 'https://a.example/previous')
  assert.equal(controller.activeTabId, 'b')
  assert.equal(controller.agentBrowserSession('chat-a').selectedTabId, 'a')
  assert.deepEqual(wc.eventNames(), [])
})

test('popup owner is the in-flight source session, not foreground or every historical owner', async () => {
  const { controller } = setup()
  controller.browserSessions.enroll('chat-b', 'a', false)
  assert.equal(controller.browserPopupOwner('a'), undefined)
  await controller.withAgentBrowserTarget('chat-a', undefined, async () => {
    await controller.activateTab({ id: 'b' })
    const owner = controller.browserPopupOwner('a')
    assert.equal(owner, 'chat-a')
    assert.equal(controller.browserPopupOwner('b'), undefined)
    controller.browserPopupOpened(owner, 'popup')
    return 'ok'
  })
  assert.equal(controller.browserPopupOwner('a'), undefined)
  assert(controller.agentBrowserSession('chat-a').tabs.some(tab => tab.id === 'popup'))
  assert(!controller.agentBrowserSession('chat-b').tabs.some(tab => tab.id === 'popup'))
})

for (const state of ['closed', 'destroyed', 'crashed', 'load-failed', 'unavailable']) {
  test(`${state} target returns explicit failure and retained metadata without acting on healthy foreground B`, async () => {
    const { controller, browser, exec, a, calls } = setup()
    controller.browserSessions.enroll('chat-a', 'a', true)
    await controller.activateTab({ id: 'b' })
    if (state === 'closed') browser.tabs.splice(browser.tabs.indexOf(a), 1)
    else if (state === 'destroyed') a.view.webContents.isDestroyed = () => true
    else if (state === 'crashed') a.view.webContents.isCrashed = () => true
    else if (state === 'unavailable') a.kind = 'onlypreview'
    else a.browserError = { status: 'load-failed', error: 'ERR_FAILED' }
    const result = await controller.withAgentBrowserTarget('chat-a', undefined, () => exec.toolBrowserExec('[{"command":"fetch","url":"/write","method":"POST"}]'))
    assert.match(result, /^ERROR: Tab a:/)
    assert.match(result, /open_tab/)
    assert.deepEqual(calls, [])
    assert.equal(controller.agentBrowserSession('chat-a').tabs[0].status, state)
    assert.equal(controller.agentBrowserSession('chat-a').tabs[0].title, 'Title a')
  })
}

test('target destroyed while awaiting approval cannot act after approval', async () => {
  const { controller, exec, a, calls } = setup()
  exec.confirmApiRequest = async () => { a.view.webContents.isDestroyed = () => true; await controller.activateTab({ id: 'b' }); return true }
  const result = await controller.withAgentBrowserTarget('chat-a', undefined, () => exec.toolBrowserExec('[{"command":"fetch","url":"/write","method":"POST"}]'))
  assert.match(result, /^ERROR: Tab a:/)
  assert.deepEqual(calls, [])
})

test('initial target closed before the first browser call retains its URL for explicit recovery', async () => {
  const { controller, browser, a } = setup()
  browser.tabs.splice(browser.tabs.indexOf(a), 1)
  assert.match(await controller.withAgentBrowserTarget('chat-a', undefined, async () => 'unexpected'), /^ERROR: Tab a:/)
  assert.equal(controller.agentBrowserSession('chat-a').tabs[0].url, 'https://a.example')
  assert.equal(controller.agentBrowserSession('chat-a').tabs[0].status, 'closed')
})

test('explicit reopen creates and selects a fresh exact tab without replaying the failed action', async () => {
  const { controller, browser, a, calls } = setup()
  controller.browserSessions.enroll('chat-a', 'a', true)
  a.browserError = { status: 'crashed', error: 'Renderer gone' }
  const fresh = { ...a, id: 'reopened', browserError: undefined, view: { webContents: { isDestroyed: () => false, isCrashed: () => false, loadURL: async url => { calls.push(`navigate ${url}`) } } } }
  browser.claimSpareTab = async () => { browser.tabs.push(fresh); return fresh }
  browser.startTabNavigation = (tab, { url }) => tab.view.webContents.loadURL(url)
  browser.activateTab = controller.activateTab
  browser.broadcastTabs = () => controller.browserTabsChanged()
  const reopened = await browser.openAgentTab(a.url, id => controller.browserSessions.enroll('chat-a', id, true))
  assert.equal(reopened.id, 'reopened')
  assert.equal(controller.agentBrowserSession('chat-a').selectedTabId, 'reopened')
  assert.equal(controller.agentBrowserSession('chat-a').tabs[0].status, 'crashed')
  assert.deepEqual(calls, ['navigate https://a.example'])
  await assert.rejects(browser.openAgentTab('file:///tmp/no', () => {}), /http\(s\)/)
})

test('temporary deep-fetch target never replaces the initiating operation target', async () => {
  const { controller } = setup()
  controller.browserSessions.enroll('chat-a', 'popup', false, false)
  assert.equal(controller.agentBrowserSession('chat-a').selectedTabId, undefined)
  await controller.withAgentBrowserTarget('chat-a', undefined, async () => 'ok')
  assert.equal(controller.agentBrowserSession('chat-a').selectedTabId, 'a')
  controller.browserSessions.release('chat-a', 'popup')
  assert.deepEqual(controller.agentBrowserSession('chat-a').tabs.map(tab => tab.id), ['a'])
  assert.equal(controller.agentBrowserSession('chat-a').selectedTabId, 'a')
})

test('an existing drill anchor stays authoritative only for its owning session', async () => {
  const { controller, exec, calls } = setup()
  controller.browserSessions.enroll('chat-a', 'a', true)
  controller.drillTrio = { run: { ownerSessionId: 'chat-a', isDrilling: true }, host: { isExploring: true, anchorTabId: 'popup', exploreSessionOrNull: () => ({ refreshTabScope() {}, tabState: () => ({}), ownsActiveTab: id => id === 'popup' }) } }
  await controller.activateTab({ id: 'b' })
  await controller.withAgentBrowserTarget('chat-a', undefined, () => exec.toolBrowserExec('[{"command":"fetch","url":"/data"}]'))
  await controller.withAgentBrowserTarget('chat-b', undefined, () => exec.toolBrowserExec('[{"command":"fetch","url":"/data"}]'))
  assert.deepEqual(calls, ['popup', 'b'])
  assert.equal(controller.agentBrowserSession('chat-a').selectedTabId, 'popup')
  assert.equal(controller.agentBrowserSession('chat-b').selectedTabId, 'b')
})

test('selected-chat store rejects late fetches and other-chat updates; view failure is retained', async () => {
  const pending = new Map()
  const shown = []
  const { AgentBrowserStore } = load('src/renderer/maestro/control/src/store/agentBrowser.store.ts', {
    vue: { reactive: value => value },
    '@renderer/common/i18n/i18n.helper': { i18nHelper: { maestroControl: { chat: { browserTabs: { status: { unavailable: 'Unavailable' } } } } } },
    './agentBrowser.api': {
      getAgentBrowserSession: id => new Promise(resolve => pending.set(id, resolve)),
      showAgentBrowserTab: async (sessionId, tabId) => { shown.push({ sessionId, tabId }); return { ok: false, error: 'Target crashed' } }
    }
  })
  const store = new AgentBrowserStore()
  const first = store.select('chat-a')
  const second = store.select('chat-b')
  store.accept({ sessionId: 'chat-a', tabs: [{ id: 'wrong' }] })
  pending.get('chat-a')({ sessionId: 'chat-a', tabs: [{ id: 'wrong' }] })
  await first
  assert.equal(store.state, null)
  store.accept({ sessionId: 'chat-b', selectedTabId: 'b', tabs: [{ id: 'b', status: 'ready' }] })
  pending.get('chat-b')({ sessionId: 'chat-b', tabs: [] })
  await second
  assert.equal(store.state.tabs[0].id, 'b')
  await store.show('b')
  assert.deepEqual(shown, [{ sessionId: 'chat-b', tabId: 'b' }])
  assert.equal(store.error, 'Target crashed')
  assert.equal(store.state.selectedTabId, 'b')
})

test('human list click shows a secondary tab without changing the selected operation target, and failures are visible', async () => {
  const { controller, a } = setup()
  controller.browserSessions.enroll('chat-a', 'a', true)
  controller.browserSessions.enroll('chat-a', 'b', false)
  assert.equal((await controller.showAgentBrowserTab({ sessionId: 'chat-a', tabId: 'b' })).ok, true)
  assert.equal(controller.activeTabId, 'b')
  assert.equal(controller.agentBrowserSession('chat-a').selectedTabId, 'a')
  a.browserError = { status: 'crashed', error: 'Renderer gone' }
  assert.equal((await controller.showAgentBrowserTab({ sessionId: 'chat-a', tabId: 'a' })).ok, false)
  assert.equal(controller.activeTabId, 'b')
})

test('Table 3 contains structured session targets alongside foreground miniapp context', () => {
  const { controller } = setup()
  controller.browserSessions.enroll('chat-a', 'a', true)
  controller.browserSessions.enroll('chat-a', 'b', false)
  const prompt = real.buildAgentTurnPrompt({ message: 'continue', nowLocal: 'now', activeTab: { state: 'miniapp', app: 'OnlyPreview' }, browserSession: controller.agentBrowserSession('chat-a'), currentUrl: 'https://a.example', briefs: [] })
  assert.match(prompt, /Active tab: mini-app/)
  assert.match(prompt, /"operation_tab_id":"a"/)
  assert.match(prompt, /"operation_tab_ids":\["a","b"\]/)
  assert.match(prompt, /"status":"ready"/)
  assert.match(prompt, /foreground context never authorizes changing these targets/)
})

test('Vue template, script, and Less compile; count/list are scoped to selected chat and localized', async () => {
  const filename = resolve(root, 'src/renderer/maestro/control/src/AgentBrowserTabs.vue')
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'agent-browser-tabs' })
  const template = compileTemplate({ id: 'agent-browser-tabs', filename, source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.match(script.content, /props\.sessionId/)
  assert.match(script.content, /copy\.value\.associated/)
  assert.doesNotMatch(script.content, /copy\.value\.operating/)
  assert.match(template.code, /selectedTabId/)
  assert.match(template.code, /copy\.status|\.status\[tab\.status\]/)
  const css = await less.render(read('src/renderer/maestro/control/src/AgentBrowserTabs.less'))
  assert.match(css.css, /focus-visible/)
  assert.match(css.css, /border: 0/)
})
