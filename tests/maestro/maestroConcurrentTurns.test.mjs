import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
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
const { TurnSteeringInbox } = load('src/main/agent/steering/turnSteeringInbox.ts');
const taskApi = load('src/shared/maestro/task.api.ts');
const source = read('src/main/agent/maestroAgent.service.ts');
const ast = ts.createSourceFile('maestroAgent.service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const agentClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'MaestroAgentService');
const members = new Set([
  'manualCompactions', 'manualCompactionCancels', 'activeAgentTurns', 'agentTurnGeneration', 'agentTurnContext', 'agentTurnRevision', 'recentFinishedAgentTurns',
  'lastAgentRunFallback', 'lastAgentRun', 'lastAgentArtifactsFallback', 'lastAgentArtifacts',
  'tabsOpenedThisTurnFallback', 'tabsOpenedThisTurn', 'hydratedMaestroAgentSessions',
  'claimAgentTurn', 'getActiveAgentTurn', 'ackAgentTurnFinished', 'hasActiveAgentTurn', 'agentTurnSnapshot',
  'activeTurnFor', 'broadcastAgentTurn', 'finishAgentTurn', 'agentTurnKey', 'pruneFinishedAgentTurns',
  'abortAgent', 'agentSessionKey', 'agentTurnIdentity', 'broadcastActiveAgentActivity', 'broadcastModelRetry',
  'routeAgentMessage', 'sendAgentMessage', 'recordAgentArtifact', 'buildMessagePrompt',
  'shutdown', 'shutdownWorkflows', 'assertAgentRuntimeActive', 'shuttingDown', 'maestroAgents', 'delegateAgents', 'attachedPaths', 'pi', 'piDelegate', 'piGen'
]);
const classSource = `class Harness { ${agentClass.members.filter(node => members.has(node.name?.getText(ast))).map(node => node.getText(ast)).join('\n')} } exports.Harness = Harness;`;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const makeHarness = (t, reservationMs = 60_000) => {
  const events = [], cancelled = [], activity = [];
  const dependencies = {
    AsyncLocalStorage, ...context, TurnSteeringInbox, applicationAuth: { assertReady() {} },
    buildAgentTurnPrompt: params => JSON.stringify(params), localNow: () => 'fixture-time-at-receipt',
    chainFilePath: (_directory, id) => `/fixture/chains/${id}.jsonl`, maestroUserChainDir: () => '/fixture/chains',
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
      describeWindowTabs: () => ({ activeTab: null, openTabs: [] }),
      existingSkillRegistry: () => ({ listSkillsForDomain: url => url ? [{ id: `${new URL(url).hostname}-skill` }] : [] }),
      ensurePersistedCaptureRecordsLoaded: async () => undefined, syncWorkspaceFromContext: () => undefined, projectRootForSession: () => undefined
    },
    offloadLongPasteIfNeeded: text => text, recordUserChainMessage: () => undefined,
    agentSkillBriefs: (_message, recordings) => recordings,
    loadHostToolPolicies: async () => undefined,
    buildAgentMediaInput: async () => ({ note: '' }),
    getMaestroAgent: id => ({ id, setProjectRoot: async () => undefined, hasConversation: async () => false }), getExistingMaestroAgent: () => undefined
  });
  t.after(() => { for (const turn of agent.activeAgentTurns.values()) clearTimeout(turn.reservationTimer); });
  const claim = (sessionId, turnId = `${sessionId}-1`) => agent.claimAgentTurn({ sessionId, turnId, rootText: `request ${sessionId}`, startedAt: 1 });
  return { agent, claim, events, cancelled, activity, ended, begun };
};
const captureSteering = turn => {
  const queued = [];
  turn.steeringInbox.start({
    enqueueSteering: async message => { queued.push(message); },
    takePendingSteering: () => []
  });
  return queued;
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
  await setImmediate();
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
    starts[runtime.id].resolve();
    await releases[runtime.id].promise;
    return { ok: true, text: `answer ${runtime.id}` };
  };
  claim('A'); claim('B');
  const request = (id, intent, message) => ({ sessionId: id, turnId: `${id}-1`, messageId: `${id}-${intent}`, intent, message });
  const a = agent.sendAgentMessage(request('A', 'root', 'root A'));
  const b = agent.sendAgentMessage(request('B', 'root', 'root B'));
  await Promise.all([starts.A.promise, starts.B.promise]);
  assert.equal((await agent.sendAgentMessage(request('A', 'root', 'duplicate'))).error, 'duplicate-root-turn');
  const turnB = agent.activeAgentTurns.get('B'), queued = captureSteering(turnB);
  const steering = agent.sendAgentMessage(request('B', 'steering', 'addition B'));
  await setImmediate();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].messageId, 'B-steering');
  assert.equal(JSON.parse(queued[0].text).message, 'addition B');
  turnB.steeringInbox.consume(queued[0].messageId);
  assert.equal((await steering).mergedIntoTurn, true);
  assert.equal((await agent.sendAgentMessage({ ...request('A', 'steering', 'wrong'), turnId: 'old' })).error, 'turn-not-active');
  assert.deepEqual(seen, [['A', 'root A', false, 'A'], ['B', 'root B', false, 'B']], 'steering never enters the ordinary route');
  releases.A.resolve(); await a;
  assert.deepEqual(agent.getActiveAgentTurn().turns.map(turn => turn.sessionId), ['B']);
  releases.B.resolve(); await b;
  assert.equal(agent.hasActiveAgentTurn(), false);
});

