import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
function actualMembers(path, names, bindings = {}) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true)
  const found = source.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]).filter(node => names.includes(node.name?.getText(source)))
  assert.equal(found.length, names.length)
  const output = ts.transpileModule(`class Actual { ${found.map(node => node.getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(bindings), `${output}; return Actual`)(...Object.values(bindings))
}
const preparationSource = ts.transpileModule(read('src/main/maestro/windows/main/browserDocumentPreparation.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const helperModule = { exports: {} }
new Function('exports', preparationSource)(helperModule.exports)
const { prepareBrowserDocument } = helperModule.exports
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const Browser = actualMembers('src/main/maestro/windows/main/maestroBrowserView.service.ts', [
  'initializeViewSlot', 'startTabNavigation', 'isLiveTabView', 'ensureWarm', 'warmAndLoad', 'activateTab', 'claimSpareTab', 'openControlledBlankTab',
  'navigate', 'reload', 'goBack', 'goForward', 'attachViewListeners', 'schedulePrewarmSpare', 'prewarmSpare'
], {
  prepareBrowserDocument, localHomeEntry: () => ({ url: 'file:///home.html' }), xpcMain: { broadcast() {} },
  bindBrowserHistoryRecorder() {}, browserHistory: {}, isWorkbenchInternalUrl: () => false,
  getMaestroPreviewOpener: () => null, normalizeUrl: url => url
})

function fixture(context, options = {}) {
  const service = new Browser()
  const traces = [], views = []
  Object.assign(service, {
    tabs: [], tabSeq: 0, lifecycleEpoch: 0, activationGeneration: 0, initializingViews: new WeakMap(), compositeTabs: new Map(),
    spareSlot: null, spareWarmTask: null, activeTabId: null,
    _state: { emitTrace: event => traces.push(event), switchCaptureTarget: () => options.recording ?? Promise.resolve(), layout() {}, opBounds: null },
    setTabLoading(tab, loading) { tab.loading = loading }, broadcastTabs() {}, broadcastNavState() {}, displayUrl: tab => tab.url,
    setOperationView(view) { this._state.operationView = view }, getActiveTab() { return this.tabs.find(tab => tab.id === this.activeTabId) },
    setCompositeActive() {}, isPinnedHomeTab: tab => tab?.kind === 'home', openPinnedHomeDevTools() {}, applyBounds() {},
    sendTabNav() {}, sendTitle() {}, preventPinnedHomeEscape: () => false, injectStoredButtonForTab() {},
    ownerOf(view) { return this.tabs.find(tab => tab.view === view) }, enforceWarmCap: async () => {},
    setTabControlled(id, on) { const tab = this.tabs.find(tab => tab.id === id); if (tab) tab.controlled = on },
    async closeTab({ id }) { const tab = this.tabs.find(tab => tab.id === id); tab.view.webContents.destroyed = true; this.tabs.splice(this.tabs.indexOf(tab), 1) }
  })
  service.buildViewSlot = () => {
    const wc = new EventEmitter()
    Object.assign(wc, {
      url: '', loads: [], destroyed: false, getURL() { return this.url }, isDestroyed() { return this.destroyed }, stop() {}, setWindowOpenHandler() {},
      navigationHistory: { canGoBack: () => true, canGoForward: () => true, goBack() {}, goForward() {} },
      async loadURL(url) {
        this.loads.push(url)
        if (url === 'about:blank') {
          this.url = url
          this.emit('did-start-loading')
          await options.blank?.promise
          this.emit('page-title-updated', {}, '')
          this.emit('did-stop-loading')
          this.emit('did-finish-load')
          return
        }
        if (options.loadError) throw new Error('site failed')
        this.url = url
        this.emit('did-start-navigation', { isMainFrame: true, url })
        this.emit('did-navigate', {}, url)
      },
      reload() { this.loads.push('reload') }
    })
    const view = { webContents: wc, setVisible(value) { this.visible = value } }
    views.push(view)
    const capture = {
      async prepareNavigation() { await options.ready?.promise },
      async attach() { await this.prepareNavigation(); await options.fullAttach?.promise },
      isSuspended: () => false, detach() {}, suspend() {}
    }
    service.attachViewListeners(view)
    return service.initializeViewSlot({ view, capture, replay: {} })
  }
  const tab = (id, url = `https://${id}.example/`) => {
    const result = { id, kind: 'browser', url, title: `Saved ${id}`, favicon: 'saved-icon', debuggerEnabled: true, navigationStarted: false, view: null }
    service.tabs.push(result)
    return result
  }
  context.after(() => { if (service.spareWarmTask) clearImmediate(service.spareWarmTask); service.lifecycleEpoch++ })
  return { service, tab, views, traces }
}

