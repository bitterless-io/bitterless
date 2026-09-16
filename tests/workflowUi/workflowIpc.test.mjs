import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
const require = createRequire(import.meta.url)
const root = new URL('../../', import.meta.url)
const bl = existsSync(new URL('src/renderer/maestro/control', root))
const renderer = bl ? 'src/renderer/maestro/control/src/' : 'src/renderer/control/src/'
function evaluate(code, modules = {}) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => name in modules ? modules[name] : require(name), module, module.exports)
  return module.exports
}
function load(relative, modules) {
  return evaluate(transformSync(readFileSync(new URL(relative, root), 'utf8'), { loader: 'ts', format: 'cjs' }).code, modules)
}
function harness(startWorkflow) {
  // Actual installed XPC registration/exception behavior, with no Electron launch.
  const xpc = evaluate(readFileSync(require.resolve('electron-xpc/main'), 'utf8'), { electron: {} })
  const host = { startWorkflow, listRuns: async () => ({ revision: 1, runs: [] }) }
  const hostModule = bl ? '@maestro-main/windows/main/maestroWindow.controller' : '@main/modules/window-manager/windowManager.controller'
  const owner = bl ? { maestroWindowHelper: { agentService: { getWorkflowHost: () => host } } } : { windowManagerController: { requireMainWindow: () => ({ agent: { getWorkflowHost: () => host } }) } }
  load('src/main/xpc/workflow.handler.ts', { 'electron-xpc/main': xpc, [hostModule]: owner })
  const api = new Proxy({}, { get: (_, name) => params => xpc.xpcMain.send('WorkflowHandler/' + name, params) })
  return load(renderer + 'store/workflow.store.ts', { 'electron-xpc/renderer': { createXpcRendererEmitter: () => api, xpcRenderer: { subscribe() {} } } }).workflowStore
}
const request = { sessionId: 'chat', entry: { kind: 'builtin', name: 'mini-demo' }, input: 'task' }
test('host startup cause survives actual electron-xpc exception handling into renderer', async () => {
  const message = 'AI-CRMS login is required. Sign in and retry.'
  const store = harness(async () => { throw new Error(message) })
  await assert.rejects(store.start(request), error => error.message === message)
})
test('successful workflow start survives actual XPC with chat ownership and forced shortcut origin', async () => {
  let received
  const run = { id: 'run-1', sessionId: 'chat', status: 'running', agents: [] }
  const store = harness(async params => { received = params; return run })
  assert.equal((await store.start(request)).id, run.id)
  assert.equal(received.origin, 'shortcut')
  assert.equal(received.sessionId, 'chat')
})
test('malformed successful reply cannot acknowledge an unrelated chat run', async () => {
  const store = harness(async () => ({ id: 'run-other', sessionId: 'another-chat' }))
  await assert.rejects(store.start(request), /not acknowledged/)
})
