import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const read = path => readFileSync(resolve(root, path), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText;
const loader = (dependencies = {}, runtimeProcess = process) => {
  const cache = new Map();
  const load = path => {
    const file = resolve(root, path.endsWith('.ts') ? path : `${path}.ts`);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    new Function('require', 'module', 'exports', 'process', compile(read(file)))(specifier => {
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      if (specifier.startsWith('.')) return load(resolve(dirname(file), specifier));
      return require(specifier);
    }, module, module.exports, runtimeProcess);
    return module.exports;
  };
  return load;
};
const method = (path, name, bindings = {}) => {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const member = ast.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members])
    .find(node => node.name?.getText(ast) === name);
  assert.ok(member, `${path}: ${name}`);
  const code = compile(`class Actual { ${member.getText(ast)} }`);
  return new Function(...Object.keys(bindings), `${code}; return Actual.prototype.${name};`)(...Object.values(bindings));
};
const labels = loader()('src/renderer/common/i18n/en.ts').en.maestroControl.chat;
const i18nHelper = { getMessages: () => ({ maestroControl: { chat: labels } }) };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const boot = (setModelIoRoot, userData) => {
  const path = 'src/main/app.main.ts';
  const source = read(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const call = ast.statements.find(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'setModelIoRoot');
  assert.ok(call, 'host startup must configure the real logger');
  assert.ok(call.pos > source.indexOf('configureE2EUserData();'), 'configure logging after profile/test storage isolation');
  new Function('setModelIoRoot', 'app', 'join', compile(call.getText(ast)))(
    setModelIoRoot, { getPath: name => { assert.equal(name, 'userData'); return userData; } }, join
  );
};
const harness = (userData, filesystem = fs) => {
  const load = loader({ 'fs/promises': filesystem });
  const { modelIoLog, setModelIoRoot } = load('src/main/agent/runtime/modelIoLog.ts');
  const { runInAgentSession } = load('src/main/agent/runtime/agentSessionContext.ts');
  const { BaseAgent } = load('src/main/agent/BaseAgent.ts');
  boot(setModelIoRoot, userData);
  const copied = [], opened = [];
  const state = {
    agentSessionKey: id => id.trim(),
    assertAgentRuntimeActive: () => { throw new Error('Directory operations must not start a runtime'); },
    openError: '', openReject: null
  };
  const bindings = { modelIoLog, i18nHelper, clipboard: { writeText: path => copied.push(path) }, shell: {
    openPath: async path => { opened.push(path); if (state.openReject) throw state.openReject; return state.openError; }
  } };
  for (const name of ['resolveSessionIoDirectory', 'copySessionIoPath', 'openSessionIoDirectory']) {
    state[name] = method('src/main/agent/maestroAgent.service.ts', name, bindings);
  }
  const agent = () => new BaseAgent({
    providerId: 'openai-codex', modelId: 'gpt-5.6-luna', buildTools: () => [],
    describeTarget: () => ({ providerLabel: 'Codex', modelLabel: 'Luna', supplier: 'fixture' }),
    runtime: { createSession: async () => ({ subscribe: () => () => {}, prompt: async () => {}, abort: async () => {} }) }
  });
  return { modelIoLog, runInAgentSession, state, copied, opened, agent };
};
const fixture = async t => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'bl-session-io-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
};
const rowsIn = async dir => {
  const parts = (await fs.readdir(dir)).filter(name => /^part-\d{3,}\.jsonl$/.test(name)).sort();
  return (await Promise.all(parts.map(name => fs.readFile(join(dir, name), 'utf8')))).join('')
    .trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
};

