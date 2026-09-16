const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const bl = fs.existsSync(path.join(root, 'src/main/agent/maestroAgent.service.ts'))

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

const shared = load('src/shared/agentWorkflow.api.ts')
const activityModule = load('src/main/agent/workflowEngine/activitySummary.ts', { '../../../shared/agentWorkflow.api': shared })
const { WorkflowActivitySummaryService, validateWorkflowActivitySentence, WORKFLOW_ACTIVITY_PROMPT } = activityModule
const context = load('src/main/agent/runtime/agentSessionContext.ts')
// Real timer rounds: the scheduler uses unref'd timers, which setImmediate rounds never advance.
const tick = () => new Promise((resolve) => setTimeout(resolve, 1))
const settle = async (rounds = 6) => { for (let index = 0; index < rounds; index += 1) await tick() }

const agent = (id, status, currentAction = '', extra = {}) =>
  ({ id, runId: extra.runId || 'run-1', sessionId: extra.sessionId || 'chat-a', label: extra.label || ('Agent ' + id), prompt: 'task', status, currentAction, queuedAt: 10, startedAt: extra.startedAt, logs: [] })
const run = (id, sessionId, agents, extra = {}) =>
  ({ id, sessionId, name: extra.name || 'mini-demo', input: extra.input || 'Compare three handoff options', status: extra.status || 'running', createdAt: 5, agents })

/** A fake provider: one session per call, so a test can count real model invocations. */
function fakeRuntime(reply) {
  const calls = []
  return {
    calls,
    createSession: async (options) => {
      const call = { options, aborted: false, prompt: '' }
      calls.push(call)
      let listener = () => undefined
      return {
        subscribe: (handler) => { listener = handler; return () => undefined },
        prompt: async (message) => {
          call.prompt = message.text
          const outcome = await reply(call, calls.length)
          if (outcome && outcome.error) { listener({ type: 'assistant_done', errorMessage: outcome.error }); return }
          if (outcome && outcome.tool) { listener({ type: 'tool_start', toolName: 'read' }); return }
          listener({ type: 'assistant_done', text: (outcome && outcome.text) || '' })
        },
        abort: async () => { call.aborted = true }
      }
    }
  }
}

function service(runtime, overrides = {}) {
  const published = []
  const instance = new WorkflowActivitySummaryService({
    runtime,
    target: overrides.target || (() => ({ providerId: 'p', modelId: 'm', thinkingLevel: 'low', authPath: '/auth' })),
    onUpdated: () => published.push(instance.list()),
    debounceMs: 0, minIntervalMs: 0, deadlineMs: overrides.deadlineMs ?? 200
  })
  return { instance, published }
}

test('facts count only active Agents of the asked chat, excluding paused and finished work', () => {
  const runs = [
    run('run-1', 'chat-a', [agent('1', 'running', 'reading src', { startedAt: 300 }), agent('2', 'paused'), agent('3', 'completed'), agent('4', 'approval', 'web_fetch', { startedAt: 200 })]),
    run('run-2', 'chat-a', [agent('1', 'queued', '', { runId: 'run-2', startedAt: 500 })]),
    run('run-3', 'chat-b', [agent('1', 'running', '', { runId: 'run-3', sessionId: 'chat-b' })])
  ]
  const facts = shared.workflowActivityFacts(runs, 'chat-a')
  assert.equal(facts.agents, 3)
  assert.equal(facts.runs, 2)
  assert.equal(facts.awaitingUser, 1)
  assert.equal(facts.startedAt, 200)
  assert.equal(shared.workflowActivityFacts(runs, 'chat-b').agents, 1)
  assert.equal(shared.workflowActivityFacts(runs, 'chat-missing').agents, 0)
  // The brief describes the work but never carries credentials or full Agent output.
  const brief = JSON.parse(facts.brief)
  assert.equal(brief.tasks.length, 3)
  assert.equal(brief.tasks[0].workflow, 'mini-demo')
  assert.equal(brief.tasks[0].goal, 'Compare three handoff options')
  assert.equal(JSON.stringify(brief).includes('/auth'), false)
})

