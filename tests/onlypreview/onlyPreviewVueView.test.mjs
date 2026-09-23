import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const loadMain = (path, { stubs }) => {
  const code = ts.transpileModule(readFileSync(resolve(import.meta.dirname, '../..', path.replace('@main/', 'src/main/') + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => stubs[name] ?? (
    name === '@shared/onlypreview/onlyPreview.types' ? { ONLY_PREVIEW_SCHEME: 'onlypreview' } :
    name === '@shared/diagnostics/diagnostic.service' ? { sanitizeErrorCauseChain: () => '' } : require(name)
  ), module, module.exports)
  return module.exports
}

let fixtureId = 0
const unique = stubs => ({ ...stubs, [`vue-preview-fixture:${++fixtureId}`]: {} })
const factoryFixture = () => {
  const views = [], installs = [], fences = [], released = []
  class WebContentsView {
    constructor(options) {
      this.options = options
      this.webContents = Object.assign(new EventEmitter(), { session: {} })
      views.push(this)
    }
  }
  const { createOnlyPreviewVueView } = loadMain('@main/miniapps/onlypreview/views/onlyPreviewVueView.service', { stubs: unique({
    electron: { WebContentsView },
    '../onlyPreviewProtocol.service': { installOnlyPreviewVueSessionProtocol: session => {
      installs.push(session); return () => { released.push(session) }
    } },
    './onlyPreviewRendererTarget.service': {
      getOnlyPreviewRendererArguments: (...args) => args,
      getOnlyPreviewRendererTarget: () => ({ url: 'file:///renderer/onlypreview/preview/index.html' }),
      configureOnlyPreviewNavigationFence: (...args) => { fences.push(args) }
    }
  }) })
  return { createOnlyPreviewVueView, views, installs, fences, released }
}
test('Workspace and IndiPreview use the same Vue factory and capability arguments', () => {
  const h = factoryFixture()
  const host = { hostToken: 'token', hostId: 'host' }
  const view = h.createOnlyPreviewVueView({ host, baseDirectory: '/app/main', runtimeToken: 'runtime',
    officeCapability: 'office', readCapability: 'read', openTag: 'tag', mountKind: 'cowork', hostArguments: ['host-argument'] })
  assert.deepEqual(view.options.webPreferences, {
    preload: '/app/preload/onlypreviewContent.js', sandbox: true, contextIsolation: true,
    nodeIntegration: false, webSecurity: true,
    additionalArguments: ['host-argument', host, 'preview', 'runtime', 'office', 'read', 'tag', 'cowork']
  })
  assert.deepEqual(h.fences, [[view.webContents, 'file:///renderer/onlypreview/preview/index.html']])
  assert.deepEqual(h.installs, [], 'Workspace default session retains its existing protocol registration')
})
test('IndiPreview Vue sessions install asset authority and release it when their content is destroyed', () => {
  const h = factoryFixture()
  const first = h.createOnlyPreviewVueView({ host: { hostId: 'one' }, baseDirectory: '/app/main', partition: 'indipreview-one' })
  const second = h.createOnlyPreviewVueView({ host: { hostId: 'two' }, baseDirectory: '/app/main', partition: 'indipreview-two' })
  assert.equal(first.options.webPreferences.partition, 'indipreview-one')
  assert.equal(second.options.webPreferences.partition, 'indipreview-two')
  assert.deepEqual(h.installs, [first.webContents.session, second.webContents.session])
  first.webContents.emit('destroyed'); first.webContents.emit('destroyed')
  assert.deepEqual(h.released, [first.webContents.session])
  second.webContents.emit('destroyed')
  assert.deepEqual(h.released, h.installs)
})

const protocolFixture = () => {
  const calls = [], assets = []
  const targetSession = { protocol: {
    handlers: new Map(),
    isProtocolHandled(name) { return this.handlers.has(name) },
    handle(name, handler) { calls.push(['handle', name]); this.handlers.set(name, handler) },
    unhandle(name) { calls.push(['unhandle', name]); this.handlers.delete(name) }
  } }
  const { installOnlyPreviewVueSessionProtocol } = loadMain('@main/miniapps/onlypreview/onlyPreviewProtocol.service', { stubs: unique({
    electron: { protocol: {} },
    './onlyPreviewAsset.registry': { onlyPreviewAssetRegistry: { respond: async request => {
      assets.push(request.url); return new Response('asset bytes')
    } } },
    './onlyPreviewDocument.registry': { onlyPreviewDocumentRegistry: {} }
  }) })
  return { installOnlyPreviewVueSessionProtocol, targetSession, calls, assets }
}
test('isolated Vue asset protocol shares capability checks and rejects document/malformed targets', async () => {
  const h = protocolFixture()
  const release = h.installOnlyPreviewVueSessionProtocol(h.targetSession)
  const [scheme, handler] = [...h.targetSession.protocol.handlers][0]
  const token = 'a'.repeat(64), asset = `${scheme}://asset/${token}`
  assert.equal(await (await handler(new Request(asset))).text(), 'asset bytes')
  assert.deepEqual(h.assets, [asset])
  assert.equal((await handler(new Request(`${scheme}://document/${token}`))).status, 404)
  assert.equal((await handler(new Request(`${scheme}://asset/not-a-capability`))).status, 400)
  assert.equal(h.assets.length, 1)
  release()
  assert.equal(h.targetSession.protocol.handlers.size, 0)
})
test('late destruction of a replaced Vue view cannot remove the new session asset handler', () => {
  const h = protocolFixture()
  const first = h.installOnlyPreviewVueSessionProtocol(h.targetSession)
  const second = h.installOnlyPreviewVueSessionProtocol(h.targetSession)
  const count = h.calls.length
  first()
  assert.equal(h.calls.length, count)
  assert.equal(h.targetSession.protocol.handlers.size, 1)
  second()
  assert.equal(h.targetSession.protocol.handlers.size, 0)
})
