/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { after, test } from 'node:test';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { build } from 'esbuild';
import * as vue from 'vue';

/**
 * 选 Bitterless 模型时聊天里提示「Sign in to Bitterless」—— 就绪从来不该来自一个自建的 pi runtime
 * (docs/issues/bitterless-provider-asks-to-sign-in-inside-chat.md #契约):
 *
 * 1. `checkLlmProviderReady('bitterless', …)` 纯读 main 里的应用账号会话,不调 `ModelRuntime.create()`;
 * 2. 会话每变一次,`coach/llm-config` 恰好重播一次;重叠的求值里最后开始的那次说了算;监听器不向外抛;
 * 3. Control 对 Bitterless 的登录卡去重新验证应用账号会话,不调 `loginLlm`;失败可见、不留未处理的 rejection;
 * 4. 手动压缩在自建的 runtime 上先注册 Bitterless 再找模型。
 */

const root = resolve(import.meta.dirname, '../..');

const stubPlugin = (name, stubs, fallback = () => false) => ({
  name,
  setup(ctx) {
    ctx.onResolve({ filter: /.*/ }, ({ path }) =>
      Object.hasOwn(stubs, path) || fallback(path) ? { path, namespace: name } : undefined
    );
    ctx.onLoad({ filter: /.*/, namespace: name }, ({ path }) => ({
      contents:
        stubs[path] ??
        (path.endsWith('.vue')
          ? `export default { name: ${JSON.stringify(basename(path, '.vue'))} };`
          : ''),
      loader: 'js'
    }));
  }
});
const importBundle = async (result) =>
  await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  );
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));
const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) await tick();
};
const catchUnhandledRejections = (t) => {
  const reasons = [];
  const onRejection = (reason) => reasons.push(reason);
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));
  return reasons;
};

// ---------------------------------------------------------------------------------------------
// main:MaestroLlmService + compaction.handler,只桩进程边界;会话、预设、provider 注册都用真的。
// ---------------------------------------------------------------------------------------------

const ZERO_LEDGER = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costUsd: 0
};
const BITTERLESS_TARGET = { provider: 'bitterless', model: 'qwen3.8-max', effort: 'default' };
const SESSION = { token: 'core-token', baseUrl: 'https://core.example.invalid' };

const main = {
  broadcasts: [],
  events: [],
  runtimeCreates: 0,
  target: BITTERLESS_TARGET,
  ledger: ZERO_LEDGER,
  describeContextWindows: async () => ({}),
  /** 一个 pi `ModelRuntime` 的最小替身:模型与凭据只存在于注册过它们的**这个**实例上。 */
  createRuntime: () => {
    main.events.push('create');
    main.runtimeCreates += 1;
    const models = new Map([
      [
        'openai-codex/gpt-5.6-luna',
        { provider: 'openai-codex', id: 'gpt-5.6-luna', contextWindow: 272000 }
      ]
    ]);
    const keys = new Map([['openai-codex', 'codex-oauth']]);
    return {
      models,
      keys,
      getModel: (provider, model) => models.get(`${provider}/${model}`),
      hasConfiguredAuth: (provider) => keys.has(provider),
      registerProvider: (provider, config) => {
        main.events.push(`registerProvider:${provider}`);
        for (const model of config.models) {
          models.set(`${provider}/${model.id}`, {
            provider,
            id: model.id,
            contextWindow: model.contextWindow
          });
        }
      },
      setRuntimeApiKey: async (provider, apiKey) => {
        main.events.push(`setRuntimeApiKey:${provider}`);
        keys.set(provider, apiKey);
      }
    };
  }
};
globalThis.__bitterlessReadiness = main;

const llmPaths = `export const maestroAgentDir = () => '/fixture/agent';
  export const maestroAuthPath = () => '/fixture/auth.json';
  export const maestroModelsPath = () => '/fixture/models.json';`;
