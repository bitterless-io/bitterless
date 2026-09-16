const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')

function load(relative, modules = {}) {
  const filename = path.join(root, relative)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', '__dirname', code)((name) => {
    if (name in modules) return modules[name]
    if (name.startsWith('node:')) return require(name)
    throw Error('Unexpected test dependency: ' + name)
  }, module, module.exports, path.dirname(filename))
  return module.exports
}

const { WorkflowWaitRegistry, workflowWaitReceipt, workflowWaitRejectionMessage } =
  load('src/main/agent/workflowEngine/workflowWait.ts')

const run = (id, sessionId, status, agents = 2) =>
  ({ id, sessionId, name: 'code-review', input: 'goal', status, createdAt: 1, agents: Array.from({ length: agents }, (_, index) => ({ id: String(index + 1), runId: id })) })

test('waiting with no run named covers every live run of that chat only', () => {
  const registry = new WorkflowWaitRegistry()
  const runs = [run('a', 'chat', 'running'), run('b', 'chat', 'completed'), run('c', 'other', 'running')]
  const outcome = registry.declare('chat', [], runs, 10)
  assert.equal(outcome.ok, true)
  assert.deepEqual(outcome.intent.runIds, ['a'], 'a finished run is not waited on, and another chat is not this chat')
  assert.equal(registry.pending('chat').declaredAt, 10)
  assert.equal(registry.pending('other'), undefined)
})

test('an unknown or foreign run is refused rather than silently ignored', () => {
  const registry = new WorkflowWaitRegistry()
  const runs = [run('a', 'chat', 'running'), run('c', 'other', 'running')]
  const unknown = registry.declare('chat', ['a', 'zzz'], runs, 1)
  assert.deepEqual(unknown, { ok: false, reason: 'unknown-runs', runIds: ['zzz'] })
  const foreign = registry.declare('chat', ['c'], runs, 1)
  assert.equal(foreign.reason, 'unknown-runs', "another chat's run is not addressable from here")
  assert.equal(registry.pending('chat'), undefined, 'a refused wait leaves nothing pending')
  assert.match(workflowWaitRejectionMessage(unknown), /never guess a run ID/)
})

test('waiting on work that already finished is refused, because it would never fire', () => {
  const registry = new WorkflowWaitRegistry()
  const runs = [run('a', 'chat', 'completed'), run('b', 'chat', 'failed'), run('c', 'chat', 'running')]
  const settled = registry.declare('chat', ['a', 'b'], runs, 1)
  assert.deepEqual(settled, { ok: false, reason: 'already-settled', runIds: ['a', 'b'] })
  assert.match(workflowWaitRejectionMessage(settled), /already in this chat/)
  // A mixed request keeps only what can still settle.
  const mixed = registry.declare('chat', ['a', 'c'], runs, 1)
  assert.deepEqual(mixed.intent.runIds, ['c'])
  assert.deepEqual(registry.declare('chat', [], [run('a', 'chat', 'completed')], 1), { ok: false, reason: 'no-live-runs' })
})

test('the wait fires once, only when every named run has settled', () => {
  const registry = new WorkflowWaitRegistry()
  registry.declare('chat', ['a', 'b'], [run('a', 'chat', 'running'), run('b', 'chat', 'running')], 1)
  assert.deepEqual(registry.settle([run('a', 'chat', 'completed'), run('b', 'chat', 'running')]), [], 'one of two is not enough')
  assert.ok(registry.pending('chat'))
  const fired = registry.settle([run('a', 'chat', 'completed'), run('b', 'chat', 'failed')])
  assert.equal(fired.length, 1)
  assert.deepEqual(fired[0].runs.map(item => [item.id, item.status]), [['a', 'completed'], ['b', 'failed']])
  assert.equal(registry.pending('chat'), undefined, 'the intent is consumed as it fires')
  // The same snapshot arriving again must not continue the chat a second time.
  assert.deepEqual(registry.settle([run('a', 'chat', 'completed'), run('b', 'chat', 'failed')]), [])
})

