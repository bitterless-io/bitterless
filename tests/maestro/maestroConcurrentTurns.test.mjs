import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const read = path => readFileSync(resolve(root, path), 'utf8');
const compile = text => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText;
const load = (path, stubs = {}) => {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compile(read(path)))(
    name => Object.hasOwn(stubs, name) ? stubs[name] : require(name), module, module.exports
  );
  return module.exports;
};
const context = load('src/main/agent/runtime/agentSessionContext.ts');
const taskApi = load('src/shared/maestro/task.api.ts');
const source = read('src/main/agent/maestroAgent.service.ts');
const ast = ts.createSourceFile('maestroAgent.service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const agentClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'MaestroAgentService');
const members = new Set([
  'activeAgentTurns', 'agentTurnGeneration', 'agentTurnContext', 'agentTurnRevision', 'recentFinishedAgentTurns',
  'lastAgentRunFallback', 'lastAgentRun', 'lastAgentArtifactsFallback', 'lastAgentArtifacts',
  'tabsOpenedThisTurnFallback', 'tabsOpenedThisTurn', 'hydratedMaestroAgentSessions',
  'claimAgentTurn', 'getActiveAgentTurn', 'ackAgentTurnFinished', 'hasActiveAgentTurn', 'agentTurnSnapshot',
  'activeTurnFor', 'broadcastAgentTurn', 'finishAgentTurn', 'agentTurnKey', 'pruneFinishedAgentTurns',
  'abortAgent', 'agentSessionKey', 'agentTurnIdentity', 'broadcastActiveAgentActivity', 'broadcastModelRetry',
  'routeAgentMessage', 'sendAgentMessage', 'recordAgentArtifact',
  'shutdown', 'assertAgentRuntimeActive', 'shuttingDown', 'maestroAgents', 'delegateAgents', 'attachedPaths', 'pi', 'piDelegate', 'piGen'
]);
const classSource = `class Harness { ${agentClass.members.filter(node => members.has(node.name?.getText(ast))).map(node => node.getText(ast)).join('\n')} } exports.Harness = Harness;`;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const makeHarness = (t, reservationMs = 60_000) => {
  const events = [], cancelled = [], activity = [];
  const dependencies = {
    AsyncLocalStorage, ...context,
    AGENT_TURN_RESERVATION_TIMEOUT_MS: reservationMs,
    MAX_CONCURRENT_AGENT_TURNS: Number(source.match(/const MAX_CONCURRENT_AGENT_TURNS = (\d+)/)[1]),
    FINISHED_AGENT_TURN_TTL_MS: 60_000, MAX_RECENT_FINISHED_AGENT_TURNS: 20,
    AGENT_TURN_CHANNEL: 'turn', MODEL_RETRY_CHANNEL: 'retry',
    xpcMain: { broadcast: (channel, payload) => events.push({ channel, payload }) },
    broadcastCodexDebug: () => undefined,
    broadcastAgentActivity: (...args) => activity.push(args),
    describeAgentPromptError: (_provider, _model, error) => error,
    taskRegistry: { cancelSessionTasks: params => cancelled.push(params) }
  };
  const exports = {};
  new Function('exports', ...Object.keys(dependencies), compile(classSource))(exports, ...Object.values(dependencies));
  const agent = new exports.Harness();
  const ended = [], begun = [];
  Object.assign(agent, {
    _state: {
      activeTabId: 'page-a', beginBrowserTurn: (...args) => begun.push(args), endBrowserTurn: id => ended.push(id),
      ensurePersistedCaptureRecordsLoaded: async () => undefined, syncWorkspaceFromContext: () => undefined
    },
    offloadLongPasteIfNeeded: text => text, recordUserChainMessage: () => undefined,
    loadHostToolPolicies: async () => undefined,
    buildAgentMediaInput: async () => ({ note: '' }),
    getMaestroAgent: id => ({ id }), getExistingMaestroAgent: () => undefined
  });
  t.after(() => { for (const turn of agent.activeAgentTurns.values()) clearTimeout(turn.reservationTimer); });
  const claim = (sessionId, turnId = `${sessionId}-1`) => agent.claimAgentTurn({ sessionId, turnId, rootText: `request ${sessionId}`, startedAt: 1 });
  return { agent, claim, events, cancelled, activity, ended, begun };
};

test('main admits four chat roots, preserves same-chat identity, and releases only the finished slot', t => {
  const { agent, claim, ended } = makeHarness(t);
  for (const id of ['A', 'B', 'C', 'D']) assert.equal(claim(id).ok, true);
  assert.equal(claim('E').reason, 'busy-elsewhere');
  assert.equal(claim('A').ok, true, 'idempotent retries do not consume another slot');
  assert.equal(claim('A', 'A-2').reason, 'busy-here');
  const recovered = agent.getActiveAgentTurn();
  assert.deepEqual(recovered.turns.map(turn => turn.sessionId), ['A', 'B', 'C', 'D']);
  assert.equal(recovered.turn.sessionId, 'A');
  const old = agent.activeAgentTurns.get('A');
  agent.finishAgentTurn(old, 'completed', { ok: true, text: 'A result' });
  assert.deepEqual(ended, ['A']);
  assert.equal(claim('E').ok, true);
  agent.finishAgentTurn(old, 'stopped');
  assert.deepEqual(agent.getActiveAgentTurn().turns.map(turn => turn.sessionId), ['B', 'C', 'D', 'E']);
  assert.equal(agent.getActiveAgentTurn().finished.length, 1);
  agent.ackAgentTurnFinished({ sessionId: 'A', turnId: 'A-1' });
  assert.equal(agent.getActiveAgentTurn().finished.length, 0);
});

test('reservation expiry is per chat and cannot expire a newer generation', async t => {
  const { agent, claim } = makeHarness(t, 15);
  claim('A'); claim('B');
  const b = agent.activeAgentTurns.get('B');
  b.rootStarted = true; b.state = 'running';
  await new Promise(done => setTimeout(done, 35));
  assert.deepEqual(agent.getActiveAgentTurn().turns.map(turn => turn.sessionId), ['B']);
  assert.equal(agent.getActiveAgentTurn().finished[0].reason, 'reservation-expired');
  assert.equal(claim('A', 'A-2').ok, true);
  assert.equal(agent.activeAgentTurns.get('A').generation > b.generation, true);
});

test('shutdown drains every active chat and rejects new claims while aborting', async t => {
  const { agent, claim } = makeHarness(t);
  claim('A'); claim('B');
  const drain = deferred(), aborted = [];
  for (const id of ['A', 'B']) agent.maestroAgents.set(id, { abort: async () => { aborted.push(id); await drain.promise; } });
  const stopping = agent.shutdown();
  assert.deepEqual(agent.getActiveAgentTurn().turns.map(turn => turn.state), ['aborting', 'aborting']);
  assert.throws(() => claim('C'), /shutting down/);
  assert.deepEqual(aborted, ['A', 'B']);
  drain.resolve(); await stopping;
  assert.deepEqual(agent.getActiveAgentTurn().turns, []);
  assert.equal(agent.getActiveAgentTurn().finished.length, 2);
});

test('root and steering identify their own chat while another root remains running', async t => {
  const { agent, claim } = makeHarness(t);
  const releases = { A: deferred(), B: deferred() }, starts = { A: deferred(), B: deferred() };
  const seen = [];
  agent.handleAgentTurn = async (message, runtime, _context, options) => {
    seen.push([runtime.id, message, options.steeringOnly, context.currentChatSessionId()]);
    if (options.steeringOnly) return { ok: true, text: '', mergedIntoTurn: true };
    starts[runtime.id].resolve();
    await releases[runtime.id].promise;
    return { ok: true, text: `answer ${runtime.id}` };
  };
  claim('A'); claim('B');
  const request = (id, intent, message) => ({ sessionId: id, turnId: `${id}-1`, intent, message });
  const a = agent.sendAgentMessage(request('A', 'root', 'root A'));
  const b = agent.sendAgentMessage(request('B', 'root', 'root B'));
  await Promise.all([starts.A.promise, starts.B.promise]);
  assert.equal((await agent.sendAgentMessage(request('A', 'root', 'duplicate'))).error, 'duplicate-root-turn');
  assert.equal((await agent.sendAgentMessage(request('B', 'steer', 'addition B'))).mergedIntoTurn, true);
  assert.equal((await agent.sendAgentMessage({ ...request('A', 'steer', 'wrong'), turnId: 'old' })).error, 'turn-not-active');
  assert.deepEqual(seen, [['A', 'root A', false, 'A'], ['B', 'root B', false, 'B'], ['B', 'addition B', true, 'B']]);
  releases.A.resolve(); await a;
  assert.deepEqual(agent.getActiveAgentTurn().turns.map(turn => turn.sessionId), ['B']);
  releases.B.resolve(); await b;
  assert.equal(agent.hasActiveAgentTurn(), false);
});

test('aborting A settles only A and stale stop or callbacks cannot affect its new turn or B', async t => {
  const { agent, claim, cancelled, activity, events } = makeHarness(t);
  claim('A'); claim('B');
  const old = agent.activeAgentTurns.get('A'), b = agent.activeAgentTurns.get('B');
  old.state = b.state = 'running';
  const drain = deferred();
  agent.getExistingMaestroAgent = id => ({ abort: async () => { assert.equal(id, 'A'); await drain.promise; } });
  const stopping = agent.abortAgent({ sessionId: 'A', turnId: 'A-1' });
  assert.equal(old.state, 'aborting');
  assert.equal(b.state, 'running');
  assert.deepEqual(cancelled, [{ sessionId: 'A', reason: 'active turn stopped' }]);
  drain.resolve(); await stopping;
  claim('A', 'A-2'); agent.activeAgentTurns.get('A').state = 'running';
  await agent.abortAgent({ sessionId: 'A', turnId: 'A-1' });
  assert.equal(cancelled.length, 1);
  const identity = turn => ({ sessionId: turn.sessionId, turnId: turn.turnId, generation: turn.generation });
  agent.agentTurnContext.run(identity(old), () => {
    assert.equal(agent.agentTurnIdentity('A'), null);
    agent.broadcastActiveAgentActivity('tool', 'stale');
    agent.broadcastModelRetry({ attempt: 2, max: 5 });
  });
  agent.agentTurnContext.run(identity(b), () => {
    agent.broadcastActiveAgentActivity('tool', 'B alive');
    agent.broadcastModelRetry({ attempt: 2, max: 5 });
  });
  assert.equal(activity.length, 1);
  assert.equal(activity[0][3].sessionId, 'B');
  assert.deepEqual(events.filter(event => event.channel === 'retry').map(event => event.payload.sessionId), ['B']);
  agent.finishAgentTurn(old, 'completed');
  assert.equal(agent.activeAgentTurns.get('A').turnId, 'A-2');
});

test('actual route keeps files, skill results, opened tabs and task attribution in each async chat', async t => {
  const { agent, claim } = makeHarness(t);
  const releases = { A: deferred(), B: deferred() }, starts = { A: deferred(), B: deferred() };
  agent.handleAgentTurn = async (_message, runtime) => {
    const id = runtime.id;
    agent.lastAgentRun = { replay: { owner: id } };
    agent.recordAgentArtifact({ path: `/fixture/${id}`, name: id, action: 'created' });
    agent.tabsOpenedThisTurn.push({ id: `tab-${id}` });
    starts[id].resolve();
    await releases[id].promise;
    assert.equal(context.currentChatSessionId(), id);
    return { ok: true, replay: agent.lastAgentRun.replay, files: [...agent.lastAgentArtifacts], tabs: [...agent.tabsOpenedThisTurn] };
  };
  claim('A'); claim('B');
  const a = agent.routeAgentMessage('A', 'A', undefined, agent.activeAgentTurns.get('A'));
  const b = agent.routeAgentMessage('B', 'B', undefined, agent.activeAgentTurns.get('B'));
  await Promise.all([starts.A.promise, starts.B.promise]);
  releases.B.resolve(); const rb = await b;
  releases.A.resolve(); const ra = await a;
  for (const [id, reply] of [['A', ra], ['B', rb]]) {
    assert.deepEqual(reply.replay, { owner: id });
    assert.deepEqual(reply.files.map(file => file.path), [`/fixture/${id}`]);
    assert.deepEqual(reply.tabs.map(tab => tab.id), [`tab-${id}`]);
  }
  assert.equal(context.currentChatSessionId(), undefined);
  assert.deepEqual(agent.lastAgentArtifacts, []);
});

test('task cancellation denies only the stopped chat approval and leaves another chat actionable', async () => {
  const { taskRegistry } = load('src/main/maestro/tasks/taskRegistry.service.ts', {
    'electron-xpc/main': { xpcMain: { broadcast: () => undefined } },
    '@main/agent/runtime/agentSessionContext': context,
    '@maestro-shared/task.api': taskApi
  });
  const a = context.runInAgentSession('A', () => taskRegistry.askOperator({ title: 'A approval', timeoutMs: 60_000 }));
  const b = context.runInAgentSession('B', () => taskRegistry.askOperator({ title: 'B approval', timeoutMs: 60_000 }));
  assert.equal(taskRegistry.cancelSessionTasks({ sessionId: 'A' }), 1);
  assert.equal(await a, false);
  const bTask = [...taskRegistry.tasks.values()].find(task => task.sessionId === 'B');
  assert.equal(bTask.state.status, 'running');
  assert.ok(bTask.state.pendingConfirm);
  taskRegistry.resolveConfirm({ taskId: bTask.id, confirmId: bTask.state.pendingConfirm.id, confirm: true });
  assert.equal(await b, true);
});

test('an unrelated chat cannot enter the drill continuation', async () => {
  const drillSource = read('src/main/maestro/sitemap/drillTools.host.ts');
  const drillAst = ts.createSourceFile('drill.ts', drillSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const drillClass = drillAst.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'DrillToolsHost');
  const method = drillClass.members.find(node => node.name?.getText(drillAst) === 'continueAfterTurn');
  const exports = {};
  new Function('exports', compile(`class Harness { ${method.getText(drillAst)} } exports.Harness = Harness;`))(exports);
  const fixture = new exports.Harness();
  fixture.run = { ownerSessionId: 'A' };
  fixture.drillHost = new Proxy({}, { get() { throw new Error('B must not enter A drill'); } });
  const reply = { ok: true, text: 'B complete' };
  assert.equal(await fixture.continueAfterTurn({ sessionId: 'B', message: 'ordinary chat' }, reply), reply);
});

test('controller stops a drill only for the exact active turn, before runtime cancellation', async () => {
  const controllerSource = read('src/main/maestro/windows/main/maestroWindow.controller.ts');
  const controllerAst = ts.createSourceFile('controller.ts', controllerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const controllerClass = controllerAst.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(controllerAst) === 'abortAgent'));
  const method = controllerClass.members.find(node => node.name?.getText(controllerAst) === 'abortAgent');
  const exports = {};
  new Function('exports', compile(`class Harness { ${method.getText(controllerAst)} } exports.Harness = Harness;`))(exports);
  const fixture = new exports.Harness(), calls = [];
  fixture.agentService = {
    getActiveAgentTurn: () => ({ turns: [{ sessionId: 'A', turnId: 'A-2' }, { sessionId: 'B', turnId: 'B-1' }] }),
    abortAgent: async params => calls.push(['abort', params.turnId])
  };
  fixture.drillTrio = { run: { ownerSessionId: 'A', stopByOperator: id => calls.push(['drill', id]) } };
  await fixture.abortAgent({ sessionId: 'A', turnId: 'A-1' });
  assert.deepEqual(calls, [['abort', 'A-1']]);
  calls.length = 0;
  await fixture.abortAgent({ sessionId: 'B', turnId: 'B-1' });
  assert.deepEqual(calls, [['abort', 'B-1']]);
  calls.length = 0;
  await fixture.abortAgent({ sessionId: 'A', turnId: 'A-2' });
  assert.deepEqual(calls, [['drill', 'A'], ['abort', 'A-2']]);
});

