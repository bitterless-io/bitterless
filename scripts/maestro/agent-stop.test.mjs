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
const contextFile = resolve(import.meta.dirname, '../../src/main/maestro/agent/runtime/agentExecutionContext.ts')
const contextSource = ts.transpileModule(readFileSync(contextFile, 'utf8'), {
  fileName: contextFile,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const contextModule = { exports: {} }
vm.runInThisContext(`(function(exports,require,module){${contextSource}\n})`, { filename: contextFile })(contextModule.exports, require, contextModule)
const { runAgentTurn, observeAgentTool } = contextModule.exports
const deferred = () => {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
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
  await tick()
  await delay(1550)
  const beforeCleanup = receipts
  const replacement = await f.agent.prompt('replacement')
  cleaned.resolve()
  await Promise.all([prompt, ...stops])
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
  await tick()
  const early = acknowledged
  const replacement = await f.agent.prompt('replacement')
  toolFinish.resolve()
  await Promise.all([prompt, tool, stopping])
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

test('native abort success still acknowledges Stop when the raw fetch rejects with AbortError', async t => {
  const entered = deferred(), finish = deferred()
  t.after(() => finish.resolve())
  const f = fixture(async () => { entered.resolve(); await finish.promise }, {
    abort: async () => { finish.reject(new DOMException('This operation was aborted', 'AbortError')) }
  })
  const prompt = f.agent.prompt('old', 5000)
  await entered.promise
  const result = await f.agent.abort().then(() => ({ ok: true }), error => ({ error }))
  assert.equal((await prompt).ok, false)
  assert.deepEqual(result, { ok: true })
  assert.equal(f.sessions[0].aborted, 1)
})

test('failed native cleanup retains its session and blocks replacement until a real retry succeeds', async t => {
  const entered = deferred(), finish = deferred(), cleaned = deferred()
  t.after(() => { finish.resolve(); cleaned.resolve() })
  const failure = new Error('native cleanup failed')
  const f = fixture(async () => { entered.resolve(); await finish.promise }, {
    abort: async session => { if (session.aborted === 1) throw failure; await cleaned.promise }
  })
  const prompt = f.agent.prompt('old', 5000)
  await entered.promise
  const first = f.agent.abort().then(() => undefined, error => error)
  finish.resolve()
  await prompt
  assert.equal(await first, failure)
  const afterFailure = await f.agent.prompt('replacement')
  let acknowledged = false
  const retry = f.agent.abort().then(() => { acknowledged = true })
  await tick()
  const observed = { accepted: afterFailure.ok, acknowledged, abortCalls: f.sessions[0].aborted }
  cleaned.resolve()
  await retry
  assert.deepEqual(observed, { accepted: false, acknowledged: false, abortCalls: 2 })
  assert.equal((await f.agent.prompt('fresh')).ok, true)
})

test('Stop retry retains the actual failed reset session while a fresh managed turn drains', async t => {
  const entered = deferred(), finish = deferred(), cleanup = deferred()
  t.after(() => { finish.resolve(); cleanup.resolve() })
  const failure = new Error('prior session cleanup failed')
  const f = fixture(async () => { entered.resolve(); await finish.promise }, {
    abort: async session => {
      if (session === f.sessions[0] && session.aborted === 1) { await cleanup.promise; throw failure }
      if (session !== f.sessions[0]) finish.resolve()
    }
  })
  await f.agent.init()
  const prompt = f.agent.prompt('new', 5000, { freshSession: true })
  await entered.promise
  const stopping = f.agent.abort().then(() => undefined, error => error)
  cleanup.resolve()
  assert.equal(await stopping, failure)
  await prompt
  await f.agent.abort()
  assert.equal(f.sessions[0].aborted, 2, 'retry must reach the failed old session, not the already-cleaned new one')
  assert.equal(f.sessions[1].aborted, 1)
})

test('the shared GUI and ACP owner remains reserved until native Stop cleanup finishes', async t => {
  const entered = deferred(), finish = deferred(), cleaned = deferred()
  t.after(() => { finish.resolve(); cleaned.resolve() })
  const f = fixture(async () => { entered.resolve(); await finish.promise }, { abort: async () => cleaned.promise })
  const original = runAgentTurn(() => f.agent.prompt('old', 5000))
  await entered.promise
  const stopping = f.agent.abort()
  finish.resolve()
  await tick()
  const competing = await runAgentTurn(async () => 'external replacement').then(value => ({ value }), error => ({ error }))
  cleaned.resolve()
  await Promise.all([original, stopping])
  assert.match(competing.error?.message || '', /busy/i)
  assert.equal(await runAgentTurn(async () => 'fresh external turn'), 'fresh external turn')
})

test('Stop accepted while a host tool outlives the model still reserves the shared owner through native cleanup', async t => {
  const entered = deferred(), toolFinish = deferred(), modelFinish = deferred(), cleaned = deferred()
  t.after(() => { toolFinish.resolve(); modelFinish.resolve(); cleaned.resolve() })
  let tool
  const f = fixture(async session => {
    tool = session.options.tools[0].execute({})
    await modelFinish.promise
  }, {
    abort: async () => cleaned.promise,
    tools: [{ name: 'write', description: 'fixture', params: [], execute: () => observeAgentTool('write', {
      input: {}, execute: async () => { entered.resolve(); await toolFinish.promise; return 'written' }
    }) }]
  })
  const original = runAgentTurn(() => f.agent.prompt('old', 5000))
  await entered.promise
  modelFinish.resolve()
  await tick()
  const stopping = f.agent.abort()
  toolFinish.resolve()
  await tick()
  const competing = await runAgentTurn(async () => 'external replacement').then(value => ({ value }), error => ({ error }))
  cleaned.resolve()
  const [reply] = await Promise.all([original, stopping, tool])
  assert.match(competing.error?.message || '', /busy/i)
  assert.equal(reply.ok, false)
})
