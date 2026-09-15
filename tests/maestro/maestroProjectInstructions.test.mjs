import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const load = (() => {
  const cache = new Map();
  const read = file => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const native = createRequire(file);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
    new Function('require', 'module', 'exports', outputText)(name => name.startsWith('.') ? read(resolve(dirname(file), `${name}.ts`)) : name.startsWith('@main/') ? read(resolve(root, 'src/main', `${name.slice(6)}.ts`)) : native(name), module, module.exports);
    return module.exports;
  };
  return path => read(resolve(root, path));
})();
const { readProjectInstructions } = load('src/main/agent/prompt/projectInstructions.ts');
const { BaseAgent } = load('src/main/agent/BaseAgent.ts');
const { MaestroAgent } = load('src/main/agent/MaestroAgent.ts');
const { A7_DISCIPLINE } = load('src/main/agent/prompt/sysPrompt.ts');
const { PiRuntimeSession } = load('src/main/agent/runtime/piRuntimeSession.ts');
const { createPiResourceLoader } = load('src/main/agent/runtime/piRuntimeProtocol.ts');
const { resolveRuntimeSystemPrompt } = load('src/main/agent/runtime/runtimeSystemPrompt.ts');
const method = (path, name, bindings = {}) => {
  const text = readFileSync(resolve(root, path), 'utf8');
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const member = ast.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]).find(node => node.name?.getText(ast) === name);
  assert.ok(member, name);
  const code = ts.transpileModule(`class Actual { ${member.getText(ast)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return Actual.prototype.${name};`)(...Object.values(bindings));
};
const fixture = async t => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'bl-project-instructions-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const a = join(dir, 'project A'), b = join(dir, 'project B');
  await Promise.all([fs.mkdir(a), fs.mkdir(b)]);
  await Promise.all([fs.writeFile(join(dir, 'AGENTS.md'), 'PARENT MUST NOT LOAD'), fs.writeFile(join(a, 'AGENTS.md'), '规则 A\n'), fs.writeFile(join(a, 'CLAUDE.md'), 'CLAUDE MUST NOT LOAD'), fs.writeFile(join(b, 'AGENTS.md'), 'RULE B')]);
  return { dir, a, b };
};
const hostAgent = (AgentClass = BaseAgent) => {
  const calls = { starts: [], updates: [], prompts: [], aborts: 0 };
  let listener, pending;
  const runtime = {
    subscribe(fn) { listener = fn; return () => {}; },
    async prompt(message) { calls.prompts.push(message); if (pending) await pending; listener?.({ type: 'assistant_done', text: 'ok', stopReason: 'stop' }); },
    async abort() { calls.aborts++; },
    setSystemPrompt(text) { if (calls.rejectUpdate) throw new Error('update rejected'); calls.updates.push(text); },
    get isStreaming() { return !!pending; }
  };
  const agent = new AgentClass({ buildTools: () => [], cwd: '/fixture/skills', describeTarget: () => ({ providerLabel: 'fixture', modelLabel: 'fixture', supplier: 'fixture' }), runtime: {
    createSession: async options => { calls.starts.push(options); return runtime; }
  } });
  return { agent, calls, hold: promise => { pending = promise; } };
};

test('chat removes the browser role and sends the exact ten shared A7 rules once, retaining model identity', async t => {
  const { a, b } = await fixture(t);
  const expected = [
    'Treat interruptions as updates to the active task. Complete earlier unfinished requests alongside new requests when they do not conflict. Follow the latest instruction for conflicting parts; drop earlier work only when explicitly cancelled or replaced. Update the plan with update_plan when available.',
    'Instructions vs data', 'Think before acting', 'Be decisive otherwise', 'Minimum & surgical',
    'Endpoints are grounded, not guessed', 'Verify against the goal', 'Name conflicts', 'Report honestly',
    'Link every file you produce.'
  ];
  assert.equal(A7_DISCIPLINE, '## Discipline\n' + expected.map(line => '- ' + line).join('\n'));
  assert.doesNotMatch(A7_DISCIPLINE, /[()（）]|[^\x00-\x7F]/);
  const h = hostAgent(MaestroAgent);
  await h.agent.setProjectRoot(a); await h.agent.prompt('start');
  const text = h.calls.starts[0].systemPrompt;
  assert.equal(text, h.agent.composedSystemPrompt());
  assert.equal(text.split(A7_DISCIPLINE).length - 1, 1);
  assert.doesNotMatch(text, /Your additional responsibility|operator of the built-in browser|Navigation recovery is your job/);
  assert.ok(text.indexOf('规则 A') < text.indexOf(A7_DISCIPLINE));
  assert.ok(text.indexOf(A7_DISCIPLINE) < text.indexOf('## Which model you are'));
  assert.match(text, /provider id/);
  await h.agent.setProjectRoot(b);
  const updated = h.calls.updates.at(-1);
  assert.equal(updated.split(A7_DISCIPLINE).length - 1, 1);
  assert.doesNotMatch(updated, /规则 A/);
  await h.agent.oneShot('generate');
  assert.equal(h.calls.starts.at(-1).systemPrompt, updated);
  class SpecializedAgent extends BaseAgent { systemPrompt() { return 'SPECIALIZED ROLE'; } }
  const specialized = hostAgent(SpecializedAgent).agent.composedSystemPrompt();
  assert.ok(specialized.indexOf(A7_DISCIPLINE) < specialized.indexOf('SPECIALIZED ROLE'));
});

