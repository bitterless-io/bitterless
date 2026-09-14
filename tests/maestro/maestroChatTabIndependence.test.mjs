import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const read = file => readFileSync(resolve(root, file), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const channelPath = 'src/renderer/maestro/control/src/store/channel.store.ts';
const channelHarness = (remembered = '', sessions = []) => {
  const saved = new Map([['bitterless.maestro.activeSessionId', remembered]]);
  const calls = [];
  let busy = null;
  const store = {
    sessions,
    activeSessionId: '',
    init: async () => undefined,
    getSession: id => sessions.find(session => session.id === id),
    loadPersistedSession: async id => store.getSession(id),
    latestActiveSession: async () => sessions.find(session => !session.archivedAt),
    markRead: id => calls.push(['read', id]),
    discardIfEmpty: async id => calls.push(['discard', id]),
    archive: async id => { store.getSession(id).archivedAt = Date.now(); calls.push(['archive', id]); },
    turnService: { activeTurn: () => busy },
    createSession: options => {
      const session = { ...options, id: `new-${sessions.length}`, messages: [] };
      calls.push(['create', options]);
      sessions.push(session);
      return session;
    }
  };
  const reload = () => {
    const exports = {};
    new Function('exports', 'require', 'localStorage', compile(read(channelPath)))(exports,
      name => name === 'vue' ? { reactive: value => value } : { messageStore: store },
      { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) });
    return new exports.ChannelStoreState();
  };
  return { store, calls, saved, reload, channel: reload(), setBusy: value => { busy = value; } };
};

test('tab creation, activation and closure preserve the selected chat and its mutable state', async () => {
  const session = { id: 'remembered', operationTabId: 'closed-tab', messages: [{ content: 'kept history' }], draft: 'unsent draft', attachments: ['/test/file.txt'], detail: { workspace: { path: '/test/project' } }, turn: { id: 'running-turn' } };
  const harness = channelHarness(session.id, [session]);
  await harness.channel.init([{ id: 'page-a', active: true }]);
  const snapshot = structuredClone(session);
  harness.setBusy(session.turn);
  const callsBeforeTabs = harness.calls.length;
  for (const tabs of [[{ id: 'page-a' }, { id: 'reference', active: true }], [{ id: 'page-a', active: true }], []]) {
    await harness.channel.syncOperationTabs(tabs);
    assert.equal(harness.channel.activeSession, session);
    assert.deepEqual(session, snapshot);
  }
  assert.equal(harness.calls.length, callsBeforeTabs, 'tab broadcasts do not create/select/archive/discard or mark chats read');
  harness.channel.selectSource('connector');
  await harness.channel.syncOperationTabs([{ id: 'another-page', active: true }]);
  assert.equal(harness.channel.activeSession, undefined);
  assert.equal(harness.store.activeSessionId, '');
  harness.channel.selectSource('cowork');
  assert.equal(harness.channel.activeSession, session);
});

for (const messages of [[], [{ content: 'streaming answer' }]]) test('New chat preserves a running ' + (messages.length ? 'populated' : 'empty') + ' session and its browser state', async () => {
  const old = { id: 'running', messages, turn: { id: 'turn-a', phase: 'streaming', steering: { pending: ['continue'] } }, browserUseTabIds: ['page-a'], operationTabId: 'page-a' };
  const h = channelHarness(old.id, [old]);
  await h.channel.init(); h.setBusy(old.turn);
  const before = structuredClone(old);
  assert.equal(await h.channel.startNewMaestroSession(old.id), true);
  const fresh = h.channel.activeSession;
  assert.notEqual(fresh.id, old.id);
  assert.deepEqual(fresh.messages, []);
  assert.deepEqual(old, before);
  assert.equal(h.store.turnService.activeTurn(), old.turn);
  assert.deepEqual(h.calls.filter(([kind]) => ['discard', 'archive'].includes(kind)), []);
  old.messages.push({ content: 'late result for A' });
  assert.deepEqual(fresh.messages, []);
  assert.equal(await h.channel.selectMaestroHistorySession(old.id), true);
  assert.equal(h.channel.activeSession, old);
  assert.equal(old.messages.at(-1).content, 'late result for A');
});