test('cold restored activation displays immediately and first request waits only required setup', async context => {
  const ready = deferred(), fullAttach = deferred(), recording = deferred()
  const { service, tab } = fixture(context, { ready, fullAttach, recording: recording.promise })
  const a = tab('a')
  await service.activateTab({ id: a.id })
  assert.equal(a.view.visible, true)
  assert.equal(a.navigationStarted, true)
  assert.deepEqual(a.view.webContents.loads, ['about:blank'])
  ready.resolve()
  await flush()
  assert.deepEqual(a.view.webContents.loads, ['about:blank', a.url])
  await service.activateTab({ id: a.id })
  await service.warmAndLoad(a)
  assert.equal(a.view.webContents.loads.length, 2)
})

test('a warm restored tab with no first navigation is loaded once', async context => {
  const { service, tab } = fixture(context)
  const a = tab('a')
  await service.ensureWarm(a)
  await service.activateTab({ id: a.id })
  await service.warmAndLoad(a)
  assert.deepEqual(a.view.webContents.loads, ['about:blank', a.url])
})

test('blank prewarm events cannot replace saved metadata or clear target loading/error', async context => {
  const blank = deferred(), ready = deferred()
  const { service, tab } = fixture(context, { blank, ready })
  const a = tab('a')
  await service.activateTab({ id: a.id })
  const wc = a.view.webContents
  a.browserError = { status: 'load-failed', error: 'existing' }
  wc.emit('page-title-updated', {}, '')
  wc.emit('page-favicon-updated', {}, ['blank-icon'])
  wc.emit('did-start-navigation', { isMainFrame: true, url: 'about:blank' })
  wc.emit('did-fail-load', {}, -105, 'blank failed', 'about:blank', true)
  assert.equal(a.title, 'Saved a'); assert.equal(a.favicon, 'saved-icon'); assert.equal(a.loading, true)
  assert.equal(a.browserError.error, 'existing')
  blank.resolve(); await flush()
  wc.emit('did-stop-loading')
  assert.equal(a.loading, true); assert.equal(a.title, 'Saved a')
  ready.resolve(); await flush()
  assert.equal(a.url, 'https://a.example/')
})

test('typed navigation supersedes queued restore, and background navigation survives foreground switches', async context => {
  const ready = deferred()
  const { service, tab } = fixture(context, { ready })
  const a = tab('a'), b = tab('b')
  await service.activateTab({ id: a.id })
  const typed = service.navigate({ url: 'https://typed.example/new' })
  await service.activateTab({ id: b.id })
  ready.resolve(); await typed; await flush()
  assert.deepEqual(a.view.webContents.loads, ['about:blank', 'https://typed.example/new'])
  assert.deepEqual(b.view.webContents.loads, ['about:blank', b.url])
  assert.equal(service.activeTabId, b.id)
})

test('closed and replaced views cannot receive an old delayed navigation', async context => {
  const ready = deferred()
  const { service, tab } = fixture(context, { ready })
  const a = tab('a'), b = tab('b')
  await service.activateTab({ id: a.id }); const old = a.view
  a.view.webContents.destroyed = true
  await service.ensureWarm(a)
  const replacement = service.startTabNavigation(a)
  await service.activateTab({ id: b.id }); b.closeReady = Promise.resolve()
  ready.resolve(); await replacement; await flush()
  assert.deepEqual(old.webContents.loads, ['about:blank'])
  assert.deepEqual(a.view.webContents.loads, ['about:blank', a.url])
  assert.deepEqual(b.view.webContents.loads, ['about:blank'])
})

