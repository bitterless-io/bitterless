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
    if (name === '../../workflowLibrary/workflowLibraryRuntime') return { workflowLibraryRuntime: { list: async () => [], resolve: async () => { throw new Error('Fixture library unavailable') }, assertPath: async () => undefined } }
    if (name.startsWith('node:')) return require(name)
    throw Error('Unexpected test dependency: ' + name)
  }, module, module.exports, path.dirname(filename))
  return module.exports
}
const context = load('src/main/agent/runtime/agentSessionContext.ts')
const activityModule = load('src/main/agent/workflowEngine/activitySummary.ts', { '../../../shared/agentWorkflow.api': load('src/shared/agentWorkflow.api.ts') })
function integration(tools = () => [], runtime, assertCanStartShortcut, library) {
  let supervisor
  class Supervisor {
    constructor(deps) { this.deps = deps; this.stops = []; supervisor = this }
    async start(request, runtime) { this.request = request; this.runtime = runtime; return { id: 'run-1', ...request, status: 'running' } }
    waitForRun() { return new Promise((resolve) => { this.finish = resolve }) }
    stopAgent(...ids) { this.stops.push(ids) }
    stopRun(...ids) { this.stops.push(ids) }
    stopSession(...ids) { this.stops.push(ids) }
    list() { return { runs: [], revision: 1 } }
    setAgentStatus(...args) { this.status = args }
    dispose() { this.disposed = true }
  }
  const { WorkflowHostIntegration } = load('src/main/agent/workflowEngine/hostIntegration.ts', {
    electron: { app: { getPath: () => '/test-user-data' } },
    './supervisor': { WorkflowSupervisor: Supervisor }, './activitySummary': activityModule, '../runtime/agentSessionContext': context,
    '../runtime/modelIoLog': { modelIoLog: { append() {} } },
    ...(library ? { '../../workflowLibrary/workflowLibraryRuntime': { workflowLibraryRuntime: library } } : {})
  })
  const host = new WorkflowHostIntegration({
    broadcast() {}, tools, assertCanStartShortcut,
    runtime: runtime || (async () => ({ cwd: '/test-project', providerId: 'chosen-provider', modelId: 'chosen-model', thinkingLevel: 'low', authPath: '/test-auth', systemPrompt: 'Selected project instructions' }))
  })
  return { host, supervisor }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('workflow_run returns a background receipt and preserves selected session, model, and project', async () => {
  const { host, supervisor } = integration(() => [{ name: 'web_search', description: 'search', params: [], execute: async () => '' }])
  const tool = host.chatTools('chat-a').find((tool) => tool.name === 'workflow_run')
  let settled = false
  const result = tool.execute({ name: 'research', input: 'Verify these claims' }).then((value) => { settled = true; return value })
  await tick()
  assert.equal(settled, true)
  assert.equal(supervisor.request.sessionId, 'chat-a')
  assert.equal(supervisor.request.cwd, '/test-project')
  assert.equal(supervisor.runtime.providerId, 'chosen-provider')
  assert.equal(supervisor.runtime.modelId, 'chosen-model')
  assert.equal(supervisor.runtime.systemPrompt, 'Selected project instructions')
  assert.equal(supervisor.runtime.tools[0].execute, undefined)
  assert.deepEqual(JSON.parse(await result), { runId: 'run-1', status: 'running', background: true })
})

test('rejects ambiguous entries, missing chat owner, unknown workflow, and unsafe file inputs', async () => {
  const { host } = integration()
  const tool = host.chatTools('chat-a').find((tool) => tool.name === 'workflow_run')
  await assert.rejects(tool.execute({ name: 'research', path: '/work/a.ts', input: 'x' }), /exactly one/)
  for (const sessionId of ['', 'default', 'workflow:parent:child']) {
    await assert.rejects(host.startWorkflow({ sessionId, entry: { kind: 'builtin', name: 'research' }, input: 'x' }), /explicit chat/)
  }
  await assert.rejects(host.startWorkflow({ sessionId: 'chat-a', entry: { kind: 'builtin', name: 'unknown' }, input: 'x' }), /Unknown/)
  await assert.rejects(host.startWorkflow({ sessionId: 'chat-a', entry: { kind: 'file', path: '../relative.ts' }, input: 'x' }), /absolute/)
  assert.equal((await host.listWorkflows()).length, 7)
})

test('host tool cancellation waits for the real resource to stop, with a separate per-agent context', async () => {
  const controller = new AbortController()
  let release
  let receivedSignal
  let owner
  let parent
  const { supervisor } = integration((signal, onApproval, sessionId) => [{
    name: 'web_fetch', description: 'fetch', params: [],
    execute: async () => {
      receivedSignal = signal; owner = context.currentAgentSessionKey(); parent = sessionId
      onApproval(true)
      await new Promise((resolve) => { release = resolve })
      return 'late result'
    }
  }])
  let settled = false
  const task = supervisor.deps.executeTool({ sessionId: 'chat-a', runId: 'run-a', agentId: 'agent-b', callId: 'call-c', toolName: 'web_fetch', args: {} }, controller.signal)
  const observed = task.finally(() => { settled = true })
  await tick()
  controller.abort(new DOMException('Stopped', 'AbortError'))
  await tick()
  assert.equal(settled, false)
  assert.equal(receivedSignal, controller.signal)
  assert.equal(owner, 'workflow:run-a:agent-b')
  assert.equal(parent, 'chat-a')
  assert.deepEqual(supervisor.status, ['chat-a', 'run-a', 'agent-b', 'approval', 'Awaiting approval: web_fetch'])
  release()
  await assert.rejects(observed, { name: 'AbortError' })
  assert.equal(context.currentAgentSessionKey(), undefined)
})

test('unsupported host actions cannot bypass the workflow capability boundary', async () => {
  let ran = false
  const { host, supervisor } = integration(() => [{ name: 'browser_exec', description: '', params: [], execute: async () => { ran = true; return '' } }])
  await assert.rejects(supervisor.deps.executeTool({ sessionId: 'chat-a', runId: 'run-a', agentId: 'agent-b', callId: 'c', toolName: 'browser_exec', args: {} }, new AbortController().signal), /unavailable or cannot be cancelled/)
  assert.equal(ran, false)
  supervisor.list = () => ({ runs: [{ id: 'run-a', sessionId: 'chat-a', status: 'running', agents: [{ id: 'agent-b' }] }], revision: 1 })
  await host.stopAgent({ sessionId: 'chat-a', runId: 'run-a', agentId: 'agent-b' })
  assert.deepEqual(supervisor.stops, [['chat-a', 'run-a', 'agent-b']])
})

test('cancel one approval while another remains live in the same parent chat', async () => {
  const shared = load(bl ? 'src/shared/maestro/task.api.ts' : 'src/shared/task.api.ts')
  const { taskRegistry } = load(bl ? 'src/main/maestro/tasks/taskRegistry.service.ts' : 'src/main/tasks/taskRegistry.service.ts', {
    'electron-xpc/main': { xpcMain: { broadcast() {} } },
    '@main/agent/runtime/agentSessionContext': context,
    [bl ? '@maestro-shared/task.api' : '@shared/task.api']: shared
  })
  const ctl = new AbortController()
  const first = context.runInAgentSession('workflow:run:a', () => taskRegistry.askOperator({ sessionId: 'chat-a', signal: ctl.signal, title: 'First' }))
  const second = context.runInAgentSession('workflow:run:b', () => taskRegistry.askOperator({ sessionId: 'chat-a', title: 'Second' }))
  const tasks = taskRegistry.list()
  assert.deepEqual(tasks.map((task) => task.sessionId), ['chat-a', 'chat-a'])
  ctl.abort()
  assert.equal(await first, false)
  const live = taskRegistry.list().find((task) => task.state.title === 'Second')
  assert.equal(live.state.status, 'running')
  assert.ok(live.state.pendingConfirm)
  taskRegistry.resolveConfirm({ taskId: live.id, confirmId: live.state.pendingConfirm.id, confirm: true })
  assert.equal(await second, true)
  const count = taskRegistry.list().length
  await assert.rejects(taskRegistry.askOperator({ title: 'Already stopped', signal: ctl.signal }), { name: 'AbortError' })
  assert.equal(taskRegistry.list().length, count)
})

for (const api of ['search', 'fetch']) test(`${api} AbortSignal reaches HTTP and rejects as cancellation`, async () => {
  let signal
  let aborted = false
  const fetch = async (_url, options) => {
    signal = options.signal
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true }))
  }
  const modules = { undici: { fetch } }
  let call
  if (api === 'search') {
    modules['@main/auth/customerSession.service'] = { customerSessionService: { current: { baseUrl: 'https://test.invalid', token: 'test-only' } } }
    modules['@main/networking/clients/relay.client'] = { resolveAiCrmsRelayRoot: () => ({ baseUrl: 'https://test.invalid', region: 'TEST' }) }
    modules['@shared/session.api'] = { isCompleteAuthSession: () => true }
    const entry = load(bl ? 'src/main/net/webSearch.api.ts' : 'src/main/networking/api/webSearch.api.ts', modules)
    call = (signal) => (entry.searchWebThroughCore || entry.searchWebThroughRelay)({ query: 'test', signal, session: { jwt_token: 'test-only', iid: 1 } })
  } else {
    modules['@main/logging/moduleLog'] = { moduleLog: () => ({ info() {}, warn() {} }) }
    modules['@main/net/fetchPolicy'] = { assertFetchableUrl: (url) => new URL(url), narrowForLog: (value) => value }
    modules['@main/net/articleExtract'] = { extractArticle() { throw Error('must not reach extraction') } }
    call = (signal) => load('src/main/net/webFetch.ts', modules).fetchWebPage('https://test.invalid', 1000, signal)
  }
  const ctl = new AbortController()
  const promise = call(ctl.signal)
  assert.ok(signal)
  ctl.abort(new DOMException('Stopped', 'AbortError'))
  await assert.rejects(promise, { name: 'AbortError' })
  assert.equal(aborted, true)
})

