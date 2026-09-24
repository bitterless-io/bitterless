import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

/**
 * **按停止时队列里的 steering 不许被 pi 在中止后再跑一轮。**
 *
 * WORKFLOW-MCU 会话 2026-09-24 在真实的 pi 0.85.1 循环上复现:`steer` → `abort` 之后 pi 又发了一次模型请求,
 * 并把那句话和回复写进会话文件;而界面早已把它判成没投出去、顺延成下一个回合 —— 模型收到两次。
 * pi 自己按 Esc 是「先清队列、再中止」;宿主漏了清队列那一步。见 docs/issues/abort-lets-pi-run-queued-steering.md。
 *
 * 跑的是**真的** pi `AgentSession`(本地假模型,无网络、无凭据)+ 宿主**真的** `PiRuntimeSession`。
 */
const ROOT = resolve(import.meta.dirname, '../..');
const NM = join(ROOT, 'node_modules/@earendil-works');
const load = (() => {
  const cache = new Map();
  const read = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const native = createRequire(file);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
    new Function('require', 'module', 'exports', outputText)((name) => {
      if (name === '@main/net/downloadManager') return { drainDownloadNote: () => '' };
      if (name.startsWith('.')) return read(resolve(dirname(file), `${name}.ts`));
      if (name.startsWith('@main/')) return read(resolve(ROOT, 'src/main', `${name.slice(6)}.ts`));
      return native(name);
    }, module, module.exports);
    return module.exports;
  };
  return (path) => read(resolve(ROOT, path));
})();
const { PiRuntimeSession } = load('src/main/agent/runtime/piRuntimeSession.ts');

const pi = await import(pathToFileURL(`${NM}/pi-coding-agent/dist/index.js`).href);
const { Agent } = await import(pathToFileURL(`${NM}/pi-agent-core/dist/index.js`).href);
const { convertToLlm } = await import(pathToFileURL(`${NM}/pi-coding-agent/dist/core/messages.js`).href);
const { createAssistantMessageEventStream } = await import(pathToFileURL(`${NM}/pi-ai/dist/utils/event-stream.js`).href);

const model = { id: 'fixture', name: 'fixture', provider: 'fixture', api: 'openai-responses', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1000 };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const scenario = () => {
  const requests = [];
  let streaming;
  const started = new Promise((r) => { streaming = r; });
  const agent = new Agent({ convertToLlm, initialState: { model }, streamFn: async (_model, context, options) => {
    requests.push(context.messages.map((m) => m.role));
    const stream = createAssistantMessageEventStream();
    const n = requests.length;
    if (n === 1) {
      streaming();
      // 像真的供应商那样响应中止:以 stopReason 'aborted' 结束这一轮。
      options.signal.addEventListener('abort', () => {
        stream.push({ type: 'error', reason: 'aborted', error: { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'aborted', errorMessage: 'aborted', timestamp: n } });
      }, { once: true });
    } else {
      stream.push({ type: 'done', reason: 'stop', message: { role: 'assistant', content: [{ type: 'text', text: `answer-${n}` }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: n } });
    }
    return stream;
  } });
  const session = new pi.AgentSession({ agent, sessionManager: pi.SessionManager.inMemory('/fixture'),
    settingsManager: pi.SettingsManager.inMemory({ compaction: { enabled: false } }), cwd: '/fixture',
    resourceLoader: { getExtensions: () => ({ extensions: [], errors: [], runtime: pi.createExtensionRuntime() }), getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => 'sys', getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => undefined, reload: async () => {} },
    modelRuntime: { hasConfiguredAuth: () => true, getModel: () => model }, customTools: [] });
  const debug = [];
  const runtime = new PiRuntimeSession(session, (event) => debug.push(event));
  return { session, runtime, requests, started, debug };
};

test('流式中排进一句 steering 再按停止:pi 不再发第二次请求,会话文件里也没有那句话', async () => {
  const s = scenario();
  const run = s.runtime.prompt({ text: 'ROOT' });
  await s.started;
  await s.runtime.enqueueSteering({ text: 'HUMAN typed while streaming', messageId: 'm-steer', turnId: 't' });
  await s.runtime.abort();
  await run.catch(() => undefined);
  assert.equal(s.requests.length, 1, '原来中止之后 pi 又带着这句话发了一次模型请求');
  const persisted = s.session.sessionManager.getEntries().filter((e) => e.type === 'message').map((e) => e.message.role);
  assert.deepEqual(persisted, ['user', 'assistant'], '会话文件里只能有 ROOT 与被中止的那一轮 —— 不许出现那句 steering 与它的回复');
  assert.ok(s.debug.some((e) => e.phase === 'steering-dropped'), '丢掉的排队消息要留痕');
});