const mainStubs = {
  electron: 'export const shell = { openExternal: async () => undefined };',
  'electron-xpc/main': `const f = () => globalThis.__bitterlessReadiness;
    export const createXpcMainEmitter = () => ({ get: async () => ({ options: f().target }), upsert: async () => undefined });
    export const xpcMain = { broadcast: (channel, params) => f().broadcasts.push({ channel, params }) };
    export class XpcMainHandler {}`,
  inversify: 'export const injectable = () => (target) => target;',
  '@maestro-shared/iocHelper/ioc.helper':
    'export class CommonService { setState(state) { this._state = state; } }',
  '@main/agent/runtime/piNativeCompaction': "export const DEFAULT_COMPACT_PROMPT = 'compact';",
  '@main/agent/runtime/piRuntimeAdapter': `export class PiRuntimeAdapter {
    describeContextWindows(params) { return globalThis.__bitterlessReadiness.describeContextWindows(params); }
  }`,
  './llmPaths': llmPaths,
  '@maestro-main/llm/llmPaths': llmPaths,
  '../../codex/codexCredential.runtime':
    'export const codexCredentialService = { getStatus: async () => ({ connected: true }) };',
  '@maestro-main/windows/main/maestroWindow.controller': `export const maestroWindowHelper = {
    getLlmRuntimeTarget: () => globalThis.__bitterlessReadiness.target,
    agentService: { agentSessionKey: (id) => id || 'default', getExistingMaestroAgent: () => null }
  };`,
  '@main/agent/runtime/usageLedger':
    'export const usageLedger = { get: () => globalThis.__bitterlessReadiness.ledger };',
  '@earendil-works/pi-coding-agent': `const f = () => globalThis.__bitterlessReadiness;
    export const ModelRuntime = { create: async () => f().createRuntime() };
    export class ModelRegistry {
      constructor(runtime) { this.runtime = runtime; }
      async refresh() {}
      find(provider, model) {
        f().events.push('find:' + provider + '/' + model);
        return this.runtime.models.get(provider + '/' + model);
      }
      hasConfiguredAuth(model) { return this.runtime.keys.has(model.provider); }
      async getApiKeyAndHeaders(model) { return { ok: true, apiKey: this.runtime.keys.get(model.provider), headers: {} }; }
    }
    export const calculateContextTokens = (usage) => usage?.totalTokens ?? 0;
    export const shouldCompact = (used, window, settings) => used > window - settings.reserveTokens;`
};
const mainBundle = await build({
  stdin: {
    contents: `export { MaestroLlmService } from './src/main/maestro/llm/maestroLlm.service';
      export { compactionHandler } from './src/main/xpc/compaction.handler';
      export { customerSessionService } from './src/main/auth/customerSession.service';
      export { LLM_PRESETS } from './src/main/maestro/llm/llmModels';`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [stubPlugin('bitterless-readiness-main', mainStubs)]
});
const { MaestroLlmService, compactionHandler, customerSessionService, LLM_PRESETS } =
  await importBundle(mainBundle);

const llmState = (over = {}) => ({
  applyLlmTarget: () => undefined,
  getLlmRuntimeTarget: () => main.target,
  hasActiveAgentTurn: () => false,
  resetLlmTurnState: () => undefined,
  resetLlmAgentSessions: () => undefined,
  readMaestroSettings: () => ({
    llmProvider: main.target.provider,
    llmModel: main.target.model,
    llmEffort: main.target.effort,
    compactPrompt: ''
  }),
  saveMaestroSettings: (patch) => patch,
  emitTrace: () => undefined,
  ...over
});
const llmConfigBroadcasts = () =>
  main.broadcasts.filter((item) => item.channel === 'coach/llm-config').map((item) => item.params);
const bitterlessReady = (cfg) => cfg.providers.find((item) => item.provider === 'bitterless').ready;

/** 订阅了会话的 service;数它求值了几次,并在用例结束时摘掉订阅,免得串到下一个用例。 */
const watchedService = (t, state = llmState()) => {
  const service = new MaestroLlmService();
  service.setState(state);
  let evaluations = 0;
  const getLlmConfig = service.getLlmConfig.bind(service);
  service.getLlmConfig = async () => {
    evaluations += 1;
    return await getLlmConfig();
  };
  service.watchAccountSession();
  service.watchAccountSession();
  t.after(() => {
    service.unwatchAccountSession?.();
    customerSessionService.clear();
  });
  return { evaluations: () => evaluations };
};

// ---------------------------------------------------------------------------------------------
// Control:编译真的 ControlApp.vue,桩掉 store / 组件 / xpc 边界,点真的那颗 Login 按钮。
// ---------------------------------------------------------------------------------------------

const control = {
  calls: [],
  messages: [],
  mounts: [],
  unmounts: [],
  subscriptions: new Map(),
  config: null,
  restore: async () => undefined
};
const readySnapshot = () => ({
  authorityEpoch: 1,
  revision: 1,
  phase: 'ready',
  email: 'person@example.invalid'
});
control.auth = vue.reactive({
  ready: true,
  loggingOut: false,
  snapshot: readySnapshot(),
  restoreSession() {
    control.calls.push(['restoreSession']);
    return control.restore();
  },
  isAuthenticated() {
    return Boolean(
      this.snapshot && this.snapshot.phase !== 'unknown' && this.snapshot.phase !== 'signed-out'
    );
  }
});
control.coach = {
  loginLlm: async (request) => {
    control.calls.push(['loginLlm', request]);
    return control.config;
  }
};
control.channelStore = vue.reactive({
  activeSession: { id: 'session', turn: null, archivedAt: null },
  reset: () => undefined
});
control.messageStore = vue.reactive({
  activeAgentTurnSnapshot: null,
  turnService: { activeTurn: () => null },
  setContextWindow: () => undefined,
  compactAllIfNeeded: async () => undefined,
  reset: () => undefined
});
globalThis.__bitterlessControl = control;
globalThis.__bitterlessControlVue = vue;
after(() => {
  delete globalThis.__bitterlessReadiness;
  delete globalThis.__bitterlessControl;
  delete globalThis.__bitterlessControlVue;
});

const lifecycle = new Set(['onMounted', 'onBeforeUnmount']);
const vueExports = Object.keys(vue).filter(
  (key) => /^[A-Za-z_$][\w$]*$/.test(key) && key !== 'default' && !lifecycle.has(key)
);
const controlStubs = {
  vue: `const v = globalThis.__bitterlessControlVue;
    export const ${vueExports.map((key) => `${key} = v.${key}`).join(', ')};
    export const onMounted = (callback) => globalThis.__bitterlessControl.mounts.push(callback);
    export const onBeforeUnmount = (callback) => globalThis.__bitterlessControl.unmounts.push(callback);`,
  '@arco-design/web-vue': `const f = () => globalThis.__bitterlessControl;
    export const Button = { name: 'Button' }, Spin = { name: 'Spin' }, Trigger = { name: 'Trigger' };
    export const Message = {
      success: (text) => f().messages.push(['success', text]),
      warning: (text) => f().messages.push(['warning', text]),
      error: (text) => f().messages.push(['error', text])
    };
    export const Notification = { info: () => undefined, remove: () => undefined };`,
  '@tabler/icons-vue':
    "export const IconLogin2 = { name: 'IconLogin2' }, IconX = { name: 'IconX' };",
  'electron-xpc/renderer': `export const createXpcRendererEmitter = () => globalThis.__bitterlessControl.coach;
    export const xpcRenderer = {
      subscribe: (topic, callback) => globalThis.__bitterlessControl.subscriptions.set(topic, callback),
      broadcast: () => undefined
    };`,
  '@renderer/common/i18n/i18n.helper': `export const i18nHelper = { menuBar: { maestro: {
    resizePanel: 'Resize', hidePanel: 'Hide', providerUnavailable: 'Unavailable'
  } } };`,
  '@maestro-shared/coach.api': 'export const defaultLlmEffort = (preset) => preset.effort;',
  '@renderer/maestro/localHome/src/localHomeAuth.store':
    'export const localHomeAuthStore = globalThis.__bitterlessControl.auth;',
  './store/agentBrowser.store':
    'export const agentBrowserStore = { reset: () => undefined, accept: () => undefined };',
  './store/sessionActions.store':
    'export const sessionActions = { init: () => undefined, reset: () => undefined, historyVisible: false, searchVisible: false };',
  './store/channel.store':
    'export const channelStore = globalThis.__bitterlessControl.channelStore;',
  './store/message.store':
    'export const messageStore = globalThis.__bitterlessControl.messageStore;',
  './store/turn.service': 'export const isRejection = (reply) => reply?.rejected === true;',
  './store/task.store':
    'export const taskStore = { init: async () => undefined, reset: () => undefined };',
  './store/workflow.store':
    'export const workflowStore = { resume: () => undefined, reset: () => undefined };',
  './markdownLinkTooltip.service':
    'export const installMarkdownLinkTooltipCleanup = () => () => undefined;'
};
const controlFile = resolve(root, 'src/renderer/maestro/control/src/ControlApp.vue');
const { descriptor } = parse(readFileSync(controlFile, 'utf8'), { filename: controlFile });
const script = compileScript(descriptor, { id: 'bitterless-readiness', genDefaultAs: 'component' });
const template = compileTemplate({
  source: descriptor.template.content,
  filename: controlFile,
  id: 'bitterless-readiness',
  compilerOptions: { bindingMetadata: script.bindings }
});
const controlBundle = await build({
  stdin: {
    contents: `${script.content}\n${template.code}\nexport default component;`,
    resolveDir: dirname(controlFile),
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  plugins: [
    stubPlugin('bitterless-readiness-control', controlStubs, (path) => /\.(vue|less)$/.test(path))
  ]
});
const { default: component, render } = await importBundle(controlBundle);

const llmConfig = (provider) => {
  const presets = JSON.parse(JSON.stringify(LLM_PRESETS));
  const preset = presets.find((item) => item.provider === provider);
  return {
    provider,
    model: preset.model,
    effort: preset.effort,
    ready: false,
    providers: [
      {
        provider: 'openai-codex',
        label: 'Codex',
        authLabel: 'Coding agent subscription',
        ready: provider !== 'openai-codex',
        active: provider === 'openai-codex'
      },
      {
        provider: 'bitterless',
        label: 'Bitterless',
        authLabel: 'Bitterless account',
        ready: provider !== 'bitterless',
        active: provider === 'bitterless'
      }
    ],
    presets,
    loginProviders: [
      {
        provider: 'openai-codex',
        label: 'Codex',
        methods: [{ id: 'browser', label: 'Browser Login' }]
      }
    ]
  };
};
const mountControl = (t, config) => {
  control.calls.length = 0;
  control.messages.length = 0;
  control.mounts.length = 0;
  control.unmounts.length = 0;
  control.restore = async () => undefined;
  control.auth.ready = true;
  control.auth.loggingOut = false;
  control.auth.snapshot = readySnapshot();
  control.config = config;
  const scope = vue.effectScope();
  const ui = scope.run(() => component.setup({}, { expose: () => undefined }));
  t.after(() => scope.stop());
  ui.controlLoading.value = false;
  ui.llmConfig.value = config;
  return ui;
};
const subtree = (vnode) => {
  const nodes = [];
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (!value || typeof value !== 'object' || !vue.isVNode(value)) return;
    nodes.push(value);
    if (Array.isArray(value.children)) walk(value.children);
    else if (value.children && typeof value.children === 'object') {
      for (const slot of Object.values(value.children)) {
        if (typeof slot === 'function') walk(slot());
      }
    }
  };
  walk(vnode);
  return nodes;
};
const text = (node) =>
  typeof node?.children === 'string'
    ? node.children
    : Array.isArray(node?.children)
      ? node.children.map(text).join('')
      : '';
const loginCard = (ui) => {
  const card = subtree(render({}, [], {}, vue.proxyRefs(ui), {}, {})).find(
    (node) => node.props?.name === 'control__llm__login_card'
  );
  assert.ok(card, 'the login card is rendered');
  const inside = subtree(card);
  return {
    message: text(inside.find((node) => node.props?.class === 'control-app__login-message')).trim(),
    button: inside.find((node) => node.type?.name === 'Button')
  };
};

test('Bitterless readiness is a pure read of the account session: no pi runtime is built', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  main.runtimeCreates = 0;
  main.target = BITTERLESS_TARGET;
  t.after(() => customerSessionService.clear());
  const service = new MaestroLlmService();
  service.setState(llmState());

  // TS 里是 private,运行期可以直接调 —— 钉住的正是这条分支本身。
  assert.equal(
    await service.checkLlmProviderReady('bitterless', 'qwen3.8-max'),
    false,
    'no session → not ready'
  );
  customerSessionService.set(SESSION);
  assert.equal(await service.checkLlmProviderReady('bitterless', 'qwen3.8-max'), true);
  assert.equal(await service.checkLlmProviderReady('bitterless', 'qwen3.8-flash'), true);
  assert.equal(
    await service.checkLlmProviderReady('bitterless', 'gpt-6-astra'),
    false,
    'a model outside the Bitterless presets is never ready'
  );
  const cfg = await service.getLlmConfig();
  assert.equal(bitterlessReady(cfg), true);
  assert.equal(cfg.ready, true, 'the selected Bitterless target is ready to send');
  assert.equal(cfg.hint, undefined);

  customerSessionService.clear();
  assert.equal(
    await service.checkLlmProviderReady('bitterless', 'qwen3.8-max'),
    false,
    'signed out → not ready'
  );
  customerSessionService.set({ token: SESSION.token, baseUrl: '' });
  assert.equal(
    await service.checkLlmProviderReady('bitterless', 'qwen3.8-max'),
    false,
    'half a session is no session'
  );
  assert.equal(main.runtimeCreates, 0, 'Bitterless readiness must never build a pi runtime');

  // 桩是真的在数:没有自己分支的 provider 仍然走建 runtime 的那条路。
  await service.checkLlmProviderReady('anthropic', 'claude');
  assert.equal(main.runtimeCreates, 1);
});

