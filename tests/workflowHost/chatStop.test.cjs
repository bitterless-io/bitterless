const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const mainFile = 'src/main/agent/maestroAgent.service.ts'
const rendererFile = 'src/renderer/maestro/control/src/store/turn.service.ts'
function source(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
}
function member(file, name) {
  const s = source(file)
  for (const c of s.statements.filter(ts.isClassDeclaration)) {
    const m = c.members.find(m => m.name?.getText(s) === name)
    if (m) return m.getText(s)
  }
  throw Error('Missing method: ' + name)
}
function compile(code, dependencies = {}) {
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(dependencies), js)(...Object.values(dependencies))
}
function probe(file, methods, dependencies = {}) {
  return compile(`class Probe { ${methods.map(m => member(file, m)).join('\n')} }; return new Probe()`, dependencies)
}
const tick = () => new Promise(resolve => setImmediate(resolve))
function mainHarness(stop, abort = async () => {}) {
  const p = probe(mainFile, ['abortAgent', 'finishAgentTurn', 'agentTurnSnapshot'], { taskRegistry: { cancelSessionTasks() {} } })
  const turn = { sessionId: 'chat', turnId: 'turn', state: 'running', steeringInbox: { cancel() {} }, resolveRootStart() {}, resolveFinished() {} }
  const updates = []
  Object.assign(p, {
    activeAgentTurns: new Map([['chat', turn]]), agentSessionKey: id => id,
    activeTurnFor: (_s, id) => id === turn.turnId && p.activeAgentTurns.get('chat'),
    recentFinishedAgentTurns: new Map(), broadcastAgentTurn: update => updates.push(update),
    hydratedMaestroAgentSessions: new Set(), workflowHost: { stopSession: stop },
    getExistingMaestroAgent: () => ({ abort }), _state: { endBrowserTurn() {} }
  })
  return { p, turn, updates }
}

test('cleanup rejection retains active ownership, publishes failure, and permits a successful retry', async () => {
  let fail = true
  const { p, turn, updates } = mainHarness(async () => { if (fail) throw Error('worker still alive') })
  await assert.rejects(p.abortAgent({ sessionId: 'chat', turnId: 'turn' }), /worker still alive/)
  assert.equal(p.activeAgentTurns.get('chat'), turn)
  assert.equal(turn.state, 'aborting')
  assert.equal(updates.at(-1).turn.stopError, 'worker still alive')
  assert.equal(updates.some(u => u.finished), false)
  p.finishAgentTurn(turn, 'completed', { ok: true, text: 'late reply' })
  assert.equal(p.activeAgentTurns.get('chat'), turn)
  fail = false
  assert.deepEqual(await p.abortAgent({ sessionId: 'chat', turnId: 'turn' }), { ok: true })
  assert.equal(p.activeAgentTurns.size, 0)
  assert.equal(updates.at(-1).finished.reason, 'stopped')
})

test('duplicate stop joins cleanup and waits for root abort even if workflow stop rejects first', async () => {
  let calls = 0, release
  const { p, turn } = mainHarness(async () => { calls++; throw Error('cleanup failed') }, () => new Promise(r => { release = r }))
  let settled = false
  const a = assert.rejects(p.abortAgent({ sessionId: 'chat', turnId: 'turn' }), /cleanup failed/).then(() => { settled = true })
  const b = assert.rejects(p.abortAgent({ sessionId: 'chat', turnId: 'turn' }), /cleanup failed/)
  await tick()
  assert.equal(calls, 1)
  assert.equal(settled, false)
  assert.ok(turn.abortOperation)
  release()
  await Promise.all([a, b])
  assert.equal(turn.abortOperation, undefined)
  assert.deepEqual(await p.abortAgent({ sessionId: 'chat', turnId: 'old' }), { ok: true })
})

test('renderer requires positive IPC acknowledgement, retains pending turn, and allows retry after null reply', async () => {
  let release, calls = 0, stopped = 0
  const coach = { abortAgent: () => { calls++; return new Promise(r => { release = r }) } }
  const p = probe(rendererFile, ['stop', 'finishReply'], { coach, i18nHelper: { workflow: { stopError: 'Cleanup not confirmed' } } })
  const turn = { id: 'turn', aborting: false }, session = { id: 'chat', turn }
  Object.assign(p, { _state: { getSession: () => session }, forceStop: () => { stopped++; session.turn = undefined } })
  const a = p.stop('chat')
  await p.stop('chat')
  await p.finishReply(session, turn, { ok: true, text: 'late root reply' })
  assert.equal(calls, 1)
  assert.equal(session.turn, turn)
  assert.equal(stopped, 0)
  release(null)
  await a
  assert.equal(turn.stopError, 'Cleanup not confirmed')
  assert.equal(session.turn, turn)
  const retry = p.stop('chat')
  release({ ok: true })
  await retry
  assert.equal(stopped, 1)
})

