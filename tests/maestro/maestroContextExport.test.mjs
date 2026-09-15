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
import { pathToFileURL } from 'node:url';
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
      export { A7_DISCIPLINE, BASE_SYSTEM_PROMPT } from './src/main/agent/prompt/sysPrompt';
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
  './prompt/sysPrompt': { A7_DISCIPLINE: real.A7_DISCIPLINE, BASE_SYSTEM_PROMPT: real.BASE_SYSTEM_PROMPT },
  './prompt/projectInstructions': { readProjectInstructions: () => { throw new Error('Context export must not read project files'); } }
});
const { PiRuntimeSession } = real;
const { SessionManager } = await import(pathToFileURL(resolve(root, 'node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js')).href);
const { Agent: NativeAgent } = await import(pathToFileURL(resolve(root, 'node_modules/@earendil-works/pi-agent-core/dist/agent.js')).href);

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

const mainHarness = (ioLogDir = null) => {
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
      describeWindowTabs: () => ({ activeTab: { tab_id: 'foreground-tab', kind: 'web', title: 'Visible page', url: 'https://example.com' }, openTabs: [{ tab_id: 'foreground-tab', kind: 'web', title: 'Visible page', url: 'https://example.com' }, { tab_id: 'background-tab', kind: 'miniapp', title: 'Trench', miniapp: 'trench' }] }),
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
    modelIoLog: { dirForSession: async sessionId => { assert.equal(sessionId, 'chat-1'); return ioLogDir; } },
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
    sessionManager: { getEntries: () => entries, buildContextEntries: () => entries },
    prompt: () => { throw new Error('Must not prompt'); },
    abort: () => { throw new Error('Must not abort'); }
  };
  const surface = new PiRuntimeSession(native).context;
  assert.deepEqual(surface.entries(), entries);
  assert.deepEqual(surface.contextEntries(), entries);

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
test('no runtime has empty context, while unsupported effective reads fail instead of using raw history', () => {
  const session = { messages: [{ role: 'tool', tool_call_id: '1', content: 'tool result' }] };
  assert.equal(session.context, undefined);
  assert.deepEqual(real.entriesOfSurface(session.context ?? null), []);
  assert.deepEqual(real.entriesOfSurface(undefined), []);
  assert.deepEqual(real.contextEntriesOfSurface(null), []);
  assert.throws(() => real.contextEntriesOfSurface({ entries: () => [] }), /does not support.*effective/);
  assert.throws(() => new PiRuntimeSession({}).context.contextEntries(), /does not support.*effective/);
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
  assert.equal(await agent.existingContextSurface({ readOnly: true }), null);
  assert.equal(creations, 0);
  // 组装用的系统提示词读自**活实例**,与会话 preamble 同一个 systemPrompt() 覆写 —— 不会漂。
  const composed = agent.composedSystemPrompt();
  assert.match(composed, /APP SYSTEM/);
  assert.match(composed, /Which model you are/);
  assert.match(composed, /Codex/);
});

// 写入仍受 busy 门保护，显式只读可读取当前已存在的快照。
test('a busy agent permits read-only snapshots while retaining the compaction write guard', async () => {
  const agent = new BaseAgent({
    runtime: { createSession: async () => ({}) },
    describeTarget: () => ({ providerLabel: 'p', modelLabel: 'm', supplier: 's' }),
    buildTools: () => []
  });
  const surface = { contextEntries: () => [messageEntry({ role: 'user', content: 'x' })] };
  agent.sessionPromise = Promise.resolve({ context: surface });
  assert.ok(await agent.existingContextSurface());
  agent.busy = true;
  assert.equal(await agent.existingContextSurface(), null);
  assert.equal(await agent.existingContextSurface({ readOnly: true }), surface);
  agent.sessionPromise = Promise.resolve({});
  await assert.rejects(agent.existingContextSurface({ readOnly: true }), /does not support.*effective/);
  agent.sessionPromise = Promise.reject(new Error('session unavailable'));
  await assert.rejects(agent.existingContextSurface({ readOnly: true }), /session unavailable/);
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
  assert.doesNotMatch(text, /model-io jsonl:/);
  // No live agent: inspect fixed A1–A5 and A7 without initializing runtime or reading A6.
  assert.ok(text.includes(real.A7_DISCIPLINE));
  assert.doesNotMatch(text, /Your additional responsibility: you are the operator of the built-in browser/);
  assert.match(text, /Active workspace: \/workspace/);
  assert.match(text, /Active tab when this message was sent:\n\{"tab_id":"foreground-tab","kind":"web","title":"Visible page","url":"https:\/\/example.com"\}/);
  assert.match(text, /restored memory/);
  assert.match(text, /\/unread\/attachment\.png/);
  // 附件只是路径:没有读过、没有校验过、没有上传过 —— 结果里不该出现文件内容或结构化回传。
  assert.doesNotMatch(JSON.stringify(result), /restored memory|attachment\.png/);
});

