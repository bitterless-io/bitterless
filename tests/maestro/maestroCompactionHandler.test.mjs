/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* The legacy mutating endpoint is retired; read-only usage/cut inspection remains. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const cache = new Map();

/** 转译 + 求值一个 main 侧 TS 模块;`deps` 命中就用桩,否则按真实路径继续加载。 */
const load = (relPath, deps) => {
  const key = relPath + '::' + Object.keys(deps).sort().join(',');
  if (cache.has(key)) return cache.get(key);
  const file = resolve(root, relPath);
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: file
  }).outputText;
  const module = { exports: {} };
  cache.set(key, module.exports);
  new Function('require', 'module', 'exports', '__filename', out)(
    (name) => {
      if (Object.hasOwn(deps, name)) return deps[name];
      if (name.startsWith('@main/agent/')) return load('src/main/agent/' + name.slice('@main/agent/'.length) + '.ts', deps);
      if (name.startsWith('./') || name.startsWith('../')) {
        return load('src/main/agent/compaction/' + name.replace(/^\.+\//, '') + '.ts', deps);
      }
      return require(name);
    },
    module,
    module.exports,
    file
  );
  cache.set(key, module.exports);
  return module.exports;
};

/** 一个可观测的假会话面 —— ③②④ 的落点。 */
const fakeSurface = (over = {}) => {
  const calls = [];
  return {
    calls,
    // entry 形状必须是 pi 的:只有 `message` / `custom_message` / `branch_summary` 会产生消息
    // (`messageFromEntry`),别的 entry 类型留着等于没留。给三条,好让切点前后都有东西。
    entries: () =>
      over.entries ?? [
        { type: 'message', message: { role: 'user', content: 'first question' } },
        { type: 'message', message: { role: 'assistant', content: 'first answer' } },
        { type: 'message', message: { role: 'user', content: 'latest question' } }
      ],
    appendCompaction: (...args) => {
      calls.push(['appendCompaction', ...args.slice(0, 1)]);
      return over.appendCompaction ?? true;
    },
    appendCustomMessage: (kind) => {
      calls.push(['appendCustomMessage', kind]);
      return over.appendCustomMessage ?? true;
    }
  };
};

/** 桩掉进程边界后加载 handler。`pi` / `surface` / `ledger` / `target` 由用例给。 */
const loadHandler = (opts = {}) => {
  cache.clear();
  const chainStore = load('src/main/agent/userChainStore.service.ts', {});
  const seen = { getExisting: 0, getOrCreate: 0, generateSummary: 0 };
  const piStub = {
    calculateContextTokens: (u) => u?.totalTokens ?? 0,
    shouldCompact: (used, window) => (opts.shouldCompactVerdict ?? used > window),
    // pi 的真返回形状是 `{ firstKeptEntryIndex, turnStartIndex, isSplitTurn }` —— 写错就会被
    // `validateCutPoint` 判掉、退回 `noCut()`,于是整轮报 `nothing-to-compact`。
    // 这正是这套三层兜底该有的行为,所以桩必须按真形状给,否则测的是兜底而不是主路径。
    findCutPoint: () => ({ firstKeptEntryIndex: 2, turnStartIndex: 2, isSplitTurn: false }),
    findTurnStartIndex: () => 0,
    estimateTokens: (text) => Math.ceil(String(text || '').length / 4),
    generateSummary: async () => {
      seen.generateSummary += 1;
      return opts.summary ?? 'SUMMARY';
    },
    ModelRuntime: { create: async () => ({}) },
    ModelRegistry: class {
      find() {
        return opts.model === null ? null : opts.model ?? { contextWindow: 1000 };
      }
      hasConfiguredAuth() {
        return opts.signedIn !== false;
      }
      async getApiKeyAndHeaders() {
        return { ok: true, apiKey: 'k', headers: {} };
      }
    },
    ...(opts.pi || {})
  };
  const handler = load('src/main/xpc/compaction.handler.ts', {
    'electron-xpc/main': { XpcMainHandler: class {} },
    '@earendil-works/pi-coding-agent': piStub,
    '@maestro-main/llm/llmPaths': {
      maestroAuthPath: () => '/tmp/auth',
      maestroModelsPath: () => '/tmp/models',
      maestroUserChainDir: () => '/fixture/maestro-user-chain'
    },
    '@maestro-main/llm/llmModels': { DEFAULT_CONTEXT_WINDOW_TOKENS: 1000 },
    '@main/agent/userChainStore.service': {
      ...chainStore,
      readChainRecords: () => opts.chainRecords ?? []
    },
    '@maestro-main/windows/main/maestroWindow.controller': {
      maestroWindowHelper: {
        getLlmRuntimeTarget: () => ({ provider: 'openai-codex', model: 'gpt-5.6-luna' }),
        agentService: {
          agentSessionKey: (id) => (id || 'default'),
          getExistingMaestroAgent: () => {
            seen.getExisting += 1;
            return opts.surface === null ? null : { existingContextSurface: async () => opts.surface };
          },
          // 这个**不该被碰**:压缩不为了凑候选批去开会话。
          getMaestroAgent: () => {
            seen.getOrCreate += 1;
            return {};
          }
        }
      }
    },
    '@main/agent/runtime/usageLedger': {
      usageLedger: { get: () => opts.ledger ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 } }
    },
    // 这里的目标是 Codex,Bitterless 的注册不会被走到;真的那条路径在 bitterlessProviderReadiness.test.mjs。
    '@main/agent/runtime/bitterlessProvider': {
      isBitterlessProvider: (id) => id === 'bitterless',
      registerBitterlessProvider: async () => false
    }
  });
  return { handler: handler.compactionHandler, seen, piStub };
};