test('a stopped or failed run settles the wait — the continuation must report it, not hang on it', () => {
  const registry = new WorkflowWaitRegistry()
  registry.declare('chat', ['a'], [run('a', 'chat', 'running')], 1)
  const fired = registry.settle([run('a', 'chat', 'stopped')])
  assert.equal(fired.length, 1)
  assert.equal(fired[0].runs[0].status, 'stopped')
})

test('a run that vanished from the snapshot drops the wait rather than hanging forever', () => {
  const registry = new WorkflowWaitRegistry()
  registry.declare('chat', ['a', 'gone'], [run('a', 'chat', 'running'), run('gone', 'chat', 'running')], 1)
  const fired = registry.settle([run('a', 'chat', 'completed')])
  assert.equal(fired.length, 1)
  assert.deepEqual(fired[0].runs.map(item => item.id), ['a'], 'only real snapshots are handed on')
})

test('the user outranks the wait, and a second declaration replaces the first', () => {
  const registry = new WorkflowWaitRegistry()
  const runs = [run('a', 'chat', 'running'), run('b', 'chat', 'running')]
  registry.declare('chat', ['a'], runs, 1)
  registry.declare('chat', ['b'], runs, 2)
  assert.deepEqual(registry.pending('chat').runIds, ['b'], 'one pending wait per chat, never two racing')
  assert.equal(registry.cancel('chat'), true)
  assert.equal(registry.pending('chat'), undefined)
  assert.equal(registry.cancel('chat'), false)
  assert.deepEqual(registry.settle([run('b', 'chat', 'completed')]), [], 'a cancelled wait never continues the chat')
})

test('the receipt tells the model to end its turn and never to poll', () => {
  const registry = new WorkflowWaitRegistry()
  const runs = [run('a', 'chat', 'running', 3)]
  const outcome = registry.declare('chat', [], runs, 1)
  const receipt = JSON.parse(workflowWaitReceipt(outcome.intent, runs))
  assert.equal(receipt.waiting, true)
  assert.deepEqual(receipt.runs, [{ runId: 'a', name: 'code-review', agents: 3 }])
  assert.match(receipt.instruction, /Do NOT call this tool again and do not poll/)
  assert.match(receipt.instruction, /End your turn now/)
  assert.match(receipt.instruction, /names which workflows you are waiting for/)
  assert.match(receipt.instruction, /wait is cancelled and they are answered first/)
})

test('the tool is non-blocking, fires from settle, and is only offered where a chat can actually resume', () => {
  const cowork = path.resolve(root, '../micromeet-cowork/apps/cowork')
  const others = fs.existsSync(cowork) ? [cowork] : []
  for (const app of [root, ...others]) {
    const host = fs.readFileSync(path.join(app, 'src/main/agent/workflowEngine/hostIntegration.ts'), 'utf8')
    assert.match(host, /name: 'workflow_wait'/, `workflow_wait is missing in ${app}`)
    assert.match(host, /Returns IMMEDIATELY — it does not block and must not be polled/)
    assert.match(host, /this\.waits\.settle\(runs\)/, 'the continuation must fire from the settle path')
    // The tool must not exist in an app whose host cannot resume the conversation.
    assert.match(host, /\.\.\.\(this\.options\.onWaitSatisfied \? \[\{/, 'workflow_wait must be gated on a wired continuation')
    const wait = fs.readFileSync(path.join(app, 'src/main/agent/workflowEngine/workflowWait.ts'), 'utf8')
    assert.match(wait, /Deliberately NOT a blocking tool/)
    assert.match(wait, /A pointer, not a restatement/, 'the continuation prompt must not repeat results already in context')
  }
  // Bitterless wires the continuation today; its absence elsewhere is deliberate, not an oversight.
  const maestro = path.join(root, 'src/main/agent/maestroAgent.service.ts')
  if (fs.existsSync(maestro)) {
    const bl = fs.readFileSync(maestro, 'utf8')
    assert.match(bl, /onWaitSatisfied: async/, 'Bitterless must implement the continuation it advertises')
    assert.match(bl, /hostAuthored: true/, 'the continuation root is host-authored, never the user speaking')
  }
})
