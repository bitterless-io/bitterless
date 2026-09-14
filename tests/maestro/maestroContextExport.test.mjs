/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * 上下文导出 —— 组装交给 `@main/agent/contextExport.service`(与 cowork 同一份设计,各自实现)。
 *
 * 这个文件守的是**与实现无关的保证**,不是某一版的文本格式:
 *   ① 导出不建模型会话、不预热 preamble;
 *   ② 导出零副作用(不初始化服务、不重放技能、不改 workspace、不标记记忆已注水);
 *   ③ 历史来自**运行时的真实条目**(含工具调用参数与工具返回正文),不拿渲染端消息冒充;
 *   ④ 待发内容(草稿 / workspace / 附件)如实出现,附件**不被读取**;
 *   ⑤ 失败可见,且**不写剪贴板**;
 *   ⑥ 内联媒体只标记不搬字节;
 *   ⑦ 超限是清晰失败(宿主的 8 MiB 闸);
 *   ⑧ send 与 export 用**同一个** prompt 构建器。
 *
 * 换实现时改断言的写法可以,别把上面任何一条删掉 —— 它们各自对应一次真实的踩坑。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
// agent 树在本仓内(`src/main/agent/`)。2026-09-08 它曾被抽进仓外的共享 maestro-agent-sdk,
// 当日 Ral 决定放弃那条路:设计文档统一(`areas/agent-runtime/agent-design-parity.md`),实现两边各存一份。
const sdk = resolve(root, 'src', 'main', 'agent');
const read = path => readFileSync(resolve(root, path), 'utf8');
const require = createRequire(import.meta.url);
const load = (path, dependencies, extra = '') => {
  const result = ts.transpileModule(read(path) + extra, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: path, reportDiagnostics: true
  });
  assert.equal(result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputText)(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), module, module.exports
  );
  return module.exports;
};
const output = await build({
  stdin: {
    contents: `
      export * from '@main/agent/contextExport.service';
      export * from './src/main/agent/runtime/contextExportLimit.service';
      export { buildAgentTurnPrompt } from './src/main/agent/runtime/agentPrompt';
      export { MAESTRO_SYSTEM_PROMPT } from './src/main/agent/prompt/maestroSysPrompt';
      export { BASE_SYSTEM_PROMPT } from './src/main/agent/prompt/sysPrompt';
      export { PiRuntimeSession } from './src/main/agent/runtime/piRuntimeSession';
    `,
    resolveDir: root, loader: 'ts'
  },
  bundle: true, write: false, platform: 'node', format: 'esm', tsconfig: resolve(root, 'tsconfig.node.json')
});
const real = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const noopBudget = { record: () => undefined, get turnIndexNow() { return 0; } };
const noopIoLog = { append: () => undefined, dirForSession: async () => null };
const { BaseAgent } = load(join(sdk, 'BaseAgent.ts'), {
  './runtime/inputBudget': { inputBudget: noopBudget, subjectOf: () => '' },
  './runtime/modelIoLog': { modelIoLog: noopIoLog },
  './prompt/sysPrompt': { BASE_SYSTEM_PROMPT: real.BASE_SYSTEM_PROMPT }
});
const { PiRuntimeSession } = real;

