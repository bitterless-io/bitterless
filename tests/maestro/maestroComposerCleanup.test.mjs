/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const greeting = 'Hi — how can I help you today?';
const mocks = {
  inversify: `
    export const injectable = () => (target) => target;
    export const inject = () => () => undefined;
  `,
  'gpt-tokenizer': 'export const countTokens = (text) => Math.ceil(text.length / 4);',
  '@maestro-shared/iocHelper/ioc.helper': `
    export const iocHelper = {
      bind: ({ controller, services }) => new controller(new services[0]())
    };
  `,
  './turn.service': `
    export class TurnService {
      setState(state) { this.state = state; }
      async send(...args) {
        globalThis.__maestroComposerFixture.sent.push(args);
        return globalThis.__maestroComposerFixture.reply;
      }
      async stop(sessionId) { globalThis.__maestroComposerFixture.stopped.push(sessionId); }
      async finishFromMain(session, turnId, reply, reason) {
        globalThis.__maestroComposerFixture.finished.push({ sessionId: session.id, turnId, reply, reason });
        delete session.turn;
      }
    }
  `,
  'electron-xpc/renderer': `
    export const createXpcRendererEmitter = (handler) => new Proxy({}, {
      get: (_target, method) => async (params) => {
        const fixture = globalThis.__maestroComposerFixture;
        fixture.calls.push({ handler, method, params });
        const route = fixture.routes[handler]?.[method];
        if (!route) throw new Error('Unexpected mock boundary: ' + handler + '.' + String(method));
        return await route(params);
      }
    });
    export const xpcRenderer = {
      subscribe: (channel, listener) => globalThis.__maestroComposerFixture.subscriptions.set(channel, listener)
    };
  `
};
const bundled = await build({
  stdin: {
    contents: `
      export { MessageStoreState } from './src/renderer/maestro/control/src/store/message.store.ts';
      export { TurnService } from './turn.service';
      export { reactive } from 'vue';
    `,
    resolveDir: root
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'maestro-composer-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'composer-mock' } : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'composer-mock' }, ({ path }) => ({
          contents: mocks[path]
        }));
      }
    }
  ]
});
const { MessageStoreState, TurnService, reactive } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
after(() => {
  delete globalThis.__maestroComposerFixture;
});

const createHarness = () => {
  const fixture = {
    calls: [],
    saved: [],
    deleted: [],
    sent: [],
    stopped: [],
    finished: [],
    subscriptions: new Map(),
    persisted: new Map(),
    recovery: null,
    defaultWorkspace: undefined,
    workspaceResult: { ok: false, missing: true },
    reply: { text: 'test turn reply' },
    routes: {}
  };
  fixture.routes = {
    CoachXpcHandler: {
      getActiveAgentTurn: async () => fixture.recovery,
      ackAgentTurnFinished: async () => ({ ok: true }),
      getWorkspaceDirectory: async () => ({ ok: true, workspace: fixture.defaultWorkspace }),
      setWorkspaceDirectory: async () => fixture.workspaceResult
    },
    MaestroChatDao: {
      getSession: async ({ id }) => fixture.persisted.get(id) ?? null,
      listSessions: async () => [],
      saveSession: async ({ session }) => {
        fixture.saved.push(structuredClone(session));
        return { ok: true };
      },
      deleteSession: async ({ id, onlyIfEmpty }) => {
        if (onlyIfEmpty && fixture.persisted.get(id)?.messages.length) return { ok: false };
        fixture.deleted.push(id);
        return { ok: true };
      }
    }
  };
  globalThis.__maestroComposerFixture = fixture;
  const turnService = new TurnService();
  const store = reactive(new MessageStoreState(turnService));
  return { store, fixture, turnService };
};
const options = { title: 'Maestro', intent: 'chat', operationTabId: 'operation-tab' };
const message = (id, role, content = greeting, ts = 1000) => ({
  id,
  source: 'cowork',
  role,
  type: 'text',
  content,
  streaming: false,
  ts
});
const storedSession = (id, messages) => ({
  id,
  title: 'Retained conversation',
  operationTabId: options.operationTabId,
  createdAt: 900,
  updatedAt: 2000,
  detail: { compressedContext: '' },
  messages
});
const turnSnapshot = (state = 'reserved') => ({
  sessionId: `recovered-${state}`,
  operationTabId: options.operationTabId,
  turnId: `turn-${state}`,
  generation: 7,
  rootText: state === 'reserved' ? '' : 'Continue the real request',
  startedAt: 1000,
  state
});

