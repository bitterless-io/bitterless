import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { basename, dirname } from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { runtime, source } from './onlyPreviewCoreTest.helper.mjs'
import { test } from 'node:test'
const { OnlyPreviewHostRegistry, OnlyPreviewWorkspaceRegistry } = runtime;
const require = createRequire(import.meta.url);
const loadMain = (_path, { stubs }) => {
  const module = { exports: {} };
  const compiled = ts.transpileModule(source('src/main/windows/onlyPreviewFileTab.service.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  new Function('require', 'module', 'exports', '__dirname', compiled)(
    (name) => Object.hasOwn(stubs, name) ? stubs[name] : name.startsWith('node:') ? require(name) : (() => { throw new Error(name); })(),
    module, module.exports, '/fixture/main'
  );
  return module.exports;
};
let fixtureId = 0
// The shared loader keys modules by stub names. Each fixture needs its own service closure.
const freshStubs = (stubs) => ({ ...stubs, [`file-preview-fixture:${++fixtureId}`]: {} })
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const fileTarget = (path) => ({
  rootRealPath: dirname(path), displayPath: dirname(path),
  rootName: basename(dirname(path)), selectedRelativePath: basename(path)
})

const surfaceHarness = (t) => {
  const hosts = new OnlyPreviewHostRegistry()
  const workspaces = new OnlyPreviewWorkspaceRegistry(hosts)
  const state = {
    hosts: [], registrations: [], revokedHosts: [], revokedWorkspaces: [], regions: [],
    views: [], recentWrites: [], inspect: async (path) => fileTarget(path),
    load: async () => undefined, present: async () => undefined
  }
  const issue = hosts.issue.bind(hosts)
  hosts.issue = (...args) => {
    const host = issue(...args)
    state.hosts.push(host)
    return host
  }
  const register = workspaces.registerExternalPreview.bind(workspaces)
  workspaces.registerExternalPreview = (...args) => {
    const fileRef = register(...args)
    state.registrations.push({ hostToken: args[0], fileRef })
    return fileRef
  }
  hosts.onRevoke((host) => state.revokedHosts.push(host.hostToken))
  workspaces.onRevoke((workspace) => state.revokedWorkspaces.push(workspace.workspaceId))

  // These doubles record the host's calls; they neither start Electron nor model rendering.
  class View {
    children = []
    visible = true
    setVisible(value) { this.visible = value }
    setBounds(value) { this.bounds = value }
    addChildView(view) { this.children.push(view) }
    removeChildView(view) { this.children = this.children.filter((child) => child !== view) }
  }
  class WebContentsView extends View {
    constructor(options) {
      super()
      this.options = options
      this.webContents = new EventEmitter()
      this.webContents.closed = 0
      this.webContents.isDestroyed = () => this.webContents.closed > 0
      this.webContents.close = () => { this.webContents.closed++ }
      this.webContents.focus = () => undefined
      this.webContents.loadURL = async (url) => {
        this.url = url
        await state.load(url)
      }
      state.views.push(this)
    }
  }
  class PreviewRegion {
    presentations = []
    destroyed = 0
    constructor() { state.regions.push(this) }
    start(options) { this.options = options }
    async present(hostToken, fileRef) {
      workspaces.getPreviewAuthorityItemRef(hostToken, fileRef)
      this.presentations.push({ hostToken, fileRef })
      await state.present(hostToken, fileRef)
    }
    updateBounds(hostToken, bounds) { this.bounds = { hostToken, ...bounds } }
    focusActiveContent(hostToken) { this.focusedHost = hostToken }
    destroy() { this.destroyed++ }
  }
  const recordRecent = async (...args) => { state.recentWrites.push(args) }
  const { OnlyPreviewFileTabSurface } = loadMain(
    '@main/miniapps/onlypreview/host/onlyPreviewFileTab.service',
    { stubs: freshStubs({
      electron: { View, WebContentsView },
      '@shared/onlypreview/onlyPreview.types': { ONLY_PREVIEW_FIND_FOCUS_EVENT: 'onlypreview/findFocus' },
      'electron-xpc/main': { xpcMain: { broadcast() {} } },
      '@maestro-main/common/shortcutsHelper/shortcuts.helper': { enrollMaestroShortcutContents() {} },
      '@electron-toolkit/utils': { is: { dev: false } },
      '@main/fileSearch/fileSearchWindow.service': {
        fileSearchWindowService: { inspectTarget: (path) => state.inspect(path) }
      },
      '@main/miniapps/onlypreview/onlyPreviewHost.registry': { onlyPreviewHostRegistry: hosts },
      '@main/miniapps/onlypreview/onlyPreviewWorkspace.registry': { onlyPreviewWorkspaceRegistry: workspaces },
      '@main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service': {
        OnlyPreviewPreviewRegionService: PreviewRegion
      },
      '@main/miniapps/onlypreview/views/onlyPreviewRendererTarget.service': {
        configureOnlyPreviewNavigationFence: () => undefined,
        getOnlyPreviewRendererTarget: () => ({ url: 'file:///fixture/preview.html' }),
        getOnlyPreviewRendererArguments: (host, surface) => [host.hostToken, surface]
      },
      '@main/miniapps/onlypreview/onlyPreviewRecents.runtime': { recordOnlyPreviewRecentFile: recordRecent },
      '../onlyPreviewRecents.runtime': { recordOnlyPreviewRecentFile: recordRecent }
    }) }
  )
  const window = { contentView: new View(), isDestroyed: () => false }
  const makeSurface = (path) => {
    const owner = {
      window, path, open: true, attachments: [],
      rectangle: { x: 10, y: 50, width: 800, height: 600 },
      isOpen() { return this.open },
      bounds() { return this.rectangle },
      attach(container) {
        this.attachments.push(container)
        window.contentView.addChildView(container)
      },
      close() { this.open = false; surface.dispose() }
    }
    const surface = new OnlyPreviewFileTabSurface(owner)
    t.after(() => surface.dispose())
    return { owner, surface }
  }
  return { state, hosts, workspaces, window, makeSurface }
}

test('file tabs keep independent hosts, previews and file authority without recording OnlyPreview recents', async (t) => {
  const h = surfaceHarness(t)
  const first = h.makeSurface('/outside/first.md')
  const second = h.makeSurface('/elsewhere/second.pdf')
  await Promise.all([first.surface.open(), second.surface.open()])
  const [a, b] = h.state.registrations
  assert.notEqual(a.hostToken, b.hostToken)
  assert.notEqual(a.fileRef.workspaceId, b.fileRef.workspaceId)
  assert.deepEqual(h.window.contentView.children, [first.surface.container, second.surface.container])
  assert.deepEqual(h.state.regions.map((region) => region.presentations), [[a], [b]])
  assert.equal(h.workspaces.getExternalPreviewNativePath(a.hostToken, a.fileRef), '/outside/first.md')
  assert.equal(h.workspaces.getExternalPreviewNativePath(b.hostToken, b.fileRef), '/elsewhere/second.pdf')
  assert.throws(() => h.workspaces.getPreviewAuthorityItemRef(a.hostToken, b.fileRef), { code: 'WORKSPACE_ACCESS_DENIED' })
  assert.throws(() => h.workspaces.getPreviewAuthorityItemRef(b.hostToken, a.fileRef), { code: 'WORKSPACE_ACCESS_DENIED' })
  assert.equal(h.workspaces.restore(a.hostToken), null)
  assert.equal(h.workspaces.restore(b.hostToken), null)
  assert.deepEqual(h.state.views.map((view) => view.options.webPreferences.additionalArguments), [
    [a.hostToken, 'shell'], [b.hostToken, 'shell']
  ])
  assert.deepEqual(h.state.views.map((view) => new URL(view.url).searchParams.get('path')), [
    '/outside/first.md', '/elsewhere/second.pdf'
  ])
  assert.deepEqual(h.state.recentWrites, [])

  first.surface.setActive(true)
  first.surface.setActive(false)
  second.surface.setActive(true)
  assert.equal(first.surface.container.visible, false)
  assert.equal(second.surface.container.visible, true)
  assert.equal(h.state.regions[1].focusedHost, b.hostToken)
  assert.deepEqual(h.state.regions[1].bounds, {
    hostToken: b.hostToken, x: 0, y: 40, width: 800, height: 560
  })
})

test('closing one file tab revokes only its host and file authority; repeated disposal is harmless', async (t) => {
  const h = surfaceHarness(t)
  const first = h.makeSurface('/outside/first.md')
  const second = h.makeSurface('/outside/second.md')
  await first.surface.open()
  await second.surface.open()
  const [a, b] = h.state.registrations
  first.owner.close()
  first.surface.dispose()
  assert.deepEqual(h.state.revokedHosts, [a.hostToken])
  assert.deepEqual(h.state.revokedWorkspaces, [a.fileRef.workspaceId])
  assert.throws(() => h.workspaces.getPreviewAuthorityItemRef(a.hostToken, a.fileRef), { code: 'HOST_NOT_FOUND' })
  assert.equal(h.hosts.isLive(b.hostToken), true)
  assert.equal(h.workspaces.getExternalPreviewNativePath(b.hostToken, b.fileRef), '/outside/second.md')
  assert.deepEqual(h.state.regions.map((region) => region.destroyed), [1, 0])
  assert.deepEqual(h.state.views.map((view) => view.webContents.closed), [1, 0])
  assert.deepEqual(h.window.contentView.children, [second.surface.container])
})

test('closing while target inspection is pending never attaches a view or issues file authority', async (t) => {
  const h = surfaceHarness(t)
  const gate = deferred()
  h.state.inspect = () => gate.promise
  const { owner, surface } = h.makeSurface('/outside/pending.md')
  const pending = surface.open()
  owner.close()
  gate.resolve(fileTarget(owner.path))
  await assert.rejects(pending, /closed during startup/)
  assert.deepEqual(h.state.registrations, [])
  assert.deepEqual(h.state.views, [])
  assert.deepEqual(owner.attachments, [])
  assert.deepEqual(h.window.contentView.children, [])
  assert.deepEqual(h.state.revokedHosts, [h.state.hosts[0].hostToken])
  assert.equal(h.state.regions[0].destroyed, 1)
})

test('closing while the toolbar loads prevents late preview presentation and revokes the registered file', async (t) => {
  const h = surfaceHarness(t)
  const loading = deferred()
  const enteredLoad = deferred()
  h.state.load = () => { enteredLoad.resolve(); return loading.promise }
  const { owner, surface } = h.makeSurface('/outside/pending.md')
  const pending = surface.open()
  await enteredLoad.promise
  owner.close()
  loading.resolve()
  await assert.rejects(pending, /closed during startup/)
  const registration = h.state.registrations[0]
  assert.deepEqual(h.state.revokedWorkspaces, [registration.fileRef.workspaceId])
  assert.deepEqual(h.state.regions[0].presentations, [])
  assert.equal(h.state.views[0].webContents.closed, 1)
  assert.deepEqual(h.window.contentView.children, [])
})

for (const phase of ['inspect', 'load', 'present']) {
  test(`${phase} failure disposes the file tab and releases all authority`, async (t) => {
    const h = surfaceHarness(t)
    h.state[phase] = async () => { throw new Error(`${phase} failed`) }
    const { surface } = h.makeSurface('/outside/failure.md')
    await assert.rejects(surface.open(), new RegExp(`${phase} failed`))
    assert.deepEqual(h.state.revokedHosts, [h.state.hosts[0].hostToken])
    assert.deepEqual(h.state.revokedWorkspaces, h.state.registrations.map(({ fileRef }) => fileRef.workspaceId))
    assert.equal(h.state.regions[0].destroyed, 1)
    assert.ok(h.state.views.every((view) => view.webContents.closed === 1))
    assert.deepEqual(h.window.contentView.children, [])
    assert.deepEqual(h.state.recentWrites, [])
  })
}

