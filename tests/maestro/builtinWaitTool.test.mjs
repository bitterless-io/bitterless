import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/**
 * 通用的内置 `wait {ms}`(docs/features/builtin-wait-tool.md #4)。
 *
 * 上限判定与返回格式用纯函数测，不真等 60 秒;超上限那条路径把 `timerHelper` 换成只记账的桩。
 * 被中止两种 `execute` 形状都测 —— BL 传 signal 本身,CoWork 传 `{ signal, confirm }`,
 * 而 `waitTool.ts` 两仓逐字节相同，两种都得认。下载 NOTE 那 15 秒用 mock 时钟推进，不真等。
 * 同一条消息里的 `[wait, 观察]` 用真的 pi AgentSession 跑(假模型),看观察是不是排在 wait 之后(审查 F1)。
 */
const root = resolve(import.meta.dirname, '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const aliases = [
  ['@maestro-main/', 'src/main/maestro/'],
  ['@maestro-shared/', 'src/shared/maestro/'],
  ['@main/', 'src/main/'],
  ['@shared/', 'src/shared/']
];

// 每个 loader 一份独立的模块缓存 —— 同一个文件可以带不同的桩各加载一份。
const loader = (stubs) => {
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const native = createRequire(file);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    });
    const requireFrom = (name) => {
      if (stubs[name]) return stubs[name];
      if (name.startsWith('.')) return load(resolve(dirname(file), `${name}.ts`));
      for (const [prefix, dir] of aliases) {
        if (name.startsWith(prefix)) return load(resolve(root, dir, `${name.slice(prefix.length)}.ts`));
      }
      return native(name);
    };
    new Function('require', 'module', 'exports', outputText)(requireFrom, module, module.exports);
    return module.exports;
  };
  return (rel) => load(resolve(root, rel));
};

const downloadsDir = mkdtempSync(join(tmpdir(), 'bl-wait-downloads-'));
const load = loader({ electron: { app: { getPath: () => downloadsDir } } });
const { buildWaitTool, planWait, waitResult, WAIT_MAX_MS, WAIT_INPUT_ERROR } = load('src/main/agent/tools/waitTool.ts');
const { timerHelper } = load('src/shared/timerHelper/timer.helper.ts');
const { executeHostTool } = load('src/main/agent/runtime/hostToolExecution.ts');
const { HostToolRegistry } = load('src/main/agent/runtime/hostToolRegistry.ts');
const { bindPiTools, createPiResourceLoader } = load('src/main/agent/runtime/piRuntimeProtocol.ts');
const manager = load('src/main/net/downloadManager.ts');

// The real pi the host hands its tools to; only the model is fake.
const pi = await import('@earendil-works/pi-coding-agent');
const { Agent } = await import('@earendil-works/pi-agent-core');
const { Type } = await import('typebox');
const piFile = (rel) => pathToFileURL(resolve(root, 'node_modules/@earendil-works', rel)).href;
const { convertToLlm } = await import(piFile('pi-coding-agent/dist/core/messages.js'));
const { createAssistantMessageEventStream } = await import(piFile('pi-ai/dist/utils/event-stream.js'));
const model = { id: 'fixture', name: 'fixture', provider: 'fixture', api: 'openai-responses', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1000 };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

// 只记账、不真等的 timerHelper —— 超上限那条路径靠它，不用等 60 秒。
const delays = [];
const recorded = loader({ '@shared/timerHelper/timer.helper': { timerHelper: { delay: async (ms) => { delays.push(ms); } } } })(
  'src/main/agent/tools/waitTool.ts'
);

const CAPPED_ERROR = 'asked for 90000ms, capped at 60000ms — observe again and decide';

test('上限判定:60000 以内照等，超过按上限等，负数当 0,不是有限数字就是输入错误', () => {
  assert.equal(WAIT_MAX_MS, 60000);
  assert.deepEqual(planWait(5000), { requestedMs: 5000, waitMs: 5000 });
  assert.deepEqual(planWait(60000), { requestedMs: 60000, waitMs: 60000 });
  assert.deepEqual(planWait(90000), { requestedMs: 90000, waitMs: 60000 });
  assert.deepEqual(planWait(0), { requestedMs: 0, waitMs: 0 });
  assert.deepEqual(planWait(-5), { requestedMs: 0, waitMs: 0 });
  for (const bad of [undefined, null, '3000', Number.NaN, Infinity, -Infinity, {}, true]) {
    assert.equal(planWait(bad), null, `planWait(${String(bad)})`);
  }
});