test('A6 reads exactly the project root file and preserves its text; missing, empty and other errors are distinct', async t => {
  const { dir, a, b } = await fixture(t);
  assert.equal(await readProjectInstructions(), '');
  const text = await readProjectInstructions(a);
  assert.ok(text.endsWith('规则 A\n'));
  assert.ok(text.includes(join(a, 'AGENTS.md')));
  assert.doesNotMatch(text, /PARENT MUST|CLAUDE MUST/);
  const child = join(a, 'child'); await fs.mkdir(child);
  assert.equal(await readProjectInstructions(child), '');
  await fs.writeFile(join(b, 'AGENTS.md'), '\n  ');
  assert.equal(await readProjectInstructions(b), '');
  await assert.rejects(readProjectInstructions('relative'), /absolute project root/);
  await fs.rm(join(b, 'AGENTS.md')); await fs.mkdir(join(b, 'AGENTS.md'));
  await assert.rejects(readProjectInstructions(b), /Could not read project instructions/);
  assert.equal(await readProjectInstructions(join(dir, 'absent')), '');
});

test('project changes refresh the same runtime, inspection keeps applied bytes, and sessions remain isolated', async t => {
  const { a, b } = await fixture(t);
  const first = hostAgent(), second = hostAgent();
  await first.agent.setProjectRoot(a); await second.agent.setProjectRoot(b);
  await first.agent.prompt('start');
  assert.equal(first.calls.starts.length, 1);
  assert.equal(first.calls.starts[0].systemPrompt, first.agent.composedSystemPrompt());
  assert.ok(first.agent.composedSystemPrompt().indexOf('A session may assign') < first.agent.composedSystemPrompt().indexOf('规则 A'));
  await fs.writeFile(join(a, 'AGENTS.md'), 'EDITED A');
  assert.match(first.agent.composedSystemPrompt(), /规则 A/);
  await first.agent.setProjectRoot(a);
  assert.match(first.agent.composedSystemPrompt(), /EDITED A/);
  assert.equal(first.calls.updates.at(-1), first.agent.composedSystemPrompt());
  await first.agent.setProjectRoot(b);
  assert.doesNotMatch(first.agent.composedSystemPrompt(), /EDITED A|规则 A/);
  assert.match(first.agent.composedSystemPrompt(), /RULE B/);
  assert.match(second.agent.composedSystemPrompt(), /RULE B/);
  first.calls.rejectUpdate = true;
  await assert.rejects(first.agent.setProjectRoot(a), /update rejected/);
  assert.match(first.agent.composedSystemPrompt(), /RULE B/);
  first.calls.rejectUpdate = false;
  await first.agent.setProjectRoot();
  assert.doesNotMatch(first.agent.composedSystemPrompt(), /Project instructions|RULE B/);
  await first.agent.prompt('continue');
  assert.equal(first.calls.starts.length, 1);
  assert.equal(first.calls.aborts, 0);
});

test('a running turn freezes its project snapshot and keeps it through steering', async t => {
  const { a, b } = await fixture(t);
  const h = hostAgent(); await h.agent.setProjectRoot(a);
  let release; h.hold(new Promise(done => { release = done; }));
  const running = h.agent.prompt('start');
  while (!h.calls.prompts.length) await new Promise(done => setImmediate(done));
  const applied = h.agent.composedSystemPrompt();
  await h.agent.setProjectRoot(b);
  assert.equal(h.agent.composedSystemPrompt(), applied);
  assert.equal(h.calls.updates.length, 0);
  const steering = h.agent.steerActiveTurn('steer');
  release(); await running; assert.equal((await steering).outcome, 'delivered');
  h.hold(undefined);
  await h.agent.setProjectRoot(b);
  assert.match(h.agent.composedSystemPrompt(), /RULE B/);
});

