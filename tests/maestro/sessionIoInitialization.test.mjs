import assert from 'node:assert/strict'
import test from 'node:test'
import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const bl = root.endsWith('bitterless')
const require = createRequire(import.meta.url)
const servicePath = `src/main/agent/${bl ? 'maestroAgent' : 'coworkAgent'}.service.ts`
const rendererPath = `src/renderer/${bl ? 'maestro/' : ''}control/src/store/message.store.ts`
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const method = (path, name, bindings = {}) => {
  const source = readFileSync(join(root, path), 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const member = ast.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]).find(node => node.name?.getText(ast) === name)
  assert.ok(member, name)
  return new Function(...Object.keys(bindings), `${compile(`class Actual { ${member.getText(ast)} }`)};return Actual.prototype.${name}`)(...Object.values(bindings))
}
const bundle = (await build({ stdin: { contents: `export { BaseAgent } from './src/main/agent/BaseAgent'; export * from './src/main/agent/sessionIoInitialization'; export * from './src/main/agent/runtime/modelIoLog'; export * from './src/main/agent/runtime/agentSessionContext';`, resolveDir: root, loader: 'ts' }, bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false })).outputFiles[0].text
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function harness(t, filesystem = fs) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'chat-initialization-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const module = { exports: {} }
  new Function('require', 'module', 'exports', bundle)(name => name === 'fs/promises' ? filesystem : require(name), module, module.exports)
  const real = module.exports
  real.setModelIoRoot(() => join(dir, 'agent-io'))
  let requests = 0, created = 0, resets = 0
  const runtime = { createSession: async () => { created++; return { subscribe: () => () => {}, prompt: async () => { requests++ }, abort: async () => { resets++ } } } }
  const agents = new Map()
  const owner = {
    sessionIoInitialization: new real.SessionIoInitialization(),
    maestroAgents: agents, coworkAgents: agents,
    agentSessionKey: id => id.trim(),
    _state: { projectRootForSession: () => undefined }
  }
  const get = id => {
    if (!agents.has(id)) {
      const agent = new real.BaseAgent({ runtime, cwd: dir, buildTools: () => [], describeTarget: () => ({ providerLabel: 'Fixture', modelLabel: 'Test', supplier: 'test' }) })
      agent.setTarget('fixture', 'test-model', 'high')
      agents.set(id, agent)
    }
    return agents.get(id)
  }
  owner.getMaestroAgent = get; owner.getCoworkAgent = get
  owner.ensureSessionIo = method(servicePath, 'ensureSessionIo')
  return { real, dir, owner, agents, get, counts: () => ({ requests, created, resets }) }
}
const rows = async path => (await fs.readFile(join(path, 'part-001.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)

test('new chat and immediate copy await the same disk write, with initial actual system/model metadata and no model request', async t => {
  const gate = deferred(), entered = deferred()
  const h = await harness(t, { ...fs, appendFile: async (...args) => { entered.resolve(); await gate.promise; return fs.appendFile(...args) } })
  const project = join(h.dir, 'project'); await fs.mkdir(project); await fs.writeFile(join(project, 'AGENTS.md'), 'Project fixture instruction')
  const init = h.owner.ensureSessionIo({ sessionId: 'new', workspace: { path: project } })
  const copy = h.owner.ensureSessionIo({ sessionId: 'new' }, 'missing-history')
  let done = false; void copy.then(() => { done = true })
  await entered.promise
  assert.equal(done, false)
  assert.deepEqual(h.counts(), { requests: 0, created: 0, resets: 0 })
  gate.resolve()
  const [a, b] = await Promise.all([init, copy]); assert.deepEqual(a, b); assert.equal(a.ok, true)
  const saved = await rows(a.path)
  const snapshots = saved.filter(row => row.name === 'session-configuration')
  assert.equal(snapshots.length, 1)
  assert.match(snapshots[0].text, /Project fixture instruction/)
  assert.match(snapshots[0].text, /Current working directory:/)
  assert.equal(snapshots[0].detail.evidence, 'initial-configuration')
  assert.equal(snapshots[0].detail.modelId, 'test-model')
  assert.equal(snapshots[0].detail.thinkingLevel, 'high')
  assert.deepEqual(await fs.readdir(join(h.dir, 'agent-io')), [a.path.split('/').at(-1)])
  await h.real.runInAgentSession('new', () => h.get('new').prompt('hi'))
  const after = await h.owner.ensureSessionIo({ sessionId: 'new' }, 'missing-history')
  assert.equal(after.path, a.path, 'first message appends without rotating away the initial snapshot')
  assert.ok((await rows(a.path)).some(row => row.kind === 'prompt' && row.text === 'hi'))
  assert.deepEqual(h.counts(), { requests: 1, created: 1, resets: 0 })
  await new Promise(done => setTimeout(done, 3))
  await h.real.runInAgentSession('new', async () => { h.get('new').reset(); await new Promise(done => setTimeout(done, 10)) })
  assert.notEqual(await h.real.modelIoLog.dirForSession('new'), a.path, 'reset of an actual runtime retains its previous rotation behavior')
  assert.equal(h.counts().resets, 1)
})

test('parallel sessions stay separate; restart and existing history do not construct agents or alter saved bytes', async t => {
  const h = await harness(t)
  const [a, b] = await Promise.all(['A', 'B'].map(sessionId => h.owner.ensureSessionIo({ sessionId })))
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.notEqual(a.path, b.path)
  const before = await rows(a.path)
  const restarted = new h.real.SessionIoInitialization()
  const path = await restarted.ensure('A', 'missing-history', async () => assert.fail('retained evidence must not inspect/create agent'))
  assert.equal(path, a.path); assert.deepEqual(await rows(path), before)
  assert.deepEqual(h.counts(), { requests: 0, created: 0, resets: 0 })
})

test('missing old history is labelled current configuration, existing active agents are never mutated', async t => {
  const h = await harness(t)
  const agent = h.get('old')
  agent.setProjectRoot = async () => assert.fail('must not mutate an existing agent for inspection')
  agent.reset = () => assert.fail('must not reset an existing agent')
  const result = await h.owner.ensureSessionIo({ sessionId: 'old', workspace: { path: '/unused' } }, 'missing-history')
  assert.equal(result.ok, true)
  const snapshot = (await rows(result.path)).find(row => row.name === 'session-configuration')
  assert.equal(snapshot.detail.evidence, 'current-configuration-only')
  assert.match(snapshot.detail.explanation, /Historical model I\/O is unavailable/)
  assert.ok((await rows(result.path)).every(row => row.kind === 'note'))
  assert.deepEqual(h.counts(), { requests: 0, created: 0, resets: 0 })
})

test('write failure stays visible, never reports an empty directory, and a later retry works', async t => {
  let fail = true
  const h = await harness(t, { ...fs, appendFile: async (...args) => { if (fail) throw new Error('fixture disk full'); return fs.appendFile(...args) } })
  const failure = await h.owner.ensureSessionIo({ sessionId: 'retry' })
  assert.equal(failure.ok, false); assert.match(failure.error, /Unable to save/)
  fail = false
  const retry = await h.owner.ensureSessionIo({ sessionId: 'retry' }, 'missing-history')
  assert.equal(retry.ok, true); assert.ok((await rows(retry.path)).length)
})

test('a saved session-open note cannot hide failure to persist the configuration itself and retry repairs it', async t => {
  let fail = true
  const h = await harness(t, { ...fs, appendFile: async (...args) => {
    if (fail && String(args[1]).includes('session-configuration')) throw new Error('fixture snapshot write failed')
    return fs.appendFile(...args)
  } })
  const result = await h.owner.ensureSessionIo({ sessionId: 'partial' })
  assert.equal(result.ok, false)
  assert.match(result.error, /Unable to save/)
  const path = await h.real.modelIoLog.dirForSession('partial')
  assert.ok(path, 'session-open was saved but is not a successful configuration write')
  assert.ok((await rows(path)).every(row => row.name === 'session-open'))
  fail = false
  const retry = await h.owner.ensureSessionIo({ sessionId: 'partial' }, 'missing-history')
  assert.equal(retry.ok, true)
  assert.equal(retry.path, path)
  assert.equal((await rows(path)).filter(row => row.name === 'session-configuration').length, 1)
})

test('renderer newchat initializes its own identity/workspace and remains usable after IPC initialization failure', async () => {
  const calls = []
  const coach = { ensureSessionIo: async params => { calls.push(params); throw new Error('fixture offline') } }
  const notices = []
  const create = method(rendererPath, 'createSession', { coach, console: { warn: (...args) => notices.push(args) } })
  const session = { id: 'new-renderer', source: 'cowork', detail: { workspace: { path: '/project' } } }
  const owner = { sessions: [], createEmptySession: () => session, updateSessionContextUsage() {}, restoreActiveTurn() {}, replayTaskSnapshot() {}, cloneWorkspace: value => value }
  assert.equal(create.call(owner, { title: 'New', intent: 'chat' }), session)
  assert.deepEqual(calls, [{ sessionId: session.id, workspace: session.detail.workspace }])
  await new Promise(done => setImmediate(done))
  assert.equal(owner.sessions.length, 1); assert.equal(notices.length, 1)
})