test('New chat stays available during pending cleanup without hijacking a later selection', async () => {
  for (const switchSource of [false, true]) {
    const first = { id: 'first', messages: [] }, other = { id: 'other', messages: [{ content: 'kept' }] };
    const h = channelHarness(first.id, [first, other]); await h.channel.init();
    const finishes = [];
    h.store.discardIfEmpty = () => new Promise(resolve => { finishes.push(resolve); });
    const opening = h.channel.startNewMaestroSession(first.id);
    const createdId = h.channel.activeSessionId;
    assert.notEqual(createdId, first.id, 'creation and selection complete before optional cleanup');
    assert.equal(await h.channel.startNewMaestroSession(first.id), false, 'stale click stays ignored');
    assert.equal(await h.channel.startNewMaestroSession(createdId), true);
    const nextCreatedId = h.channel.activeSessionId;
    if (switchSource) h.channel.selectSource('connector');
    else await h.channel.selectMaestroHistorySession(other.id);
    for (const finish of finishes) finish();
    assert.equal(await opening, true);
    assert.equal(h.calls.filter(([kind]) => kind === 'create').length, 2);
    assert.equal(h.channel.activeSource, switchSource ? 'connector' : 'cowork');
    assert.equal(h.channel.activeSessionId, switchSource ? nextCreatedId : other.id);
  }
});

test('creation failure preserves selection and releases its guard; cleanup failure does not undo success', async () => {
  const old = { id: 'old', messages: [], draft: 'keep me', attachments: ['file'] };
  const h = channelHarness(old.id, [old]); await h.channel.init();
  const create = h.store.createSession;
  h.store.createSession = () => { throw new Error('creation unavailable'); };
  await assert.rejects(h.channel.startNewMaestroSession(old.id), /creation unavailable/);
  assert.equal(h.channel.activeSession, old);
  assert.deepEqual(old, { id: 'old', messages: [], draft: 'keep me', attachments: ['file'] });
  assert.equal(h.calls.some(([kind]) => kind === 'discard'), false);
  h.store.createSession = create;
  h.store.discardIfEmpty = async () => { throw new Error('cleanup unavailable'); };
  h.setBusy({ id: 'another-task-turn' });
  assert.equal(await h.channel.startNewMaestroSession(old.id), true, 'a different running task is not a creation gate');
  assert.notEqual(h.channel.activeSessionId, old.id);
  assert.equal(h.store.getSession(old.id), old);
});

test('New chat rejects archived, stale and connector source requests without creating or discarding', async () => {
  const old = { id: 'old', messages: [] };
  const h = channelHarness(old.id, [old]); await h.channel.init();
  assert.equal(await h.channel.startNewMaestroSession('stale'), false);
  old.archivedAt = 1;
  assert.equal(await h.channel.startNewMaestroSession(old.id), false);
  delete old.archivedAt;
  h.channel.selectSource('connector');
  assert.equal(await h.channel.startNewMaestroSession(old.id), false);
  assert.equal(h.calls.some(([kind]) => ['create', 'discard'].includes(kind)), false);
});

test('history and New Chat explicitly select and remember chats without a browser operation', async () => {
  const first = { id: 'first', messages: [{ content: 'history' }] };
  const second = { id: 'second', messages: [{ content: 'other history' }], operationTabId: 'obsolete' };
  const harness = channelHarness('missing', [first, second]);
  await harness.channel.init();
  assert.equal(harness.channel.activeSession, first, 'unavailable remembered selection falls back to recent unarchived chat');
  await harness.channel.selectMaestroHistorySession(second.id);
  assert.equal(harness.store.activeSessionId, second.id);
  const reloaded = harness.reload();
  await reloaded.init([{ id: 'different-page', active: true }]);
  assert.equal(reloaded.activeSession, second, 'reload restores remembered chat independently of page id');
  assert.equal(await reloaded.startNewMaestroSession(second.id), true);
  assert.notEqual(reloaded.activeSession.id, second.id);
  assert.deepEqual(reloaded.activeSession.messages, []);
  assert.equal(second.archivedAt, undefined);
  assert.deepEqual(harness.calls.filter(([kind]) => kind === 'create'), [['create', { title: 'Maestro', intent: 'chat' }]]);
  assert.equal(harness.saved.get('bitterless.maestro.activeSessionId'), reloaded.activeSession.id);
  const empty = channelHarness('archived', [{ id: 'archived', archivedAt: 1 }]);
  await empty.channel.init();
  assert.equal(empty.calls.filter(([kind]) => kind === 'create').length, 1, 'only an unusable history needs a new empty chat');
});