test('an account session change re-broadcasts coach/llm-config exactly once per change', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  main.broadcasts.length = 0;
  main.target = BITTERLESS_TARGET;
  const { evaluations } = watchedService(t);

  customerSessionService.set(SESSION);
  await settle();
  assert.equal(evaluations(), 1, 'watchAccountSession() twice still subscribes once');
  assert.deepEqual(llmConfigBroadcasts().map(bitterlessReady), [true]);
  assert.equal(llmConfigBroadcasts()[0].ready, true);

  customerSessionService.set({ ...SESSION });
  await settle();
  assert.equal(llmConfigBroadcasts().length, 1, 'the same session pushed again is not a change');

  customerSessionService.clear();
  await settle();
  assert.equal(evaluations(), 2);
  assert.deepEqual(llmConfigBroadcasts().map(bitterlessReady), [true, false]);
  assert.equal(llmConfigBroadcasts()[1].ready, false);
});

test('overlapping evaluations: the latest one wins and a stale one arriving late never broadcasts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  main.broadcasts.length = 0;
  main.target = BITTERLESS_TARGET;
  const gates = [];
  main.describeContextWindows = () => {
    const gate = deferred();
    gates.push(gate);
    return gate.promise;
  };
  t.after(() => {
    main.describeContextWindows = async () => ({});
  });
  watchedService(t);
  const until = async (predicate) => {
    for (let turn = 0; turn < 50 && !predicate(); turn += 1) await tick();
    assert.ok(predicate());
  };

  customerSessionService.set(SESSION);
  await until(() => gates.length === 1); // A 已读到「就绪」,停在上下文窗口解析上
  customerSessionService.clear();
  await until(() => gates.length === 2); // B 已读到「未就绪」
  gates[1].resolve({});
  await settle();
  gates[0].resolve({});
  await settle();
  assert.deepEqual(
    llmConfigBroadcasts().map(bitterlessReady),
    [false],
    'the evaluation that started first and finished last must not overwrite the newer one'
  );
});

