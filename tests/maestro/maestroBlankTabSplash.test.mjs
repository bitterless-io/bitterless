// 空白新标签页必须让宿主页那张 Bitterless 底图透出来 —— 预备空白页(about:blank)是内部引导,
// 不是内容。显出来就是一块盖住底图的不透明矩形,深色外观下即黑屏。
// 契约:docs/issues/maestro-blank-new-tab-paints-black.md · docs/plan/tasks/maestro-local-home-branding-008.md
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
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

const Browser = actualMembers('src/main/maestro/windows/main/maestroBrowserView.service.ts', [
  'initializeViewSlot', 'startTabNavigation', 'isLiveTabView', 'ensureWarm', 'activateTab', 'claimSpareTab', 'newTab',
  'navigate', 'attachViewListeners', 'schedulePrewarmSpare', 'prewarmSpare', 'showsPreparedBlank', 'revealTabContent'
], {
  prepareBrowserDocument, xpcMain: { broadcast() {} }, bindBrowserHistoryRecorder() {}, browserHistory: {},
  isWorkbenchInternalUrl: () => false, getMaestroPreviewOpener: () => null, normalizeUrl: url => url,
  focusAddressBarForBlankTab() {}
})

function fixture(context, options = {}) {
  const service = new Browser()
  const traces = []
  Object.assign(service, {
    tabs: [], tabSeq: 0, lifecycleEpoch: 0, activationGeneration: 0, initializingViews: new WeakMap(), compositeTabs: new Map(),
    spareSlot: null, spareWarmTask: null, activeTabId: null, creatingTab: false,
    _state: { emitTrace: event => traces.push(event), switchCaptureTarget: () => Promise.resolve(), layout() {}, opBounds: null, dismissBrowserHistory() {} },
    setTabLoading(tab, loading) { tab.loading = loading }, broadcastTabs() {}, broadcastNavState() {}, displayUrl: tab => tab.url,
    setOperationView(view) { this._state.operationView = view }, getActiveTab() { return this.tabs.find(tab => tab.id === this.activeTabId) },
    setCompositeActive() {}, isPinnedHomeTab: tab => tab?.kind === 'home', openPinnedHomeDevTools() {}, applyBounds() {},
    sendTabNav() {}, sendTitle() {}, preventPinnedHomeEscape: () => false, injectStoredButtonForTab() {},
    ownerOf(view) { return this.tabs.find(tab => tab.view === view) }, enforceWarmCap: async () => {},
    setTabControlled() {}, hideTabContent(tab) { if (tab.view) tab.view.setVisible(false) }
  })
  service.buildViewSlot = () => {
    const wc = new EventEmitter()
    Object.assign(wc, {
      url: '', loads: [], destroyed: false, getURL() { return this.url }, isDestroyed() { return this.destroyed }, stop() {}, setWindowOpenHandler() {},
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      async loadURL(url) {
        this.loads.push(url)
        this.url = url
        if (url === 'about:blank') return
        if (options.loadError) {
          this.emit('did-fail-load', {}, -105, 'site failed', url, true)
          throw new Error('site failed')
        }
        this.emit('did-start-navigation', { isMainFrame: true, url })
        this.emit('did-navigate', {}, url)
      },
      reload() { this.loads.push('reload') }
    })
    const view = { webContents: wc, visible: null, setVisible(value) { this.visible = value } }
    const capture = { async prepareNavigation() {}, async attach() {}, isSuspended: () => false, detach() {}, suspend() {} }
    service.attachViewListeners(view)
    return service.initializeViewSlot({ view, capture, replay: {} })
  }
  context.after(() => { if (service.spareWarmTask) clearImmediate(service.spareWarmTask); service.lifecycleEpoch++ })
  return { service, traces }
}

test('a blank New tab never shows its prepared blank document', async context => {
  const { service } = fixture(context)
  await service.newTab()
  await flush()
  const tab = service.tabs[0]
  assert.equal(tab.url, '')
  assert.deepEqual(tab.view.webContents.loads, ['about:blank'], '预备空白页照旧装,首次导航的修复不回退')
  assert.equal(tab.view.visible, false, '空白 tab 的 view 不许盖住宿主底图')
  assert.equal(service.showsPreparedBlank(tab), true)
  // 再点一次这个 tab 也不会把它显出来。
  await service.activateTab({ id: tab.id })
  assert.equal(tab.view.visible, false)
})

test('the view appears when the real document commits, not when navigation starts', async context => {
  const { service } = fixture(context)
  await service.newTab()
  await flush()
  const tab = service.tabs[0]
  assert.equal(tab.view.visible, false)
  await service.navigate({ url: 'https://example.com/' })
  await flush()
  assert.deepEqual(tab.view.webContents.loads, ['about:blank', 'https://example.com/'])
  assert.equal(tab.view.visible, true, '文档提交后立刻显示页面')
  assert.equal(service.showsPreparedBlank(tab), false)
})

test('an already loaded tab stays visible across switches, and a blank one stays hidden', async context => {
  const { service } = fixture(context)
  await service.newTab()
  await flush()
  const loaded = service.tabs[0]
  await service.navigate({ url: 'https://example.com/' })
  await flush()
  await service.newTab()
  await flush()
  const blank = service.tabs[1]
  assert.equal(loaded.view.visible, false, '切走的 tab 照旧隐藏')
  assert.equal(blank.view.visible, false)
  await service.activateTab({ id: loaded.id })
  await flush()
  assert.equal(loaded.view.visible, true, '装着真实文档的 tab 一切回来就显示')
})

test('a failed load reveals the tab instead of leaving it on the splash', async context => {
  const { service } = fixture(context, { loadError: true })
  await service.newTab()
  await flush()
  const tab = service.tabs[0]
  await service.navigate({ url: 'https://broken.example/' }).catch(() => undefined)
  await flush()
  assert.equal(tab.browserError?.status, 'load-failed')
  assert.equal(tab.view.visible, true, '打不开也要现身 —— 卡在底图上看起来像点了没反应')
})