const servicePath = 'src/main/agent/maestroAgent.service.ts';
const method = (name, bindings = {}) => {
  const source = read(servicePath);
  const ast = ts.createSourceFile(servicePath, source, ts.ScriptTarget.Latest, true);
  let member;
  for (const declaration of ast.statements) {
    if (ts.isClassDeclaration(declaration)) member ??= declaration.members.find(item => item.name?.getText(ast) === name);
  }
  assert.ok(member, name);
  return new Function(...Object.keys(bindings), `${compile(`class Actual { ${member.getText(ast)} }`)}; return Actual.prototype.${name}`)(...Object.values(bindings));
};
const bundled = await build({
  stdin: { contents: `export { buildAgentTurnPrompt } from './src/main/agent/runtime/agentPrompt'; export { BASE_SYSTEM_PROMPT } from './src/main/agent/prompt/sysPrompt';`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'node', tsconfig: resolve(root, 'tsconfig.node.json')
});
const real = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const baseExports = {};
new Function('exports', 'require', compile(read('src/main/agent/BaseAgent.ts')))(baseExports, name => ({
  './prompt/sysPrompt': real,
  './runtime/inputBudget': { inputBudget: new Proxy({}, { get: () => () => undefined }) },
  './runtime/modelIoLog': { modelIoLog: { append: () => undefined } }
}[name] || require(name)));

test('later root and steering messages use the new page and site skills while reusing the live runtime and fixed system', async () => {
  const creationOptions = [];
  const prompts = [];
  const listeners = new Set();
  let finishHeld;
  let heldStarted;
  let hold = false;
  let aborts = 0;
  const runtimeSession = {
    isStreaming: false,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    async prompt(prompt) {
      prompts.push(prompt.text);
      if (this.isStreaming) return;
      this.isStreaming = true;
      if (hold) {
        heldStarted();
        await new Promise(done => { finishHeld = done; });
      }
      for (const listener of listeners) listener({ type: 'assistant_message_end', text: 'answer', stopReason: 'stop' });
      this.isStreaming = false;
    },
    abort: async () => { aborts += 1; }
  };
  const agent = new baseExports.BaseAgent({
    providerId: 'openai-codex', modelId: 'fixture', buildTools: () => [],
    describeTarget: () => ({ providerLabel: 'Fixture', modelLabel: 'Fixture', supplier: 'fixture' }),
    runtime: { createSession: async options => { creationOptions.push(options); return runtimeSession; } }
  });
  const registry = {
    listSkillsForDomain: url => [{ id: `${new URL(url).hostname}-skill`, name: `${new URL(url).hostname} instructions`, triggers: [], inputs: [], description: 'Use the current page instructions' }],
    readRecipe: () => null
  };
  const owner = {
    activeLlmProvider: 'openai-codex', activeLlmModel: 'fixture',
    agentSessionKey: value => value || 'default',
    agentSkillBriefs: (_message, recordings) => recordings.map(item => ({ ...item, seed: {}, missing: [] })),
    _state: {
      agentBrowserSession: sessionId => ({sessionId, tabs: []}),
      currentUrl: 'https://alpha.example/page',
      describeActiveTabContent() { return { state: 'web', url: this.currentUrl, title: this.currentUrl.includes('alpha') ? 'Alpha title' : 'Beta title' }; },
      existingSkillRegistry: () => registry,
      ensureServices: () => { throw new Error('Steering must not initialize services'); },
      replaySkill: () => { throw new Error('Steering must not execute a recipe'); }
    }
  };
  const handle = method('handleAgentTurn', {
    ...real, localNow: () => '2026-09-14 12:00:00 +08:00',
    chainFilePath: (_directory, id) => `/test/chain/${id}.jsonl`, maestroUserChainDir: () => '/test/chain',
    MODEL_RETRY_MAX: 1, STEER_NOT_STREAMING: 'not streaming', providerLabel: () => 'Fixture'
  }).bind(owner);
  const context = { recentMessages: [{ role: 'human', content: 'RESTORED MEMORY', ts: 1 }], workspace: { path: '/test/project' } };
  assert.equal((await handle('first request', agent, context, { sessionKey: 'stable-chat', includeConversationMemory: true })).ok, true);
  owner._state.currentUrl = 'https://beta.example/page';
  assert.equal((await handle('follow-up request', agent, context, { sessionKey: 'stable-chat' })).ok, true);
  assert.match(prompts[0], /alpha\.example\/page/);
  assert.match(prompts[0], /Alpha title/);
  assert.match(prompts[0], /alpha\.example-skill/);
  assert.match(prompts[1], /beta\.example\/page/);
  assert.match(prompts[1], /Beta title/);
  assert.match(prompts[1], /beta\.example-skill/);
  assert.doesNotMatch(prompts[1], /alpha\.example|RESTORED MEMORY/);
  hold = true;
  const started = new Promise(done => { heldStarted = done; });
  const running = handle('long request', agent, context, { sessionKey: 'stable-chat' });
  await started;
  const runState = owner.lastAgentRun;
  const openedTabs = owner.tabsOpenedThisTurn;
  owner._state.currentUrl = 'https://alpha.example/other';
  const steered = await handle('look at this page now', agent, context, { sessionKey: 'stable-chat', includeConversationMemory: true, steeringOnly: true });
  assert.equal(steered.mergedIntoTurn, true);
  assert.match(prompts.at(-1), /alpha\.example\/other/);
  assert.match(prompts.at(-1), /alpha\.example-skill/);
  assert.doesNotMatch(prompts.at(-1), /beta\.example|RESTORED MEMORY/);
  assert.equal(owner.lastAgentRun, runState);
  assert.equal(owner.tabsOpenedThisTurn, openedTabs);
  assert.equal(creationOptions.length, 1, 'tab switches and steering reuse one model runtime session');
  assert.equal(creationOptions[0].systemPrompt, real.BASE_SYSTEM_PROMPT);
  assert.doesNotMatch(creationOptions[0].systemPrompt, /alpha\.example|beta\.example/);
  assert.equal(aborts, 0);
  finishHeld();
  assert.equal((await running).ok, true);
});

test('new turn ownership records the current main tab and does not rewrite an existing turn', () => {
  const owner = {
    _state: { activeTabId: 'current-page', beginBrowserTurn: () => undefined }, activeAgentTurns: new Map(), agentTurnGeneration: 0,
    agentSessionKey: id => id, agentTurnSnapshot: turn => turn, broadcastAgentTurn: () => undefined, assertAgentRuntimeActive: () => undefined
  };
  const claim = method('claimAgentTurn', { AGENT_TURN_RESERVATION_TIMEOUT_MS: 60000, MAX_CONCURRENT_AGENT_TURNS: 4 }).bind(owner);
  const request = { sessionId: 'stable-chat', turnId: 'turn-1', rootText: 'request', operationTabId: 'creation-page' };
  try {
    assert.equal(claim(request).turn.operationTabId, 'current-page');
    owner._state.activeTabId = 'next-page';
    assert.equal(claim(request).turn.operationTabId, 'current-page', 'idempotent claim preserves the active turn identity and original page');
    clearTimeout(owner.activeAgentTurns.get(request.sessionId).reservationTimer);
    owner.activeAgentTurns.delete(request.sessionId);
    assert.equal(claim({ ...request, turnId: 'turn-2' }).turn.operationTabId, 'next-page');
  } finally {
    for (const turn of owner.activeAgentTurns.values()) clearTimeout(turn.reservationTimer);
  }
});