test('signature changes only when the described work changes, so idle snapshots cost no model call', () => {
  const base = [run('run-1', 'chat-a', [agent('1', 'running', 'reading src')])]
  const same = [run('run-1', 'chat-a', [agent('1', 'running', 'reading src')], { status: 'running' })]
  const moved = [run('run-1', 'chat-a', [agent('1', 'running', 'writing report')])]
  assert.equal(shared.workflowActivityFacts(base, 'chat-a').signature, shared.workflowActivityFacts(same, 'chat-a').signature)
  assert.notEqual(shared.workflowActivityFacts(base, 'chat-a').signature, shared.workflowActivityFacts(moved, 'chat-a').signature)
  // Scope ignores the momentary step, so a sentence about these Agents stays valid across tool calls.
  assert.equal(shared.workflowActivityFacts(base, 'chat-a').scope, shared.workflowActivityFacts(moved, 'chat-a').scope)
  const joined = [run('run-1', 'chat-a', [agent('1', 'running', 'reading src'), agent('2', 'running', 'reading tests')])]
  assert.notEqual(shared.workflowActivityFacts(base, 'chat-a').scope, shared.workflowActivityFacts(joined, 'chat-a').scope)
})

test('counts publish immediately without a model, and one sentence lands afterwards', async () => {
  const runtime = fakeRuntime(async () => ({ text: '正在比较三种交接方式' }))
  const { instance, published } = service(runtime)
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'reading src', { startedAt: 400 })])])
  // Deterministic facts are available to the very first broadcast; the sentence is not yet written.
  assert.deepEqual(instance.list('chat-a').map((entry) => [entry.agents, entry.text]), [[1, '']])
  assert.equal(runtime.calls.length, 0)
  await settle()
  assert.equal(runtime.calls.length, 1)
  assert.equal(runtime.calls[0].options.systemPrompt, WORKFLOW_ACTIVITY_PROMPT)
  assert.deepEqual(runtime.calls[0].options.tools, [])
  assert.deepEqual(runtime.calls[0].options.builtinTools, [])
  assert.equal(runtime.calls[0].aborted, true)
  assert.equal(instance.list('chat-a')[0].text, '正在比较三种交接方式')
  assert.equal(published.length, 1)
  // An unchanged snapshot must not re-ask the model or drop the sentence.
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'reading src', { startedAt: 400 })])])
  await settle()
  assert.equal(runtime.calls.length, 1)
  assert.equal(instance.list('chat-a')[0].text, '正在比较三种交接方式')
  instance.dispose()
})

test('a sentence written for superseded work is discarded, and the new work is summarized instead', async () => {
  let release
  const runtime = fakeRuntime(async (call, index) => {
    if (index === 1) { await new Promise((resolve) => { release = resolve }); return { text: 'stale sentence' } }
    return { text: 'fresh sentence' }
  })
  const { instance } = service(runtime)
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'first step')])])
  await settle()
  assert.equal(runtime.calls.length, 1)
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'second step')])])
  release()
  await settle(10)
  assert.equal(instance.list('chat-a')[0].text, 'fresh sentence', 'a sentence about older work must not describe new work')
  assert.equal(runtime.calls.length, 2)
  instance.dispose()
})

test('a sentence survives the Agents taking their next step, and is refreshed rather than blanked', async () => {
  const runtime = fakeRuntime(async (call, index) => ({ text: index === 1 ? 'first sentence' : 'second sentence' }))
  const { instance } = service(runtime)
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'reading src')])])
  await settle()
  assert.equal(instance.list('chat-a')[0].text, 'first sentence')
  // Same Agent, next tool step: blanking here made the status bar flicker between sentence and counts.
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'writing report')])])
  assert.equal(instance.list('chat-a')[0].text, 'first sentence')
  await settle()
  assert.equal(instance.list('chat-a')[0].text, 'second sentence')
  assert.equal(runtime.calls.length, 2)
  instance.dispose()
})