test('ordinary messages and steering keep their receipt-time foreground across initialization waits', async t => {
  const { agent, claim } = makeHarness(t);
  const ready = deferred(), rootRelease = deferred(), started = deferred();
  const snapshotA = { tab_id: 'visible-a', kind: 'web', title: 'Alias A', url: 'https://a.example/' };
  const snapshotB = { tab_id: 'visible-b', kind: 'miniapp', title: 'Trench', miniapp: 'trench' };
  let foreground = snapshotA;
  const seen = [], chain = [];
  agent._state.describeWindowTabs = () => ({ activeTab: foreground && { ...foreground }, openTabs: foreground ? [{ ...foreground }] : [] });
  agent._state.ensurePersistedCaptureRecordsLoaded = () => ready.promise;
  agent.recordUserChainMessage = (_message, _id, _context, snapshot) => chain.push(snapshot);
  agent.handleAgentTurn = async (_message, _runtime, _context, options) => {
    seen.push(options.windowTabs);
    if (options.sessionKey === 'A') { started.resolve(); await rootRelease.promise; }
    return { ok: true };
  };
  claim('A'); claim('B');
  let sequence = 0;
  const request = (sessionId, intent) => ({ sessionId, turnId: `${sessionId}-1`, messageId: `message-${++sequence}`, message: 'inspect', intent });
  const a = agent.sendAgentMessage(request('A', 'root'));
  const b = agent.sendAgentMessage(request('B', 'root'));
  foreground = snapshotB;
  ready.resolve(); await started.promise; await b;
  assert.deepEqual(seen, [{ activeTab: snapshotA, openTabs: [snapshotA] }, { activeTab: snapshotA, openTabs: [snapshotA] }], 'both chats describe the same actual window');
  agent.buildAgentMediaInput = () => assert.fail('Steering must not enter asynchronous media/root preparation');
  const turnA = agent.activeAgentTurns.get('A'), queued = captureSteering(turnA);
  const steer = agent.sendAgentMessage(request('A', 'steering'));
  foreground = null;
  await setImmediate();
  const captured = JSON.parse(queued[0].text);
  assert.deepEqual(captured.activeTab, snapshotB);
  assert.deepEqual(captured.openTabs, [snapshotB]);
  turnA.steeringInbox.consume(queued[0].messageId);
  assert.equal((await steer).mergedIntoTurn, true);
  const emptySteer = agent.sendAgentMessage(request('A', 'steering'));
  await setImmediate();
  assert.equal(JSON.parse(queued[1].text).activeTab, null, 'an empty window must not reuse an earlier snapshot');
  assert.deepEqual(JSON.parse(queued[1].text).openTabs, []);
  turnA.steeringInbox.consume(queued[1].messageId);
  await emptySteer;
  assert.equal(seen.length, 2, 'both additions bypass the root handler');
  assert.deepEqual(chain, [snapshotA, snapshotA, snapshotB, null]);
  rootRelease.resolve(); await a;
});