test('返回格式：正常 / 超时是 JSON 反馈(不加 ERROR:)/ 被中止优先', () => {
  assert.equal(waitResult(planWait(5000), { aborted: false, elapsedMs: 5003 }), '{"ok":true,"waitedMs":5000}');
  assert.equal(waitResult(planWait(60000), { aborted: false, elapsedMs: 60002 }), '{"ok":true,"waitedMs":60000}', '正好 60000 不算超');
  const capped = waitResult(planWait(90000), { aborted: false, elapsedMs: 60002 });
  assert.equal(capped, JSON.stringify({ ok: false, timedOut: true, waitedMs: 60000, error: CAPPED_ERROR }));
  assert.doesNotMatch(capped, /ERROR:/);
  assert.equal(waitResult(planWait(5000), { aborted: true, elapsedMs: 1234 }), '{"ok":false,"aborted":true,"waitedMs":1234}');
  assert.equal(waitResult(planWait(90000), { aborted: true, elapsedMs: 800 }), '{"ok":false,"aborted":true,"waitedMs":800}');
  assert.equal(WAIT_INPUT_ERROR, 'ERROR: wait needs "ms": a number of milliseconds (0–60000).');
});

test('工具定义:wait {ms} 必填、65 s 超时、downloadSettleMs 0、顺序执行;说明覆盖 #2.1 四点', () => {
  const tool = buildWaitTool();
  assert.equal(tool.name, 'wait');
  assert.deepEqual(tool.params.map(({ name, type, required }) => ({ name, type, required })), [{ name: 'ms', type: 'number', required: true }]);
  assert.equal(tool.timeoutMs, 65000);
  assert.equal(tool.downloadSettleMs, 0);
  assert.equal(tool.executionMode, 'sequential');
  for (const point of [
    /page still loading/, /download still in progress/, /generating a file/,
    /call wait on its own, and once it returns observe again/,
    /observe again \(page_snapshot, download_history, or whichever read tool/,
    /At most 60000 ms per call/, /timedOut/, /change approach or tell the user/,
    /use workflow_wait \(it ends this turn/, /do not poll with wait/
  ]) {
    assert.match(tool.description, point);
  }
});

test('宿主登记：目录里有 wait,注册时不报 missing catalog entry', () => {
  const warnings = [];
  const tools = new HostToolRegistry({ scope: 'cowork', onWarning: (message, detail) => warnings.push({ message, detail }) })
    .add(buildWaitTool())
    .toRuntimeTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['wait']);
  assert.deepEqual(warnings, []);
});

// One assistant message with [wait {ms: 150}, probe] through a real pi AgentSession, built from the host's
// own chain: HostToolRegistry (confirm policy, which re-spreads the spec) → bindPiTools → customTools.
const runBatch = async (waitSpec) => {
  const order = [];
  const instrumentedWait = {
    ...waitSpec,
    execute: async (...args) => {
      order.push('wait:start');
      const text = await waitSpec.execute(...args);
      order.push('wait:end');
      return text;
    }
  };
  const probe = { name: 'probe', description: 'stands in for page_snapshot', params: [], execute: async () => { order.push('probe:start'); return 'snapshot'; } };
  const hostTools = new HostToolRegistry({ scope: 'cowork', policies: { wait: { toolName: 'wait', mode: 'confirm', updatedAt: 1 } }, onConfirm: async () => true })
    .add(instrumentedWait, probe)
    .toRuntimeTools();
  const customTools = bindPiTools(pi, Type, { tools: hostTools, scope: 'agent' });
  let calls = 0;
  const agent = new Agent({ convertToLlm, initialState: { model, messages: [] }, streamFn: async () => {
    calls += 1;
    const first = calls === 1;
    const content = first
      ? [{ type: 'toolCall', id: 'c1', name: 'wait', arguments: { ms: 150 } }, { type: 'toolCall', id: 'c2', name: 'probe', arguments: {} }]
      : [{ type: 'text', text: 'done' }];
    const stopReason = first ? 'toolUse' : 'stop';
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: stopReason, message: { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage, stopReason, timestamp: Date.now() } });
    return stream;
  } });
  const session = new pi.AgentSession({
    agent,
    sessionManager: pi.SessionManager.inMemory('/fixture'),
    settingsManager: pi.SettingsManager.inMemory({ compaction: { enabled: false } }),
    cwd: '/fixture',
    resourceLoader: createPiResourceLoader(pi, () => 'host'),
    modelRuntime: { hasConfiguredAuth: () => true, getModel: () => model },
    customTools,
    initialActiveToolNames: ['wait', 'probe']
  });
  const modeOf = (tools) => Object.fromEntries(tools.map((tool) => [tool.name, tool.executionMode]));
  const scheduled = modeOf(session.agent.state.tools);
  await session.prompt('go');
  await session.dispose();
  return { order, calls, definitions: modeOf(customTools), scheduled };
};