test('root reply fallback leaves an aborting turn for authoritative cleanup finalization', async () => {
  const s = source(rendererFile)
  const cls = s.statements.find(n => ts.isClassDeclaration(n) && n.members.some(m => m.name?.getText(s) === 'send'))
  const send = cls.members.find(m => m.name?.getText(s) === 'send')
  const statement = send.body.statements.find(n => ts.isTryStatement(n) && n.finallyBlock && n.tryBlock.getText(s).includes('await this.finishReply('))
  assert.ok(statement)
  const turn = { id: 'turn', aborting: true }, session = { turn }
  const run = compile(`return async function() { ${statement.getText(s)} }`, { turn, session, reply: { ok: true } })
  await run.call({ finishReply: async () => {} })
  assert.equal(session.turn, turn)
})

test('failed runtime shutdown preserves SQLite and proxy for retry', async () => {
  let fail = true, sqliteDestroyed = 0, proxyReleased = 0
  const p = probe('src/main/xpc/maestroWindow.handler.ts', ['destroyMaestroRuntime'], {
    maestroWindowHelper: { shutdown: async () => { if (fail) throw Error('cleanup failed') } },
    maestroSqliteWindowHelper: { destroy: () => { sqliteDestroyed++ } }
  })
  p.releaseProxy = () => { proxyReleased++ }
  await assert.rejects(p.destroyMaestroRuntime(), /cleanup failed/)
  assert.equal(sqliteDestroyed, 0)
  assert.equal(proxyReleased, 0)
  assert.equal(p.cleanupPromise, null)
  fail = false
  await p.destroyMaestroRuntime()
  assert.equal(sqliteDestroyed, 1)
  assert.equal(proxyReleased, 1)
})

test('failed workflow shutdown reopens the runtime gate instead of leaving a half-closed chat', async () => {
  const p = probe(mainFile, ['shutdown'])
  p.activeAgentTurns = new Map()
  p.shutdownWorkflows = async () => { throw Error('cleanup failed') }
  await assert.rejects(p.shutdown(), /cleanup failed/)
  assert.equal(p.shuttingDown, false)
})

function declaration(file, name) {
  const s = source(file)
  for (const st of s.statements.filter(ts.isVariableStatement)) {
    const d = st.declarationList.declarations.find(d => d.name.getText(s) === name)
    if (d) return `const ${d.getText(s)};`
  }
  throw Error('Missing declaration: ' + name)
}

test('normal quit and update install are both blocked by failed cleanup, then retry succeeds', async () => {
  for (const update of [false, true]) {
    let fail = true, quit = 0, installed = 0, reported = 0
    const updateService = { isUpdating: update, installAfterCleanup: () => { installed++ } }
    const h = compile(`let isQuitting=false,hasShownQuitDialog=true; ${declaration('src/main/app.main.ts', 'quitAfterCleanup')} return { run: quitAfterCleanup, quitting:()=>isQuitting };`, {
      cleanupResources: async () => { if (fail) throw Error('cleanup failed') }, updateService,
      app: { quit: () => { quit++ } }, console: { error() {} },
      dialogHelper: { showQuitCleanupFailedDialog: async () => { reported++ } }
    })
    await h.run()
    assert.equal(quit + installed, 0)
    assert.equal(h.quitting(), false)
    assert.equal(reported, 1)
    fail = false
    updateService.isUpdating = update
    await h.run()
    assert.equal(quit, update ? 0 : 1)
    assert.equal(installed, update ? 1 : 0)
  }
})

test('critical workflow cleanup runs before other resources and resets its failed promise', async () => {
  let calls = 0
  const h = compile(`let cleanupPromise=null,isShutdownStarted=false; ${declaration('src/main/app.main.ts', 'cleanupResources')} return { run:cleanupResources, pending:()=>cleanupPromise, closing:()=>isShutdownStarted };`, {
    console: { log() {} }, maestroWindowHandler: { destroyForHostQuit: async () => { calls++; throw Error('worker alive') } },
    snipingSessionService: { clearCurrent() { assert.fail('destroyed before cleanup confirmed') } }
  })
  await assert.rejects(h.run(), /worker alive/)
  assert.equal(h.pending(), null)
  assert.equal(h.closing(), false)
  await assert.rejects(h.run(), /worker alive/)
  assert.equal(calls, 2)
})