function chatDao(options = {}) {
  const mutations = []
  let stops = 0
  const workflows = {
    stopSession: async () => { stops++; return options.stop ? options.stop() : { ok: true } },
    listRuns: async () => 'snapshot' in options ? options.snapshot : { runs: [], revision: 1 }
  }
  const db = {
    prepare: (sql) => ({ get: () => options.hasMessages, run: () => mutations.push(sql) }),
    transaction: (fn) => fn
  }
  const entries = load(bl ? 'src/preload/maestro/sqlite/maestroChat.dao.ts' : 'src/preload/sqlite/cowork_chat.dao.ts', {
    'electron-xpc/preload': { XpcPreloadHandler: class {}, createXpcPreloadEmitter: () => workflows },
    './sqliteManager': { sqliteManager: { db } }
  })
  return { dao: entries.maestroChatDao || entries.coworkChatDao, mutations, stops: () => stops }
}

test('chat deletion waits for confirmed workflow cleanup before SQL, and refuses incomplete cleanup', async () => {
  let release
  const pending = chatDao({ stop: () => new Promise((resolve) => { release = resolve }) })
  const deleted = pending.dao.deleteSession({ id: 'chat-a' })
  await tick()
  assert.equal(pending.mutations.length, 0)
  release({ ok: true })
  assert.deepEqual(await deleted, { ok: true })
  assert.equal(pending.mutations.length, 2)
  for (const options of [
    { stop: async () => null }, { snapshot: null },
    { snapshot: { runs: [{ status: 'stopping' }], revision: 1 } }
  ]) {
    const failed = chatDao(options)
    await assert.rejects(failed.dao.deleteSession({ id: 'chat-a' }), /chat was kept/)
    assert.equal(failed.mutations.length, 0)
  }
  const nonEmpty = chatDao({ hasMessages: true })
  assert.deepEqual(await nonEmpty.dao.deleteSession({ id: 'chat-a', onlyIfEmpty: true }), { ok: false })
  assert.equal(nonEmpty.stops(), 0)
})