test('a failing re-evaluation is logged, never thrown into the session service, and later changes still broadcast', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  main.broadcasts.length = 0;
  main.target = BITTERLESS_TARGET;
  const rejections = catchUnhandledRejections(t);
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => {
    warnings.push(args);
  });
  const base = llmState();
  let broken = true;
  watchedService(t, {
    ...base,
    readMaestroSettings: () => {
      if (broken) throw new Error('settings unreadable');
      return base.readMaestroSettings();
    }
  });
  let laterSubscriber = 0;
  const stopLater = customerSessionService.subscribe(() => {
    laterSubscriber += 1;
  });
  t.after(stopLater);

  assert.doesNotThrow(() => customerSessionService.set(SESSION));
  await settle();
  assert.equal(laterSubscriber, 1, 'a subscriber registered after Maestro still hears the change');
  assert.deepEqual(llmConfigBroadcasts(), []);
  assert.ok(
    warnings.some(
      ([message, detail]) =>
        /re-broadcast after account session change failed/.test(message) &&
        detail === 'settings unreadable'
    ),
    'the failure is logged'
  );

  broken = false;
  customerSessionService.clear();
  await settle();
  assert.deepEqual(
    llmConfigBroadcasts().map(bitterlessReady),
    [false],
    'the next change still re-broadcasts'
  );
  assert.deepEqual(rejections, []);
});