test('new chat is genuinely empty, retaining context defaults, attachments and inherited workspace', () => {
  const { store, fixture } = createHarness();
  const workspace = {
    path: '/test/full-workspace',
    name: 'Full workspace name',
    exists: true,
    updatedAt: 1
  };
  store.defaultWorkspace = workspace;
  const session = store.createSession(options);
  assert.deepEqual(session.messages, []);
  assert.equal(Object.hasOwn(session, 'welcome'), false);
  assert.equal(session.contextUsage.usedTokens, 0);
  assert.equal(session.contextUsage.percent, 0);
  assert.equal(session.allowFiles, true);
  assert.equal(session.placeholder, 'Start a Maestro conversation…');
  assert.equal(session.operationTabId, options.operationTabId);
  assert.deepEqual(session.detail.workspace, workspace);
  assert.notEqual(
    session.detail.workspace,
    store.defaultWorkspace,
    'new sessions clone the default workspace'
  );
  assert.equal(store.getSession(session.id).id, session.id);
  assert.deepEqual(fixture.calls, [], 'creating an empty local draft does not write history');
});

test('reserved recovery injects no greeting, retains turn ownership and is not discarded while active', async () => {
  const { store, fixture } = createHarness();
  const snapshot = turnSnapshot();
  fixture.recovery = { revision: 1, turn: snapshot, finished: [] };
  const session = await store.latestActiveSession();
  assert.ok(session);
  assert.deepEqual(session.messages, []);
  assert.equal(session.id, snapshot.sessionId);
  assert.equal(session.turn.id, snapshot.turnId);
  assert.equal(session.turn.generation, snapshot.generation);
  assert.equal(session.turn.rootText, '');
  assert.equal(session.turn.rootHumanMessageId, undefined);
  assert.equal(session.turn.phase, 'accepted');
  await store.discardIfEmpty(session.id);
  assert.equal(store.getSession(session.id).id, session.id);
  assert.deepEqual(fixture.deleted, []);
  assert.equal(
    await store.latestActiveSession(),
    store.getSession(session.id)
  );
});

test('running and aborting recovery keep the real root and turn state without prepending a greeting', async () => {
  for (const state of ['running', 'aborting']) {
    const { store, fixture } = createHarness();
    const snapshot = turnSnapshot(state);
    fixture.recovery = { revision: 2, turn: snapshot, finished: [] };
    const session = await store.latestActiveSession();
    assert.equal(session.messages.length, 1);
    const rootMessage = session.messages[0];
    assert.equal(rootMessage.role, 'human');
    assert.equal(rootMessage.content, snapshot.rootText);
    assert.equal(rootMessage.ts, snapshot.startedAt);
    assert.ok(!rootMessage.id.startsWith('welcome-'));
    assert.equal(session.turn.rootHumanMessageId, rootMessage.id);
    assert.equal(session.turn.id, snapshot.turnId);
    assert.equal(session.turn.generation, 7);
    assert.equal(session.turn.aborting, state === 'aborting');
    await store.persistSession(session);
    assert.equal(fixture.saved.length, 1, 'a single recovered human root is persistent content');
    assert.equal(fixture.saved[0].messages[0].content, snapshot.rootText);
    assert.deepEqual(fixture.deleted, []);
  }
});

test('loading history preserves message IDs, order and text, including genuine messages equal to the former greeting', async () => {
  const { store, fixture } = createHarness();
  const originals = [
    message('welcome-historical', 'ai'),
    message('real-human', 'human', greeting, 1100),
    message('real-assistant', 'ai', greeting, 1200),
    message('real-body', 'human', '  Keep this content exactly.\n第二行  ', 1300)
  ];
  const stored = storedSession('history-with-greeting-text', originals);
  fixture.persisted.set(stored.id, stored);
  const before = structuredClone(stored);
  const session = await store.loadPersistedSession(stored.id);
  const identityAndText = (messages) =>
    messages.map(({ id, role, content, ts }) => ({ id, role, content, ts }));
  assert.deepEqual(identityAndText(session.messages), identityAndText(originals));
  assert.deepEqual(stored, before, 'loading does not rewrite persisted input');
  assert.equal(Object.hasOwn(session, 'welcome'), false);
  await store.discardIfEmpty(session.id);
  await store.persistSession(session);
  assert.deepEqual(fixture.deleted, []);
  assert.equal(fixture.saved.length, 1);
  assert.deepEqual(identityAndText(fixture.saved[0].messages), identityAndText(originals));
});