// ③⑧ 活会话:用运行时条目 + 与 send 同一个构建器
test('live context uses runtime entry history, existing memory hydration and the same send builder', async () => {
  const h = mainHarness('/fixture/agent-io/saved-chat-1');
  h.owner.maestroAgents.set('chat-1', {
    existingContextSurface: async options => {
      assert.deepEqual(options, { readOnly: true });
      h.owner._state.describeWindowTabs = () => ({ activeTab: null, openTabs: [] });
      return {
        entries: () => { throw new Error('Export must not read the raw tree'); },
        contextEntries: () => [messageEntry({ role: 'toolResult', toolName: 'read_file', content: [{ type: 'text', text: 'full result' }] })]
      };
    },
    composedSystemPrompt: () => 'native system'
  });
  h.owner.hydratedMaestroAgentSessions.add('chat-1');
  const result = await h.copy({ sessionId: 'chat-1', draft: 'next', context: { recentMessages: [{ role: 'human', content: 'must not replay', ts: 1 }] } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.entries, 1);
  assert.match(h.clipboardWrites[0], /native system/);
  assert.match(h.clipboardWrites[0], /full result/);
  assert.match(h.clipboardWrites[0], /"tab_id":"foreground-tab"/);
  assert.match(h.clipboardWrites[0], /Open tabs when this message was sent:\n\[\{/);
  assert.match(h.clipboardWrites[0], /\"tab_id\":\"background-tab\"/);
  assert.doesNotMatch(h.clipboardWrites[0], /Session browser targets|operation_tab_ids|active_use_tab_ids/);
  assert.match(h.clipboardWrites[0], /model-io jsonl: \/fixture\/agent-io\/saved-chat-1/);
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
  h.owner.maestroAgents.set('chat-1', {
    existingContextSurface: async () => ({ entries: () => [messageEntry({ role: 'user', content: 'raw history must not leak' })] }),
    composedSystemPrompt: () => 'system'
  });
  const unsupported = await h.copy({ sessionId: 'chat-1', draft: '' });
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.error, /does not support.*effective/);
  h.owner._state.existingSkillRegistry = () => null;
  const missing = await h.copy({ sessionId: 'new', draft: '' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not ready/);
  assert.equal(h.clipboardWrites.length, 0);
});

const nativeFixture = () => {
  const manager = SessionManager.inMemory('/fixture/effective-context');
  const agent = new NativeAgent({ streamFn: () => { throw new Error('No model calls in context tests'); } });
  const surface = new PiRuntimeSession({ sessionManager: manager, agent }).context;
  const user = text => manager.appendMessage({ role: 'user', content: text, timestamp: 1 });
  const exported = () => {
    const tree = structuredClone(manager.getEntries());
    const leaf = manager.getLeafId();
    const messages = agent.state.messages;
    const messageSnapshot = structuredClone(messages);
    const record = real.buildContextRecord({
      sessionId: 'fixture-context', systemPrompt: 'fixture system', timestamp: 'fixed',
      entries: real.contextEntriesOfSurface(surface)
    });
    assert.deepEqual(manager.getEntries(), tree, 'export must not mutate raw history');
    assert.equal(manager.getLeafId(), leaf, 'export must not move the leaf');
    assert.equal(agent.state.messages, messages, 'export must not replace live messages');
    assert.deepEqual(agent.state.messages, messageSnapshot, 'export must not mutate live messages');
    return { record, text: real.renderContextText(record) };
  };
  return { manager, agent, surface, user, exported };
};

test('real pi context before compaction excludes metadata and preserves message/custom content without mutation', () => {
  const h = nativeFixture();
  h.manager.appendModelChange('fixture-provider', 'fixture-model');
  h.manager.appendThinkingLevelChange('high');
  h.manager.appendCustomEntry('diagnostic', { note: 'metadata must not become context' });
  h.user('current user request');
  h.manager.appendCustomMessageEntry('instruction', 'custom model instruction', false);
  const { record, text } = h.exported();
  assert.deepEqual(record.entries.map(entry => entry.type), ['user', 'custom_message:instruction']);
  assert.match(text, /current user request/);
  assert.match(text, /custom model instruction/);
  assert.doesNotMatch(text, /fixture-provider|thinking_level_change|diagnostic|metadata must/);
  assert.equal(h.surface.entries().length, 5, 'raw graph/candidate history remains intact');
});

test('real pi first compaction exports only its summary, retained tool pair and subsequent messages', async () => {
  const h = nativeFixture();
  h.user('ABSORBED_RAW_UNIQUE_TEXT');
  const kept = h.manager.appendMessage({
    role: 'assistant', content: [{ type: 'toolCall', id: 'tool-1', name: 'read_file', arguments: { path: '/fixture/kept.txt' } }], timestamp: 2
  });
  h.manager.appendMessage({ role: 'toolResult', toolCallId: 'tool-1', toolName: 'read_file', content: [{ type: 'text', text: 'KEPT_TOOL_RESULT' }], timestamp: 3 });
  h.manager.appendCompaction('CURRENT_SUMMARY', kept, 1000);
  h.user('AFTER_COMPACTION');
  const { record, text } = h.exported();
  assert.deepEqual(record.entries.map(entry => entry.type), ['compaction', 'tool_call', 'tool_result', 'user']);
  assert.match(text, /CURRENT_SUMMARY/);
  assert.match(text, /kept\.txt/);
  assert.match(text, /KEPT_TOOL_RESULT/);
  assert.match(text, /AFTER_COMPACTION/);
  assert.doesNotMatch(text, /ABSORBED_RAW_UNIQUE_TEXT/);
  assert.match(JSON.stringify(h.surface.entries()), /ABSORBED_RAW_UNIQUE_TEXT/);
  // Run the actual host method through handler/controller, not only the projection helper.
  const host = mainHarness();
  host.owner.maestroAgents.set('chat-1', { existingContextSurface: async () => h.surface, composedSystemPrompt: () => 'system' });
  host.owner.hydratedMaestroAgentSessions.add('chat-1');
  const result = await host.copy({ sessionId: 'chat-1', draft: '' });
  assert.equal(result.ok, true, result.error);
  assert.doesNotMatch(host.clipboardWrites[0], /ABSORBED_RAW_UNIQUE_TEXT/);
  assert.match(host.clipboardWrites[0], /CURRENT_SUMMARY/);
});

test('real pi repeated compaction retains only the latest summary and its selected tail', () => {
  const h = nativeFixture();
  h.user('FIRST_ABSORBED_RAW');
  const oldTail = h.user('OLD_TAIL_NOW_ABSORBED');
  h.manager.appendCompaction('OLD_SUMMARY_NOW_ABSORBED', oldTail, 1000);
  const latestTail = h.user('LATEST_RETAINED_TAIL');
  h.manager.appendCompaction('LATEST_SUMMARY', latestTail, 2000);
  h.user('LATEST_POST_COMPACTION');
  const { record, text } = h.exported();
  assert.deepEqual(record.entries.map(entry => entry.type), ['compaction', 'user', 'user']);
  assert.match(text, /LATEST_SUMMARY/);
  assert.match(text, /LATEST_RETAINED_TAIL/);
  assert.match(text, /LATEST_POST_COMPACTION/);
  assert.doesNotMatch(text, /FIRST_ABSORBED_RAW|OLD_TAIL_NOW_ABSORBED|OLD_SUMMARY_NOW_ABSORBED/);
});

test('real pi missing keep ID is an empty retained tail, without raw-history fallback', () => {
  const h = nativeFixture();
  h.user('RAW_BEFORE_EMPTY_TAIL');
  h.manager.appendCompaction('EMPTY_TAIL_SUMMARY', 'nonexistent-entry', 1000);
  assert.deepEqual(h.exported().record.entries.map(entry => entry.type), ['compaction']);
  h.user('AFTER_EMPTY_TAIL');
  const { record, text } = h.exported();
  assert.deepEqual(record.entries.map(entry => entry.type), ['compaction', 'user']);
  assert.match(text, /EMPTY_TAIL_SUMMARY/);
  assert.match(text, /AFTER_EMPTY_TAIL/);
  assert.doesNotMatch(text, /RAW_BEFORE_EMPTY_TAIL/);
});

test('real pi export follows the current branch leaf and includes branch summary text', () => {
  const h = nativeFixture();
  const shared = h.user('SHARED_ROOT');
  const abandoned = h.user('ABANDONED_BRANCH_RAW');
  h.manager.branchWithSummary(shared, 'RETURNED_BRANCH_SUMMARY');
  h.user('CURRENT_BRANCH_ONLY');
  const { record, text } = h.exported();
  assert.deepEqual(record.entries.map(entry => entry.type), ['user', 'branch_summary', 'user']);
  assert.match(text, /RETURNED_BRANCH_SUMMARY/);
  assert.match(text, /CURRENT_BRANCH_ONLY/);
  assert.doesNotMatch(text, /ABANDONED_BRANCH_RAW/);
  h.manager.branch(abandoned);
  const returned = h.exported().text;
  assert.match(returned, /ABANDONED_BRANCH_RAW/);
  assert.doesNotMatch(returned, /RETURNED_BRANCH_SUMMARY|CURRENT_BRANCH_ONLY/);
});

test('manual pi appends update the real live agent context after compaction and both supplemental messages', () => {
  const h = nativeFixture();
  h.user('ABSORBED_ASSISTANT_CONTEXT');
  const kept = h.user('RETAINED_REQUEST');
  h.agent.state.messages = h.manager.buildSessionContext().messages;
  const original = structuredClone(h.agent.state.messages);
  assert.ok(h.surface.appendCompaction('LIVE_COMPACTED_SUMMARY', kept, 1000));
  assert.notDeepEqual(h.agent.state.messages, original);
  assert.deepEqual(h.agent.state.messages, h.manager.buildSessionContext().messages);
  assert.doesNotMatch(JSON.stringify(h.agent.state.messages), /ABSORBED_ASSISTANT_CONTEXT/);
  assert.ok(h.surface.appendCustomMessage('user-verbatim', 'EXPLICIT_RETAINED_USER_CHAIN'));
  assert.deepEqual(h.agent.state.messages, h.manager.buildSessionContext().messages);
  assert.ok(h.surface.appendCustomMessage('manifest', 'EXPLICIT_CONTEXT_MANIFEST'));
  assert.deepEqual(h.agent.state.messages, h.manager.buildSessionContext().messages);
  const { text } = h.exported();
  assert.match(text, /LIVE_COMPACTED_SUMMARY/);
  assert.match(text, /RETAINED_REQUEST/);
  assert.match(text, /EXPLICIT_RETAINED_USER_CHAIN/);
  assert.match(text, /EXPLICIT_CONTEXT_MANIFEST/);
  assert.doesNotMatch(text, /ABSORBED_ASSISTANT_CONTEXT/);
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