test('stopping a chat fences startup while runtime configuration is still loading', async () => {
  let release
  const { host, supervisor } = integration(() => [], () => new Promise((resolve) => { release = resolve }))
  const pending = host.startWorkflow({ sessionId: 'chat-a', entry: { kind: 'builtin', name: 'mini-demo' }, input: 'x' })
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  const stopped = host.stopSession({ sessionId: 'chat-a' })
  await assert.rejects(host.startWorkflow({ sessionId: 'chat-a', entry: { kind: 'builtin', name: 'mini-demo' }, input: 'x' }), /stopping/)
  release({ cwd: '/test-project', providerId: 'chosen', modelId: 'model', thinkingLevel: 'low', authPath: '/test-auth', systemPrompt: '' })
  await rejected
  assert.deepEqual(await stopped, { ok: true })
  assert.equal(supervisor.request, undefined)
  await host.dispose()
  await assert.rejects(host.startWorkflow({ sessionId: 'chat-b', entry: { kind: 'builtin', name: 'mini-demo' }, input: 'x' }), /stopping/)
})


test('shortcut startup uses host admission before and after runtime, with no renderer cwd override', async () => {
  const checks = []
  let receivedCwd
  const { host, supervisor } = integration(undefined, async (sessionId, cwd) => {
    receivedCwd = cwd
    return { cwd: '/host-selected-project', providerId: 'selected', modelId: 'selected-model' }
  }, (id, others) => checks.push({ id, others }))
  await host.startWorkflow({ sessionId: 'chat-a', entry: { kind: 'builtin', name: 'mini-demo' }, input: 'task', origin: 'shortcut', cwd: '/renderer-override' })
  assert.equal(checks.length, 2)
  assert.equal(receivedCwd, undefined)
  assert.equal(supervisor.request.cwd, '/host-selected-project')
  assert.equal(supervisor.runtime.providerId, 'selected')
})