test('first prompt needs no reset; immediate copy waits for directory creation and successful queued writes', async t => {
  const userData = await fixture(t);
  const opening = deferred(), writing = deferred(), writeStarted = deferred();
  const h = harness(userData, {
    ...fs,
    mkdir: async (...args) => { await opening.promise; return fs.mkdir(...args); },
    appendFile: async (...args) => { writeStarted.resolve(); await writing.promise; return fs.appendFile(...args); }
  });
  const turn = h.runInAgentSession('first', () => h.agent().prompt('first full prompt'));
  const copying = h.state.copySessionIoPath({ sessionId: 'first' });
  try {
    await turn;
    assert.deepEqual(h.copied, []);
    opening.resolve();
    await writeStarted.promise;
    assert.deepEqual(h.copied, [], 'an empty newly created directory is not a saved log');
    writing.resolve();
    const result = await copying;
    assert.equal(result.ok, true, result.error);
    assert.ok(isAbsolute(result.path));
    assert.equal(dirname(result.path), join(userData, 'agent-io'));
    assert.match(result.path, /-first$/);
    const rows = await rowsIn(result.path);
    assert.ok(rows.some(row => row.kind === 'prompt' && row.text === 'first full prompt'));
    assert.ok(rows.some(row => row.kind === 'turn_end'));
    assert.deepEqual(h.copied, [result.path]);
  } finally {
    opening.resolve(); writing.resolve();
    await Promise.all([turn, copying]);
  }
});

test('parallel sessions retain their own logs and a fresh logger resolves saved history without creating anything', async t => {
  const userData = await fixture(t);
  const h = harness(userData);
  await Promise.all(['A', 'B'].map(id => h.runInAgentSession(id, () => h.agent().prompt(`prompt for ${id}`))));
  const results = await Promise.all(['A', 'B'].map(sessionId => h.state.copySessionIoPath({ sessionId })));
  assert.notEqual(results[0].path, results[1].path);
  for (let index = 0; index < results.length; index++) {
    assert.equal(results[index].ok, true);
    const prompts = (await rowsIn(results[index].path)).filter(row => row.kind === 'prompt');
    assert.deepEqual(prompts.map(row => row.text), [`prompt for ${['A', 'B'][index]}`]);
  }
  const restarted = harness(userData, { ...fs, mkdir: async () => { throw new Error('lookup must never create directories'); } });
  assert.deepEqual(await restarted.state.copySessionIoPath({ sessionId: 'A' }), results[0]);
});

