import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const runtimeDir = resolve(import.meta.dirname, '../../src/main/agent/runtime');
const buildSystemPromptPath = resolve(import.meta.dirname, '../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js');
const { buildSystemPrompt } = await import(pathToFileURL(buildSystemPromptPath).href);
const loader = (externals = {}) => {
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const { outputText, diagnostics } = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    });
    assert.equal(diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    const nativeRequire = createRequire(file);
    new Function('require', 'module', 'exports', outputText)(name => {
      if (Object.hasOwn(externals, name)) return externals[name]();
      if (name.startsWith('.')) return load(resolve(dirname(file), `${name}.ts`));
      return nativeRequire(name);
    }, module, module.exports);
    return module.exports;
  };
  return name => load(join(runtimeDir, `${name}.ts`));
};

const real = loader();
const { resolveRuntimeSystemPrompt, requireSystemPrompt } = real('runtimeSystemPrompt');
const { PiRuntimeSession } = real('piRuntimeSession');
const { normalizePiEvent } = real('piRuntimeProtocol');
const { executeHostTool } = real('hostToolExecution');
const options = (overrides = {}) => ({
  target: { providerId: 'openai-codex', modelId: 'gpt-test', thinkingLevel: 'medium' },
  authPath: '/fixture/auth.json', scope: 'maestro', tools: [], systemPrompt: ' HOST SYSTEM \n\n', cwd: '/fixture/workspace',
  ...overrides
});
const harness = () => {
  const calls = { sdk: 0, schema: 0, auth: 0, sessions: [], prompts: [], events: [], modes: [], compaction: [] };
  let listener;
  const native = {
    isStreaming: false, isCompacting: false, steeringMode: 'all', autoCompactionEnabled: false,
    setSteeringMode(mode) { calls.modes.push(mode); this.steeringMode = mode; },
    setAutoCompactionEnabled(enabled) { calls.compaction.push(enabled); this.autoCompactionEnabled = enabled; },
    getSteeringMessages: () => [],
    subscribe: fn => { listener = fn; return () => { listener = null; }; },
    prompt: async (text, opts) => { calls.prompts.push({ text, opts }); },
    abort: async () => {}
  };
  const fakePi = {
    ModelRuntime: { create: async () => { calls.auth++; return {}; } },
    ModelRegistry: class { find() { return { id: 'gpt-test', contextWindow: 1234 }; } hasConfiguredAuth() { return true; } },
    defineTool: spec => spec, createExtensionRuntime: () => ({}), SessionManager: { inMemory: () => ({ memory: true }) },
    createAgentSession: async args => { calls.sessions.push(args); return { session: native }; }
  };
  const load = loader({
    './authDiagnostic': () => ({ describeAuthFile: () => { throw new Error('Auth diagnostics must not run for a configured target'); } }),
    '@earendil-works/pi-coding-agent': () => { calls.sdk++; return fakePi; },
    typebox: () => { calls.schema++; return { Type: { String: () => ({ type: 'string' }), Boolean: () => ({ type: 'boolean' }), Number: () => ({ type: 'number' }), Optional: schema => ({ optional: schema }), Object: properties => ({ type: 'object', properties }) } }; }
  });
  const { PiRuntimeAdapter } = load('piRuntimeAdapter');
  return { calls, native, adapter: new PiRuntimeAdapter(), emit: event => listener?.(event) };
};

test('missing and blank host instructions fail before SDK imports, auth or session creation', async () => {
  for (const systemPrompt of [undefined, null, '', ' \n\t']) {
    const h = harness();
    await assert.rejects(h.adapter.createSession(options({ systemPrompt })), /systemPrompt is required and must not be blank/);
    assert.deepEqual([h.calls.sdk, h.calls.schema, h.calls.auth, h.calls.sessions.length], [0, 0, 0, 0]);
  }
});

test('host prompt bytes survive pi resource mapping and match the shared final prompt', async () => {
  const h = harness();
  const supplied = options();
  await h.adapter.createSession(supplied);
  const args = h.calls.sessions[0];
  const resource = args.resourceLoader;
  assert.equal(resource.getSystemPrompt(), supplied.systemPrompt);
  assert.equal(requireSystemPrompt(supplied.systemPrompt), supplied.systemPrompt);
  assert.deepEqual(resource.getAgentsFiles(), { agentsFiles: [] });
  assert.deepEqual(resource.getSkills(), { skills: [], diagnostics: [] });
  assert.deepEqual(resource.getPrompts(), { prompts: [], diagnostics: [] });
  assert.deepEqual(resource.getThemes(), { themes: [], diagnostics: [] });
  assert.deepEqual(resource.getExtensions().extensions, []);
  assert.deepEqual(resource.getAppendSystemPrompt(), []);
  assert.deepEqual(resource.getAppendSystemPromptSources(), []);
  assert.equal(resource.getSystemPromptSource(), undefined);
  await resource.reload();
  assert.equal(resource.getSystemPrompt(), supplied.systemPrompt);
  const final = buildSystemPrompt({ customPrompt: resource.getSystemPrompt(), cwd: args.cwd, skills: resource.getSkills().skills, contextFiles: resource.getAgentsFiles().agentsFiles });
  assert.equal(final, resolveRuntimeSystemPrompt(supplied).finalSystemPrompt);
  assert.equal(args.sessionManager.memory, true);
  assert.deepEqual(h.calls.modes, ['one-at-a-time']);
  assert.deepEqual(h.calls.compaction, [true]);
});

