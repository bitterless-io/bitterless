import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import less from 'less'
import { createJiti } from 'jiti'
const require = createRequire(import.meta.url)
const root = new URL('../../', import.meta.url)
const source = path => readFileSync(new URL(path, root), 'utf8')
const base = 'src/renderer/maestro/workbench/src/'
const code = transformSync(source(base + 'workflowLibrary.store.ts'), { loader: 'ts', format: 'cjs' }).code
const meta = { name: 'Fixture', description: '', whenToUse: '', modelInvocation: true, phases: [{ title: 'Find' }, { title: 'Report' }] }
const row = { ref: 'local:text-essentials', dir: 'text-essentials', path: '/home/.bitterless/workflows/text-essentials', name: 'Fixture', description: '', entry: 'workflow.ts', entryPath: '/home/.bitterless/workflows/text-essentials/workflow.ts', bytes: 512, modifiedAt: '2026-09-20T02:00:00.000Z', phases: ['Find', 'Report'], error: null }
const snapshot = (items = [row]) => ({ root: '/home/.bitterless/workflows', scannedAt: '2026-09-20T02:00:00.000Z', items, dropped: 0, error: null })
const harness = api => {
  const module = { exports: {} }; let listener
  runInNewContext(code, { module, exports: module.exports, navigator: { clipboard: { writeText: async () => {} } }, require(name) {
    if (name === 'electron-xpc/renderer') return { createXpcRendererEmitter: () => api, xpcRenderer: { subscribe: (_channel, callback) => { listener = callback } } }
    if (name === '@shared/workflowLibrary.type') return { WORKFLOW_LIBRARY_HANDLER: 'WorkflowLibraryHandler', WORKFLOW_LIBRARY_CHANGED: 'changed' }
    return require(name)
  } })
  return { store: module.exports.workflowLibraryStore, broadcast: value => listener({ params: value }) }
}

test('SFCs and sibling Less compile; the view routes through the real store and exposes the folder', async () => {
  for (const name of ['views/WorkbenchWorkflowsView', 'components/WorkflowPhases']) {
    const filename = base + name + '.vue'; const { descriptor, errors } = parse(source(filename), { filename }); assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: name }); assert.deepEqual(compileTemplate({ filename, id: name, source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    await less.render(source(base + name + '.less'))
    assert.doesNotMatch(descriptor.template.content, /v-html/)
  }
  assert.match(source(base + 'workbench.router.ts'), /name: 'workflows', component: WorkbenchWorkflowsView/)
  const view = source(base + 'views/WorkbenchWorkflowsView.vue')
  // The folder entry point is the affordance the whole feature rests on: without it the owner has
  // no way to reach the directory the list is reading (docs/features/local-workflow-directory.md).
  assert.match(view, /store\.openRoot\(\)/)
  assert.match(view, /store\.root/)
  assert.match(view, /store\.reveal\(\)/)
  // Nothing in this view may speak of accounts, institutions or downloads any more.
  for (const gone of [/institution/i, /signIn/, /noMembership/, /installedRevision/, /autoSync/])
    assert.doesNotMatch(view, gone, String(gone))
})

test('a broadcast that drops the selected package clears the detail instead of showing a stale graph', async () => {
  const h = harness({ snapshot: async () => ({ ok: true, value: snapshot() }), detail: async () => ({ ok: true, value: { item: row, meta } }) })
  await h.store.init()
  await h.store.select(row.ref)
  assert.equal(h.store.detail.meta.phases.length, 2)
  h.broadcast(snapshot([]))
  assert.equal(h.store.detail, null)
  assert.equal(h.store.selectedRef, null)
})

test('a failed detail read surfaces the reason and does not keep a previous package on screen', async () => {
  let fail = false
  const h = harness({ snapshot: async () => ({ ok: true, value: snapshot() }), detail: async () => fail ? { ok: false, error: 'Fixture broken manifest' } : { ok: true, value: { item: row, meta } } })
  await h.store.init(); await h.store.select(row.ref)
  fail = true; await h.store.select(row.ref)
  assert.equal(h.store.detail, null)
  assert.match(h.store.detailError, /broken manifest/)
})

test('search matches the folder name as well as the package name', async () => {
  const other = { ...row, ref: 'local:weekly-report', dir: 'weekly-report', name: 'Another' }
  const h = harness({ snapshot: async () => ({ ok: true, value: snapshot([row, other]) }), detail: async () => ({ ok: true, value: { item: row, meta } }) })
  await h.store.init()
  h.store.search = 'weekly'
  assert.deepEqual(h.store.items.map(item => item.ref), ['local:weekly-report'])
  h.store.search = 'Fixture'
  assert.deepEqual(h.store.items.map(item => item.ref), ['local:text-essentials'])
})



