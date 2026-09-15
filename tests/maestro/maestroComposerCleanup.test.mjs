/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const greeting = 'Hi — how can I help you today?';
const mocks = {
  'electron-xpc/preload': 'export class XpcPreloadHandler {}',
  './sqliteManager': 'export const sqliteManager = { get db() { return globalThis.__sessionTitleDb } };',
  inversify: `
    export const injectable = () => (target) => target;
    export const inject = () => () => undefined;
  `,
  'gpt-tokenizer': 'export const countTokens = (text) => Math.ceil(text.length / 4);',
  '@maestro-shared/iocHelper/ioc.helper': `
    export class CommonService { setState(state) { this._state = state; } }
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
      export { TurnService as ActualTurnService } from './src/renderer/maestro/control/src/store/turn.service.ts';
      export { MaestroChatDao } from './src/preload/maestro/sqlite/maestroChat.dao.ts';
      export { createMaestroSqliteSchema } from './src/preload/maestro/sqlite/maestroSqlite.release.ts';
      export { reactive, ref, isReactive, toRaw } from 'vue';
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
const { MessageStoreState, TurnService, ActualTurnService, MaestroChatDao, createMaestroSqliteSchema, reactive, ref, isReactive, toRaw } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
after(() => {
  delete globalThis.__maestroComposerFixture;
  delete globalThis.__sessionTitleDb;
});

const createHarness = (useActualTurnService = false) => {
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
      generateSessionTitle: async () => ({ ok: false }),
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
  const turnService = useActualTurnService ? new ActualTurnService() : new TurnService();
  const store = reactive(new MessageStoreState(turnService));
  return { store, fixture, turnService };
};
const options = { title: 'Maestro', intent: 'chat', operationTabId: 'operation-tab' };
const ordinaryChat = { title: 'New chat', intent: 'chat', autoTitlePending: true };
const sendHarness = () => {
  const h = createHarness(true);
  h.fixture.routes.CoachXpcHandler.claimAgentTurn = async params => ({ ok: true, turn: { ...params, generation: 1 } });
  h.fixture.routes.CoachXpcHandler.sendAgentMessage = async ({ sessionId }) => {
    const reply = { ok: true, text: 'Fixture reply', ts: 2 };
    const session = h.store.getSession(sessionId);
    // Main broadcasts completion before returning its final reply. Exercise that real lifecycle.
    await h.turnService.finishFromMain(session, session.turn.id, reply, 'completed');
    return reply;
  };
  h.fixture.routes.CoachXpcHandler.abortAgent = async () => ({ ok: true });
  h.store.compactSessionIfNeeded = async () => false;
  return h;
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const titleCalls = fixture => fixture.calls.filter(call => call.method === 'generateSessionTitle');
const message = (id, role, content = greeting, ts = 1000) => ({
  id,
  source: 'cowork',
  role,
  type: 'text',
  content,
  streaming: false,
  ts
});

test('new chat derives its title once from the first actual user text, including literal defaults and first-line truncation', async () => {
  for (const first of ['New chat', 'Maestro', 'First line\nSecond line', 'A'.repeat(40)]) {
    const { store, fixture } = sendHarness();
    const session = store.createSession(ordinaryChat);
    assert.equal(session.title, 'New chat');
    store.pushLocalNote(session.id, '/fixture/local-command-result');
    assert.equal((await store.send(session.id, ' \n ')).reason, 'not-sendable');
    assert.equal(session.detail.autoTitlePending, true);
    session.messages.push(
      message('welcome-human', 'human', 'Welcome should not count'),
      { ...message('local-human', 'human', 'Local-only should not count'), localOnly: true },
      { ...message('excluded-human', 'human', 'Excluded should not count'), promptExcluded: true },
      { ...message('file-human', 'human', 'File should not count'), type: 'files' }
    );
    const result = await store.send(session.id, first);
    assert.equal(result.ok, true, result.error);
    const expected = first.startsWith('AAAA') ? 'A'.repeat(36) + '…' : first.split('\n')[0];
    assert.equal(session.title, expected);
    assert.equal(session.detail.autoTitlePending, undefined);
    assert.equal(fixture.saved.at(-1).title, expected);
    assert.equal(fixture.saved.at(-1).detail.autoTitlePending, undefined);
    assert.equal((await store.send(session.id, 'Second request must not rename')).ok, true);
    assert.equal(session.title, expected);
  }
});

test('manual titles consume first-message eligibility without changing the title, and rename undo does not revive it', async () => {
  const { store } = sendHarness();
  const session = store.createSession(ordinaryChat);
  assert.equal(await store.renameSession(session.id, 'Pinned name'), true);
  assert.equal(session.detail.autoTitlePending, true);
  assert.equal((await store.send(session.id, 'First real request')).ok, true);
  assert.equal(session.title, 'Pinned name');
  assert.equal(session.detail.autoTitlePending, undefined);
  assert.equal(await store.renameSession(session.id, 'New chat', false), true);
  assert.equal(session.detail.titleCustomized, undefined);
  assert.equal((await store.send(session.id, 'Second request')).ok, true);
  assert.equal(session.title, 'New chat');
  const untouched = store.createSession(ordinaryChat);
  await store.renameSession(untouched.id, 'Temporary');
  await store.renameSession(untouched.id, 'New chat', false);
  assert.equal((await store.send(untouched.id, 'First after undo')).ok, true);
  assert.equal(untouched.title, 'First after undo');
});

test('explicit Coaches and legacy titles do not acquire automatic-title eligibility', async () => {
  const { store } = sendHarness();
  for (const title of ['Coaches', 'Maestro', 'Existing named chat']) {
    const session = store.createSession({ title, intent: 'chat' });
    assert.equal((await store.send(session.id, 'A first request')).ok, true);
    assert.equal(session.title, title);
    assert.equal(session.detail.autoTitlePending, undefined);
  }
});

test('title eligibility and undo metadata round-trip through actual serialization, DAO normalization and restored sessions', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); delete globalThis.__sessionTitleDb; });
  const adapter = {
    exec: sql => db.exec(sql), prepare: sql => db.prepare(sql),
    transaction: fn => (...args) => {
      db.exec('BEGIN');
      try { const result = fn(...args); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  createMaestroSqliteSchema(adapter);
  globalThis.__sessionTitleDb = adapter;
  const dao = new MaestroChatDao();
  const { store, fixture } = sendHarness();
  fixture.routes.MaestroChatDao.saveSession = args => dao.saveSession(args);
  fixture.routes.MaestroChatDao.getSession = args => dao.getSession(args);
  const session = store.createSession(ordinaryChat);
  session.detail.draft = { text: 'Unsent first message', files: [] };
  assert.equal(await store.persistSession(session), true);
  store.sessions = [];
  const restored = await store.loadPersistedSession(session.id);
  assert.equal(restored.title, 'New chat');
  assert.equal(restored.detail.autoTitlePending, true);
  await store.renameSession(restored.id, 'Hand edited');
  assert.equal((await dao.getSession({ id: restored.id })).detail.titleCustomized, true);
  await store.renameSession(restored.id, 'New chat', false);
  assert.equal((await dao.getSession({ id: restored.id })).detail.titleCustomized, undefined);
  assert.equal((await store.send(restored.id, 'New chat')).ok, true);
  store.sessions = [];
  const consumed = await store.loadPersistedSession(restored.id);
  assert.equal(consumed.detail.autoTitlePending, undefined);
  assert.equal(consumed.detail.titleRevision, 2);
  assert.equal(consumed.detail.titleGeneration.expectedRevision, 2);
  assert.deepEqual(consumed.detail.titleGeneration, (await dao.getSession({ id: consumed.id })).detail.titleGeneration);
  const requestsBeforeReloadSend = titleCalls(fixture).length;
  assert.equal((await store.send(consumed.id, 'Second after reload')).ok, true);
  assert.equal(consumed.title, 'New chat');
  assert.equal((await dao.getSession({ id: consumed.id })).title, 'New chat');
  await flush();
  assert.equal(titleCalls(fixture).length, requestsBeforeReloadSend, 'restored attempt is never resumed or retried');
});

test('first send persists its one title attempt before requesting and does not await the title model', async () => {
  const { store, fixture } = sendHarness();
  const saving = deferred(), generated = deferred();
  let first = true;
  fixture.routes.MaestroChatDao.saveSession = async ({ session }) => {
    fixture.saved.push(structuredClone(session));
    if (first) { first = false; return saving.promise; }
    return { ok: true };
  };
  fixture.routes.CoachXpcHandler.generateSessionTitle = () => generated.promise;
  const session = store.createSession(ordinaryChat);
  const sending = store.send(session.id, 'First fallback\nAdditional request detail');
  await flush();
  assert.equal(titleCalls(fixture).length, 0, 'no model request until the initial save succeeds');
  assert.ok(fixture.calls.some(call => call.method === 'sendAgentMessage'), 'main turn starts despite the pending metadata save');
  assert.equal(fixture.saved[0].title, 'First fallback');
  assert.equal(fixture.saved[0].detail.autoTitlePending, undefined);
  assert.equal(fixture.saved[0].detail.titleGeneration.firstMessageId, session.messages.find(m => m.role === 'human').id);
  saving.resolve({ ok: true });
  assert.equal((await sending).ok, true, 'main send finishes while title model remains unresolved');
  await flush();
  assert.equal(titleCalls(fixture).length, 1);
  assert.equal(titleCalls(fixture)[0].params.text, 'First fallback\nAdditional request detail');
  assert.equal(titleCalls(fixture)[0].params.sessionId, session.id);
  const before = { updatedAt: session.updatedAt, unread: [...store.unreadSessionIds], active: store.activeSessionId };
  generated.resolve({ ok: true, title: 'Generated topic' });
  await flush();
  assert.equal(session.title, 'Generated topic');
  assert.deepEqual({ updatedAt: session.updatedAt, unread: [...store.unreadSessionIds], active: store.activeSessionId }, before);
  assert.equal(session.detail.titleCustomized, undefined);
  assert.equal(session.detail.titleRevision, undefined);
  assert.equal(fixture.saved.at(-1).title, 'Generated topic');
  assert.equal((await store.send(session.id, 'Second text')).ok, true);
  await flush();
  assert.equal(titleCalls(fixture).length, 1);
});

test('failed first save and failed title requests retain fallback with no automatic retry', async () => {
  const { store, fixture } = sendHarness();
  let first = true;
  fixture.routes.MaestroChatDao.saveSession = async ({ session }) => {
    fixture.saved.push(structuredClone(session));
    if (first) { first = false; return { ok: false }; }
    return { ok: true };
  };
  const session = store.createSession(ordinaryChat);
  await store.send(session.id, 'Save failure fallback');
  await flush();
  assert.equal(titleCalls(fixture).length, 0);
  assert.equal(session.title, 'Save failure fallback');
  assert.ok(session.detail.titleGeneration);
  await store.send(session.id, 'A later successful save');
  await flush();
  assert.equal(titleCalls(fixture).length, 0);
  const failedModel = store.createSession(ordinaryChat);
  fixture.routes.CoachXpcHandler.generateSessionTitle = async () => { throw new Error('synthetic unavailable'); };
  await store.send(failedModel.id, 'Model failure fallback');
  await flush();
  assert.equal(failedModel.title, 'Model failure fallback');
  await store.send(failedModel.id, 'No retry');
  await flush();
  assert.equal(titleCalls(fixture).length, 1);
});

test('late title results cannot override rename undo, editor, archive, deletion or a changed request', async () => {
  for (const change of ['rename-undo', 'editing', 'archive', 'removed', 'token', 'first-message', 'revision']) {
    const { store, fixture } = sendHarness();
    const generated = deferred();
    fixture.routes.CoachXpcHandler.generateSessionTitle = () => generated.promise;
    const session = store.createSession(ordinaryChat);
    await store.send(session.id, 'Fallback');
    await flush();
    assert.equal(titleCalls(fixture).length, 1);
    if (change === 'rename-undo') {
      assert.equal(await store.renameSession(session.id, 'Manual'), true);
      assert.equal(await store.renameSession(session.id, 'Fallback', false), true);
      assert.equal(session.detail.titleCustomized, undefined);
      assert.equal(session.detail.titleRevision, 2, 'undo increments rather than rolling revision back');
    } else if (change === 'editing') store.editingTitleSessionId = session.id;
    else if (change === 'archive') assert.equal(await store.archive(session.id), true);
    else if (change === 'removed') store.sessions = [];
    else if (change === 'token') session.detail.titleGeneration.requestId = 'newer-attempt';
    else if (change === 'first-message') session.detail.titleGeneration.firstMessageId = 'other-human';
    else session.detail.titleRevision = 1;
    const saves = fixture.saved.length;
    generated.resolve({ ok: true, title: 'Obsolete result' });
    await flush();
    assert.equal(session.title, 'Fallback', change);
    assert.equal(fixture.saved.length, saves, change);
    if (change === 'editing') {
      store.editingTitleSessionId = '';
      await flush();
      assert.equal(session.title, 'Fallback', 'ending editing does not replay a discarded result');
    }
  }
});

test('title application rechecks a queued archive and save failures roll back only generated metadata', async () => {
  const { store, fixture } = sendHarness();
  const generated = deferred();
  fixture.routes.CoachXpcHandler.generateSessionTitle = () => generated.promise;
  const session = store.createSession(ordinaryChat);
  await store.send(session.id, 'Fallback');
  await flush();
  const saving = deferred();
  fixture.routes.MaestroChatDao.saveSession = () => saving.promise;
  const blocked = store.persistSession(session);
  await flush();
  const archived = store.archive(session.id);
  await flush();
  generated.resolve({ ok: true, title: 'Queued obsolete result' });
  await flush();
  fixture.routes.MaestroChatDao.saveSession = async () => ({ ok: true });
  saving.resolve({ ok: true });
  await blocked;
  assert.equal(await archived, true);
  await flush();
  assert.equal(session.title, 'Fallback');

  const second = store.createSession(ordinaryChat), failed = deferred();
  fixture.routes.CoachXpcHandler.generateSessionTitle = () => failed.promise;
  await store.send(second.id, 'Second fallback');
  await flush();
  const before = second.updatedAt;
  fixture.routes.MaestroChatDao.saveSession = async () => ({ ok: false });
  failed.resolve({ ok: true, title: 'Cannot save this' });
  await flush();
  assert.equal(second.title, 'Second fallback');
  assert.equal(second.updatedAt, before);
  assert.equal(await store.renameSession(second.id, 'Failed manual'), false);
  assert.equal(second.detail.titleRevision, undefined, 'failed manual save rolls revision back');
  assert.equal(second.detail.titleCustomized, undefined);
});

test('independent title results update their originating sessions without selecting them', async () => {
  const { store, fixture } = sendHarness();
  const pending = new Map();
  fixture.routes.CoachXpcHandler.generateSessionTitle = ({ sessionId }) => {
    const result = deferred(); pending.set(sessionId, result); return result.promise;
  };
  const a = store.createSession(ordinaryChat), b = store.createSession(ordinaryChat);
  await store.send(a.id, 'Topic a');
  await store.send(b.id, 'Topic b');
  await flush();
  store.activeSessionId = b.id;
  pending.get(b.id).resolve({ ok: true, title: 'Generated b' });
  pending.get(a.id).resolve({ ok: true, title: 'Generated a' });
  await flush();
  assert.equal(a.title, 'Generated a');
  assert.equal(b.title, 'Generated b');
  assert.equal(store.activeSessionId, b.id);
});

test('steering reaches the reserved inbox during root preparation and preserves root-first title and message IDs', async () => {
  const { store, fixture, turnService } = sendHarness();
  const workspace = deferred(), delivered = deferred(), rootDone = deferred();
  store.refreshWorkspace = () => workspace.promise;
  fixture.routes.CoachXpcHandler.sendAgentMessage = async params => {
    if (params.intent === 'steering') return delivered.promise;
    await rootDone.promise;
    const session = store.getSession(params.sessionId);
    const reply = { ok: true, text: 'Both requests completed', ts: 2 };
    await turnService.finishFromMain(session, params.turnId, reply, 'completed');
    return reply;
  };
  const session = store.createSession(ordinaryChat);
  const first = store.send(session.id, 'Hangzhou weather');
  await flush();
  const rootId = session.messages.find(m => m.role === 'human').id;
  const second = store.send(session.id, 'Also Hong Kong weather');
  await flush();
  const secondMessage = session.messages.find(m => m.content === 'Also Hong Kong weather');
  const sends = fixture.calls.filter(c => c.method === 'sendAgentMessage');
  assert.deepEqual(sends.map(c => c.params.intent), ['steering'], 'steering does not wait for root workspace/media setup');
  assert.equal(sends[0].params.messageId, secondMessage.id);
  assert.equal(sends[0].params.turnId, session.turn.id);
  assert.deepEqual(session.messages.filter(m => m.role === 'human').map(m => m.id), [rootId, secondMessage.id]);
  assert.equal(secondMessage.promptExcluded, true, 'queued is not yet confirmed as model context');
  assert.equal(session.turn.steering.pending, true);
  assert.equal(session.title, 'Hangzhou weather');
  assert.equal(titleCalls(fixture).length, 1);
  workspace.resolve();
  await flush();
  delivered.resolve({ ok: true, text: '', ts: 2, mergedIntoTurn: true });
  assert.equal((await second).mergedIntoTurn, true);
  assert.equal(secondMessage.promptExcluded, undefined);
  rootDone.resolve();
  assert.equal((await first).ok, true);
  assert.equal(titleCalls(fixture).length, 1);
});

test('two late steering messages continue once in order, reusing their IDs and original snapshots without renaming', async t => {
  const { store, fixture, turnService } = sendHarness();
  const oldDone = deferred(), handoff = deferred(), nextDone = deferred(), nextStarted = deferred();
  let oldTurnId, nextTurnId;
  const previousReply = { ok: true, text: 'Original completed', ts: 2 };
  const snapshot = { windowTabs: { activeTab: { id: 'page-original', title: 'Original page', url: 'https://example.com/original' }, openTabs: [] }, sentAt: 'original-time' };
  fixture.routes.CoachXpcHandler.sendAgentMessage = async params => {
    if (params.intent === 'root' && !oldTurnId) { oldTurnId = params.turnId; await oldDone.promise; return previousReply; }
    if (params.turnId === oldTurnId) { await handoff.promise; return { ok: false, text: '', ts: 3, continueAsRoot: { turnId: oldTurnId, reply: previousReply, snapshot } }; }
    if (params.intent === 'root') {
      nextTurnId = params.turnId; nextStarted.resolve(); await nextDone.promise;
      const reply = { ok: true, text: 'All additional work completed', ts: 4 };
      await turnService.finishFromMain(store.getSession(params.sessionId), params.turnId, reply, 'completed');
      return reply;
    }
    await nextStarted.promise;
    assert.equal(params.turnId, nextTurnId);
    return { ok: true, text: '', ts: 3, mergedIntoTurn: true };
  };
  const selected = ref(store.createSession(ordinaryChat));
  const session = selected.value;
  assert.equal(isReactive(session), true);
  const original = store.send(session.id, 'Original topic');
  await flush();
  const second = store.send(session.id, 'Second request');
  const third = store.send(session.id, 'Third request');
  t.after(async () => { handoff.resolve(); oldDone.resolve(); nextDone.resolve(); await Promise.allSettled([original, second, third]); });
  await flush();
  const ids = session.messages.filter(m => m.role === 'human').map(m => m.id);
  handoff.resolve(); oldDone.resolve();
  await nextStarted.promise;
  await flush();
  const sends = fixture.calls.filter(c => c.method === 'sendAgentMessage').map(c => c.params);
  assert.equal(sends.filter(p => p.intent === 'root').length, 2, 'only one successor is claimed');
  assert.equal(sends.find(p => p.turnId === nextTurnId && p.intent === 'root').messageId, ids[1]);
  assert.equal(sends.find(p => p.turnId === nextTurnId && p.intent === 'steering').messageId, ids[2]);
  assert.deepEqual(sends.filter(p => p.turnId === nextTurnId).map(p => p.snapshot), [snapshot, snapshot]);
  assert.equal(fixture.calls.filter(c => c.method === 'claimAgentTurn').length, 2);
  nextDone.resolve();
  const results = await Promise.all([original, second, third]);
  assert.ok(results.every(r => r.ok));
  assert.deepEqual(session.messages.filter(m => m.role === 'human').map(m => m.id), ids);
  assert.ok(session.messages.filter(m => m.role === 'human').every(m => !m.promptExcluded));
  assert.equal(session.messages.filter(m => m.content === 'Original completed').length, 1);
  assert.equal(session.messages.filter(m => m.content === 'All additional work completed').length, 1);
  assert.equal(session.title, 'Original topic');
  assert.equal(titleCalls(fixture).length, 1);
});

test('a stopped queued message is excluded and saved with its actual failure rather than automatically retried', async () => {
  const { store, fixture } = sendHarness();
  const root = deferred(), delivery = deferred();
  fixture.routes.CoachXpcHandler.sendAgentMessage = params => params.intent === 'root' ? root.promise : delivery.promise;
  const session = store.createSession(ordinaryChat);
  const first = store.send(session.id, 'First task');
  await flush();
  const second = store.send(session.id, 'Queued task');
  await flush();
  delivery.resolve({ ok: false, text: 'Stopped before this message was delivered.', error: 'steer-failed', ts: 2 });
  assert.equal((await second).ok, false);
  const queued = session.messages.find(m => m.content === 'Queued task');
  assert.equal(queued.promptExcluded, true);
  assert.ok(session.messages.some(m => m.error && m.content.includes('Stopped before this message was delivered.')));
  assert.ok(session.messages.every(m => !m.content.includes('provider may not support')));
  assert.equal(fixture.calls.filter(c => c.method === 'claimAgentTurn').length, 1);
  root.resolve({ ok: false, text: 'Stopped.', error: 'aborted', ts: 2 });
  await first; await flush();
  assert.equal(fixture.saved.at(-1).messages.find(m => m.id === queued.id).promptExcluded, true);
});

test('local path notices stay out of subsequent saves and prompt context while other excluded records persist', async () => {
  const { store, fixture } = createHarness();
  const session = store.createSession(options);
  session.messages.push(message('human', 'human', 'Real user text'));
  session.messages.push({ ...message('error', 'ai', 'Visible failure'), type: 'error', promptExcluded: true });
  session.messages.push({ ...message('compact', 'ai', 'Summary record'), type: 'compact', promptExcluded: true, compactSummary: 'Saved summary' });
  const updatedAt = session.updatedAt;
  const writesBefore = fixture.saved.length;
  store.pushLocalNote(session.id, '/fixture/agent-io/local-path');
  const note = session.messages.at(-1);
  assert.equal(note.localOnly, true);
  assert.equal(note.promptExcluded, true);
  assert.equal(note.tokenCount, 0);
  assert.equal(session.updatedAt, updatedAt);
  assert.equal(fixture.saved.length, writesBefore);
  const context = store.buildAgentContext(session);
  assert.deepEqual(context.recentMessages.map(item => item.content), ['Real user text']);
  assert.equal(await store.persistSession(session), true);
  assert.equal(fixture.saved.length, writesBefore + 1);
  assert.deepEqual(fixture.saved.at(-1).messages.map(item => item.id), ['human', 'error', 'compact']);
  assert.ok(fixture.saved.at(-1).messages.find(item => item.id === 'error').promptExcluded);
  assert.equal(fixture.saved.at(-1).messages.find(item => item.id === 'compact').compactSummary, 'Saved summary');
  assert.ok(session.messages.some(item => item.id === note.id), 'the current renderer retains its local notice');
});

test('a local notice preserves the real streaming sink, buffered text and later deltas without an extra save', () => {
  const { store, fixture, turnService } = createHarness(true);
  store.scheduleStreamFlush = () => {};
  store.scheduleScrollToBottomIfNear = () => {};
  store.scrollToBottom = () => {};
  const session = store.createSession(options);
  session.turn = {
    id: 'turn-local', generation: 1, phase: 'accepted', rootText: 'stream please',
    sealedAssistantSegments: 0, activity: [], thinking: false, startedAt: 1, lastActivityAt: 1
  };
  const payload = { sessionId: session.id, turnId: session.turn.id, generation: 1 };
  turnService.pushStream({ ...payload, delta: 'Before ' });
  store.flushStreamBuffer(session.id);
  const sink = turnService.sink(session);
  turnService.pushStream({ ...payload, delta: 'buffered ' });
  const updatedAt = session.updatedAt;
  const writesBefore = fixture.saved.length;
  store.pushLocalNote(session.id, '/fixture/agent-io/while-streaming');
  assert.equal(session.turn.assistantMessageId, sink.id);
  assert.equal(session.turn.sealedAssistantSegments, 0);
  assert.equal(sink.streaming, true);
  assert.equal(sink.content, 'Before ', 'the local notice does not flush or seal the sink');
  assert.equal(session.updatedAt, updatedAt);
  turnService.pushStream({ ...payload, delta: 'after' });
  store.flushStreamBuffer(session.id);
  assert.equal(turnService.sink(session).id, sink.id);
  assert.equal(sink.content, 'Before buffered after');
  assert.equal(sink.streaming, true);
  assert.equal(session.messages.filter(item => item.streaming).length, 1);
  assert.equal(fixture.saved.length, writesBefore);
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

const restoredReactiveSession = async (store, fixture, id) => {
  fixture.persisted.set(id, storedSession(id, [
    message('retained-human', 'human', 'Earlier request', 1000),
    message('retained-answer', 'ai', 'Earlier reply', 1100)
  ]));
  const selected = ref(await store.loadPersistedSession(id));
  assert.equal(isReactive(store), true);
  assert.equal(isReactive(selected.value), true);
  assert.equal(selected.value, store.getSession(id));
  return selected;
};

test('reactive restored history sends hi once and final RPC reply releases its proxied Turn without a completion broadcast', async () => {
  const { store, fixture } = sendHarness();
  const selected = await restoredReactiveSession(store, fixture, 'reactive-direct-reply');
  const session = selected.value;
  fixture.routes.CoachXpcHandler.sendAgentMessage = async () => ({ ok: true, text: 'Reply to hi', ts: 2 });
  const sending = store.send(session.id, 'hi');
  assert.notEqual(session.turn, toRaw(session.turn), 'Vue wraps the raw Turn assigned by send');
  const reply = await sending;
  assert.equal(reply.ok, true);
  const dispatches = fixture.calls.filter(call => call.method === 'sendAgentMessage');
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].params.intent, 'root');
  assert.equal(dispatches[0].params.message, 'hi');
  assert.equal(session.messages.filter(item => item.role === 'human' && item.content === 'hi').length, 1);
  assert.equal(session.messages.filter(item => item.role === 'ai' && item.content === 'Reply to hi').length, 1);
  assert.equal(session.turn, undefined);
  assert.deepEqual(session.messages.slice(0, 2).map(item => item.id), ['retained-human', 'retained-answer']);
});

test('reactive restored preparation cannot dispatch after Stop even while its abort IPC remains pending', async t => {
  const { store, fixture } = sendHarness();
  const selected = await restoredReactiveSession(store, fixture, 'reactive-stop-preparing');
  const session = selected.value, workspace = deferred(), aborting = deferred();
  store.refreshWorkspace = () => workspace.promise;
  fixture.routes.CoachXpcHandler.abortAgent = () => aborting.promise;
  fixture.routes.CoachXpcHandler.sendAgentMessage = async () => ({ ok: true, text: 'Must not dispatch after Stop', ts: 2 });
  const sending = store.send(session.id, 'hi');
  await flush();
  const turnId = session.turn.id;
  const stopping = store.stop(session.id);
  t.after(async () => {
    workspace.resolve(); aborting.resolve({ ok: true });
    await Promise.allSettled([sending, stopping]);
  });
  assert.equal(session.turn.aborting, true);
  workspace.resolve();
  await flush();
  assert.equal(fixture.calls.filter(call => call.method === 'sendAgentMessage').length, 0, 'Stop admission takes effect before the abort IPC resolves');
  assert.ok(fixture.calls.filter(call => call.method === 'abortAgent').every(call => call.params.turnId === turnId));
  aborting.resolve({ ok: true });
  await stopping;
  assert.deepEqual(await sending, { ok: false, reason: 'not-sendable' });
  assert.equal(session.turn, undefined);
  assert.equal(session.messages.some(item => item.content === 'Must not dispatch after Stop'), false);
});

test('reactive restored preparation ignores stale callbacks after another Turn takes ownership', async () => {
  const { store, fixture, turnService } = sendHarness();
  const selected = await restoredReactiveSession(store, fixture, 'reactive-replaced-preparing');
  const session = selected.value, workspace = deferred();
  store.refreshWorkspace = () => workspace.promise;
  fixture.routes.CoachXpcHandler.sendAgentMessage = async () => ({ ok: true, text: 'Stale reply', ts: 2 });
  const sending = store.send(session.id, 'hi');
  await flush();
  const oldTurnId = session.turn.id;
  const newer = {
    ...toRaw(session.turn), id: 'new-owner', generation: 2, rootText: 'New request',
    rootHumanMessageId: 'new-human', assistantMessageId: 'new-assistant', activity: []
  };
  session.turn = newer;
  session.messages.push(message('new-human', 'human', 'New request'), { ...message('new-assistant', 'ai', 'New partial reply'), streaming: true });
  store.activeAgentTurnSnapshots = [{ sessionId: session.id, turnId: newer.id, generation: 2, state: 'running' }];
  workspace.resolve();
  assert.deepEqual(await sending, { ok: false, reason: 'not-sendable' });
  await turnService.finishFromMain(session, oldTurnId, { ok: true, text: 'Stale completion', ts: 3 }, 'completed');
  assert.equal(toRaw(session.turn), newer);
  assert.equal(session.messages.find(item => item.id === 'new-assistant').content, 'New partial reply');
  assert.equal(session.messages.find(item => item.id === 'new-assistant').streaming, true);
  assert.equal(store.activeAgentTurnSnapshots[0].turnId, newer.id);
  assert.equal(fixture.calls.filter(call => call.method === 'sendAgentMessage').length, 0);
  assert.ok(fixture.calls.filter(call => call.method === 'abortAgent').every(call => call.params.turnId === oldTurnId));
  assert.equal(session.messages.some(item => item.content === 'Stale reply' || item.content === 'Stale completion'), false);
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