test('persisted active turns retain their actual root and assistant segment on recovery', async () => {
  const { store, fixture } = createHarness();
  const snapshot = turnSnapshot('running');
  fixture.recovery = { revision: 3, turn: snapshot, finished: [] };
  const originals = [
    message('persisted-root', 'human', snapshot.rootText, snapshot.startedAt),
    message('persisted-answer', 'ai', 'Real partial response', snapshot.startedAt + 10)
  ];
  fixture.persisted.set(snapshot.sessionId, { ...storedSession(snapshot.sessionId, originals), operationTabId: 'another-old-tab' });
  const session = await store.latestActiveSession();
  assert.deepEqual(
    session.messages.map(({ id }) => id),
    ['persisted-root', 'persisted-answer']
  );
  assert.equal(session.turn.rootHumanMessageId, 'persisted-root');
  assert.equal(session.turn.lastAssistantMessageId, 'persisted-answer');
  assert.equal(session.turn.phase, 'streaming');
  assert.equal(session.turn.hasStreamedText, true);
  assert.equal(session.turn.sealedAssistantSegments, 1);
  assert.equal(session.turn.streamCoverageComplete, false);
});

test('reload restores every running or reserved session; completing A leaves B active and unarchivable', async () => {
  const { store, fixture } = createHarness();
  const first = { ...turnSnapshot('running'), sessionId: 'parallel-a', turnId: 'turn-a' };
  const second = { ...turnSnapshot('reserved'), sessionId: 'parallel-b', turnId: 'turn-b' };
  fixture.persisted.set(first.sessionId, storedSession(first.sessionId, [message('root-a', 'human', first.rootText)]));
  fixture.recovery = { revision: 7, turn: first, turns: [first, second], finished: [] };
  await store.init();
  assert.equal(store.getSession(first.sessionId).turn.id, first.turnId);
  assert.equal(store.getSession(second.sessionId).turn.id, second.turnId);
  assert.equal(store.sessionListItems.filter(item => item.running).length, 2);
  store.applyAgentTurnUpdate({ revision: 8, turn: null, finished: { turn: first, reason: 'aborted' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.activeAgentTurnSnapshots.map(turn => turn.sessionId), [second.sessionId]);
  assert.equal(store.getSession(second.sessionId).turn.id, second.turnId);
  assert.equal(await store.archive(second.sessionId), false);
  const next = { ...second, turnId: 'turn-b-next', generation: second.generation + 1 };
  store.setActiveAgentTurnSnapshot(next);
  store.setActiveAgentTurnSnapshot(null, second.turnId);
  assert.equal(store.activeAgentTurnSnapshots[0].turnId, next.turnId, 'old completion cannot drop a newer turn');
  store.applyAgentTurnRecovery({ revision: 6, turn: first, turns: [first], finished: [] });
  assert.equal(store.activeAgentTurnSnapshots[0].turnId, next.turnId, 'stale recovery cannot replace active ownership');
});

test('a finish missed during reload replays its original turn even after its browser tab has gone', async () => {
  const { store, fixture } = createHarness();
  const snapshot = { ...turnSnapshot('running'), operationTabId: 'closed-browser-tab' };
  const reply = { ok: true, text: 'Completed while Control reloaded', ts: 2000 };
  fixture.recovery = { revision: 4, turn: null, finished: [{ turn: snapshot, reply, reason: 'completed' }] };
  const recovered = await store.latestActiveSession();
  assert.equal(recovered.id, snapshot.sessionId);
  assert.equal(recovered.operationTabId, snapshot.operationTabId, 'legacy page metadata remains available without selecting the chat');
  assert.equal(recovered.messages[0].content, snapshot.rootText);
  assert.deepEqual(fixture.finished, [{ sessionId: snapshot.sessionId, turnId: snapshot.turnId, reply, reason: 'completed' }]);
  assert.equal(recovered.turn, undefined);
  assert.deepEqual(fixture.calls.find(({ method }) => method === 'ackAgentTurnFinished').params, { sessionId: snapshot.sessionId, turnId: snapshot.turnId });
});

test('recent chat fallback skips unavailable and archived history independently of old tab metadata', async () => {
  const { store, fixture } = createHarness();
  const recent = storedSession('available-recent', [message('body', 'human', 'kept')]);
  fixture.persisted.set(recent.id, { ...recent, operationTabId: 'old-page' });
  fixture.routes.MaestroChatDao.listSessions = async () => [
    { id: 'archived', archivedAt: 1, updatedAt: 4000 },
    { id: 'unavailable', updatedAt: 3000 },
    { id: recent.id, updatedAt: 2000 }
  ];
  assert.equal((await store.latestActiveSession()).id, recent.id);
  assert.deepEqual(fixture.calls.filter(({ method }) => method === 'getSession').map(({ params }) => params.id), ['unavailable', recent.id]);
});

test('discard removes only unused empty drafts and preserves persisted rows including legacy welcomes', async () => {
  const { store, fixture } = createHarness();
  const empty = store.createSession(options);
  await store.discardIfEmpty(empty.id);
  assert.equal(store.getSession(empty.id), undefined);
  const legacy = storedSession('legacy-unused', [message('welcome-legacy', 'ai')]);
  fixture.persisted.set(legacy.id, legacy);
  await store.loadPersistedSession(legacy.id);
  await store.discardIfEmpty(legacy.id);
  assert.ok(store.getSession(legacy.id));
  assert.deepEqual(fixture.deleted, [empty.id]);
  for (const role of ['human', 'ai']) {
    const real = store.createSession(options);
    real.messages.push(message(`single-${role}`, role));
    await store.discardIfEmpty(real.id);
    assert.ok(store.getSession(real.id));
    await store.persistSession(real);
    assert.equal(fixture.saved.at(-1).messages.length, 1);
    assert.equal(fixture.saved.at(-1).messages[0].content, greeting);
    assert.equal(fixture.saved.at(-1).messages[0].role, role);
  }
  assert.deepEqual(fixture.deleted, [empty.id]);
});

test('empty-draft cleanup failure retains the renderer session and uses conditional persistence deletion', async () => {
  for (const outcome of [false, 'throw']) {
    const { store, fixture } = createHarness();
    const session = store.createSession(options);
    fixture.routes.MaestroChatDao.deleteSession = async () => {
      if (outcome === 'throw') throw new Error('storage unavailable');
      return { ok: false };
    };
    await store.discardIfEmpty(session.id);
    assert.equal(store.getSession(session.id).id, session.id);
    assert.deepEqual(fixture.calls.find(({ method }) => method === 'deleteSession').params, { id: session.id, onlyIfEmpty: true });
  }
});

test('pending empty-draft cleanup preserves a reselected, running, populated or replaced session', async () => {
  for (const mutation of ['selected', 'running', 'content', 'replaced']) {
    const { store, fixture } = createHarness();
    const session = store.createSession(options);
    let finish;
    fixture.routes.MaestroChatDao.deleteSession = () => new Promise(resolve => { finish = resolve; });
    const pending = store.discardIfEmpty(session.id);
    assert.equal(store.getSession(session.id).id, session.id, 'memory remains intact while persistence is pending');
    if (mutation === 'selected') store.activeSessionId = session.id;
    if (mutation === 'running') session.turn = { id: 'turn-a' };
    if (mutation === 'content') session.messages.push(message('real', 'human', 'started meanwhile'));
    if (mutation === 'replaced') store.sessions = [{ ...session }];
    finish({ ok: true }); await pending;
    assert.ok(store.getSession(session.id), mutation);
  }
});

test('the selected empty draft never starts cleanup', async () => {
  const { store, fixture } = createHarness();
  const session = store.createSession(options);
  store.activeSessionId = session.id;
  await store.discardIfEmpty(session.id);
  assert.equal(store.getSession(session.id).id, session.id);
  assert.deepEqual(fixture.deleted, []);
});

test('workspace refresh still validates the current path and send/stop preserve the existing TurnService boundary', async () => {
  const { store, fixture } = createHarness();
  const session = store.createSession(options);
  const workspace = {
    path: '/test/project',
    name: 'Complete project name',
    exists: true,
    updatedAt: 2
  };
  session.detail.workspace = { ...workspace, updatedAt: 1 };
  fixture.workspaceResult = { ok: true, workspace };
  assert.equal(typeof store.refreshWorkspace, 'function');
  await store.refreshWorkspace(session.id);
  assert.deepEqual(fixture.calls.find(({ method }) => method === 'setWorkspaceDirectory').params, {
    sessionId: session.id,
    path: workspace.path
  });
  assert.deepEqual(session.detail.workspace, workspace);
  assert.deepEqual(store.defaultWorkspace, workspace);
  const files = [{ name: 'report.txt', path: '/test/project/report.txt' }];
  assert.equal(await store.send(session.id, 'real message', files), fixture.reply);
  assert.deepEqual(fixture.sent, [[session.id, 'real message', files]]);
  await store.stop(session.id);
  assert.deepEqual(fixture.stopped, [session.id]);
  assert.deepEqual(
    session.messages,
    [],
    'message store does not add an unrelated opening message on send'
  );
});

test('archive loads stored history and soft-saves empty drafts with their composer state', async () => {
  const { store, fixture } = createHarness();
  fixture.persisted.set('unloaded', storedSession('unloaded', [message('one', 'human', 'Saved content')]));
  assert.equal(await store.archive('unloaded'), true);
  assert.ok(fixture.saved.at(-1).archivedAt);
  assert.equal(fixture.saved.at(-1).messages[0].content, 'Saved content');
  const empty = store.createSession(options);
  empty.detail.draft = { text: 'Pending request', files: [{ name: 'note.txt', path: '/test/note.txt' }] };
  assert.equal(await store.archive(empty.id), true);
  assert.deepEqual(fixture.saved.at(-1).detail.draft, empty.detail.draft);
  assert.deepEqual(fixture.deleted, []);
  assert.equal(await store.restore(empty.id), true);
  assert.equal(fixture.saved.at(-1).archivedAt, undefined);
  assert.deepEqual(fixture.saved.at(-1).detail.draft, empty.detail.draft);
});

test('archive and rename roll back failed DAO results and reserved turns cannot archive', async () => {
  const { store, fixture } = createHarness();
  const session = store.createSession(options);
  const before = { title: session.title, updatedAt: session.updatedAt };
  fixture.routes.MaestroChatDao.saveSession = async () => ({ ok: false });
  assert.equal(await store.archive(session.id), false);
  assert.equal(session.archivedAt, undefined);
  assert.equal(session.updatedAt, before.updatedAt);
  assert.equal(await store.renameSession(session.id, 'custom'), false);
  assert.equal(session.title, before.title);
  assert.equal(session.detail.titleCustomized, undefined);
  fixture.routes.MaestroChatDao.saveSession = async () => { throw new Error('disk failure'); };
  assert.equal(await store.renameSession(session.id, 'custom'), false);
  store.activeAgentTurnSnapshots = [{ sessionId: session.id, state: 'reserved' }];
  assert.equal(await store.archive(session.id), false);
  assert.equal(store.sessionListItems.find((item) => item.id === session.id).running, true);
});

test('metadata changes wait behind prior saves and later saves observe rollback', async () => {
  const { store, fixture } = createHarness();
  const session = store.createSession(options);
  let release;
  const calls = [];
  fixture.routes.MaestroChatDao.saveSession = async ({ session: stored }) => {
    calls.push(structuredClone(stored));
    if (calls.length === 1) await new Promise((resolve) => { release = resolve; });
    return { ok: calls.length !== 2 };
  };
  const first = store.persistSession(session);
  await new Promise((resolve) => setImmediate(resolve));
  const rename = store.renameSession(session.id, 'Should roll back');
  await new Promise((resolve) => setImmediate(resolve));
  const later = store.persistSession(session);
  assert.equal(calls.length, 1);
  release();
  assert.deepEqual(await Promise.all([first, rename, later]), [true, false, true]);
  assert.equal(calls[1].title, 'Should roll back');
  assert.equal(calls[2].title, 'Maestro');
  assert.equal(calls[2].detail.titleCustomized, undefined);
});

test('customized default title round-trips and live metadata wins over stale history', async () => {
  const { store, fixture } = createHarness();
  const session = store.createSession(options);
  assert.equal(await store.renameSession(session.id, '  Maestro  '), true);
  const saved = fixture.saved.at(-1);
  assert.equal(saved.detail.titleCustomized, true);
  fixture.persisted.set(session.id, saved);
  store.sessions = [];
  const loaded = await store.loadPersistedSession(session.id);
  assert.equal(loaded.detail.titleCustomized, true);
  store.historySessions = [{ ...saved, archivedAt: 42, preview: 'stale' }];
  assert.equal(store.sessionListItems.length, 1, 'restored live session overrides stale archived history');
  loaded.archivedAt = 43;
  store.historySessions = [{ ...saved, archivedAt: undefined, preview: 'stale' }];
  assert.equal(store.sessionListItems.length, 0, 'archived live session overrides stale active history');
});

test('concurrent session loads reuse the first in-memory identity', async () => {
  const { store, fixture } = createHarness();
  const stored = storedSession('concurrent', [message('one', 'human', 'Hello')]);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  fixture.routes.MaestroChatDao.getSession = async () => { await gate; return stored; };
  const a = store.loadPersistedSession(stored.id);
  const b = store.loadPersistedSession(stored.id);
  release();
  const loaded = await Promise.all([a, b]);
  assert.equal(store.sessions.length, 1);
  assert.equal(loaded[0].id, loaded[1].id);
  assert.equal(store.getSession(stored.id).messages.length, 1);
});
