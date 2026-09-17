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
    ModelRegistry: class { find(provider, id) { return { provider, id, contextWindow: id === 'gpt-test' ? 1234 : 272000 }; } hasConfiguredAuth() { return true; } },
    defineTool: spec => spec, createExtensionRuntime: () => ({}), SessionManager: { inMemory: () => ({ memory: true }) },
    SettingsManager: { inMemory: settings => ({ memory: true, compaction: settings.compaction }) },
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
  assert.equal(resource.getExtensions().extensions.length, 1);
  assert.equal(resource.getExtensions().extensions[0].path, '<host:native-compaction>');
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

test('relative paths, home paths and file URLs resolve identically before provider mapping', () => {
  for (const [cwd, expected] of [['relative/work', resolve('relative/work')], ['~', homedir()], ['~/work', join(homedir(), 'work')], [pathToFileURL('/tmp/with space').href, '/tmp/with space']]) {
    const prompt = resolveRuntimeSystemPrompt({ systemPrompt: '\n HOST \n', cwd });
    assert.equal(prompt.cwd, expected);
    assert.equal(buildSystemPrompt({ customPrompt: prompt.hostText, cwd: prompt.cwd }), prompt.finalSystemPrompt);
  }
});

// The fallback this replaces made the shipped value depend on how the app was launched: `/` for a
// Finder-launched .app, the project dir for a terminal `yarn dev`. cwd is the relative-path base for
// all seven pi builtins and the literal spawn cwd for bash, so a silent default is a silent
// behaviour change. docs/features/agent-cwd-follows-workspace.md
test('an absent or blank cwd throws instead of falling back to the process working directory', () => {
  for (const cwd of [undefined, null, '', '   ']) {
    assert.throws(
      () => resolveRuntimeSystemPrompt({ systemPrompt: 'HOST', cwd }),
      /cwd is required/,
      `cwd=${JSON.stringify(cwd)} must be rejected`
    );
  }
});

// pi reads `<cwd>/.pi/settings.json` as TRUSTED project settings when the host passes no
// settingsManager, and that file supplies the bash tool's shellCommandPrefix. Harmless while cwd was
// `/`; once cwd follows a user-chosen workspace, any opened repository could wrap every bash call.
test('the pi session is created with an in-memory settings manager so a workspace cannot supply project settings', async () => {
  const h = harness();
  await h.adapter.createSession(options({}));
  const args = h.calls.sessions[0];
  assert.ok(args.settingsManager, 'a settingsManager must be supplied; omitting it lets pi read <cwd>/.pi/settings.json');
  assert.equal(args.settingsManager.memory, true);
});