test('一批里有 wait 时 pi 按顺序跑整批：同一条消息里的观察排在 wait 返回之后', async () => {
  const sequential = await runBatch(buildWaitTool());
  assert.deepEqual(sequential.definitions, { wait: 'sequential', probe: undefined }, 'bindPiTools passes the mode through and invents none');
  assert.deepEqual(sequential.scheduled, { wait: 'sequential', probe: undefined }, 'and it reaches the AgentTool pi schedules');
  assert.equal(sequential.calls, 2, 'the batch ran and the model was asked again');
  assert.deepEqual(sequential.order, ['wait:start', 'wait:end', 'probe:start']);

  // Control: the same batch without the mode runs in parallel — the observation does not wait for the pause —
  // so the order above is the mode's doing. (Which of the two starts first depends on the confirm wrapper.)
  const parallel = await runBatch({ ...buildWaitTool(), executionMode: undefined });
  assert.ok(parallel.order.indexOf('probe:start') < parallel.order.indexOf('wait:end'), `parallel order: ${parallel.order.join(', ')}`);
});

test('正常等待：小 ms 真等，实际耗时接近', async () => {
  const started = performance.now();
  const text = await buildWaitTool().execute({ ms: 80 });
  const waited = performance.now() - started;
  assert.equal(text, '{"ok":true,"waitedMs":80}');
  assert.ok(waited >= 75 && waited < 1000, `wait {ms: 80} took ${waited}ms`);
});

test('超上限：只等 60000(桩记账，不真等),返回 timedOut', async () => {
  delays.length = 0;
  const text = await recorded.buildWaitTool().execute({ ms: 90000 });
  assert.deepEqual(delays, [60000]);
  assert.deepEqual(JSON.parse(text), { ok: false, timedOut: true, waitedMs: 60000, error: CAPPED_ERROR });
});

test('ms 非法：报 ERROR:,而且根本不等', async () => {
  delays.length = 0;
  for (const args of [{}, { ms: 'soon' }, { ms: Number.NaN }, { ms: Infinity }, { ms: null }]) {
    assert.equal(await recorded.buildWaitTool().execute(args), 'ERROR: wait needs "ms": a number of milliseconds (0–60000).');
  }
  assert.deepEqual(delays, []);
});

test('被中止：两种 execute 形状(BL 传 signal、CoWork 传 { signal })都立刻返回 aborted', async () => {
  for (const shape of [(signal) => signal, (signal) => ({ signal, confirm: async () => true })]) {
    const controller = new AbortController();
    const started = performance.now();
    const pending = buildWaitTool().execute({ ms: 60000 }, shape(controller.signal));
    setTimeout(() => controller.abort(), 50);
    const result = JSON.parse(await pending);
    const took = performance.now() - started;
    assert.equal(result.ok, false);
    assert.equal(result.aborted, true);
    assert.ok(result.waitedMs >= 40 && result.waitedMs < 1000, `waitedMs ${result.waitedMs}`);
    assert.ok(took < 1000, `returned ${took}ms after the call`);
  }
  // 进来时就已经中止了:一刻不等。
  assert.deepEqual(JSON.parse(await buildWaitTool().execute({ ms: 60000 }, AbortSignal.abort())), { ok: false, aborted: true, waitedMs: 0 });
});

test('timerHelper.delay:被中止时提前 resolve、不抛错，计时器一并清掉;到时的不留监听', async (t) => {
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  const controller = new AbortController();
  const started = performance.now();
  const pending = timerHelper.delay(60000, controller.signal);
  setTimeout(() => controller.abort(new Error('stopped by the user')), 30);
  await pending; // reject 的话这里就抛了
  assert.ok(performance.now() - started < 1000, 'resolved long before 60 s');
  assert.equal(cleared.mock.callCount(), 1, 'the 60 s timer is cleared, not left pending');

  const already = performance.now();
  await timerHelper.delay(60000, AbortSignal.abort());
  assert.ok(performance.now() - already < 100, 'an already-aborted signal resolves at once');

  const reused = new AbortController();
  await timerHelper.delay(10, reused.signal);
  assert.equal(getEventListeners(reused.signal, 'abort').length, 0, 'a finished delay removes its abort listener');
});

const fakeItem = (filename) => {
  const item = {
    savePath: '',
    getFilename: () => filename,
    getMimeType: () => 'application/zip',
    getReceivedBytes: () => 1024,
    getSavePath: () => item.savePath,
    setSavePath: (path) => {
      item.savePath = path;
    },
    once: () => {}
  };
  return item;
};

test('有在途下载时 wait 不吃那 15 秒:说等多久就是多久,NOTE 照附', async () => {
  manager.resetDownloadLedgerForTests();
  manager.adoptDownload(fakeItem('big.zip'));
  const started = performance.now();
  const { text } = await executeHostTool(buildWaitTool(), { ms: 30 });
  const took = performance.now() - started;
  manager.resetDownloadLedgerForTests();
  assert.ok(took < 1000, `wait {ms: 30} took ${took}ms with a download in flight`);
  assert.match(text, /^\{"ok":true,"waitedMs":30\}\n\nNOTE: big\.zip is still downloading/);
});

