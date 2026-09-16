import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
const require = createRequire(import.meta.url)
const root = new URL('../../', import.meta.url)
const renderer = existsSync(new URL('src/renderer/maestro/control', root)) ? 'src/renderer/maestro/control/src/' : 'src/renderer/control/src/'
const code = transformSync(readFileSync(new URL(`${renderer}store/workflow.store.ts`, root), 'utf8'), { loader: 'ts', format: 'cjs' }).code
function harness(api) {
  let broadcast
  const module = { exports: {} }
  runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name === 'electron-xpc/renderer') return {
      createXpcRendererEmitter: () => api,
      xpcRenderer: { subscribe: (_channel, listener) => { broadcast = listener } }
    }
    return require(name)
  } })
  return { store: module.exports.workflowStore, broadcast: snapshot => broadcast({ params: snapshot }) }
}
const snapshot = (revision, name = 'mini-demo') => ({ revision, runs: [{ id: 'run', sessionId: 'chat', name, status: 'running', input: '', agents: [], createdAt: 1 }] })
test('a late list reply cannot roll back a newer workflow broadcast', async () => {
  let resolve
  const h = harness({ listRuns: () => new Promise(r => { resolve = r }) })
  const init = h.store.init()
  h.broadcast(snapshot(4, 'diagnose'))
  resolve(snapshot(2))
  await init
  assert.equal(h.store.revision, 4)
  assert.equal(h.store.runs[0].name, 'diagnose')
})
test('null IPC snapshots are shown as load failures and a later refresh recovers', async () => {
  let reply = null
  const h = harness({ listRuns: async () => reply })
  await h.store.init()
  assert.equal(h.store.loadFailed, true)
  assert.equal(h.store.revision, -1)
  reply = snapshot(1)
  await h.store.refresh()
  assert.equal(h.store.loadFailed, false)
  assert.equal(h.store.runs.length, 1)
})
test('an obsolete failed request does not hide a successful newer broadcast', async () => {
  let reject
  const h = harness({ listRuns: () => new Promise((_r, fail) => { reject = fail }) })
  const init = h.store.init()
  h.broadcast(snapshot(5))
  reject(new Error('offline'))
  await init
  assert.equal(h.store.loadFailed, false)
  assert.equal(h.store.revision, 5)
})
test('stopping requires a positive IPC acknowledgement and never invents terminal state', async () => {
  const calls = []
  let reply = null
  const h = harness({ listRuns: async () => snapshot(1), stopAgent: async p => { calls.push(p); return reply }, stopSession: async () => reply })
  await h.store.init()
  await assert.rejects(h.store.stopAgent('chat', 'run', 'agent'), /acknowledged/)
  await assert.rejects(h.store.stopSession('chat'), /acknowledged/)
  reply = { ok: true }
  await h.store.stopAgent('chat', 'run', 'agent')
  await h.store.stopSession('chat')
  assert.equal(calls[0].agentId, 'agent')
  assert.equal(calls[0].sessionId, 'chat')
  assert.equal(h.store.runs[0].status, 'running')
})