test('failed first load is not retried by switching, but explicit reload still works', async context => {
  const options = { loadError: true }
  const { service, tab } = fixture(context, options)
  const a = tab('a'), b = tab('b', '')
  await service.activateTab({ id: a.id }); await flush()
  assert.equal(a.navigationStarted, true); assert.equal(a.browserError.status, 'load-failed')
  await service.activateTab({ id: b.id }); await service.activateTab({ id: a.id }); await flush()
  assert.equal(a.view.webContents.loads.length, 2)
  options.loadError = false
  await service.reload()
  assert.equal(a.view.webContents.loads.at(-1), 'reload')
})

test('required setup failure is visible, stays stopped, and explicit retry reinitializes blank document', async context => {
  const ready = deferred()
  const options = { ready }
  const { service, tab } = fixture(context, options)
  const a = tab('a')
  await service.activateTab({ id: a.id })
  ready.reject(new Error('UA failed')); await flush()
  assert.equal(a.navigationPreparationFailed, true); assert.equal(a.loading, false)
  assert.match(a.browserError.error, /UA failed/)
  await service.activateTab({ id: a.id }); await flush()
  assert.deepEqual(a.view.webContents.loads, ['about:blank'])
  options.ready = undefined
  await service.reload()
  assert.deepEqual(a.view.webContents.loads, ['about:blank', 'about:blank', a.url])
  assert.equal(a.navigationPreparationFailed, false)
})

test('controlled deep_fetch placeholder remains blank even if activated while claim is pending', async context => {
  const cap = deferred()
  const { service } = fixture(context)
  service.enforceWarmCap = () => cap.promise
  const opened = service.openControlledBlankTab('https://controlled.example/')
  const a = service.tabs[0]
  assert.equal(a.externalNavigation, true)
  await service.activateTab({ id: a.id }); await flush()
  assert.equal(a.navigationStarted, false)
  assert.deepEqual(a.view.webContents.loads, ['about:blank'])
  cap.resolve(); const handle = await opened
  await handle.wc.loadURL('https://controlled.example/')
  assert.equal(a.navigationStarted, true)
  await service.activateTab({ id: a.id }); await flush()
  assert.equal(handle.wc.loads.length, 2)
  await handle.done(); await handle.done()
  assert.equal(service.tabs.length, 0)
})

test('replacement spare construction is deferred and reset epoch cancels it', async context => {
  const { service, tab, views } = fixture(context)
  await service.ensureWarm(tab('a'))
  assert.equal(views.length, 1)
  service.lifecycleEpoch++
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(views.length, 1)
})

test('explicit back/forward invalidates queued first navigation', async context => {
  for (const direction of ['goBack', 'goForward']) {
    const ready = deferred()
    const { service, tab } = fixture(context, { ready })
    const a = tab(direction)
    await service.activateTab({ id: a.id })
    await service[direction]()
    ready.resolve(); await flush()
    assert.deepEqual(a.view.webContents.loads, ['about:blank'])
  }
})

const Capture = actualMembers('src/main/maestro/capture/capture.service.ts', ['switchCaptureTarget', 'isCapturableTab', 'captureTargetTab'])
test('pending recording target preparation cannot overwrite a newer foreground or agent target', async () => {
  const gate = deferred(), started = []
  const tab = id => ({ id, kind: 'browser', debuggerEnabled: true, view: { webContents: { isDestroyed: () => false } }, capture: { prepareNavigation: async () => {}, startRecording: async () => started.push(id) } })
  const a = tab('a'), b = tab('b')
  a.documentReady = gate.promise
  const capture = new Capture()
  Object.assign(capture, { capturing: true, captureTargetRequest: 0, _state: { getOperationTabs: () => [a, b] } })
  const previous = capture.switchCaptureTarget(a)
  await capture.switchCaptureTarget(b)
  gate.resolve(); await previous
  assert.deepEqual(started, ['b']); assert.equal(capture.captureTargetTabId, 'b')
})