test('missing, empty, unreadable and failed-write logs never copy a directory or create one for lookup', async t => {
  const userData = await fixture(t);
  const h = harness(userData);
  const missing = await h.state.copySessionIoPath({ sessionId: 'old' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /No saved model I\/O log/);
  assert.match(missing.error, /new message/i);
  assert.deepEqual(await fs.readdir(userData), []);
  const empty = join(userData, 'agent-io', '20260915000000000-old');
  await fs.mkdir(empty, { recursive: true });
  await fs.writeFile(join(empty, 'part-001.jsonl'), '');
  assert.equal((await h.state.copySessionIoPath({ sessionId: 'old' })).ok, false);
  const failed = harness(userData, { ...fs, appendFile: async () => { throw new Error('fixture disk full'); } });
  const reply = await failed.runInAgentSession('failed', () => failed.agent().prompt('do not lose the model reply'));
  assert.equal(reply.ok, true, 'diagnostic failure cannot fail the model turn');
  assert.equal((await failed.state.copySessionIoPath({ sessionId: 'failed' })).ok, false);
  assert.deepEqual(failed.copied, []);
  const unreadable = harness(userData, { ...fs, readdir: async () => { throw new Error('fixture permission denied'); } });
  assert.equal((await unreadable.state.copySessionIoPath({ sessionId: 'old' })).ok, false);
  assert.deepEqual(unreadable.copied, []);
  assert.deepEqual(h.copied, []);
});

test('disk lookup matches the complete session ID, skips an empty directory and accepts a saved part after 999', async t => {
  const userData = await fixture(t);
  const saved = join(userData, 'agent-io', '20260915000000000-old');
  const empty = join(userData, 'agent-io', '20260915000000001-old');
  const other = join(userData, 'agent-io', '20260915000000002-prefix-old');
  await fs.mkdir(saved, { recursive: true }); await fs.mkdir(empty);
  await fs.mkdir(other);
  await fs.writeFile(join(other, 'part-001.jsonl'), '{"kind":"prompt","text":"another session"}\n');
  await fs.writeFile(join(saved, 'part-1000.jsonl'), '{"kind":"prompt","text":"saved"}\n');
  await fs.mkdir(join(empty, 'part-001.jsonl'));
  const h = harness(userData);
  assert.deepEqual(await h.state.copySessionIoPath({ sessionId: 'old' }), { ok: true, path: saved });
});

test('open uses the same resolved directory without clipboard writes and surfaces shell errors', async t => {
  const userData = await fixture(t);
  const h = harness(userData);
  assert.equal((await h.state.openSessionIoDirectory({ sessionId: 'missing' })).ok, false);
  assert.deepEqual(h.opened, []);
  await h.runInAgentSession('open', () => h.agent().prompt('open fixture'));
  const opened = await h.state.openSessionIoDirectory({ sessionId: 'open' });
  assert.equal(opened.ok, true, opened.error);
  assert.deepEqual(h.opened, [opened.path]);
  assert.deepEqual(h.copied, []);
  const copied = await h.state.copySessionIoPath({ sessionId: 'open' });
  assert.equal(opened.path, copied.path);
  h.state.openError = 'File manager refused the directory';
  assert.deepEqual(await h.state.openSessionIoDirectory({ sessionId: 'open' }), { ok: false, error: h.state.openError });
  h.state.openReject = new Error('Shell unavailable');
  assert.deepEqual(await h.state.openSessionIoDirectory({ sessionId: 'open' }), { ok: false, error: 'Shell unavailable' });
  assert.deepEqual(h.copied, [copied.path]);
});

test('native session menu dispatches the requested row through XPC, cancels cleanly and uses platform labels', async () => {
  for (const platform of ['darwin', 'win32']) {
    let template, popup;
    const load = loader({
      electron: { Menu: { buildFromTemplate: items => { template = items; return { popup: options => { popup = options; } }; } } },
      '@main/i18n/i18n.helper': { i18nHelper }
    }, { platform });
    const { showMaestroSessionMenu } = load('src/main/maestro/windows/main/maestroSessionMenu.service.ts');
    const window = new EventEmitter();
    window.isDestroyed = () => false;
    const actions = [];
    const controller = {
      browserWindow: window,
      agentService: {
        copySessionIoPath: async params => { actions.push(['copy', params]); return { ok: true, path: '/saved/right-clicked' }; },
        openSessionIoDirectory: async params => { actions.push(['open', params]); return { ok: false, error: 'shell refused' }; }
      }
    };
    controller.showSessionMenu = method('src/main/maestro/windows/main/maestroWindow.controller.ts', 'showSessionMenu', { showMaestroSessionMenu });
    const request = method('src/main/maestro/xpc/coach.handler.ts', 'showSessionMenu', { maestroWindowHelper: controller });
    const copying = request({ sessionId: 'right-clicked' });
    assert.equal(template[0].label, labels.copySessionPath);
    assert.equal(template[1].label, platform === 'darwin' ? labels.openSessionFinder : labels.openSessionExplorer);
    template[0].click(); popup.callback();
    assert.deepEqual(await copying, { ok: true, action: 'copy', path: '/saved/right-clicked' });
    assert.deepEqual(actions, [['copy', { sessionId: 'right-clicked' }]]);
    const opening = request({ sessionId: 'another' }); template[1].click();
    assert.deepEqual(await opening, { ok: false, error: 'shell refused' });
    assert.deepEqual(actions[1], ['open', { sessionId: 'another' }]);
    const cancelled = request({ sessionId: 'untouched' }); popup.callback();
    assert.deepEqual(await cancelled, { ok: true, action: null });
    assert.equal(actions.length, 2);
    const closing = request({ sessionId: 'untouched' }); window.emit('closed');
    assert.deepEqual(await closing, { ok: true, action: null });
    assert.equal(window.listenerCount('closed'), 0);
  }
});
