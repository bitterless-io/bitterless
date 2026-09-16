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
const manifest = JSON.parse(source('examples/institution-workflow/workflow.json'))
const row = { id: 1, ref: 'institution:7:1', scope: 'institution', revision: 1, name: 'Fixture', description: '', institution_id: 7 }
const snapshot = context => ({ context, status: 'ready', items: [row], institutions: [], institutionId: 7, error: null })
const harness = api => {
  const module = { exports: {} }; let listener
  runInNewContext(code, { module, exports: module.exports, navigator: { clipboard: { writeText: async () => {} } }, require(name) {
    if (name === 'electron-xpc/renderer') return { createXpcRendererEmitter: () => api, xpcRenderer: { subscribe: (_channel, callback) => { listener = callback } } }
    if (name === '@shared/workflowLibrary.type') return { WORKFLOW_LIBRARY_HANDLER: 'WorkflowLibraryHandler', WORKFLOW_LIBRARY_CHANGED: 'changed' }
    return require(name)
  } })
  return { store: module.exports.workflowLibraryStore, broadcast: value => listener({ params: value }) }
}
test('SFCs and sibling Less compile; route and scope controls use the real store', async () => {
  for (const name of ['views/WorkbenchWorkflowsView', 'components/WorkflowFlow']) {
    const filename = base + name + '.vue'; const { descriptor, errors } = parse(source(filename), { filename }); assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: name }); assert.deepEqual(compileTemplate({ filename, id: name, source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    await less.render(source(base + name + '.less'))
    assert.doesNotMatch(descriptor.template.content, /v-html/)
  }
  assert.match(source(base + 'workbench.router.ts'), /name: 'workflows', component: WorkbenchWorkflowsView/)
  assert.match(source(base + 'views/WorkbenchWorkflowsView.vue'), /store\.scope === scope/)
})
test('new account broadcast fences an old detail success and clears institutional preview', async () => {
  let resolve
  const h = harness({ snapshot: async () => ({ ok: true, value: snapshot('a') }), preview: () => new Promise(r => { resolve = r }) })
  await h.store.init(); const pending = h.store.select(row.ref)
  h.broadcast(snapshot('b'))
  resolve({ ok: true, value: { workflow: row, manifest, entry: '/old/institution/7/workflow.ts', installedRevision: 1 } })
  await pending; assert.equal(h.store.detail, null); assert.equal(h.store.snapshot.context, 'b')
})
test('failed update keeps a previous detail visible; qualified scope filters retain same names', async () => {
  let fail = false
  const state = snapshot('a'); state.items.push({ ...row, ref: 'shared:1', scope: 'shared', institution_id: 0 })
  const h = harness({ snapshot: async () => ({ ok: true, value: state }), preview: async () => fail ? { ok: false, error: 'Fixture corrupt archive' } : { ok: true, value: { workflow: row, manifest, entry: '/test/7/workflow.ts', installedRevision: 1 } } })
  await h.store.init(); await h.store.select(row.ref); fail = true; await h.store.select(row.ref)
  assert.equal(h.store.detail.installedRevision, 1); assert.match(h.store.detailError, /corrupt/)
  h.store.scope = 'shared'; assert.equal(h.store.items.length, 1); assert.equal(h.store.items[0].ref, 'shared:1')
})
test('graph layout remains finite for joins, cycles and escaped authored labels', async () => {
  const { layoutWorkflowGraph } = await createJiti(import.meta.url, { fsCache: false }).import('../../src/renderer/maestro/workbench/src/workflowGraph.ts')
  const graph = structuredClone(manifest.graph); graph.edges.push({ from: 'summarize', to: 'prepare', label: '<script>fixture</script>' })
  const layout = layoutWorkflowGraph(graph); assert(layout.width > 0); assert(layout.height > 0); assert(layout.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))); assert.equal(layout.edges.at(-1).label, '<script>fixture</script>')
})