test('Main accepts steering while the reserved root prepares, fixes all prompt inputs, and deduplicates its message ID', async t => {
  const { agent, claim } = makeHarness(t);
  const preparing = deferred(), started = deferred(), release = deferred();
  const page = { tab_id: 'page-at-receipt', kind: 'web', title: 'Receipt page', url: 'https://receipt.example/page' };
  let currentPage = page;
  const conversation = { workspace: { path: '/fixture/receipt-workspace' }, recentMessages: [{ role: 'human', content: 'earlier', ts: 1 }] };
  agent._state.describeWindowTabs = () => ({ activeTab: currentPage, openTabs: [currentPage] });
  agent._state.ensurePersistedCaptureRecordsLoaded = () => preparing.promise;
  let queued;
  agent.handleAgentTurn = async (_message, _runtime, _context, options) => {
    const turn = agent.activeAgentTurns.get('A');
    assert.equal(options.steeringInbox, turn.steeringInbox);
    queued = captureSteering(turn);
    started.resolve();
    await release.promise;
    return { ok: true, text: 'root completed' };
  };
  claim('A');
  const root = agent.sendAgentMessage({ sessionId: 'A', turnId: 'A-1', messageId: 'root', intent: 'root', message: 'root' });
  const request = { sessionId: 'A', turnId: 'A-1', messageId: 'addition', intent: 'steering', message: 'original addition', context: conversation };
  let settled = false;
  const steering = agent.sendAgentMessage(request).then(reply => { settled = true; return reply; });
  const duplicate = agent.sendAgentMessage({ ...request, message: 'duplicate changed body' });
  currentPage = { tab_id: 'later', kind: 'web', url: 'https://later.example/' };
  conversation.workspace.path = '/fixture/later-workspace';
  await setImmediate();
  assert.equal(settled, false);
  assert.equal(queued, undefined, 'No native runtime starts just to deliver the addition');
  preparing.resolve();
  await started.promise;
  await setImmediate();
  assert.equal(queued.length, 1);
  assert.deepEqual({ messageId: queued[0].messageId, turnId: queued[0].turnId }, { messageId: 'addition', turnId: 'A-1' });
  const payload = JSON.parse(queued[0].text);
  assert.equal(payload.message, 'original addition');
  assert.deepEqual(payload.activeTab, page);
  assert.deepEqual(payload.openTabs, [page]);
  assert.equal(payload.currentUrl, page.url);
  assert.deepEqual(payload.briefs, [{ id: 'receipt.example-skill' }]);
  assert.equal(payload.context.workspace.path, '/fixture/receipt-workspace');
  assert.equal(payload.nowLocal, 'fixture-time-at-receipt');
  assert.equal(payload.includeConversationMemory, false);
  assert.equal(settled, false, 'Queue acceptance is not the consumed receipt');
  agent.activeAgentTurns.get('A').steeringInbox.consume('addition');
  assert.equal((await steering).mergedIntoTurn, true);
  assert.equal((await duplicate).mergedIntoTurn, true);
  release.resolve();
  await root;
});

