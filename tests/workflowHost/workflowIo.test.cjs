const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const { readFileSync } = require('node:fs')
const { join, resolve, dirname } = require('node:path')
const { tmpdir } = require('node:os')
const ts = require('typescript')
const root = resolve(__dirname, '../..')
function loader(stubs) {
  const cache = new Map()
  const load = file => {
    file = resolve(root, file.endsWith('.ts') ? file : `${file}.ts`)
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }; cache.set(file, module)
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    // `@shared/…` and `@main/…` resolve to real files, exactly as the bundler does. Falling straight
    // through to `require()` for them made every harness break the moment a main module imported a
    // shared one — which is what happened when the workflow entry-name contract moved to
    // `shared/workflowPackage.ts`.
    const alias = name => name.startsWith('@shared/') ? resolve(root, 'src/shared', name.slice('@shared/'.length))
      : name.startsWith('@main/') ? resolve(root, 'src/main', name.slice('@main/'.length))
      : null
    new Function('require', 'module', 'exports', '__dirname', code)(name => name in stubs ? stubs[name] : name.startsWith('.') ? load(resolve(dirname(file), name)) : (alias(name) ? load(alias(name)) : require(name)), module, module.exports, dirname(file))
    return module.exports
  }
  return load
}
class Child extends EventEmitter {
  constructor(pid) { super(); this.pid = pid; this.commands = [] }
  postMessage(command) { this.commands.push(command); if (command.type === 'abort') this.onAbort?.() }
  message(event) { this.emit('message', event) }
  exit() { if (!this.exited) { this.exited = true; this.emit('exit', 0) } }
}
async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'workflow-io-'))
  let hostDeps
  const load = loader({
    electron: { app: { getPath: () => dir }, utilityProcess: {} },
    './supervisor': { WorkflowSupervisor: class { constructor(deps) { hostDeps = deps } } }
  })
  const { modelIoLog, setModelIoRoot } = load('src/main/agent/runtime/modelIoLog.ts')
  const { runInAgentSession } = load('src/main/agent/runtime/agentSessionContext.ts')
  setModelIoRoot(() => join(dir, 'agent-io'))
  const { WorkflowHostIntegration } = load('src/main/agent/workflowEngine/hostIntegration.ts')
  new WorkflowHostIntegration({ broadcast() {}, tools: () => [], runtime: async () => ({}) })
  const { WorkflowSupervisor } = load('src/main/agent/workflowEngine/supervisor.ts')
  const children = []
  const supervisor = new WorkflowSupervisor(hostDeps, {
    fork() { if (options.failFork) throw Error('fixture worker cannot launch'); const child = new Child(91000 + children.length); children.push(child); return child },
    signal(pid) { children.find(child => child.pid === pid)?.exit() },
    terminateOwnedProcesses: async () => {}, terminationGraceMs: 5, terminationTimeoutMs: 100
  })
  t.after(async () => { await supervisor.dispose(); for (const session of ['chat-a', 'chat-b']) await modelIoLog.dirForSession(session); await fs.rm(dir, { recursive: true, force: true }) })
  const start = sessionId => supervisor.start({ sessionId, input: `task ${sessionId}`, entry: { kind: 'builtin', name: 'mini-demo' } }, { tools: [] })
  const rows = async sessionId => {
    const path = await modelIoLog.dirForSession(sessionId)
    assert.ok(path, 'the real directory resolver must find workflow-only sessions')
    return { path, lines: (await fs.readFile(join(path, 'part-001.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse) }
  }
  return { dir, load, modelIoLog, runInAgentSession, supervisor, children, start, rows }
}

test('workflow-only launch creates a real chat log immediately and survives a fresh logger lookup', async t => {
  const h = await fixture(t)
  const run = await h.start('chat-a')
  const { path, lines } = await h.rows('chat-a')
  assert.match(path, /-chat-a$/)
  assert.ok(lines.some(line => line.name === 'workflow-start' && line.text === 'task chat-a' && line.detail.runId === run.id))
  const restarted = new h.modelIoLog.constructor()
  assert.equal(await restarted.dirForSession('chat-a'), path)
  assert.equal(await restarted.dirForSession('missing'), null)
})

test('parallel worker I/O retains full contents under its parent chat and captures abort-time messages', async t => {
  const h = await fixture(t)
  const a = await h.start('chat-a'), b = await h.start('chat-b')
  const engineA = h.children[0], engineB = h.children[1]
  const attempt = { id: '1:1', rowId: 1, turnId: 'first', prompt: 'inspect', opts: { label: 'Inspector', phase: 'analysis' }, providerId: 'fixture', modelId: 'model' }
  engineA.message({ type: 'attempt.start', attempt }); engineB.message({ type: 'attempt.start', attempt })
  const workerA = h.children[2], workerB = h.children[3]
  const fullText = 'raw tool result '.repeat(8000)
  const io = text => ({ type: 'agent.io', line: { kind: 'tool_result', turn: 1, name: 'read', subject: 'fixture', text, detail: { sessionId: 'spoof' } } })
  // An unrelated ambient main session must not redirect child diagnostics.
  await h.runInAgentSession('chat-b', async () => workerA.message(io(fullText)))
  workerB.message(io('only B'))
  workerA.onAbort = () => workerA.message({ type: 'agent.io', line: { kind: 'turn_end', turn: 1, name: 'model', subject: 'aborted', text: 'provider abort acknowledged' } })
  await h.supervisor.stopRun('chat-a', a.id)
  const A = await h.rows('chat-a'), B = await h.rows('chat-b')
  assert.notEqual(A.path, B.path)
  const tool = A.lines.find(line => line.kind === 'tool_result')
  assert.equal(tool.text, fullText); assert.equal(tool.detail.sessionId, 'chat-a')
  assert.equal(tool.detail.runId, a.id); assert.equal(tool.detail.agentId, '1'); assert.equal(tool.detail.attemptId, '1:1')
  assert.equal(tool.detail.label, 'Inspector'); assert.equal(tool.detail.phase, 'analysis')
  assert.equal(tool.detail.providerId, 'fixture'); assert.equal(tool.detail.modelId, 'model')
  assert.ok(A.lines.some(line => line.text === 'provider abort acknowledged'))
  assert.ok(A.lines.some(line => line.name === 'workflow-end' && line.detail.data.status === 'stopped'))
  assert.equal(A.lines.some(line => line.text === 'only B'), false)
  assert.equal(B.lines.find(line => line.kind === 'tool_result').detail.runId, b.id)
  assert.equal(JSON.stringify(await h.supervisor.list()).includes(fullText), false, 'full model diagnostics must not enter renderer snapshots')
})

test('worker launch failure still has saved evidence instead of reporting a missing session log', async t => {
  const h = await fixture(t, { failFork: true })
  const run = await h.start('chat-a')
  assert.equal(run.status, 'failed')
  const { lines } = await h.rows('chat-a')
  assert.ok(lines.some(line => line.name === 'workflow-end' && line.text === 'fixture worker cannot launch'))
})


test('manual retry retains exact file entry and full input across restart, creates a new run, and rejects cross-chat/old/running/stopped records', async t => {
  const h = await fixture(t, { failFork: true })
  const request = { sessionId: 'chat-a', entry: { kind: 'file', path: '/test/project with spaces/retry.ts' }, input: 'task '.repeat(15000) }
  const first = await h.supervisor.start(request, { tools: [] })
  assert.equal(first.status, 'failed')
  assert.deepEqual(await h.supervisor.retryRequest('chat-a', first.id), { ...request, origin: 'shortcut' })
  await assert.rejects(h.supervisor.retryRequest('chat-b', first.id), /Only a failed/)
  const persisted = JSON.parse(await fs.readFile(join(h.dir, 'workflow-runs/runs.json'), 'utf8'))
  persisted.runs.push({ ...first, id: 'old', entry: undefined })
  persisted.runs.push({ ...first, id: 'partial', status: 'completed', agents: [{ status: 'failed' }] })
  persisted.runs.push({ ...first, id: 'success', status: 'completed' })
  await fs.writeFile(join(h.dir, 'workflow-runs/runs.json'), JSON.stringify(persisted))
  const { WorkflowSupervisor } = h.load('src/main/agent/workflowEngine/supervisor.ts')
  const restarted = new WorkflowSupervisor({ storageDir: join(h.dir, 'workflow-runs'), broadcast() {} }, { fork() { throw Error('fixture failed'); }, signal() {} })
  t.after(() => restarted.dispose())
  assert.deepEqual(await restarted.retryRequest('chat-a', 'partial'), { ...request, origin: 'shortcut' })
  await assert.rejects(restarted.retryRequest('chat-a', 'success'), /Only a failed/)
  const retryRequest = await restarted.retryRequest('chat-a', first.id)
  const second = await restarted.start(retryRequest, { tools: [] })
  assert.notEqual(second.id, first.id)
  assert.equal(second.input, request.input)
  assert.deepEqual(second.entry, request.entry)
  assert.equal((await restarted.list()).runs.find(run => run.id === first.id).error, first.error)
  await assert.rejects(restarted.retryRequest('chat-a', 'old'), /older workflow/)
  const live = await fixture(t)
  const running = await live.start('chat-a')
  await assert.rejects(live.supervisor.retryRequest('chat-a', running.id), /Only a failed/)
  await live.supervisor.stopRun('chat-a', running.id)
  await assert.rejects(live.supervisor.retryRequest('chat-a', running.id), /Only a failed/)
})