test('drill recording stays exclusive while other chats may use ordinary browser tools', async () => {
  const controllerSource = read('src/main/maestro/windows/main/maestroWindow.controller.ts');
  const ast = ts.createSourceFile('controller.ts', controllerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let toolMapper;
  const visit = node => {
    if (ts.isArrowFunction(node) && node.parameters[0]?.name.getText(ast) === 'tool' && node.getText(ast).includes('const scoped =')) toolMapper = node;
    node.forEachChild(visit);
  };
  visit(ast);
  assert.ok(toolMapper, 'load the actual browser tool scoping callback');
  const calls = [];
  const fixture = {
    drillTrio: { run: { isDrilling: true, ownerSessionId: 'A' } },
    withAgentBrowserTarget: async (_session, id, work) => work(id || 'own-tab')
  };
  const forSession = sessionId => {
    const exports = {};
    new Function('exports', 'sessionKey', compile(`exports.scopeTool = ${toolMapper.getText(ast)};`)).call(fixture, exports, sessionId);
    return name => exports.scopeTool({ name, description: name, params: [], execute: async () => { calls.push([sessionId, name]); return 'done'; } });
  };
  const a = forSession('A'), b = forSession('B');
  for (const name of ['start_recording', 'stop_recording', 'ingest_recording']) {
    assert.match(await b(name).execute({}), /another chat owns the active drill recording/);
    assert.equal(await a(name).execute({}), 'done');
  }
  assert.equal(await b('page_snapshot').execute({}), 'done');
  assert.deepEqual(calls, [['A', 'start_recording'], ['A', 'stop_recording'], ['A', 'ingest_recording'], ['B', 'page_snapshot']]);
});
