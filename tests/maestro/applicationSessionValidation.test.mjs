import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import * as authSession from '../../src/renderer/home/src/stores/auth/authSession.service.ts';
import * as contract from '../../src/shared/home/homeShellBridge.contract.ts';

const root = resolve(import.meta.dirname, '../..');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const load = (file, imports = {}, globals = {}) => {
  const code = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
};
const customer = { id: 1, email: 'person@example.invalid', scope: 'customer', status: 'active', has_password: true, must_set_password: false };
const fixture = () => {
  const saved = new Map();
  const localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const vue = { reactive: value => value, markRaw: value => value, ref: value => ({ value }), readonly: value => value };
  const tokens = load('src/renderer/home/src/stores/auth/authToken.service.ts', { vue }, { localStorage });
  const calls = [];
  let me = async () => ({ ...customer });
  const api = { meApi: (...args) => me(...args), getCoreBaseUrl: () => 'https://example.invalid' };
  const authEmitter = new Proxy({}, { get: (_target, key) => async (...args) => { calls.push([key, ...args]); } });
  const imports = {
    vue, '@arco-design/web-vue': { Message: { error() {} } }, '@/emitter/auth.emitter': { authEmitter },
    '@/contextBridge/homeEnv.bridge': { homeEnv: {} }, '@/stores/auth/authSession.service': authSession,
    '@/stores/auth/authToken.service': tokens, '@/stores/auth/todoistSyncSession.emitter': { todoistSyncSessionEmitter: {} },
    '@/stores/auth/todoistSyncActivation.service': { TodoistSyncActivationService: class { invalidate() {} } },
    '@/contextBridge/snipingSession.bridge': { snipingSessionBridge: {} },
    '@/stores/auth/snipingSessionActivation.service': { SnipingSessionActivationService: class { async clear() {} } },
    '@/networking/auth.api': api
  };
  const exported = load('src/renderer/home/src/stores/auth/auth.store.ts', imports, { localStorage });
  const store = exported.authStore;
  const replace = token => { tokens.setCustomerToken(token); store.current = { ...customer }; };
  replace('first-session-token');
  return { store, tokens, calls, localStorage, exported, replace, setMe: value => { me = value; } };
};
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

test('quiet authority checks deduplicate and leave checking/loading/credentials intact', async () => {
  const f = fixture();
  const response = deferred();
  let reads = 0;
  f.setMe(() => { reads++; return response.promise; });
  const first = f.store.validateSession();
  const second = f.store.validateSession();
  assert.equal(first, second);
  assert.equal(reads, 1);
  assert.equal(f.store.checking, false);
  assert.equal(f.store.loading, false);
  response.resolve({ ...customer, nickname: 'updated' });
  await first;
  assert.equal(f.store.current.nickname, 'updated');
  assert.equal(f.store.checking, false);
  assert.equal(f.store.token, 'first-session-token');
  assert.deepEqual(f.calls, []);
});

test('current 401 or disabled customer clears the account and stops protected work; outages retain it', async () => {
  for (const error of [new authSession.AuthHttpError(401, 'invalid'), new authSession.SessionEligibilityError('inactive'), new authSession.AuthHttpError(503, 'unavailable'), new authSession.AuthRequestTimeoutError(), new TypeError('network')]) {
    const f = fixture();
    f.setMe(async () => { throw error; });
    await assert.rejects(f.store.validateSession(), value => value === error);
    await flush();
    const invalid = authSession.shouldInvalidateCustomerSession(error);
    assert.equal(f.store.isAuthenticated(), !invalid);
    assert.equal(f.store.current === null, invalid);
    assert.equal(f.calls.some(([name]) => name === 'deactivateSession'), invalid);
  }
});

test('late success and rejection cannot restore logout or clear a replacement, including the same token reused', async () => {
  for (const result of ['success', '401']) {
    for (const replacement of [false, true]) {
      const f = fixture();
      const response = deferred();
      f.setMe(() => response.promise);
      const checking = f.store.validateSession();
      f.store.clearLocalSession();
      if (replacement) f.replace('first-session-token');
      if (result === 'success') response.resolve(customer);
      else response.reject(new authSession.AuthHttpError(401, 'old session rejected'));
      await assert.rejects(checking);
      assert.equal(f.store.isAuthenticated(), replacement);
      assert.equal(f.store.current !== null, replacement);
    }
  }
});

test('password-setup response removes chat eligibility without treating it as a transport outage', async () => {
  const f = fixture();
  f.setMe(async () => ({ ...customer, must_set_password: true }));
  await assert.rejects(f.store.validateSession(), /password setup/);
  assert.equal(f.store.current.must_set_password, true);
  assert.equal(f.store.isAuthenticated(), true);
});