test('manual compaction registers Bitterless on its own runtime before looking the model up', async (t) => {
  main.events.length = 0;
  main.target = BITTERLESS_TARGET;
  t.after(() => {
    main.target = BITTERLESS_TARGET;
    main.ledger = ZERO_LEDGER;
    customerSessionService.clear();
  });

  // 没登录:没有东西可注册,查找如实失败。
  let resolved = await compactionHandler.resolveTarget();
  assert.equal(resolved.ok, false);
  assert.deepEqual(main.events, ['create', 'find:bitterless/qwen3.8-max']);

  customerSessionService.set(SESSION);
  main.events.length = 0;
  resolved = await compactionHandler.resolveTarget();
  assert.deepEqual(main.events, [
    'create',
    'registerProvider:bitterless',
    'setRuntimeApiKey:bitterless',
    'find:bitterless/qwen3.8-max'
  ]);
  assert.equal(resolved.ok, true, resolved.error);
  assert.equal(resolved.model.id, 'qwen3.8-max');
  assert.equal(resolved.apiKey, SESSION.token);

  // 对外的效果:Bitterless 会话拿到的是真 usage 的判定,而不是 `no-usage`。
  main.ledger = { ...ZERO_LEDGER, input: 900, output: 100, totalTokens: 1000 };
  const reply = await compactionHandler.shouldCompact({
    sessionId: 's1',
    reserveTokens: 100,
    keepRecentTokens: 100
  });
  assert.equal(reply.reason, 'under-threshold');

  // Codex 不受影响:它的 runtime 上不注册任何东西。
  main.events.length = 0;
  main.target = { provider: 'openai-codex', model: 'gpt-5.6-luna', effort: 'low' };
  resolved = await compactionHandler.resolveTarget();
  assert.equal(resolved.ok, true, resolved.error);
  assert.deepEqual(main.events, ['create', 'find:openai-codex/gpt-5.6-luna']);
});