test('cwd defaults, relative paths, home paths and file URLs resolve identically before provider mapping', () => {
  for (const [cwd, expected] of [[undefined, process.cwd()], ['relative/work', resolve('relative/work')], ['~', homedir()], ['~/work', join(homedir(), 'work')], [pathToFileURL('/tmp/with space').href, '/tmp/with space']]) {
    const prompt = resolveRuntimeSystemPrompt({ systemPrompt: '\n HOST \n', cwd });
    assert.equal(prompt.cwd, expected);
    assert.equal(buildSystemPrompt({ customPrompt: prompt.hostText, cwd: prompt.cwd }), prompt.finalSystemPrompt);
  }
});

test('tool policy preserves no-tool, host-only and builtin-plus-host allowlists', async () => {
  const tool = { name: 'host_read', description: 'host read', params: [], execute: async () => 'ok' };
  for (const [tools, builtinTools, expected] of [[[], ['read'], { noTools: 'all' }], [[tool], [], { noTools: 'builtin' }], [[tool], ['read', 'read'], { tools: ['read', 'host_read'] }]]) {
    const h = harness();
    await h.adapter.createSession(options({ tools, builtinTools }));
    const args = h.calls.sessions[0];
    assert.deepEqual(expected.tools ? args.tools : args.noTools, expected.tools ?? expected.noTools);
  }
});

test('host tool execution stays single-shot, maps output and duration, and sanitizes thrown failures', async () => {
  const h = harness();
  const debug = [];
  const received = [];
  const tools = [
    { name: 'read', description: 'read', params: [{ name: 'path', required: true }], execute: async args => { received.push(args); return 'content'; } },
    { name: 'fail', description: 'fail', params: [], execute: async () => { throw new Error('Bearer secretvalue1234'); } }
  ];
  await h.adapter.createSession(options({ tools, onDebug: event => debug.push(event) }));
  const mapped = h.calls.sessions[0].customTools;
  const result = await mapped[0].execute('tool-1', { path: '/fixture' });
  assert.deepEqual(received, [{ path: '/fixture' }]);
  assert.deepEqual(result.content, [{ type: 'text', text: 'content' }]);
  assert.equal(typeof result.details.durationMs, 'number');
  await assert.rejects(mapped[1].execute('tool-2', {}), /Bearer \[REDACTED\]/);
  assert.equal(debug.find(e => e.phase === 'pi-tool-error').detail.error, 'Bearer [REDACTED]');
  assert.doesNotMatch(JSON.stringify(debug), /secretvalue1234/);
  assert.equal((await executeHostTool({ execute: async () => 'ERROR: failed' }, {})).text, 'ERROR: failed');
  assert.equal(normalizePiEvent({ type: 'tool_execution_end', result: { content: [{ type: 'text', text: 'ERROR: failed' }] } })[0].isError, true);
});

test('native stream, usage, compaction and tool events retain their runtime shape', async () => {
  const h = harness();
  const session = await h.adapter.createSession(options());
  const events = [];
  const unsubscribe = session.subscribe(event => events.push(event));
  h.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hello' } });
  h.emit({ type: 'tool_execution_start', toolName: 'read', args: { path: 'x' } });
  h.emit({ type: 'compaction_end', reason: 'threshold', result: { ok: true, tokensBefore: 8, tokensAfter: 4 } });
  h.emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop', usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: { total: 0.1 } } } });
  assert.deepEqual(events.map(e => e.type), ['text_delta', 'tool_start', 'compaction_end', 'usage', 'assistant_message_end']);
  assert.equal(events[3].usage.totalTokens, 14);
  assert.equal(events[3].usage.costUsd, 0.1);
  assert.equal(events[4].text, 'done');
  unsubscribe();
  h.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'ignored' } });
  assert.equal(events.length, 5);
});

test('native steering policy preserves idle/streaming/queued/compacting/aborting behavior', async () => {
  const h = harness();
  const session = await h.adapter.createSession(options());
  await session.prompt({ text: 'root' });
  h.native.isStreaming = true;
  assert.equal(session.isStreaming, true);
  await session.prompt({ text: 'steer' });
  h.native.getSteeringMessages = () => ['pending'];
  await session.prompt({ text: 'queued' });
  h.native.getSteeringMessages = () => [];
  h.native.isCompacting = true;
  await session.prompt({ text: 'compacting' });
  h.native.isCompacting = false;
  let finishAbort;
  h.native.abort = () => new Promise(resolve => { finishAbort = resolve; });
  const aborting = session.abort();
  await session.prompt({ text: 'aborting' });
  finishAbort();
  await aborting;
  await session.prompt({ text: 'after abort' });
  assert.deepEqual(h.calls.prompts.map(p => p.opts.streamingBehavior), ['steer', 'steer', 'followUp', 'followUp', 'followUp', 'steer']);
  assert.deepEqual(h.calls.prompts.map(p => p.text), ['root', 'steer', 'queued', 'compacting', 'aborting', 'after abort']);
});

test('context bridge keeps live entries and native append arguments, with unsupported fallback', () => {
  const entries = [{ type: 'message', message: { role: 'toolResult', content: 'full result' } }];
  const writes = [];
  const session = new PiRuntimeSession({ sessionManager: {
    getEntries: () => entries,
    appendCustomMessageEntry: (...args) => { writes.push(args); return 'custom-id'; },
    appendCompaction: (...args) => { writes.push(args); return 'compact-id'; }
  } });
  assert.equal(session.context.entries(), entries);
  assert.equal(session.context.appendCustomMessage('user-verbatim', 'original'), 'custom-id');
  assert.equal(session.context.appendCompaction('summary', 'kept', 42), 'compact-id');
  assert.deepEqual(writes, [['user-verbatim', 'original', false], ['summary', 'kept', 42]]);
  const unsupported = new PiRuntimeSession({}).context;
  assert.deepEqual(unsupported.entries(), []);
  assert.equal(unsupported.appendCustomMessage('x', 'y'), null);
  assert.equal(unsupported.appendCompaction('x', 'y', 1), null);
});
