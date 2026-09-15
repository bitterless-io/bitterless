import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const path = 'src/main/maestro/windows/main/maestroBrowserView.service.ts'
const source = ts.createSourceFile(path, readFileSync(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true)
const names = ['tabKindChanges', 'compositeSurfaceOwners', 'setTabKind', 'mountComposite', 'openCompositeTab', 'performCloseTab']
const nodes = source.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]).filter(node => names.includes(node.name?.getText(source)))
assert.equal(nodes.length, names.length, 'The test executes the actual production methods and ownership maps.')
const output = ts.transpileModule(`class Actual {${nodes.map(node => node.getText(source)).join('\n')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let instance = 0
const Browser = new Function('mintTabInstanceId', 'getMaestroCompositeTab', `${output}; return Actual`)(() => `instance-${++instance}`, () => null)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

function fixture() {
  const service = new Browser()
  const tab = { id: 'a', kind: 'browser', url: 'https://website.example/', title: 'Website title', alias: 'My tab', debuggerEnabled: true }
  const snapshots = [], activations = [], attached = new Set(), traces = []
  Object.assign(service, {
    tabs: [tab], tabSeq: 0, activeTabId: tab.id, compositeTabs: new Map(), compositeHosts: new Map(),
    _state: { capturing: false, emitTrace: event => traces.push(event), browserWindow: { contentView: {
      addChildView: view => attached.add(view), removeChildView: view => attached.delete(view)
    } } },
    clearTabControl() {}, setTabLoading() {}, setOperationView() {}, setCompositeActive() {}, sendTabNav() {},
    async coolTab() {},
    broadcastTabs() { snapshots.push({ kind: tab.kind, title: tab.title, alias: tab.alias, active: service.activeTabId }) },
    async activateTab({ id }) { activations.push(id); service.activeTabId = id; service.broadcastTabs() },
    async closeTab({ id }) { const target = service.tabs.find(item => item.id === id); if (target) await service.performCloseTab(target) }
  })
  function miniapp(id, title, gate) {
    let host
    const surface = { id }
    const spec = { id, title, favicon: id, async open(next) { host = next; host.attach(surface); await gate?.promise }, close(next) { next.detach(surface) } }
    return { spec, surface, host: () => host, switch: () => service.setTabKind({ id: tab.id, kind: id, spec }) }
  }
  return { service, tab, snapshots, activations, attached, traces, miniapp }
}

test('registry title is broadcast while mounting is pending, and live titles preserve alias', async () => {
  const f = fixture(), gate = deferred(), app = f.miniapp('zellij', 'Zellij', gate)
  const opening = app.switch(); await flush()
  assert.equal(f.snapshots.at(-1).title, 'Zellij')
  assert.equal(f.snapshots.at(-1).active, f.tab.id)
  assert.equal(f.activations.length, 0)
  app.host().setTitle('Terminal session')
  assert.equal(f.snapshots.at(-1).title, 'Terminal session')
  assert.equal(f.tab.alias, 'My tab')
  app.host().setTitle('')
  assert.equal(f.tab.title, 'Zellij')
  gate.resolve(); await opening
  assert.deepEqual(f.activations, ['a'])
})

test('a departed host cannot change title, address, native content, activation or close', async () => {
  const f = fixture(), a = f.miniapp('zellij', 'Zellij'), b = f.miniapp('trench', 'Trench')
  await a.switch(); await b.switch()
  const stale = a.host(), current = b.host(), broadcasts = f.snapshots.length, activations = f.activations.length
  current.setDisplayUrl('bitterless://trench/current')
  stale.setTitle('Old title'); stale.setDisplayUrl('bitterless://old'); stale.attach({ id: 'late surface' })
  stale.activate(); stale.close(); stale.detach(b.surface)
  assert.equal(stale.isOpen(), false)
  assert.equal(f.tab.title, 'Trench'); assert.equal(f.tab.compositeDisplayUrl, 'bitterless://trench/current')
  assert.equal(f.snapshots.length, broadcasts + 1); assert.equal(f.activations.length, activations)
  assert.deepEqual([...f.attached], [b.surface]); assert.equal(f.service.tabs.length, 1)
})

test('a late old detach cannot remove a container reassigned to the new host', async () => {
  const f = fixture(), a = f.miniapp('zellij', 'Zellij'), b = f.miniapp('trench', 'Trench')
  await a.switch(); await b.switch()
  b.host().attach(a.surface)
  a.host().detach(a.surface)
  assert.equal(f.tab.surface, a.surface)
  assert.equal(f.attached.has(a.surface), true)
})

for (const outcome of ['resolve', 'reject']) {
  test(`old mount ${outcome} cannot replace a newer miniapp or steal focus`, async () => {
    const f = fixture(), gate = deferred(), a = f.miniapp('zellij', 'Zellij', gate), b = f.miniapp('trench', 'Trench')
    const old = a.switch(); await flush(); await b.switch()
    f.service.activeTabId = 'other'
    const activations = f.activations.length
    gate[outcome](new Error('old mount failed')); await old
    assert.equal(f.tab.kind, 'trench'); assert.equal(f.tab.title, 'Trench')
    assert.equal(f.service.compositeTabs.get('a'), b.spec); assert.equal(f.service.compositeHosts.get('a'), b.host())
    assert.equal(f.service.activeTabId, 'other'); assert.equal(f.activations.length, activations)
    assert.equal(f.traces.length, 0)
  })
}

test('a current mount completing after another tab is selected does not reactivate itself', async () => {
  const f = fixture(), gate = deferred(), app = f.miniapp('zellij', 'Zellij', gate)
  const opening = app.switch(); await flush()
  f.service.activeTabId = 'other'; gate.resolve(); await opening
  assert.equal(f.service.activeTabId, 'other'); assert.equal(f.activations.length, 0)
  assert.equal(f.tab.title, 'Zellij')
})

test('closing a pending mount invalidates title callbacks and its eventual failure', async () => {
  const f = fixture(), gate = deferred(), app = f.miniapp('zellij', 'Zellij', gate)
  const opening = app.switch(); await flush()
  await f.service.closeTab({ id: 'a' }); const count = f.snapshots.length
  app.host().setTitle('Late title'); app.host().attach({ id: 'late' }); app.host().activate()
  gate.reject(new Error('closed')); await opening
  assert.equal(f.service.tabs.length, 0); assert.equal(f.snapshots.length, count)
  assert.equal(f.attached.size, 0); assert.equal(f.activations.length, 0)
})

test('switching back to Website clears miniapp title and retains alias and saved URL', async () => {
  const f = fixture(), app = f.miniapp('zellij', 'Zellij')
  await app.switch()
  await f.service.setTabKind({ id: 'a', kind: 'browser' })
  app.host().setTitle('Old terminal')
  assert.equal(f.tab.kind, 'browser'); assert.equal(f.tab.title, '')
  assert.equal(f.tab.alias, 'My tab'); assert.equal(f.tab.url, 'https://website.example/')
  assert.equal(f.snapshots.at(-1).title, '')
})

test('a current mount failure still falls back to Website without clearing alias', async () => {
  const f = fixture(), gate = deferred(), app = f.miniapp('zellij', 'Zellij', gate)
  const opening = app.switch(); await flush(); gate.reject(new Error('unavailable')); await opening
  assert.equal(f.tab.kind, 'browser'); assert.equal(f.tab.title, ''); assert.equal(f.tab.alias, 'My tab')
  assert.equal(f.service.compositeTabs.has('a'), false); assert.match(f.traces[0].msg, /unavailable/)
})

test('newer choice wins while the old Website view is still cooling', async () => {
  const f = fixture(), cooling = deferred(), a = f.miniapp('zellij', 'Zellij'), b = f.miniapp('trench', 'Trench')
  f.service.coolTab = () => cooling.promise
  const first = a.switch(), second = b.switch()
  cooling.resolve(); await Promise.all([first, second])
  assert.equal(a.host(), undefined); assert.equal(f.tab.kind, 'trench'); assert.equal(f.tab.title, 'Trench')
  assert.equal(f.snapshots.some(item => item.title === 'Zellij'), false)
})

test('pinned, unknown, same-type and existing singleton paths keep their original semantics', async () => {
  const f = fixture(), app = f.miniapp('zellij', 'Zellij')
  f.tab.pinned = true; await app.switch(); assert.equal(app.host(), undefined)
  f.tab.pinned = false; await f.service.setTabKind({ id: 'a', kind: 'unknown' }); assert.equal(f.tab.kind, 'browser')
  await f.service.setTabKind({ id: 'a', kind: 'browser' }); assert.equal(f.snapshots.length, 0)
  app.spec.singleton = true; f.service.tabs.push({ id: 'existing', kind: 'zellij' })
  await app.switch(); assert.equal(f.tab.kind, 'browser'); assert.deepEqual(f.activations, ['existing'])
})

test('an old new-tab mount cannot remove a newer conversion when it fails', async () => {
  const f = fixture(), gate = deferred(), app = f.miniapp('zellij', 'Zellij', gate)
  const opened = f.service.openCompositeTab({ id: 'zellij', spec: app.spec }); await flush()
  const newTab = f.service.tabs.at(-1)
  const next = { id: 'trench', title: 'Trench', favicon: '', open: async () => {}, close() {} }
  await f.service.setTabKind({ id: newTab.id, kind: 'trench', spec: next })
  gate.reject(new Error('old open failed')); assert.equal(await opened, null)
  assert.equal(f.service.tabs.includes(newTab), true); assert.equal(newTab.kind, 'trench')
  assert.equal(f.service.compositeTabs.get(newTab.id), next)
})