test('host workspace binding resolves A to B and clearing the UI project removes A6 without using default root', async t => {
  const { a, b } = await fixture(t);
  const state = { workspaceRefs: new Map(), _state: { agentSessionKey: id => id || 'default' }, broadcastWorkspaceChanged() {}, async persistDefaultWorkspace() {}, workspaceRefFromPath: path => ({ path }), async removeDefaultWorkspaceIfPathMatches() {} };
  const file = 'src/main/maestro/windows/main/workspaceFile.service.ts';
  for (const name of ['projectRootForSession', 'setWorkspaceDirectory', 'clearWorkspaceRef', 'syncWorkspaceFromContext']) {
    state[name] = method(file, name, { resolve, statSync, workspaceNameForPath: path => path });
  }
  const h = hostAgent();
  state.syncWorkspaceFromContext('chat', { path: a });
  await h.agent.setProjectRoot(state.projectRootForSession('chat')); await h.agent.prompt('first');
  assert.match(h.agent.composedSystemPrompt(), /规则 A/);
  state.syncWorkspaceFromContext('chat', { path: b });
  await h.agent.setProjectRoot(state.projectRootForSession('chat'));
  assert.match(h.agent.composedSystemPrompt(), /RULE B/);
  state.workspaceRefs.set('default', { path: a });
  await state.setWorkspaceDirectory({ sessionId: 'chat', path: '' });
  state.syncWorkspaceFromContext('chat', undefined);
  assert.equal(state.projectRootForSession('chat'), undefined);
  await h.agent.setProjectRoot(state.projectRootForSession('chat'));
  assert.doesNotMatch(h.agent.composedSystemPrompt(), /Project instructions/);
});

test('real pi refresh retains tools and compacted messages and survives the next provider request', async () => {
  const pi = await import('@earendil-works/pi-coding-agent');
  const { Agent } = await import('@earendil-works/pi-agent-core');
  const { convertToLlm } = await import(pathToFileURL(resolve(root, 'node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js')).href);
  const { createAssistantMessageEventStream } = await import(pathToFileURL(resolve(root, 'node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js')).href);
  const source = resolveRuntimeSystemPrompt({ systemPrompt: 'HOST A', cwd: '/fixture/project' });
  const manager = pi.SessionManager.inMemory('/fixture/project');
  const first = manager.appendMessage({ role: 'user', content: 'old original', timestamp: 1 });
  const kept = manager.appendMessage({ role: 'user', content: 'recent retained', timestamp: 2 });
  manager.appendCompaction('effective summary', kept, 100);
  const calls = [];
  const model = { id: 'fixture', name: 'fixture', provider: 'fixture', api: 'openai-responses', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1000 };
  const agent = new Agent({ convertToLlm, initialState: { model, messages: manager.buildSessionContext().messages }, streamFn: async (_model, context) => {
    calls.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages), tools: context.tools.map(tool => tool.name) });
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: 'stop', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 3 } });
    return stream;
  } });
  const session = new pi.AgentSession({ agent, sessionManager: manager, settingsManager: pi.SettingsManager.inMemory({ compaction: { enabled: false } }), cwd: source.cwd, resourceLoader: createPiResourceLoader(pi, () => source.hostText), modelRuntime: { hasConfiguredAuth: () => true, getModel: () => model }, initialActiveToolNames: ['read', 'ls'] });
  const runtime = new PiRuntimeSession(session, undefined, source);
  const beforeMessages = structuredClone(session.messages), beforeEntries = structuredClone(manager.getEntries()), beforeTools = session.getActiveToolNames();
  runtime.setSystemPrompt('HOST B\n\nPROJECT RULES');
  assert.deepEqual(session.messages, beforeMessages);
  assert.deepEqual(manager.getEntries(), beforeEntries);
  assert.deepEqual(session.getActiveToolNames(), beforeTools);
  assert.match(session.systemPrompt, /HOST B\n\nPROJECT RULES/);
  await session.prompt('next');
  assert.equal(calls.length, 1, JSON.stringify(session.messages.at(-1)));
  assert.equal(calls[0].systemPrompt, session.systemPrompt);
  assert.match(calls[0].systemPrompt, /PROJECT RULES/);
  assert.doesNotMatch(calls[0].systemPrompt, /HOST A/);
  assert.match(JSON.stringify(calls[0].messages), /effective summary/);
  assert.doesNotMatch(JSON.stringify(calls[0].messages), /old original/);
  assert.equal(manager.getEntry(first).message.content, 'old original');
  assert.deepEqual(session.getActiveToolNames(), beforeTools);
  await session.dispose();
});