const method = (path, name, bindings = {}) => {
  const source = read(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let member;
  for (const node of ast.statements) {
    if (ts.isClassDeclaration(node)) member ??= node.members.find(item => item.name?.getText(ast) === name);
  }
  assert.ok(member, name);
  const code = ts.transpileModule(`class Actual { ${member.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return Actual.prototype.${name}`)(...Object.values(bindings));
};

/** pi 条目形状(`SessionEntry`)—— 组装侧按 type/message 分型,测试里照它构造。 */
const messageEntry = message => ({ type: 'message', message });

const mainHarness = () => {
  const clipboardWrites = [];
  const registry = { listSkillsForDomain: () => [], readRecipe: () => { throw new Error('No fixture recipe'); } };
  const owner = {
    pi: null, maestroAgents: new Map(), hydratedMaestroAgentSessions: new Set(),
    activeLlmProvider: 'openai-codex', activeLlmModel: 'test-model',
    assertAgentRuntimeActive: () => undefined,
    agentSessionKey: value => value.trim() || 'default',
    _state: {
      agentBrowserSession: sessionId => ({sessionId, tabs: []}),
      currentUrl: 'https://example.com', existingSkillRegistry: () => registry,
      describeActiveTabContent: () => ({ type: 'browser', url: 'https://example.com' }),
      ensureServices: () => { throw new Error('Export must not initialize services'); },
      replaySkill: () => { throw new Error('Export must not replay'); },
      syncWorkspaceFromContext: () => { throw new Error('Export must not mutate workspace'); }
    }
  };
  const servicePath = 'src/main/agent/maestroAgent.service.ts';
  owner.agentSkillBriefs = method(servicePath, 'agentSkillBriefs', {
    DRILL_BUILTIN_SKILL: { id: 'drill', name: 'drill', description: 'Fixture skill', triggers: [], inputs: [], seed: {}, missing: [] }
  });
  owner.copyNextTurnContext = method(servicePath, 'copyNextTurnContext', {
    ...real, clipboard: { writeText: text => clipboardWrites.push(text) },
    localNow: () => '2026-09-14 12:00:00',
    maestroUserChainDir: () => '/fixture/user-chain',
    chainFilePath: (directory, session) => `${directory}/${session}.jsonl`
  });
  const controller = { agentService: owner };
  controller.copyNextTurnContext = method('src/main/maestro/windows/main/maestroWindow.controller.ts', 'copyNextTurnContext');
  const handler = method('src/main/maestro/xpc/coach.handler.ts', 'copyNextTurnContext', { maestroWindowHelper: controller });
  return { owner, clipboardWrites, copy: params => handler(params) };
};

// ③ 历史来自运行时真实条目
test('pi context surface reads the live entry tree — tool calls and tool results in full, no prompt', () => {
  const entries = [
    messageEntry({ role: 'assistant', content: [{ type: 'toolCall', name: 'read_file', arguments: { path: '/test.txt' } }] }),
    messageEntry({ role: 'toolResult', toolName: 'read_file', content: [{ type: 'text', text: 'tool result in full' }] })
  ];
  const native = {
    sessionManager: { getEntries: () => entries },
    prompt: () => { throw new Error('Must not prompt'); },
    abort: () => { throw new Error('Must not abort'); }
  };
  const surface = new PiRuntimeSession(native).context;
  assert.deepEqual(surface.entries(), entries);

  const rows = real.flattenEntries(surface.entries());
  const call = rows.find(row => row.type === 'tool_call');
  assert.equal(call.tool, 'read_file');
  // 工具**参数**必须在:模型看到的不是"调用了工具"这句话,而是完整参数。
  assert.match(call.text, /\/test\.txt/);
  assert.match(rows.find(row => row.type === 'tool_result').text, /tool result in full/);

  // pi 大版本挪走 sessionManager 时退化成空历史,而不是整个回合炸掉。
  assert.deepEqual(new PiRuntimeSession({}).context.entries(), []);
});

// ③ 反面:拿不到面就是空历史,不拿渲染端消息冒充
// (原来拿 AI-CRMS 那条运行时当实例,它 2026-09 退役了;立论不依赖具体 provider。)
test('a runtime with no context surface exports empty history instead of faking it', () => {
  const session = { messages: [{ role: 'tool', tool_call_id: '1', content: 'tool result' }] };
  assert.equal(session.context, undefined);
  assert.deepEqual(real.entriesOfSurface(session.context ?? null), []);
  assert.deepEqual(real.entriesOfSurface(undefined), []);
});

// ① 导出不建会话、不预热 preamble
test('no model session is created by export; an idle agent yields no context surface', async () => {
  let creations = 0;
  class Agent extends BaseAgent { systemPrompt() { return ' APP SYSTEM '; } }
  const agent = new Agent({
    runtime: { createSession: async () => { creations++; } },
    describeTarget: () => ({ providerLabel: 'Codex', modelLabel: 'test-model', supplier: 'test supplier' }),
    buildTools: () => { throw new Error('No tools'); }
  });
  assert.equal(await agent.existingContextSurface(), null);
  assert.equal(creations, 0);
  // 组装用的系统提示词读自**活实例**,与会话 preamble 同一个 systemPrompt() 覆写 —— 不会漂。
  const composed = agent.composedSystemPrompt();
  assert.match(composed, /APP SYSTEM/);
  assert.match(composed, /Which model you are/);
  assert.match(composed, /Codex/);
});

// ①:回合进行中不导出半截历史
test('a busy agent yields no surface rather than exporting mid-turn history', async () => {
  const agent = new BaseAgent({
    runtime: { createSession: async () => ({}) },
    describeTarget: () => ({ providerLabel: 'p', modelLabel: 'm', supplier: 's' }),
    buildTools: () => []
  });
  agent.sessionPromise = Promise.resolve({ context: { entries: () => [messageEntry({ role: 'user', content: 'x' })] } });
  assert.ok(await agent.existingContextSurface());
  agent.busy = true;
  assert.equal(await agent.existingContextSurface(), null);
});

// ②④ 首轮:如实的待发内容 + 零副作用
test('typed handler/controller/service export truthful first-turn pending context without side effects', async () => {
  const h = mainHarness();
  const result = await h.copy({
    sessionId: 'chat-1', draft: ' draft ',
    context: { workspace: { path: '/workspace' }, attachedPaths: ['/unread/attachment.png'], recentMessages: [{ role: 'human', content: 'restored memory', ts: 1 }] }
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.entries, 0);
  assert.equal(h.owner.maestroAgents.size, 0);
  assert.equal(h.owner.hydratedMaestroAgentSessions.size, 0);
  const text = h.clipboardWrites[0];
  assert.equal(result.chars, text.length);
  assert.match(text, /no model-side history yet/);
  // 还没有 agent 时系统段退回静态提示词 —— 它就是下一轮会注入的那份。
  assert.ok(text.includes(real.MAESTRO_SYSTEM_PROMPT.trim().slice(0, 80)));
  assert.match(text, /Active workspace: \/workspace/);
  assert.match(text, /restored memory/);
  assert.match(text, /\/unread\/attachment\.png/);
  // 附件只是路径:没有读过、没有校验过、没有上传过 —— 结果里不该出现文件内容或结构化回传。
  assert.doesNotMatch(JSON.stringify(result), /restored memory|attachment\.png/);
});

// ③⑧ 活会话:用运行时条目 + 与 send 同一个构建器
test('live context uses runtime entry history, existing memory hydration and the same send builder', async () => {
  const h = mainHarness();
  h.owner.maestroAgents.set('chat-1', {
    existingContextSurface: async () => ({
      entries: () => [messageEntry({ role: 'toolResult', toolName: 'read_file', content: [{ type: 'text', text: 'full result' }] })]
    }),
    composedSystemPrompt: () => 'native system'
  });
  h.owner.hydratedMaestroAgentSessions.add('chat-1');
  const result = await h.copy({ sessionId: 'chat-1', draft: 'next', context: { recentMessages: [{ role: 'human', content: 'must not replay', ts: 1 }] } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.entries, 1);
  assert.match(h.clipboardWrites[0], /native system/);
  assert.match(h.clipboardWrites[0], /full result/);
  assert.doesNotMatch(h.clipboardWrites[0], /must not replay/);
  // ⑧ send / export / context-graph 必须**共用** buildAgentTurnPrompt,不允许有人另拼一份。
  //
  // 早先这里断言"恰好两处"。那是把意图写成了一个代理值,而代理已经腐烂过一次:context-graph
  // (`maestroAgent.service.ts` 约 982 行)加了**第三处合法的共用调用**,断言就红了 —— 它把
  // "多一个正确的调用方"报成了违规。所以改成两条:
  //
  //   ① **下界**:至少两处 —— send 与 export 仍然共用同一个 builder。有人把其中一处内联掉,
  //      计数会掉下来。上界故意不设:再多一个共用调用方是好事,不该让守卫红。
  //   ② **结构**:builder 的原料(`selectAgentSkillBriefs`)必须留在 `agentPrompt.ts` 内部。
  //      这才是"第四处另拼一份"拿不到机器的真正原因 —— 它不是私有约定,是模块边界。
  //      哪天有人把它导出去,那一刻就是该看一眼的时候。
  const serviceSource = read('src/main/agent/maestroAgent.service.ts');
  const sharedCalls = (serviceSource.match(/buildAgentTurnPrompt\(\{/g) || []).length;
  assert.ok(sharedCalls >= 2, `send 与 export 必须共用 buildAgentTurnPrompt,实际只有 ${sharedCalls} 处`);
  const promptSource = read('src/main/agent/runtime/agentPrompt.ts');
  assert.doesNotMatch(
    promptSource,
    /^export const selectAgentSkillBriefs/m,
    'builder 的原料一旦导出,别处就能绕过 buildAgentTurnPrompt 自己拼一份提示词'
  );
});

// ⑤ 失败可见且不写剪贴板
test('unsupported live context and missing catalog fail visibly without a clipboard write', async () => {
  const h = mainHarness();
  h.owner.maestroAgents.set('bad', { existingContextSurface: async () => { throw new Error('unsupported live context'); } });
  assert.deepEqual(await h.copy({ sessionId: 'bad', draft: '' }), { ok: false, error: 'unsupported live context' });
  h.owner._state.existingSkillRegistry = () => null;
  const missing = await h.copy({ sessionId: 'new', draft: '' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not ready/);
  assert.equal(h.clipboardWrites.length, 0);
});

// ⑥⑦ 内联媒体只标记;超限是清晰失败
test('inline media is marked without copying bytes; oversized text is a clear failure', () => {
  const binary = 'a'.repeat(real.MAX_CONTEXT_EXPORT_CHARS + 10);
  const rows = real.flattenEntries([
    messageEntry({
      role: 'user',
      content: [
        { type: 'image', data: binary, mimeType: 'image/png' },
        { type: 'text', text: 'full tool text must survive' }
      ]
    })
  ]);
  const exported = JSON.stringify(rows);
  assert.ok(exported.length < 1000, `媒体字节被搬进导出了(${exported.length} 字符)`);
  assert.match(exported, /\[image\]/);
  assert.match(exported, /full tool text must survive/);
  assert.throws(() => real.assertContextTextSize(binary), /8 MiB.*nothing was copied/);
});
