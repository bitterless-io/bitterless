/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from '@vue/compiler-sfc';
import less from 'less';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const mocks = {
  'electron-xpc/renderer': `export const xpcRenderer = { subscribe(channel, listener) { const f = globalThis.__controlLogin; f.bindings.push(channel); f.listeners.set(channel, listener); } }; export const createXpcRendererEmitter = handler => new Proxy({}, { get: (_, method) => params => globalThis.__controlLogin.call(handler, method, params) });`,
  inversify: `export const injectable = () => x => x; export const inject = () => () => {};`,
  'gpt-tokenizer': `export const countTokens = text => text.length;`,
  '@maestro-shared/iocHelper/ioc.helper': `export const iocHelper = { bind: ({controller, services}) => new controller(new services[0]()) };`,
  './turn.service': `export class TurnService { setState() {} }`
};
const bundled = await build({
  stdin: {
    contents: `export { MessageStoreState, messageStore } from './src/renderer/maestro/control/src/store/message.store';
    export { ChannelStoreState } from './src/renderer/maestro/control/src/store/channel.store';
    export { taskStore } from './src/renderer/maestro/control/src/store/task.store';
    export { workflowStore } from './src/renderer/maestro/control/src/store/workflow.store';
    export { ControlSubscriptionScope } from './src/renderer/maestro/control/src/controlSubscriptions.service';`,
    resolveDir: root
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'control-login-boundary',
      setup(ctx) {
        ctx.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined
        );
        ctx.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path] }));
      }
    }
  ]
});
const {
  MessageStoreState,
  messageStore,
  ChannelStoreState,
  taskStore,
  workflowStore,
  ControlSubscriptionScope
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const fixture = () => {
  const f = {
    bindings: [],
    listeners: new Map(),
    call: async (_handler, method) => {
      if (method === 'listSessions' || method === 'listTasks') return [];
      if (method === 'listRuns') return { revision: 1, runs: [] };
      return null;
    }
  };
  globalThis.__controlLogin = f;
  return f;
};

test('remounted Control listeners share one native subscription and disposed mounts receive nothing', () => {
  const f = fixture();
  const delivered = [];
  const old = new ControlSubscriptionScope();
  old.subscribe('control-login-fixture', () => delivered.push('old'));
  f.listeners.get('control-login-fixture')({});
  old.dispose();
  f.listeners.get('control-login-fixture')({});
  const current = new ControlSubscriptionScope();
  current.subscribe('control-login-fixture', () => delivered.push('current'));
  f.listeners.get('control-login-fixture')({});
  assert.deepEqual(f.bindings, ['control-login-fixture']);
  assert.deepEqual(delivered, ['old', 'current']);
  assert.equal(old.active, false);
  current.dispose();
});

test('logout invalidates old session/history reads and prevents queued old-account saves', async () => {
  const f = fixture();
  const history = deferred();
  const session = deferred();
  let saves = 0;
  f.call = async (_handler, method) => {
    if (method === 'listSessions') return history.promise;
    if (method === 'getSession') return session.promise;
    if (method === 'saveSession') {
      saves += 1;
      return { ok: true };
    }
    return null;
  };
  const store = new MessageStoreState({
    setState() {
      return undefined;
    }
  });
  const oldHistory = store.refreshHistory();
  const oldSession = store.loadPersistedSession('old');
  const old = store.createSession({ title: 'old account', intent: 'chat' });
  const saving = store.persistSession(old);
  store.reset();
  store.resume();
  history.resolve([{ id: 'old', title: 'old account' }]);
  session.resolve({ id: 'old', messages: [], detail: {}, title: 'old account' });
  await Promise.all([oldHistory, oldSession, saving]);
  assert.deepEqual(store.sessions, []);
  assert.deepEqual(store.historySessions, []);
  assert.equal(saves, 0);
});

test('logout during channel bootstrap cannot create or select an old-account chat', async () => {
  fixture();
  const ready = deferred();
  const originalInit = messageStore.init;
  const originalLatest = messageStore.latestActiveSession;
  let latestCalls = 0;
  messageStore.init = () => ready.promise;
  messageStore.latestActiveSession = async () => {
    latestCalls += 1;
    return undefined;
  };
  try {
    const channel = new ChannelStoreState();
    const loading = channel.init();
    channel.reset();
    messageStore.reset();
    ready.resolve();
    await loading;
    assert.equal(latestCalls, 0);
    assert.equal(channel.activeSessionId, '');
    assert.equal(channel.initialized, false);
  } finally {
    messageStore.init = originalInit;
    messageStore.latestActiveSession = originalLatest;
  }
});

test('task and workflow snapshots ignore suspended broadcasts and late results, then resume once', async () => {
  const f = fixture();
  const tasks = deferred();
  const workflows = deferred();
  f.call = (_handler, method) => (method === 'listTasks' ? tasks.promise : workflows.promise);
  const loadingTasks = taskStore.init();
  const loadingWorkflows = workflowStore.init();
  taskStore.reset();
  workflowStore.reset();
  f.listeners.get('coach/tasks')({ params: { tasks: [{ id: 'old' }] } });
  f.listeners.get('agent/workflows')({ params: { revision: 3, runs: [{ id: 'old' }] } });
  tasks.resolve([{ id: 'old' }]);
  workflows.resolve({ revision: 2, runs: [{ id: 'old' }] });
  await Promise.all([loadingTasks, loadingWorkflows]);
  assert.deepEqual(taskStore.tasks, []);
  assert.deepEqual(workflowStore.runs, []);
  f.call = async (_handler, method) =>
    method === 'listTasks' ? [] : { revision: 1, runs: [{ id: 'new' }] };
  workflowStore.resume();
  await Promise.all([taskStore.init(), workflowStore.init()]);
  assert.equal(workflowStore.runs[0].id, 'new');
  assert.deepEqual(f.bindings, ['coach/tasks', 'agent/workflows']);
  taskStore.reset();
  workflowStore.reset();
});

test('Control/Login/guide Vue and compact Less compile with closed protected content and usable chrome', async () => {
  for (const path of [
    'src/renderer/maestro/control/src/ControlAuthApp.vue',
    'src/renderer/maestro/control/src/ControlApp.vue',
    'src/renderer/home/src/views/login/Login.vue',
    'src/renderer/maestro/localHome/src/SignInGuide.vue'
  ]) {
    const { descriptor, errors } = parse(read(path), { filename: path });
    assert.deepEqual(errors, []);
    const compiled = compileScript(descriptor, { id: path, inlineTemplate: true });
    assert.ok(compiled.content.length > 0);
  }
  const shell = read('src/renderer/maestro/control/src/ControlAuthApp.vue');
  assert.match(shell, /defineAsyncComponent\(\(\) => import\('\.\/ControlApp.vue'\)\)/);
  assert.match(
    shell,
    /v-if="localHomeAuthStore.ready && !localHomeAuthStore.loggingOut"\s+:key="protectedGeneration"/
  );
  assert.match(shell, /protectedGeneration\.value \+= 1/);
  assert.match(shell, /snapshot\?\.authorityEpoch/);
  assert.match(shell, /snapshot\?\.email/);
  assert.match(shell, /name="control-auth__close"/);
  assert.match(shell, /@pointerdown="beginResize"/);
  assert.match(shell, /homeAuthorityUnavailable/);
  assert.match(shell, /<Login v-else :auth="localHomeAuthStore" compact/);
  assert.doesNotMatch(shell, /vue-router|LoginRendererHandler|WebContentsView/);
  const app = read('src/renderer/maestro/control/src/ControlApp.vue');
  assert.match(app, /flush: 'sync'/);
  assert.match(app, /epoch !== previousEpoch \|\| email !== previousEmail/);
  for (const store of [
    'channelStore',
    'messageStore',
    'taskStore',
    'sessionActions',
    'agentBrowserStore',
    'workflowStore'
  ])
    assert.match(app, new RegExp(`${store}\\.reset\\(\\)`));
  const { css } = await less.render(
    read('src/renderer/home/src/views/login/Login.less') +
      read('src/renderer/maestro/control/src/ControlAuthApp.less')
  );
  assert.match(css, /\.login-view--compact[^}]*background: transparent/);
  assert.match(css, /\.control-auth button:focus-visible/);
  const guide = read('src/renderer/maestro/localHome/src/SignInGuide.vue');
  assert.match(guide, /await homeShellBridge.requestLogin\(\)/);
  assert.doesNotMatch(guide, /<Login|type="password"|navigate|router/);
});
