import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { reactive, watch } from 'vue'

const root = new URL('../../', import.meta.url)
const renderer = existsSync(new URL('src/renderer/maestro/control', root)) ? 'src/renderer/maestro/control/src/' : 'src/renderer/control/src/'
function load(file, modules = {}) {
  const code = transformSync(readFileSync(new URL(file, root), 'utf8'), { loader: 'ts', format: 'cjs' }).code
  const module = { exports: {} }
  runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name in modules) return modules[name]
    throw new Error(`Unexpected dependency: ${name}`)
  } })
  return module.exports
}
const shared = load('src/shared/agentWorkflow.api.ts')
const { workflowEn: copy } = load(`${renderer}workflow.messages.ts`)
const plain = value => JSON.parse(JSON.stringify(value))
const cleanups = []
test.afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
const runSnapshot = (patch = {}) => ({ id: 'run', sessionId: 'chat-a', name: 'mini-demo', input: '', status: 'running', agents: [], createdAt: 1, ...patch })
test('workflow parsing preserves input and accepts quoted paths without matching ordinary prose', () => {
  assert.deepEqual(plain(shared.parseWorkflowCommand('/workflow demo')), { kind: 'run', target: 'mini-demo', input: '' })
  assert.deepEqual(plain(shared.parseWorkflowCommand('/workflow research investigate\nwith citations')), { kind: 'run', target: 'research', input: 'investigate\nwith citations' })
  assert.deepEqual(plain(shared.parseWorkflowCommand('/workflow "/work/my flow.ts" inspect files')), { kind: 'run', target: '/work/my flow.ts', input: 'inspect files' })
  assert.equal(shared.parseWorkflowCommand('Explain /workflow demo'), null)
  assert.equal(shared.parseWorkflowCommand('/workflowish demo'), null)
  assert.equal(shared.parseWorkflowCommand('/workflow "unfinished').kind, 'invalid')
  assert.equal(shared.parseWorkflowCommand('/workflow').kind, 'list')
})
function harness(overrides = {}) {
  const calls = [], notes = []
  const subscriptions = { active: 0 }
  const store = reactive({
    runs: [],
    listWorkflows: async () => [{ name: 'mini-demo', description: 'demo' }, { name: 'research', description: 'evidence' }],
    start: async request => { calls.push(plain(request)); return runSnapshot({ sessionId: request.sessionId, name: request.entry.name || request.entry.path }) },
    ...overrides
  })
  const { executeWorkflowCommand: execute } = load(`${renderer}workflow.command.ts`, {
    vue: { watch: (...args) => {
      const stop = watch(...args)
      subscriptions.active++
      let stopped = false
      const dispose = () => { if (!stopped) { stopped = true; subscriptions.active--; stop() } }
      cleanups.push(dispose)
      return dispose
    } },
    '@shared/agentWorkflow.api': shared,
    './store/workflow.store': { workflowStore: store },
    './workflow.text': { workflowText: () => copy }
  })
  const context = { sessionId: 'chat-a', hasAttachments: false, assertCanStart() {}, refreshWorkspace: async () => '/selected-project', note: text => notes.push(text) }
  return { calls, notes, context, store, subscriptions, execute: (text, patch = {}) => execute(text, { ...context, ...patch }) }
}
test('listing requires no model/workspace or root turn and does not start work', async () => {
  const h = harness()
  await h.execute('/workflow', { assertCanStart() { throw Error('busy') }, refreshWorkspace() { throw Error('unavailable') } })
  assert.equal(h.calls.length, 0)
  assert.match(h.notes[0], /\/workflow demo/)
  assert.match(h.notes[0], /\/workflow research/)
})
test('demo deterministically starts with selected session and default task; Main owns cwd/model', async () => {
  const h = harness()
  await h.execute('/workflow demo')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].entry.name, 'mini-demo')
  assert.equal(h.calls[0].origin, 'shortcut')
  assert.equal(h.calls[0].sessionId, 'chat-a')
  assert.equal(h.calls[0].input, copy.demoInput)
  assert.equal(h.calls[0].cwd, undefined)
  assert.match(h.notes[0], /Started mini-demo/)
})
test('unknown entries, empty tasks, missing workspace, attachments, and busy chats never start', async () => {
  const h = harness()
  await assert.rejects(h.execute('/workflow unknown task'), /Unknown workflow/)
  await assert.rejects(h.execute('/workflow research'), /Describe the task/)
  await assert.rejects(h.execute('/workflow research x', { refreshWorkspace: async () => undefined }), /workspace/)
  await assert.rejects(h.execute('/workflow demo', { hasAttachments: true }), /attachments/)
  await assert.rejects(h.execute('/workflow demo', { assertCanStart() { throw Error('busy') } }), /busy/)
  assert.equal(h.calls.length, 0)
})
test('recheck admission after asynchronous workspace refresh, and expose start failure', async () => {
  const h = harness()
  let checks = 0
  await assert.rejects(h.execute('/workflow demo', { assertCanStart() { if (++checks === 2) throw Error('new turn started') } }), /new turn started/)
  assert.equal(h.calls.length, 0)
  const failed = harness({ start: async () => { throw Error('login required') } })
  await assert.rejects(failed.execute('/workflow demo'), /login required/)
  assert.equal(failed.notes.length, 0)
})
test('explicit absolute file passes unchanged and all commands stay ahead of ordinary model send', async () => {
  const h = harness()
  await h.execute('/workflow "/work/my flow.ts" inspect files')
  assert.deepEqual(h.calls[0].entry, { kind: 'file', path: '/work/my flow.ts' })
  assert.equal(h.calls[0].input, 'inspect files')
  const source = readFileSync(new URL(`${renderer}ChatPanel.vue`, root), 'utf8')
  const send = source.slice(source.indexOf('async function send()'), source.indexOf('function pickFiles()'))
  assert.ok(send.indexOf('parseWorkflowCommand(input.value)') < send.indexOf('turnService.send('))
  assert.match(source, /workflowCommandPending/)
  const ui = readFileSync(new URL(`${renderer}WorkflowTaskBar.vue`, root), 'utf8')
  assert.match(ui, /workflow-taskbar__run-result/)
  assert.match(ui, /run\.error/)
  assert.match(ui, /run\.result/)
})
test('a failure before the first Agent stays visible in the original chat and is reported once', async () => {
  const h = harness()
  const originalChatNotes = []
  await h.execute('/workflow demo', { note: text => originalChatNotes.push(text) })
  assert.equal(h.subscriptions.active, 1)
  h.store.runs = [runSnapshot({ sessionId: 'chat-b', status: 'failed', error: 'other chat error' })]
  assert.equal(originalChatNotes.length, 1)
  h.store.runs = [runSnapshot({ status: 'failed', error: 'Cannot load workflow module' })]
  assert.match(originalChatNotes[1], /mini-demo · Failed\n\nCannot load workflow module/)
  assert.equal(h.subscriptions.active, 0)
  h.store.runs = [runSnapshot({ status: 'failed', error: 'Cannot load workflow module' })]
  assert.equal(originalChatNotes.length, 2)
  assert.equal(h.notes.length, 0)
})
test('a workflow with no Agents reports its terminal result or stop state, then detaches', async () => {
  for (const patch of [{ status: 'completed', result: '42' }, { status: 'stopped' }]) {
    const h = harness()
    await h.execute('/workflow demo')
    h.store.runs = [runSnapshot(patch)]
    assert.match(h.notes[1], patch.status === 'completed' ? /Completed\n\n42/ : /Stopped/)
    assert.equal(h.subscriptions.active, 0)
  }
})
test('the first Agent hands subsequent results to the task bar without duplicate chat notes', async () => {
  const h = harness()
  await h.execute('/workflow demo')
  h.store.runs = [runSnapshot()]
  h.store.runs[0].agents.push({ id: 'agent' })
  assert.equal(h.subscriptions.active, 0)
  h.store.runs = [runSnapshot({ agents: [{ id: 'agent' }], status: 'completed', result: 'task bar result' })]
  assert.equal(h.notes.length, 1)
})
test('a terminal start reply or faster terminal broadcast never prints a misleading Started notice', async () => {
  const failed = harness({ start: async () => runSnapshot({ status: 'failed', error: 'load failed' }) })
  await failed.execute('/workflow demo')
  assert.equal(failed.notes.length, 1)
  assert.match(failed.notes[0], /Failed\n\nload failed/)
  assert.doesNotMatch(failed.notes[0], /Started/)
  assert.equal(failed.subscriptions.active, 0)

  let finishStart
  const fast = harness({ start: () => new Promise(resolve => { finishStart = resolve }) })
  const starting = fast.execute('/workflow demo')
  while (!finishStart) await Promise.resolve()
  fast.store.runs = [runSnapshot({ status: 'completed', result: 'finished before reply' })]
  finishStart(runSnapshot())
  await starting
  assert.equal(fast.notes.length, 1)
  assert.match(fast.notes[0], /Completed\n\nfinished before reply/)
  assert.doesNotMatch(fast.notes[0], /Started/)
  assert.equal(fast.subscriptions.active, 0)
})