test('same-chat workflows start concurrently without reserving ordinary chat turns', async () => {
  const releases = []
  const h = integration(undefined, () => new Promise(resolve => releases.push(() => resolve({ cwd: '/host-project', providerId: 'selected', modelId: 'selected-model' }))), () => {})
  const request = { sessionId: 'chat-a', entry: { kind: 'builtin', name: 'mini-demo' }, input: 'task', origin: 'shortcut' }
  const first = h.host.startWorkflow(request)
  const second = h.host.startWorkflow(request)
  await tick()
  assert.equal(releases.length, 2)
  for (const release of releases) release()
  assert.equal((await first).status, 'running')
  assert.equal((await second).status, 'running')
})

test('workflow shortcut handler always supplies the authoritative shortcut origin', () => {
  const source = fs.readFileSync(path.join(root, 'src/main/xpc/workflow.handler.ts'), 'utf8')
  assert.match(source, /startWorkflow\(\{ \.\.\.params, origin: 'shortcut' \}\)/)
})


test('manual retry deduplicates concurrent clicks and uses current host admission, workspace and model', async () => {
  let release, lookups = 0, starts = 0
  const checks = []
  const { host, supervisor } = integration(undefined, async (_id, cwd) => {
    assert.equal(cwd, undefined)
    await new Promise(done => { release = done })
    return { cwd: '/current-project', providerId: 'current', modelId: 'current-model' }
  }, id => checks.push(id))
  supervisor.retryRequest = async (sessionId, runId) => {
    lookups++; assert.equal(runId, 'failed-run')
    return { sessionId, entry: { kind: 'builtin', name: 'mini-demo' }, input: 'original input', origin: 'shortcut' }
  }
  const start = supervisor.start.bind(supervisor)
  supervisor.start = (...args) => { starts++; return start(...args) }
  const first = host.retryWorkflow({ sessionId: 'chat-a', runId: 'failed-run' })
  const second = host.retryWorkflow({ sessionId: 'chat-a', runId: 'failed-run' })
  await tick(); assert.equal(lookups, 1); assert.equal(starts, 0)
  release()
  assert.deepEqual(await first, await second)
  assert.equal(starts, 1); assert.equal(supervisor.request.cwd, '/current-project')
  assert.equal(supervisor.runtime.modelId, 'current-model'); assert.equal(checks.length, 2)
  const blocked = integration(undefined, undefined, () => { throw Error('chat busy') })
  blocked.supervisor.retryRequest = supervisor.retryRequest
  await assert.rejects(blocked.host.retryWorkflow({ sessionId: 'chat-a', runId: 'failed-run' }), /chat busy/)
  assert.equal(blocked.supervisor.request, undefined)
  blocked.supervisor.retryRequest = async () => { throw Error('old entry missing') }
  await assert.rejects(blocked.host.retryWorkflow({ sessionId: 'chat-a', runId: 'failed-run' }), /old entry missing/)
})


