import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const file = resolve(import.meta.dirname, '../../src/main/maestro/agent/BaseAgent.ts')
const source = ts.transpileModule(readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText
const mod = { exports: {} }
// The real class, including its timers and tool wrapper, runs unchanged. Only its unused
// default network adapter is replaced; each fixture supplies an explicit model adapter.
vm.runInThisContext(`(function(exports,require,module){${source}\n})`, { filename: file })(mod.exports, id =>
  id === './runtime/coachRuntimeAdapter' ? { CoachRuntimeAdapter: class { constructor() { throw Error('Unexpected default network adapter') } } } : require(id), mod)
const { BaseAgent } = mod.exports
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const fixture = (respond, controls = {}) => {
  const sessions = [], events = [], streams = [], activity = []
  const agent = new BaseAgent({
    authPath: '/unused-test-auth.json',
    buildTools: () => controls.tools || [],
    onRuntimeEvent: event => events.push(event), onStream: text => streams.push(text), onActivity: value => activity.push(value),
    runtime: {
      async createSession(options) {
        const listeners = new Set()
        const session = {
          calls: [], aborted: 0, options,
          subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) },
          emit(event) { for (const listener of listeners) listener(event) },
          async prompt(input) {
            session.calls.push(input)
            await respond(session, input)
            session.emit({ type: 'assistant_done', text: 'late final result', stopReason: 'stop' })
          },
          async abort() { session.aborted++; await controls.abort?.(session) }
        }
        sessions.push(session)
        await controls.beforeCreate?.(session)
        return session
      }
    }
  })
  return { agent, sessions, events, streams, activity }
}

test('Stop waits for the actual normal prompt and rejects replacement admission and late events', async t => {
  const entered = deferred(), finish = deferred()
  t.after(() => finish.resolve())
  const f = fixture(async (_session, input) => { if (input.text === 'old') { entered.resolve(); await finish.promise } })
  const old = f.agent.prompt('old', 5000)
  await entered.promise
  let acknowledged = false
  const stopping = f.agent.abort().then(() => { acknowledged = true })
  await tick()
  f.sessions[0].emit({ type: 'text_delta', delta: 'late output' })
  f.sessions[0].emit({ type: 'tool_start', toolName: 'write' })
  const replacement = await f.agent.prompt('replacement', 5000)
  const observed = { acknowledged, replacement: replacement.ok, sessions: f.sessions.length, events: f.events.length, streams: f.streams.length, activity: f.activity.length }
  finish.resolve()
  const [reply] = await Promise.all([old, stopping])
  assert.deepEqual(observed, { acknowledged: false, replacement: false, sessions: 1, events: 0, streams: 0, activity: 0 })
  assert.equal(reply.ok, false)
  assert.equal(reply.text, '')
  assert.match(reply.error, /cancelled/i)
  assert.equal(f.events.length, 0)
  assert.equal((await f.agent.prompt('fresh', 5000)).ok, true)
})

test('Stop during startup waits beyond 500ms and aborts the created session without a model call', async t => {
  const entered = deferred(), creation = deferred(), cleaned = deferred()
  t.after(() => { creation.resolve(); cleaned.resolve() })
  const f = fixture(() => assert.fail('cancelled startup must not prompt'), {
    beforeCreate: async () => { entered.resolve(); await creation.promise },
    abort: async () => cleaned.promise
  })
  const prompt = f.agent.prompt('old', 5000)
  await entered.promise
  let acknowledged = false
  const stopping = f.agent.abort().then(() => { acknowledged = true })
  await delay(550)
  const early = acknowledged
  assert.equal((await f.agent.prompt('replacement')).ok, false)
  creation.resolve()
  await tick()
  const beforeCleanup = acknowledged
  cleaned.resolve()
  const [reply] = await Promise.all([prompt, stopping])
  assert.equal(early, false)
  assert.equal(beforeCleanup, false)
  assert.equal(reply.ok, false)
  assert.equal(f.sessions[0].calls.length, 0)
  assert.equal(f.sessions[0].aborted, 1)
})

test('Stop joins concurrent requests and native cleanup beyond 1500ms even after the model finishes', async t => {
  const entered = deferred(), finish = deferred(), cleaned = deferred()
  t.after(() => { finish.resolve(); cleaned.resolve() })
  const f = fixture(async () => { entered.resolve(); await finish.promise }, { abort: async () => cleaned.promise })
  const prompt = f.agent.prompt('old', 5000)
  await entered.promise
  let receipts = 0
  const stops = [f.agent.abort(), f.agent.abort()].map(stop => stop.then(() => { receipts++ }))
  finish.resolve()
  await prompt
  await delay(1550)
  const beforeCleanup = receipts
  const replacement = await f.agent.prompt('replacement')
  cleaned.resolve()
  await Promise.all(stops)
  assert.equal(beforeCleanup, 0)
  assert.equal(replacement.ok, false)
  assert.equal(receipts, 2)
  assert.equal(f.sessions[0].aborted, 1)
  await f.agent.abort()
  assert.equal(f.sessions[0].aborted, 1)
})