test('Main Stop and failed root preparation fail queued additions without converting them to new roots', async t => {
  for (const stop of [true, false]) {
    const { agent, claim } = makeHarness(t);
    const preparing = deferred();
    agent._state.ensurePersistedCaptureRecordsLoaded = () => preparing.promise;
    agent.handleAgentTurn = () => assert.fail('Stopped or failed preparation cannot enter a model run');
    claim('A');
    const root = agent.sendAgentMessage({ sessionId: 'A', turnId: 'A-1', messageId: 'root', intent: 'root', message: 'root' });
    const pending = agent.sendAgentMessage({ sessionId: 'A', turnId: 'A-1', messageId: 'waiting', intent: 'steering', message: 'waiting' });
    if (stop) {
      await agent.abortAgent({ sessionId: 'A', turnId: 'A-1' });
      preparing.resolve();
    } else preparing.reject(new Error('fixture startup failed'));
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.error, 'steer-failed');
    assert.equal(result.continueAsRoot, undefined);
    assert.ok(result.text);
    await root;
    assert.equal(agent.activeAgentTurns.size, 0);
  }
});

test('a closed successful owner returns a typed continuation only after finish, without claiming a new root', async t => {
  const { agent, claim } = makeHarness(t);
  claim('A'); claim('B');
  const turn = agent.activeAgentTurns.get('A');
  assert.equal(turn.steeringInbox.next(), undefined);
  const request = { sessionId: 'A', turnId: 'A-1', messageId: 'late', intent: 'steering', message: 'late addition' };
  let settled = false;
  const waiting = agent.sendAgentMessage(request).then(reply => { settled = true; return reply; });
  await setImmediate();
  assert.equal(settled, false, 'Closed admission must wait for the real success/failure outcome');
  const reply = { ok: true, text: 'original result', ts: 1 };
  const snapshot = { windowTabs: { activeTab: null, openTabs: [] }, sentAt: 'fixture-time-at-receipt' };
  agent.finishAgentTurn(turn, 'completed', reply);
  const result = await waiting;
  assert.equal(result.ok, false);
  assert.deepEqual(result.continueAsRoot, { turnId: 'A-1', reply, snapshot });
  assert.equal(result.mergedIntoTurn, undefined);
  const repeated = await Promise.all([agent.sendAgentMessage(request), agent.sendAgentMessage(request)]);
  assert.ok(repeated.every(item => item.ok === false));
  assert.deepEqual(repeated.map(item => item.continueAsRoot), [{ turnId: 'A-1', reply, snapshot }, { turnId: 'A-1', reply, snapshot }]);
  assert.deepEqual([...agent.activeAgentTurns.keys()], ['B'], 'Only renderer ownership serialization may claim the continuation');
});

test('closed or finished failed owners and superseding owners never authorize continueAsRoot', async t => {
  for (const scenario of ['failed', 'stopped', 'expired', 'superseded-while-waiting', 'superseded-after-finish']) {
    const { agent, claim } = makeHarness(t);
    claim('A');
    const turn = agent.activeAgentTurns.get('A');
    turn.steeringInbox.next();
    const request = { sessionId: 'A', turnId: 'A-1', messageId: 'late', intent: 'steering', message: 'late' };
    const waiting = scenario.endsWith('while-waiting') ? agent.sendAgentMessage(request) : null;
    const reason = scenario === 'stopped' ? 'stopped' : scenario === 'expired' ? 'reservation-expired' : 'completed';
    agent.finishAgentTurn(turn, reason, { ok: scenario !== 'failed', text: scenario });
    if (scenario.startsWith('superseded')) claim('A', 'A-2');
    const response = await (waiting || agent.sendAgentMessage(request));
    assert.equal(response.ok, false, scenario);
    assert.equal(response.continueAsRoot, undefined, scenario);
    assert.ok(['steer-failed', 'turn-not-active'].includes(response.error), scenario);
    if (scenario.startsWith('superseded')) assert.equal(agent.activeAgentTurns.get('A').turnId, 'A-2');
  }
});