test('downloadSettleMs:带 0 的成功与失败两条路都一刻不等;不带的两条路都照旧等满 15 秒', async (t) => {
  manager.resetDownloadLedgerForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  manager.adoptDownload(fakeItem('slow.pdf'));
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const track = (promise) => {
    const state = { settled: false, value: undefined };
    promise.then(
      (value) => Object.assign(state, { settled: true, value }),
      (error) => Object.assign(state, { settled: true, value: error })
    );
    return state;
  };

  const zeroOk = track(executeHostTool({ execute: async () => 'ok', downloadSettleMs: 0 }, {}));
  const zeroFail = track(executeHostTool({ execute: async () => { throw new Error('boom'); }, downloadSettleMs: 0 }, {}));
  await flush();
  assert.equal(zeroOk.settled, true, 'no clock advanced, yet it returned');
  assert.match(zeroOk.value.text, /^ok\n\nNOTE: slow\.pdf is still downloading/);
  assert.equal(zeroFail.settled, true);
  assert.match(zeroFail.value.message, /^boom\n\nNOTE: slow\.pdf is still downloading/);

  const byDefault = track(executeHostTool({ execute: async () => 'plain' }, {}));
  const byDefaultFail = track(executeHostTool({ execute: async () => { throw new Error('boom'); } }, {}));
  await flush();
  for (let tick = 0; tick < 74; tick += 1) {
    t.mock.timers.tick(200);
    await flush();
  }
  assert.equal(byDefault.settled, false, 'success path: still holding the result at 14.8 s');
  assert.equal(byDefaultFail.settled, false, 'failure path: still holding the error at 14.8 s');
  t.mock.timers.tick(200);
  await flush();
  assert.equal(byDefault.settled, true, 'success path: released at 15 s');
  assert.equal(byDefaultFail.settled, true, 'failure path: released at 15 s');
  assert.match(byDefault.value.text, /^plain\n\nNOTE: slow\.pdf is still downloading/);
  assert.match(byDefaultFail.value.message, /^boom\n\nNOTE: slow\.pdf is still downloading/);
  manager.resetDownloadLedgerForTests();
});

test('源码：wait 注册在 reload_skills 旁边，不进浏览器目标的 scoped 列表，也不碰 tab', () => {
  const controller = read('src/main/maestro/windows/main/maestroWindow.controller.ts');
  assert.match(controller, /^import \{ buildWaitTool \} from '@main\/agent\/tools\/waitTool'$/m);
  const tools = controller.slice(controller.indexOf('buildPiTools(opts'), controller.indexOf('async pushHostApprovalEvent('));
  const reload = tools.indexOf('buildReloadSkillsTool({');
  const wait = tools.indexOf('buildWaitTool(),');
  assert.ok(reload > 0 && wait > reload && wait < tools.indexOf('...buildSkillCreatorTools('), 'registered right after reload_skills');
  const scoped = tools.match(/const scoped = \[([^\]]+)\]/)[1];
  assert.ok(scoped.includes("'ui_act'"), 'the scoped list is the browser-target one');
  assert.doesNotMatch(scoped, /'wait'/);

  const source = read('src/main/agent/tools/waitTool.ts');
  const imports = [...source.matchAll(/^import .* from '([^']+)'$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ['@main/agent/runtime/agentRuntime.types', '@shared/timerHelper/timer.helper'], 'only modules both repos have');
  assert.doesNotMatch(source, /tab_id|withAgentBrowserTarget|@maestro-/);
});

test('源码:workflow_wait 与 wait 互相说明;ui_act 说清楚自己没有 wait', () => {
  const workflowWait = read('src/main/agent/workflowEngine/hostIntegration.ts');
  assert.match(workflowWait, /For a short pause inside this turn \(a page still loading, a file still generating\), call wait instead/);
  const controller = read('src/main/maestro/windows/main/maestroWindow.controller.ts');
  assert.match(controller, /'ui_act has no wait action — to pause, call the wait tool between ui_act calls\. '/);
  assert.match(controller, /the `snapshot` check cannot reliably catch a ref used on another tab/);
  assert.doesNotMatch(controller, /cannot catch a ref/);
});

const cowork = resolve(root, '../micromeet-cowork/apps/cowork/src/main/agent/tools/waitTool.ts');
test('waitTool.ts 与 micromeet-cowork 逐字节相同', { skip: existsSync(cowork) ? false : 'micromeet-cowork has no waitTool.ts yet (builtin-wait-001) — NOT compared' }, () => {
  assert.ok(readFileSync(cowork).equals(readFileSync(resolve(root, 'src/main/agent/tools/waitTool.ts'))), 'change both copies in the same change');
});