test('Stop cleanup failure still drains the raw model before rejecting and never accepts an overlapping prompt', async t => {
  const entered = deferred(), finish = deferred()
  t.after(() => finish.resolve())
  const failure = new Error('native abort failed')
  const f = fixture(async () => { entered.resolve(); await finish.promise }, { abort: async () => { throw failure } })
  const prompt = f.agent.prompt('old', 5000)
  await entered.promise
  let settled = false
  const stopping = f.agent.abort().then(() => ({ ok: true }), error => ({ error })).then(result => { settled = true; return result })
  await tick()
  const early = settled
  const replacement = await f.agent.prompt('replacement')
  finish.resolve()
  const [, result] = await Promise.all([prompt, stopping])
  assert.equal(early, false)
  assert.equal(replacement.ok, false)
  assert.equal(result.error, failure)
})

test('an accepted Stop cannot mistake the existing prompt timeout for raw model completion', async t => {
  const entered = deferred(), finish = deferred()
  t.after(() => finish.resolve())
  const f = fixture(async () => { entered.resolve(); await finish.promise })
  const prompt = f.agent.prompt('old', 20)
  await entered.promise
  let acknowledged = false
  const stopping = f.agent.abort().then(() => { acknowledged = true })
  await delay(40)
  const early = acknowledged
  const replacement = await f.agent.prompt('replacement')
  finish.resolve()
  await Promise.all([prompt, stopping])
  assert.equal(early, false)
  assert.equal(replacement.ok, false)
  assert.equal(f.sessions[0].aborted, 1)
})

test('Stop retains a timed-out native initialization until its late session cleanup completes', async t => {
  const entered = deferred(), creation = deferred(), cleaned = deferred()
  const previous = process.env.COACH_PI_SESSION_TIMEOUT_MS
  process.env.COACH_PI_SESSION_TIMEOUT_MS = '10'
  t.after(() => {
    creation.resolve(); cleaned.resolve()
    if (previous === undefined) delete process.env.COACH_PI_SESSION_TIMEOUT_MS
    else process.env.COACH_PI_SESSION_TIMEOUT_MS = previous
  })
  const f = fixture(() => assert.fail('timed-out cancelled startup cannot prompt'), {
    beforeCreate: async () => { entered.resolve(); await creation.promise }, abort: async () => cleaned.promise
  })
  const prompt = f.agent.prompt('old', 5000)
  await entered.promise
  let acknowledged = false
  const stopping = f.agent.abort().then(() => { acknowledged = true })
  await delay(30)
  const beforeCreation = acknowledged
  creation.resolve()
  await tick()
  const beforeCleanup = acknowledged
  cleaned.resolve()
  await Promise.all([prompt, stopping])
  assert.equal(beforeCreation, false)
  assert.equal(beforeCleanup, false)
  assert.equal(f.sessions[0].calls.length, 0)
  assert.equal(f.sessions[0].aborted, 1)
})

test('Stop rejects late host tools and retains already-running tool work after model completion', async t => {
  const entered = deferred(), toolFinish = deferred(), modelFinish = deferred()
  t.after(() => { toolFinish.resolve(); modelFinish.resolve() })
  let calls = 0, tool
  const f = fixture(async session => {
    tool = session.options.tools[0].execute({})
    await modelFinish.promise
  }, { tools: [{ name: 'write', description: 'fixture', params: [], execute: async () => {
    calls++; entered.resolve(); await toolFinish.promise; return 'written'
  } }] })
  const prompt = f.agent.prompt('old', 5000)
  await entered.promise
  let acknowledged = false
  const stopping = f.agent.abort().then(() => { acknowledged = true })
  await assert.rejects(f.sessions[0].options.tools[0].execute({}), /cancelled/i)
  modelFinish.resolve()
  await prompt
  await tick()
  const early = acknowledged
  const replacement = await f.agent.prompt('replacement')
  toolFinish.resolve()
  await Promise.all([tool, stopping])
  assert.equal(early, false)
  assert.equal(replacement.ok, false)
  assert.equal(calls, 1)
})

test('idle Stop leaves an initialized session usable and disposal still rejects future turns', async () => {
  const f = fixture(async session => session.emit({ type: 'text_delta', delta: 'ordinary reply' }))
  await f.agent.abort()
  await f.agent.init()
  await f.agent.abort()
  assert.equal(f.sessions[0].aborted, 0)
  assert.equal((await f.agent.prompt('normal')).text, 'ordinary reply')
  await f.agent.dispose()
  assert.equal(f.sessions[0].aborted, 1)
  assert.equal((await f.agent.prompt('after disposal')).ok, false)
})