test('Control: the Bitterless card re-validates the account session and never calls loginLlm', async (t) => {
  const ui = mountControl(t, llmConfig('bitterless'));
  assert.equal(ui.needsLlmLogin.value, true);
  const card = loginCard(ui);
  assert.equal(card.message, 'Sign in to Bitterless to use this model.', 'the card keeps its text');

  const gate = deferred();
  control.restore = () => gate.promise;
  const clicking = card.button.props.onClick();
  assert.deepEqual(control.calls, [['restoreSession']]);
  assert.equal(
    ui.llmLoginLoading.value,
    true,
    'the button spins while the session is being checked'
  );
  await ui.loginActiveProvider();
  assert.deepEqual(control.calls, [['restoreSession']], 'a second click while checking is ignored');

  gate.resolve();
  await clicking;
  assert.equal(ui.llmLoginLoading.value, false);
  assert.deepEqual(control.messages, []);
  assert.equal(
    control.calls.some(([method]) => method === 'loginLlm'),
    false
  );
});

test('Control: a failed re-validation is shown, never an unhandled rejection; a cleared session leaves it to the login form', async (t) => {
  const rejections = catchUnhandledRejections(t);
  const ui = mountControl(t, llmConfig('bitterless'));

  control.restore = async () => {
    throw new Error('Bitterless 服务暂时不可用，请稍后重试');
  };
  await loginCard(ui).button.props.onClick();
  assert.deepEqual(control.messages, [['warning', 'Bitterless 服务暂时不可用，请稍后重试']]);
  assert.equal(ui.llmLoginLoading.value, false, 'the card is usable again');

  // Home 判定会话已失效并清掉了它:闸门换成登录表单就是结果,上面不再叠一条 toast。
  control.messages.length = 0;
  control.restore = async () => {
    control.auth.snapshot = { authorityEpoch: 1, revision: 2, phase: 'signed-out', email: null };
    control.auth.ready = false;
    throw new Error('邮箱、密码或验证码不正确');
  };
  await ui.loginActiveProvider();
  assert.deepEqual(control.messages, []);
  assert.deepEqual(
    control.calls.map(([method]) => method),
    ['restoreSession', 'restoreSession'],
    'loginLlm is never called for Bitterless'
  );
  await tick();
  assert.deepEqual(rejections, []);
});

test('Control: Codex keeps its existing loginLlm path', async (t) => {
  const ui = mountControl(t, llmConfig('openai-codex'));
  const card = loginCard(ui);
  assert.equal(card.message, 'Sign in to Codex to use this model.');
  await card.button.props.onClick();
  assert.deepEqual(control.calls, [['loginLlm', { provider: 'openai-codex', method: 'browser' }]]);
});