test('stop during retry lookup fences launch and waits for the pending retry', async () => {
  const { host, supervisor } = integration(undefined, undefined, () => {})
  let release
  supervisor.retryRequest = () => new Promise(done => { release = done })
  const retry = host.retryWorkflow({ sessionId: 'chat-a', runId: 'failed' })
  const rejected = assert.rejects(retry, { name: 'AbortError' })
  let stopped = false
  const stopping = host.stopSession({ sessionId: 'chat-a' }).then(() => { stopped = true })
  await tick(); assert.equal(stopped, false)
  release({ sessionId: 'chat-a', entry: { kind: 'builtin', name: 'mini-demo' }, input: 'original', origin: 'shortcut' })
  await rejected; await stopping
  assert.equal(supervisor.request, undefined)
})

test('structured task controls require exact chat-owned identifiers and additional tasks start independently', async () => {
  const { host, supervisor } = integration()
  const row = { id: 'parent', sessionId: 'chat-a', name: 'mini-demo', status: 'running', input: 'original', agents: [{ id: '1', status: 'paused' }] }
  supervisor.list = (sessionId) => ({ runs: sessionId === 'chat-a' ? [row] : [], revision: 1 })
  const controls = []
  supervisor.pauseAgent = (...args) => controls.push(['pause', ...args])
  supervisor.resumeAgent = (...args) => controls.push(['resume', ...args])
  supervisor.steerAgent = (...args) => controls.push(['steer', ...args])
  const tool = name => host.chatTools('chat-a').find(tool => tool.name === name)
  for (const name of ['workflow_pause', 'workflow_resume', 'workflow_stop_agent', 'workflow_steer']) {
    await assert.rejects(tool(name).execute({runId:'parent', message:'change scope'}), /Exact/)
    await assert.rejects(tool(name).execute({runId:'foreign', agentId:'1', message:'change scope'}), /does not belong/)
  }
  await tool('workflow_pause').execute({runId:'parent',agentId:'1'})
  await tool('workflow_resume').execute({runId:'parent',agentId:'1'})
  await tool('workflow_steer').execute({runId:'parent',agentId:'1',message:'read-only, concise'})
  assert.deepEqual(controls.map(call => call[0]), ['pause','resume','steer'])
  assert.ok(controls.every(call => call[1] === 'chat-a' && call[2] === 'parent' && call[3] === '1'))
  await assert.rejects(tool('workflow_add_task').execute({input:'research',parentRunId:'foreign'}), /does not belong/)
  const added = JSON.parse(await tool('workflow_add_task').execute({input:'research',parentRunId:'parent'}))
  assert.equal(added.background, true)
  assert.equal(supervisor.request.entry.name, 'agent-task')
  assert.match(supervisor.request.input, /Related workflow \(context only\)/)
  assert.equal(row.agents.length, 1, 'adding work does not mutate the existing graph')
  await assert.rejects(host.pauseWorkflowAgent({sessionId:'chat-b',runId:'parent',agentId:'1'}), /does not belong/)
})

test('library references resolve through live scope and managed file permission is rechecked after runtime preparation', async () => {
  const checks = []
  const library = { list: async () => [{ name: 'institution:7:1', ref: 'institution:7:1', scope: 'institution', institution_id: 7, description: 'Fixture' }], resolve: async ref => { assert.equal(ref, 'institution:7:1'); return { kind: 'file', path: '/managed/7/workflow.ts' } }, assertPath: async path => { checks.push(path) } }
  const { host, supervisor } = integration(() => [], undefined, undefined, library)
  assert((await host.listWorkflows()).some(row => row.scope === 'institution' && row.institution_id === 7))
  assert((await host.listWorkflows()).some(row => row.scope === 'shared' && row.ref === 'shared:builtin:mini-demo'))
  const tool = host.chatTools('chat-a').find(tool => tool.name === 'workflow_run')
  await tool.execute({ name: 'institution:7:1', input: 'Fixture input' })
  assert.equal(supervisor.request.entry.kind, 'file'); assert.deepEqual(checks, ['/managed/7/workflow.ts', '/managed/7/workflow.ts'])
  const revoked = integration(() => [], async () => { throw Error('fixture context changed') }, undefined, library)
  await assert.rejects(revoked.host.startWorkflow({ sessionId: 'chat-a', entry: { kind: 'library', ref: 'institution:7:1' }, input: 'Fixture' }), /context changed/)
})