test('a different set of Agents drops the old sentence at once rather than describing them wrongly', async () => {
  let held
  const runtime = fakeRuntime(async (call, index) => {
    if (index === 1) return { text: 'one Agent is reading' }
    await new Promise((resolve) => { held = resolve })
    return { text: 'two Agents are reading' }
  })
  const { instance } = service(runtime)
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'reading src')])])
  await settle()
  assert.equal(instance.list('chat-a')[0].text, 'one Agent is reading')
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'reading src'), agent('2', 'running', 'reading tests')])])
  assert.equal(instance.list('chat-a')[0].text, '', 'a sentence about one Agent must not stand in for two')
  assert.equal(instance.list('chat-a')[0].agents, 2, 'the counts are still correct while no sentence exists')
  await settle()
  held()
  await settle(8)
  assert.equal(instance.list('chat-a')[0].text, 'two Agents are reading')
  instance.dispose()
})

test('a model that keeps failing costs a bounded number of attempts, retried when the Agents change', async () => {
  const runtime = fakeRuntime(async () => ({ error: 'provider exploded' }))
  const { instance } = service(runtime)
  for (let index = 0; index < 6; index += 1) {
    instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'step ' + index)])])
    await settle(4)
  }
  assert.equal(runtime.calls.length, 3, 'an unreachable model must not be called once per interval forever')
  assert.equal(instance.list('chat-a')[0].agents, 1)
  // New Agents are new work: worth one more budget, since the failure may have been about the old brief.
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'step'), agent('2', 'running', 'other')])])
  await settle(4)
  assert.equal(runtime.calls.length, 4)
  instance.dispose()
})

test('provider failure, unexpected tool use, and a missing target all degrade to counts only', async () => {
  for (const reply of [async () => ({ error: 'provider exploded' }), async () => ({ tool: true }), async () => ({ text: 'x'.repeat(140) })]) {
    const runtime = fakeRuntime(reply)
    const { instance, published } = service(runtime)
    instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'reading src')])])
    await settle(8)
    assert.equal(instance.list('chat-a')[0].agents, 1)
    assert.equal(instance.list('chat-a')[0].text, '')
    assert.equal(published.length, 0, 'nothing to republish when no sentence was accepted')
    instance.dispose()
  }
  const runtime = fakeRuntime(async () => ({ text: 'never asked' }))
  const { instance } = service(runtime, { target: () => null })
  instance.update([run('run-1', 'chat-a', [agent('1', 'running')])])
  await settle()
  assert.equal(runtime.calls.length, 0)
  assert.equal(instance.list('chat-a')[0].agents, 1)
  instance.dispose()
})

test('a chat with no active Agents is retired, and a later start is summarized again', async () => {
  const runtime = fakeRuntime(async () => ({ text: 'working on it' }))
  const { instance } = service(runtime)
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'step')])])
  await settle()
  assert.equal(instance.list('chat-a').length, 1)
  instance.update([run('run-1', 'chat-a', [agent('1', 'completed', 'step')], { status: 'completed' })])
  assert.deepEqual(instance.list('chat-a'), [])
  assert.deepEqual(instance.list(), [])
  instance.update([run('run-2', 'chat-a', [agent('1', 'running', 'new step', { runId: 'run-2' })])])
  await settle()
  assert.equal(instance.list('chat-a')[0].text, 'working on it')
  assert.equal(runtime.calls.length, 2)
  instance.dispose()
})

test('dispose stops scheduled work and a late sentence cannot publish', async () => {
  let release
  const runtime = fakeRuntime(async () => { await new Promise((resolve) => { release = resolve }); return { text: 'after dispose' } })
  const { instance, published } = service(runtime)
  instance.update([run('run-1', 'chat-a', [agent('1', 'running', 'step')])])
  await settle()
  instance.dispose()
  release()
  await settle(8)
  assert.equal(published.length, 0)
  assert.deepEqual(instance.list(), [])
})