test('hidden Home checks authenticated sessions every 60 seconds, updates login route, and releases timer', async () => {
  const f = fixture();
  const watches = [], timers = new Map(), lifecycle = new Map(), broadcasts = [], routes = [];
  let nextTimer = 1;
  const watch = (get, run, options) => {
    const entry = { get, run, previous: get(), stopped: false };
    watches.push(entry);
    if (options.immediate) run(entry.previous);
    return () => { entry.stopped = true; };
  };
  const runWatches = () => {
    for (const item of watches) {
      if (item.stopped) continue;
      const value = item.get();
      if (JSON.stringify(value) !== JSON.stringify(item.previous)) { item.previous = value; item.run(value); }
    }
  };
  const router = { currentRoute: { value: { name: 'chat' } }, replace: async ({ name }) => { routes.push(name); router.currentRoute.value.name = name; } };
  const handler = load('src/renderer/home/src/xpc/homeShellBridge.handler.ts', {
    vue: { watch }, 'electron-xpc/renderer': { XpcRendererHandler: class {}, xpcRenderer: { broadcast: (...args) => broadcasts.push(args) } },
    '@shared/home/homeShellBridge.contract': contract, '@/router': { default: router },
    '@/emitter/todoWindow.emitter': { todoWindowEmitter: {} }, '@/stores/auth/auth.store': f.exported,
    '@/stores/auth/authSession.service': authSession, '@/stores/auth/authSessionRecovery.service': {}, '@/stores/auth/authToken.service': f.tokens
  }, { localStorage: f.localStorage, window: { addEventListener: (name, fn) => lifecycle.set(name, fn) },
    setInterval: (fn, ms) => { assert.equal(ms, 60_000); const id = nextTimer++; timers.set(id, fn); return id; },
    clearInterval: id => timers.delete(id) });
  handler.initHomeShellBridge();
  assert.equal(timers.size, 1);
  timers.values().next().value();
  await flush();
  runWatches();
  assert.deepEqual(routes, []);
  assert.equal(f.store.checking, false);
  assert.equal(broadcasts.every(([, snapshot]) => snapshot.phase === 'ready'), true);
  f.setMe(async () => { throw new authSession.AuthHttpError(401, 'expired'); });
  timers.values().next().value();
  await flush();
  runWatches();
  assert.deepEqual(routes, ['login']);
  assert.equal(timers.size, 0);
  assert.equal(broadcasts.at(-1)[1].phase, 'signed-out');
  f.replace('replacement-token');
  runWatches();
  assert.equal(timers.size, 1);
  lifecycle.get('beforeunload')();
  assert.equal(timers.size, 0);
});

test('runtime rejection revalidates only the captured current account', async () => {
  let validations = 0;
  const main = load('src/main/auth/customerSession.service.ts', {
    './applicationAuth.service': { applicationAuth: { requireReady: async () => { validations++; } } }
  });
  const original = { sessionId: 'a', token: 'token-a', baseUrl: 'https://example.invalid' };
  main.customerSessionService.set(original);
  await main.revalidateRejectedCustomerSession(original);
  assert.equal(validations, 1);
  main.customerSessionService.set({ ...original, sessionId: 'b', token: 'token-b' });
  await main.revalidateRejectedCustomerSession(original);
  assert.equal(validations, 1);
  assert.equal(main.customerSessionService.current.sessionId, 'b');
});

test('stale Main invalidation and deferred logout cannot clear a newer Core session', async () => {
  const path = 'src/main/xpc/auth.handler.ts';
  const source = readFileSync(resolve(root, path), 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const cls = file.statements.find(ts.isClassDeclaration);
  const members = cls.members.filter(member => ts.isMethodDeclaration(member) && ['invalidateSession', 'deactivateSession', 'clearCustomerSession'].includes(member.name.getText(file)));
  let session = { sessionId: 'b' }, clears = 0, invalidations = 0, shutdowns = 0;
  const code = ts.transpileModule(`class Subject { ${members.map(member => member.getText(file)).join('\n')} }; return Subject;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const subject = new (new Function('customerSessionService', 'applicationAuth', 'maestroWindowHelper', 'coinWindowHandler', 'xpcMain', 'console', code)(
    { get current() { return session; }, clear() { clears++; session = null; } },
    { invalidate() { invalidations++; } }, { prepareForAuthShutdown: async () => { shutdowns++; } },
    { lockForAuthInvalidation() {} }, { broadcast() {} }, { warn() {} }
  ))();
  subject._deactivateSession = async () => {};
  await subject.invalidateSession({ sessionId: 'a' });
  await subject.clearCustomerSession({ sessionId: 'a' });
  await subject.deactivateSession({ sessionId: 'a' });
  assert.equal(clears, 0);
  assert.equal(invalidations, 0);
  assert.equal(shutdowns, 0);
  await subject.invalidateSession({ sessionId: 'b' });
  assert.equal(clears, 1);
  assert.equal(invalidations, 1);
});

test('Pi provider failure invokes its account check hook while ordinary models have no account hook', () => {
  const { PiRuntimeSession } = load('src/main/agent/runtime/piRuntimeSession.ts', {
    './piRuntimeProtocol': { normalizePiEvent: event => [event] }, './runtimeSessionPolicy': { RUNTIME_SESSION_POLICY: {} },
    '../steering/steeringPolicy': {}, './piInterruptibleBash': {}, './runtimeSystemPrompt': {},
    './pruneToolOutputs': {}, './keepLatestSkillCatalog': {}
  });
  let providerChecks = 0;
  for (const hook of [undefined, () => { providerChecks++; }]) {
    let deliver;
    const native = { subscribe: fn => { deliver = fn; return () => {}; } };
    const runtime = new PiRuntimeSession(native, undefined, undefined, undefined, undefined, hook);
    const dispose = runtime.subscribe(() => {});
    deliver({ type: 'assistant_message_end', errorMessage: '401 session rejected' });
    dispose();
  }
  assert.equal(providerChecks, 1);
  const adapter = readFileSync(resolve(root, 'src/main/agent/runtime/piRuntimeAdapter.ts'), 'utf8');
  assert.match(adapter, /isBitterlessProvider\(options.target.providerId\) \? customerSessionService.current : null/);
});