test('a continued root keeps the original addition and the page/time snapshot returned by its finished owner', async t => {
  const { agent, claim } = makeHarness(t);
  const page = { tab_id: 'original-page', kind: 'web', title: 'Original', url: 'https://original.example/' };
  agent._state.describeWindowTabs = () => ({ activeTab: page, openTabs: [page] });
  claim('A');
  const turn = agent.activeAgentTurns.get('A');
  turn.steeringInbox.next();
  const addition = { sessionId: 'A', turnId: 'A-1', messageId: 'addition', intent: 'steering', message: 'original addition text' };
  const late = agent.sendAgentMessage(addition);
  agent._state.describeWindowTabs = () => ({ activeTab: { tab_id: 'later-page', kind: 'web', url: 'https://later.example/' }, openTabs: [] });
  agent.finishAgentTurn(turn, 'completed', { ok: true, text: 'previous answer' });
  const marker = (await late).continueAsRoot;
  assert.deepEqual(marker.snapshot, { windowTabs: { activeTab: page, openTabs: [page] }, sentAt: 'fixture-time-at-receipt' });
  const routed = [];
  agent.handleAgentTurn = async (message, _runtime, _context, options) => {
    routed.push({ message, windowTabs: options.windowTabs, sentAt: options.messageSentAt });
    return { ok: true, text: 'new answer' };
  };
  claim('A', 'A-2');
  assert.equal((await agent.sendAgentMessage({ ...addition, turnId: 'A-2', intent: 'root', snapshot: marker.snapshot })).ok, true);
  assert.deepEqual(routed, [{ message: addition.message, windowTabs: marker.snapshot.windowTabs, sentAt: marker.snapshot.sentAt }]);
});

test('acknowledged completion allows another late addition only through its continuation lineage, and Stop revokes it', async t => {
  for (const continuation of [true, false]) {
    const { agent, claim } = makeHarness(t);
    const reply = { ok: true, text: 'original completed result' };
    agent.handleAgentTurn = async () => reply;
    claim('A');
    await agent.sendAgentMessage({ sessionId: 'A', turnId: 'A-1', messageId: 'root', intent: 'root', message: 'original root' });
    agent.ackAgentTurnFinished({ sessionId: 'A', turnId: 'A-1' });
    assert.deepEqual(agent.getActiveAgentTurn().finished, []);
    assert.equal(agent.claimAgentTurn({ sessionId: 'A', turnId: 'A-2', rootText: 'first late addition', startedAt: 2,
      ...(continuation ? { continuationOf: 'A-1' } : {}) }).ok, true);
    const late = { sessionId: 'A', turnId: 'A-1', messageId: 'second-late', intent: 'steering', message: 'second late addition' };
    const result = await agent.sendAgentMessage(late);
    if (continuation) {
      assert.equal(result.continueAsRoot.turnId, 'A-1');
      assert.deepEqual(result.continueAsRoot.reply, reply);
      assert.equal(agent.activeAgentTurns.get('A').turnId, 'A-2');
      await agent.abortAgent({ sessionId: 'A', turnId: 'A-2' });
      assert.equal((await agent.sendAgentMessage(late)).continueAsRoot, undefined);
      assert.throws(() => agent.claimAgentTurn({ sessionId: 'A', turnId: 'A-3', continuationOf: 'A-1', rootText: 'after Stop' }), /cannot be continued/);
    } else {
      assert.equal(result.continueAsRoot, undefined);
      assert.equal(result.error, 'turn-not-active');
      assert.equal(agent.activeAgentTurns.get('A').turnId, 'A-2');
    }
  }
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

test('root received during manual compaction keeps its reservation beyond the normal expiry and waits for completion', async t => {
  const {agent,claim} = makeHarness(t,15)
  const compact = deferred(), run = deferred(), started = deferred()
  agent.manualCompactions.set('A',compact.promise)
  agent.routeAgentMessage = async () => { started.resolve(); await run.promise; return {ok:true,text:'done'} }
  claim('A')
  const result = agent.sendAgentMessage({sessionId:'A',turnId:'A-1',messageId:'root',intent:'root',message:'after compact'})
  await new Promise(resolve => setTimeout(resolve,35))
  assert.ok(agent.activeAgentTurns.has('A'))
  assert.equal(agent.activeAgentTurns.get('A').rootStarted,false)
  compact.resolve(); await started.promise
  run.resolve(); assert.equal((await result).ok,true)
})