test('账本读不到 → no-usage,而不是一个零用量的「不用压」', async () => {
  const { handler } = loadHandler({ ledger: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 } });
  const reply = await handler.shouldCompact({ sessionId: 's1', reserveTokens: 100, keepRecentTokens: 100 });
  assert.equal(reply.shouldCompact, false);
  assert.equal(
    reply.reason,
    'no-usage',
    '报成 under-threshold 就把「没有账本」和「上下文很空」混成一件事 —— 前者该退回本地估算,后者该什么都不做'
  );
});

test('force 时不看账本也压 —— 人点的那一次不该被触发线否掉', async () => {
  const { handler } = loadHandler({});
  const reply = await handler.shouldCompact({ sessionId: 's1', force: true, reserveTokens: 0, keepRecentTokens: 1 });
  assert.equal(reply.shouldCompact, true);
  assert.equal(reply.reason, 'forced');
});

test('账本有值 → 判据整条交给 pi 的 shouldCompact,窗口取模型自己的 contextWindow', async () => {
  const seenArgs = [];
  const { handler } = loadHandler({
    ledger: { input: 900, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 900, costUsd: 0 },
    model: { contextWindow: 1000 },
    pi: {
      shouldCompact: (used, window, cfg) => {
        seenArgs.push({ used, window, cfg });
        return true;
      }
    }
  });
  const reply = await handler.shouldCompact({ sessionId: 's1', reserveTokens: 128, keepRecentTokens: 256 });
  assert.equal(reply.shouldCompact, true);
  assert.equal(reply.reason, 'usage');
  assert.equal(seenArgs.length, 1, '没把判据交给 pi —— 别在宿主里复刻那行公式');
  assert.equal(seenArgs[0].window, 1000, '窗口必须取 pi 的 Model.contextWindow,不是写死的常量');
  assert.equal(seenArgs[0].cfg.reserveTokens, 128);
  assert.equal(seenArgs[0].cfg.keepRecentTokens, 256);
});

test('legacy compact endpoint is retired without reading, summarizing or mutating history', async () => {
  const surface = fakeSurface();
  const { handler, seen } = loadHandler({ surface });
  const reply = await handler.compact({ sessionId: 's1', keepRecentTokens: 100 });
  assert.equal(reply.ok, false);
  assert.match(reply.error, /native Pi|\/compact/);
  assert.equal(reply.applied, false);
  assert.equal(seen.generateSummary, 0);
  assert.equal(seen.getExisting, 0);
  assert.equal(seen.getOrCreate, 0);
  assert.deepEqual(surface.calls, []);
});

test('cutPoint 不要求登录 —— 该在哪切与能不能摘要是两件事', async () => {
  const surface = fakeSurface();
  // 连模型都找不到(find 返回 null):`compact` 会失败,而 `cutPoint` 必须照样算得出来。
  const { handler, seen } = loadHandler({ surface, model: null });
  const cut = await handler.cutPoint({ sessionId: 's1', keepRecentTokens: 10 });
  assert.equal(typeof cut.firstKeptIndex, 'number', '没登录就算不出切点 = 把两件事绑成了一件');
  assert.equal(seen.generateSummary, 0, 'cutPoint 不该调模型');

  const compacted = await handler.compact({ sessionId: 's1', keepRecentTokens: 10 });
  assert.equal(compacted.ok, false, '同一状态下 compact 应当失败 —— 对照组,证明上面那条不是碰巧');
});