test('tool policy preserves no-tool, host-only and builtin-plus-host allowlists', async () => {
  const tool = { name: 'host_read', description: 'host read', params: [], execute: async () => 'ok' };
  for (const [tools, builtinTools, expected] of [[[], [], { noTools: 'all' }], [[], ['read'], { noTools: 'all' }], [[tool], [], { noTools: 'builtin' }], [[tool], ['read', 'read'], { tools: ['read', 'host_read'] }]]) {
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
  h.emit({ type: 'compaction_end', reason: 'threshold', result: { tokensBefore: 8, estimatedTokensAfter: 4 } });
  h.emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop', usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: { total: 0.1 } } } });
  assert.deepEqual(events.map(e => e.type), ['text_delta', 'tool_start', 'compaction_end', 'usage', 'assistant_message_end']);
  assert.equal(events[2].afterTokens, 4);
  assert.equal(events[2].ok, true);
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

test('context bridge preserves raw entries, exposes effective entries and synchronizes every native append', () => {
  const entries = [{ id: 'old', type: 'message', message: { role: 'toolResult', content: 'full result' } }];
  const effectiveEntries = [{ id: 'compact-id', type: 'compaction', summary: 'summary' }];
  const state = { messages: [{ role: 'toolResult', content: 'full result' }] };
  let projectedMessages = [{ role: 'compactionSummary', summary: 'summary' }];
  const writes = [];
  const context = new PiRuntimeSession({ agent: { state }, sessionManager: {
    getEntries: () => entries,
    buildContextEntries: () => effectiveEntries,
    buildSessionContext: () => ({ messages: projectedMessages }),
    appendCustomMessageEntry: (...args) => { writes.push(args); return 'custom-id'; },
    appendCompaction: (...args) => { writes.push(args); return 'compact-id'; }
  } }).context;
  assert.equal(context.entries(), entries);
  assert.equal(context.contextEntries(), effectiveEntries);
  assert.equal(context.appendCompaction('summary', 'kept', 42), 'compact-id');
  assert.deepEqual(state.messages, projectedMessages);
  projectedMessages = [...projectedMessages, { role: 'custom', content: 'original' }];
  assert.equal(context.appendCustomMessage('user-verbatim', 'original'), 'custom-id');
  assert.deepEqual(state.messages, projectedMessages);
  projectedMessages = [...projectedMessages, { role: 'custom', content: 'retained files' }];
  assert.equal(context.appendCustomMessage('manifest', 'retained files'), 'custom-id');
  assert.deepEqual(state.messages, projectedMessages);
  assert.equal(context.entries(), entries);
  assert.deepEqual(writes, [['summary', 'kept', 42], ['user-verbatim', 'original', false], ['manifest', 'retained files', false]]);
});

test('context bridge refuses writes before mutation when live synchronization is unsupported', () => {
  for (const missing of ['buildSessionContext', 'agent', 'state']) {
    const writes = [];
    const native = {
      agent: { state: { messages: [] } },
      sessionManager: {
        buildSessionContext: () => ({ messages: [] }),
        appendCustomMessageEntry: (...args) => { writes.push(args); return 'custom-id'; },
        appendCompaction: (...args) => { writes.push(args); return 'compact-id'; }
      }
    };
    if (missing === 'buildSessionContext') delete native.sessionManager.buildSessionContext;
    else if (missing === 'agent') delete native.agent;
    else delete native.agent.state;
    const context = new PiRuntimeSession(native).context;
    assert.equal(context.appendCustomMessage('user-verbatim', 'original'), null, missing);
    assert.equal(context.appendCompaction('summary', 'kept', 42), null, missing);
    assert.deepEqual(writes, [], missing);
  }
});

test('context append failures do not synchronize stale messages or report success', () => {
  for (const append of [undefined, () => undefined, () => { throw new Error('append failed'); }]) {
    const original = [{ role: 'user', content: 'unchanged live context' }];
    const state = { messages: original };
    let projections = 0;
    const context = new PiRuntimeSession({ agent: { state }, sessionManager: {
      buildSessionContext: () => { projections++; return { messages: [] }; },
      appendCustomMessageEntry: append,
      appendCompaction: append
    } }).context;
    assert.equal(context.appendCompaction('summary', 'kept', 42), null);
    assert.equal(context.appendCustomMessage('manifest', 'files'), null);
    assert.equal(projections, 0, 'a failed append must not reset live context');
    assert.equal(state.messages, original);
  }
});

test('context synchronization runs after append and a projection failure is reported as failed', () => {
  const calls = [];
  const original = [{ role: 'user', content: 'live context' }];
  const state = { messages: original };
  const context = new PiRuntimeSession({ agent: { state }, sessionManager: {
    appendCompaction: () => { calls.push('append'); return 'compact-id'; },
    buildSessionContext: () => { calls.push('project'); throw new Error('projection failed'); }
  } }).context;
  assert.equal(context.appendCompaction('summary', 'kept', 42), null);
  assert.deepEqual(calls, ['append', 'project']);
  assert.equal(state.messages, original);
});

test('unsupported effective context fails explicitly without falling back to raw entries', () => {
  const entries = [{ type: 'message', message: { role: 'toolResult', content: 'full result' } }];
  const context = new PiRuntimeSession({ sessionManager: { getEntries: () => entries } }).context;
  assert.equal(context.entries(), entries);
  assert.throws(() => context.contextEntries(), /does not support reading effective context entries/);
  const unsupported = new PiRuntimeSession({}).context;
  assert.deepEqual(unsupported.entries(), []);
  assert.throws(() => unsupported.contextEntries(), /does not support reading effective context entries/);
  assert.equal(unsupported.appendCustomMessage('x', 'y'), null);
  assert.equal(unsupported.appendCompaction('x', 'y', 1), null);
});

test('model selection applies exact Codex compaction policy on every new session while children remain disabled', async () => {
  const h=harness()
  for(const id of ['gpt-6-astra','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna']) {
    await h.adapter.createSession(options({target:{providerId:'openai-codex',modelId:id}}))
    assert.deepEqual(h.calls.sessions.at(-1).settingsManager.compaction,{enabled:true,reserveTokens:54400,keepRecentTokens:27200})
  }
  await h.adapter.createSession(options({target:{providerId:'openai-codex',modelId:'gpt-6-astra'},autoCompaction:false}))
  assert.deepEqual(h.calls.sessions.at(-1).settingsManager.compaction,{enabled:false,reserveTokens:54400,keepRecentTokens:27200})
  await h.adapter.createSession(options())
  assert.deepEqual(h.calls.sessions.at(-1).settingsManager.compaction,{enabled:true,reserveTokens:16384,keepRecentTokens:20000})
})