test('only a single bounded plain line is accepted as a status sentence', () => {
  assert.equal(validateWorkflowActivitySentence('  Reviewing the relay diff  '), 'Reviewing the relay diff')
  assert.equal(validateWorkflowActivitySentence('"正在分析交接方式"'), '正在分析交接方式')
  assert.equal(validateWorkflowActivitySentence('first\nsecond'), 'first second')
  assert.equal(validateWorkflowActivitySentence('- bullet'), '')
  assert.equal(validateWorkflowActivitySentence('# heading'), '')
  assert.equal(validateWorkflowActivitySentence('x'.repeat(101)), '')
  assert.equal(validateWorkflowActivitySentence('bad' + String.fromCharCode(7) + 'bell'), '')
  assert.equal(validateWorkflowActivitySentence('   '), '')
})

test('the host publishes activity with every snapshot and a filtered listing keeps other chats', async () => {
  const runs = [run('run-1', 'chat-a', [agent('1', 'running', 'reading src')]), run('run-2', 'chat-b', [agent('1', 'running', 'reading docs', { runId: 'run-2', sessionId: 'chat-b' })])]
  let deps
  class Supervisor {
    constructor(options) { deps = options }
    async list(sessionId) { return { runs: sessionId ? runs.filter((entry) => entry.sessionId === sessionId) : runs, revision: 7 } }
    async dispose() {}
  }
  const { WorkflowHostIntegration } = load('src/main/agent/workflowEngine/hostIntegration.ts', {
    electron: { app: { getPath: () => '/test-user-data' } },
    './supervisor': { WorkflowSupervisor: Supervisor },
    './activitySummary': activityModule,
    '../runtime/agentSessionContext': context,
    '../runtime/modelIoLog': { modelIoLog: { append() {} } }
  })
  const broadcasts = []
  const runtime = fakeRuntime(async () => ({ text: 'summarized' }))
  const host = new WorkflowHostIntegration({
    broadcast: (snapshot) => broadcasts.push(snapshot),
    tools: () => [],
    runtime: async () => ({ cwd: '/test-project', providerId: 'p', modelId: 'm', thinkingLevel: 'low', authPath: '/auth', systemPrompt: 'instructions' }),
    activity: { runtime, target: () => ({ providerId: 'p', modelId: 'm', thinkingLevel: 'low', authPath: '/auth' }), debounceMs: 0, minIntervalMs: 0, deadlineMs: 200 }
  })

  deps.broadcast({ runs, revision: 7 })
  assert.equal(broadcasts.length, 1)
  assert.deepEqual(broadcasts[0].activity.map((entry) => [entry.sessionId, entry.agents]).sort(), [['chat-a', 1], ['chat-b', 1]])

  const filtered = await host.listRuns({ sessionId: 'chat-a' })
  assert.deepEqual(filtered.runs.map((entry) => entry.id), ['run-1'])
  assert.deepEqual(filtered.activity.map((entry) => entry.sessionId), ['chat-a'])
  // The other chat's Agents are still running; a filtered read must not retire them.
  assert.deepEqual((await host.listRuns()).activity.map((entry) => entry.sessionId).sort(), ['chat-a', 'chat-b'])

  await settle(10)
  const republished = broadcasts[broadcasts.length - 1]
  assert.equal(republished.revision, 7)
  assert.deepEqual(republished.activity.map((entry) => entry.text), ['summarized', 'summarized'])
  await host.dispose()
})

test('both apps ship the same summary service and contract', () => {
  const other = bl
    ? '/Users/ral/Documents/projects/overmind/projects/micromeet-cowork/apps/cowork'
    : '/Users/ral/Documents/projects/overmind/projects/bitterless'
  if (!fs.existsSync(other)) return
  for (const relative of ['src/main/agent/workflowEngine/activitySummary.ts', 'src/shared/agentWorkflow.api.ts']) {
    assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), fs.readFileSync(path.join(other, relative), 'utf8'), relative + ' drifted between apps')
  }
})
