import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import ts from 'typescript';

/**
 * 宿主工具的结果进 agent-io(docs/plan/tasks/agent-io-tool-results-205.md;
 * docs/issues/builtin-tools-skip-host-result-hooks.md「修法(已定:agent-io 补记)」)。
 *
 * 原来 `HostToolRegistry.toRuntimeTools()` 不包计量壳:盘上 31 个 agent-io 文件 0 条 `tool_result`,
 * `turn_end` 永远「本轮工具结果 0 tok / 0 次」。所以这里 inputBudget 与 modelIoLog 都用**真的**
 * (落点指到临时目录),断言读回来的 jsonl 里真有那一行 —— 而不是某个桩被调用过。
 *
 * 不是聊天 agent 自己模型输入的调用不计量(`toUnmeasuredTools()`):界面直接调用(Skills 页的
 * `manageSkillInstallation`),以及工作流子 agent 的工具(结果已由工作流 worker 记进聊天那一份)。
 * 聊天 agent 的工具仍走计量的那条路。这几条都在文件后半,跑的是从真实源码里取出来的方法。
 */
const root = resolve(import.meta.dirname, '../..');
const aliases = [
  ['@maestro-main/', 'src/main/maestro/'],
  ['@maestro-shared/', 'src/shared/maestro/'],
  ['@main/', 'src/main/'],
  ['@shared/', 'src/shared/']
];

// 每个 loader 一份模块缓存,按解析后的文件记:hostToolRegistry 里 `@main/agent/runtime/inputBudget`
// 拿到的,与这里直接加载的是同一个实例 —— 否则账本记在一份上、断言读另一份。`stubs` 按 import 名替换。
const loader = (stubs = {}) => {
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
      if (Object.hasOwn(stubs, name)) return stubs[name];
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

const fromRoot = loader();
const { HostToolRegistry } = fromRoot('src/main/agent/runtime/hostToolRegistry.ts');
const { inputBudget } = fromRoot('src/main/agent/runtime/inputBudget.ts');
const { modelIoLog, setModelIoRoot, UNATTRIBUTED_IO_SESSION } = fromRoot('src/main/agent/runtime/modelIoLog.ts');
const { runInAgentSession } = fromRoot('src/main/agent/runtime/agentSessionContext.ts');

const ioRoot = mkdtempSync(join(tmpdir(), 'bl-host-tool-results-'));
setModelIoRoot(() => ioRoot);

// 每个用例一个会话:行按会话键分桶落盘,各读各的。
const sessions = [];
const nextSession = (key = `host-tool-results-${sessions.length + 1}`) => {
  sessions.push(key);
  return key;
};

after(async () => {
  // 先等每个会话的写队列排空,再删目录 —— 否则收尾的写入撞上已删的目录,会打出一条写入失败。
  for (const key of [...sessions, UNATTRIBUTED_IO_SESSION]) await modelIoLog.dirForSession(key);
  rmSync(ioRoot, { recursive: true, force: true });
});

// 回合号推到 2:行里的 `turn` 必须是账本当下的回合号,写死 0 或 1 都会在这里露馅。
beforeEach(() => {
  inputBudget.reset();
  inputBudget.turnStart();
  inputBudget.turnStart();
});

const spec = (name, execute, fields = {}) => ({ name, description: `${name} fixture`, params: [], execute, ...fields });
const confirmPolicy = (toolName) => ({ [toolName]: { toolName, mode: 'confirm', updatedAt: 1 } });
const deferred = () => {
  let resolveIt;
  const promise = new Promise((done) => { resolveIt = done; });
  return { promise, resolve: resolveIt };
};

const toolResults = async (key, log = modelIoLog) => {
  const dir = await log.dirForSession(key);
  if (!dir) return [];
  return readFileSync(join(dir, 'session.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.kind === 'tool_result')
    .map(({ name, subject, text, turn }) => ({ name, subject, text, turn }));
};

// 本轮账本里这个工具那一栏。
const budgetOf = (tool) => {
  const row = inputBudget.report().turn.top.find((item) => item.tool === tool);
  return row && { calls: row.calls, bytes: row.bytes, maxSubject: row.maxSubject };
};

test('a bypass tool writes one tool_result with its text and counts utf-8 bytes in inputBudget', async () => {
  const out = '已读取 ✓ 3 行';
  const args = { url: 'https://example.test/a', body: '请求体不进标签' };
  const [tool] = new HostToolRegistry({ scope: 'cowork' })
    .add(spec('probe_read', async () => out, { timeoutMs: 1234, downloadSettleMs: 0 }))
    .toRuntimeTools();
  // 壳是 `...tool` 展开的:工具自己的声明要原样留着,bindPiTools 与 executeHostTool 读的就是它们。
  assert.equal(tool.timeoutMs, 1234);
  assert.equal(tool.downloadSettleMs, 0);

  const key = nextSession();
  assert.equal(await runInAgentSession(key, () => tool.execute(args)), out);

  const subject = 'url=https://example.test/a';
  const bytes = Buffer.byteLength(out, 'utf8');
  assert.notEqual(bytes, out.length, 'fixture must be multi-byte so a character count cannot pass');
  assert.deepEqual(await toolResults(key), [{ name: 'probe_read', subject, text: out, turn: 2 }]);
  assert.deepEqual(budgetOf('probe_read'), { calls: 1, bytes, maxSubject: subject });
});

test('a throwing tool writes one "<name> (threw)" row, counts in inputBudget, and rethrows the same error', async () => {
  const failure = new Error('拒绝访问:没有权限');
  const [tool] = new HostToolRegistry({ scope: 'cowork' })
    .add(spec('probe_fail', async () => { throw failure; }))
    .toRuntimeTools();

  const key = nextSession();
  await assert.rejects(runInAgentSession(key, () => tool.execute({ path: 'notes/今天.md' })), (err) => err === failure);

  const subject = 'path=notes/今天.md';
  assert.deepEqual(await toolResults(key), [{ name: 'probe_fail (threw)', subject, text: failure.message, turn: 2 }]);
  // 账本按工具名记(与 Cowork 相同):失败的那笔照样占上下文,算在这个工具头上。
  assert.deepEqual(budgetOf('probe_fail'), { calls: 1, bytes: Buffer.byteLength(failure.message, 'utf8'), maxSubject: subject });
});

test('a non-string result is recorded as JSON.stringify(out ?? \'\') and handed back as the very same value', async () => {
  const payload = { ok: true, 名称: '值' };
  const [objectTool, emptyTool] = new HostToolRegistry({ scope: 'cowork' })
    .add(spec('probe_object', async () => payload), spec('probe_empty', async () => undefined))
    .toRuntimeTools();

  const key = nextSession();
  const [object, empty] = await runInAgentSession(key, async () => [await objectTool.execute({}), await emptyTool.execute({})]);
  assert.equal(object, payload, 'the caller gets the object itself, not its JSON');
  assert.equal(empty, undefined);

  const json = JSON.stringify(payload);
  assert.deepEqual(await toolResults(key), [
    { name: 'probe_object', subject: '', text: json, turn: 2 },
    { name: 'probe_empty', subject: '', text: '""', turn: 2 }
  ]);
  assert.equal(budgetOf('probe_object').bytes, Buffer.byteLength(json, 'utf8'));
  assert.equal(budgetOf('probe_empty').bytes, 2);
});

test('a confirm-policy tool is measured too, and an operator denial is recorded as (threw) and still thrown', async () => {
  let allow = true;
  let runs = 0;
  const requests = [];
  const [tool] = new HostToolRegistry({
    scope: 'cowork',
    policies: confirmPolicy('probe_write'),
    onConfirm: async (request) => {
      requests.push(request);
      return allow;
    }
  })
    .add(spec('probe_write', async () => { runs += 1; return 'written'; }))
    .toRuntimeTools();

  const key = nextSession();
  const args = { path: 'a.txt' };
  assert.equal(await runInAgentSession(key, () => tool.execute(args)), 'written');
  allow = false;
  const denied = 'Tool "probe_write" was denied by the operator.';
  await assert.rejects(runInAgentSession(key, () => tool.execute(args)), { message: denied });
  assert.equal(requests.length, 2);
  assert.equal(runs, 1, 'the denied call never reached the tool');

  // 拒绝是 confirmedTool 抛的 —— 这一行在,说明计量壳确实包在它外面。
  assert.deepEqual(await toolResults(key), [
    { name: 'probe_write', subject: 'path=a.txt', text: 'written', turn: 2 },
    { name: 'probe_write (threw)', subject: 'path=a.txt', text: denied, turn: 2 }
  ]);
  assert.equal(budgetOf('probe_write').calls, 2);
});

test('args, signal and the third argument reach the tool untouched (extra.confirm survives)', async () => {
  const seen = [];
  const [tool] = new HostToolRegistry({ scope: 'cowork' })
    .add(spec('probe_install', async (args, signal, extra) => {
      seen.push({ args, signal, extra });
      return 'ok';
    }, { deferConfirmation: true }))
    .toRuntimeTools();

  const args = { action: 'install' };
  const signal = new AbortController().signal;
  const extra = { confirm: async () => true };
  await runInAgentSession(nextSession(), () => tool.execute(args, signal, extra));

  assert.equal(seen.length, 1);
  assert.equal(seen[0].args, args);
  assert.equal(seen[0].signal, signal);
  assert.equal(seen[0].extra, extra);
  assert.equal(seen[0].extra.confirm, extra.confirm);
});

test('under a confirm policy a deferConfirmation tool still gets the signal and a working confirm; its denial is recorded as (threw)', async () => {
  const seen = [];
  const requests = [];
  const refused = 'Skill installation mutation was denied by the operator';
  const [tool] = new HostToolRegistry({
    scope: 'cowork',
    policies: confirmPolicy('probe_install'),
    onConfirm: async (request) => {
      requests.push(request);
      return false;
    }
  })
    .add(spec('probe_install', async (args, signal, extra) => {
      seen.push(signal);
      if (!(await extra.confirm({ destination: 'skills/x' }))) throw new Error(refused);
      return 'installed';
    }, { deferConfirmation: true }))
    .toRuntimeTools();

  const key = nextSession();
  const signal = new AbortController().signal;
  await assert.rejects(runInAgentSession(key, () => tool.execute({ action: 'install' }, signal)), { message: refused });

  assert.equal(seen.length, 1);
  assert.equal(seen[0], signal);
  assert.deepEqual(requests, [{ scope: 'cowork', toolName: 'probe_install', mode: 'confirm', args: { destination: 'skills/x' } }]);
  assert.deepEqual(await toolResults(key), [{ name: 'probe_install (threw)', subject: 'action=install', text: refused, turn: 2 }]);
});

test('a tool result does not wait for the agent-io disk write, and the row still lands once the disk frees up', async (t) => {
  // 卡住的盘:appendFile 等 `gate` 放行才写。目录名是 `<17 位时间戳>-<会话键>`,据此认出是哪个会话开始写了。
  const gate = deferred();
  const started = new Map();
  const writeStarted = (key) => {
    if (!started.has(key)) started.set(key, deferred());
    return started.get(key);
  };
  const disk = {
    ...fsPromises,
    appendFile: async (file, ...rest) => {
      writeStarted(basename(dirname(file)).slice(18)).resolve();
      await gate.promise;
      return fsPromises.appendFile(file, ...rest);
    }
  };
  // 另一份模块实例,只有它的 modelIoLog 用这块盘。
  const slow = loader({ 'fs/promises': disk });
  const { HostToolRegistry: SlowRegistry } = slow('src/main/agent/runtime/hostToolRegistry.ts');
  const { modelIoLog: slowLog, setModelIoRoot: setSlowRoot } = slow('src/main/agent/runtime/modelIoLog.ts');
  const { runInAgentSession: inSlowSession } = slow('src/main/agent/runtime/agentSessionContext.ts');
  const slowRoot = mkdtempSync(join(tmpdir(), 'bl-host-tool-results-slow-'));
  t.after(() => rmSync(slowRoot, { recursive: true, force: true }));
  setSlowRoot(() => slowRoot);

  const [ok, boom] = new SlowRegistry({ scope: 'cowork' })
    .add(spec('probe_ok', async () => 'done'), spec('probe_boom', async () => { throw new Error('boom'); }))
    .toRuntimeTools();
  // 谁先到:工具结果,还是这一行开始落盘。必须是结果先到 —— 等落盘就是把磁盘搬进了模型调用的热路径
  // (modelIoLog.append 的注释:「同步返回,异步落盘」)。
  const first = (key, run) => inSlowSession(key, () => Promise.race([
    run().then((value) => ({ value }), (error) => ({ error: error.message })),
    writeStarted(key).promise.then(() => ({ waitedForDisk: true }))
  ]));
  try {
    assert.deepEqual(await first('slow-ok', () => ok.execute({})), { value: 'done' });
    assert.deepEqual(await first('slow-boom', () => boom.execute({})), { error: 'boom' });
  } finally {
    gate.resolve();
    for (const key of ['slow-ok', 'slow-boom']) await slowLog.dirForSession(key);
  }
  assert.deepEqual(await toolResults('slow-ok', slowLog), [{ name: 'probe_ok', subject: '', text: 'done', turn: 0 }]);
  assert.deepEqual(await toolResults('slow-boom', slowLog), [{ name: 'probe_boom (threw)', subject: '', text: 'boom', turn: 0 }]);
});

test('toUnmeasuredTools() applies policy without measuring: disabled is absent, confirm asks and a denial throws, nothing is recorded', async () => {
  let allow = false;
  const requests = [];
  const warnings = [];
  const tools = new HostToolRegistry({
    scope: 'cowork',
    policies: { ...confirmPolicy('probe_write'), probe_off: { toolName: 'probe_off', mode: 'disabled', updatedAt: 1 } },
    onConfirm: async (request) => {
      requests.push(request);
      return allow;
    },
    onWarning: (message, detail) => warnings.push(`${message}: ${detail.tool}`)
  })
    .add(spec('probe_read', async () => 'read'), spec('probe_write', async () => 'written'), spec('probe_off', async () => 'never'))
    .toUnmeasuredTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['probe_read', 'probe_write']);
  // 与 toRuntimeTools() 一样先查目录覆盖。
  assert.deepEqual(warnings, ['host tool missing catalog entry: probe_read', 'host tool missing catalog entry: probe_write']);

  const [read, write] = tools;
  const key = nextSession();
  const denied = 'Tool "probe_write" was denied by the operator.';
  await runInAgentSession(key, async () => {
    assert.equal(await read.execute({ url: 'https://example.test/b' }), 'read');
    await assert.rejects(write.execute({ path: 'a.txt' }), { message: denied });
    allow = true;
    assert.equal(await write.execute({ path: 'a.txt' }), 'written');
  });
  assert.deepEqual(requests.map((request) => request.toolName), ['probe_write', 'probe_write']);
  assert.deepEqual(await toolResults(key), []);
  assert.equal(inputBudget.report().session.calls, 0);
});

// 从真实源码里取类成员单独编译(手法同 maestroSessionIoPath.test.mjs 的 `method`):
// controller / service 整个加载要拖进 electron 与几十个服务,为这几个方法不值。
const SERVICE = 'src/main/agent/maestroAgent.service.ts';
const CONTROLLER = 'src/main/maestro/windows/main/maestroWindow.controller.ts';
const memberNode = (rel, name) => {
  const ast = ts.createSourceFile(rel, readFileSync(resolve(root, rel), 'utf8'), ts.ScriptTarget.Latest, true);
  const node = ast.statements.filter(ts.isClassDeclaration).flatMap((item) => [...item.members])
    .find((item) => item.name?.getText(ast) === name);
  assert.ok(node, `${rel}: no class member ${name}`);
  return { ast, node };
};
const memberOf = (rel, name) => {
  const { ast, node } = memberNode(rel, name);
  return node.getText(ast);
};
const method = (rel, name, bindings = {}) => {
  const { outputText } = ts.transpileModule(`class Actual { ${memberOf(rel, name)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  return new Function(...Object.keys(bindings), `${outputText}; return Actual.prototype.${name};`)(...Object.values(bindings));
};
// 用到时才取:源码里缺了哪个方法,只让用到它的用例失败 —— 在加载时就抛,整个文件崩掉,连临时目录都清不掉。
const once = (make) => {
  let value;
  return () => (value ??= make());
};
// 三个都给 `HostToolRegistry`:哪个方法将来又自己建一份 registry,也是按行为判,而不是因为少个名字而报错。
const serviceMethods = once(() => ({
  wrapHostTools: method(SERVICE, 'wrapHostTools', { HostToolRegistry }),
  wrapHostToolsUnmeasured: method(SERVICE, 'wrapHostToolsUnmeasured', { HostToolRegistry }),
  buildHostToolRegistry: method(SERVICE, 'buildHostToolRegistry', { HostToolRegistry })
}));
const manageSkillInstallation = once(() => method(CONTROLLER, 'manageSkillInstallation'));

// 形状照 skillInstallTools.ts:`deferConfirmation`,改动类动作才借 `extra.confirm` 问人,拿不到就按允许走。
const skillInstall = () => spec('skill_install', async (args, signal, extra) => {
  if (args.action !== 'list') {
    const allowed = extra?.confirm ? await extra.confirm({ action: args.action }) : true;
    if (!allowed) throw new Error('Skill installation mutation was denied by the operator');
  }
  return JSON.stringify({ ok: true, action: args.action });
}, { deferConfirmation: true });

// 上面几个真方法跑在最小的 `this` 上:service 只带它们读到的字段,确认结果由 `allow` 定。
const agentService = (hostToolPolicies, allow) => {
  const requests = [];
  const traces = [];
  return {
    requests,
    traces,
    hostToolPolicies,
    confirmHostToolCall: async (request) => {
      requests.push(request);
      return allow;
    },
    _state: { emitTrace: (event) => traces.push(event.msg) },
    ...serviceMethods()
  };
};
const skillsPage = (policies, allow) => {
  const service = agentService(policies, allow);
  const controller = {
    agentService: service,
    skillService: { currentViewSessionId: () => 'skills-page' },
    skillInstallationTools: () => [skillInstall()]
  };
  return { requests: service.requests, manage: (params) => manageSkillInstallation().call(controller, params) };
};

test('the Skills page (manageSkillInstallation) records nothing, yet host tool policy still applies', async () => {
  assert.deepEqual(await skillsPage({}, true).manage({ action: 'list' }), { ok: true, action: 'list' });
  const disabled = { skill_install: { toolName: 'skill_install', mode: 'disabled', updatedAt: 1 } };
  await assert.rejects(skillsPage(disabled, true).manage({ action: 'list' }), { message: 'skill_install is disabled by host tool policy' });

  const refused = skillsPage(confirmPolicy('skill_install'), false);
  await assert.rejects(refused.manage({ action: 'remove', installationId: 'i1' }), { message: 'Skill installation mutation was denied by the operator' });
  assert.deepEqual(refused.requests, [{ scope: 'cowork', toolName: 'skill_install', mode: 'confirm', args: { action: 'remove' } }]);
  const approved = skillsPage(confirmPolicy('skill_install'), true);
  assert.deepEqual(await approved.manage({ action: 'remove', installationId: 'i1' }), { ok: true, action: 'remove' });
  assert.equal(approved.requests.length, 1);

  // 这条路不在任何 agent 会话里:要是被计量了,行会落进 `unattributed` 桶,账本也会多出几次。
  assert.deepEqual(await toolResults(UNATTRIBUTED_IO_SESSION), []);
  assert.equal(inputBudget.report().session.calls, 0);
});

test('both wrappers are built by one registry builder: catalog warnings reach the trace from each', () => {
  for (const wrap of ['wrapHostTools', 'wrapHostToolsUnmeasured']) {
    const service = agentService({}, true);
    service[wrap]('cowork', [spec('probe_uncatalogued', async () => '')]);
    assert.deepEqual(service.traces, [
      'host tool registry: host tool missing catalog entry {"scope":"cowork","tool":"probe_uncatalogued"}'
    ], wrap);
  }
});

test('chat agent tools stay measured: wrapHostTools still records, and buildPiTools still uses it', async () => {
  const [tool] = agentService({}, true).wrapHostTools('cowork', [skillInstall()]);
  const key = nextSession();
  await runInAgentSession(key, () => tool.execute({ action: 'list' }));
  assert.deepEqual(await toolResults(key), [
    { name: 'skill_install', subject: 'action=list', text: JSON.stringify({ ok: true, action: 'list' }), turn: 2 }
  ]);
  // 反过来那一半:聊天 agent 的工具表要是也换成不计量的那条,它们的结果又一条都不记了。
  const buildPiTools = memberOf(CONTROLLER, 'buildPiTools');
  assert.match(buildPiTools, /this\.agentService\.wrapHostTools\(/);
  assert.doesNotMatch(buildPiTools, /wrapHostToolsUnmeasured/);
});

// getWorkflowHost() 里给工作流子 agent 建工具的那个 `tools` 箭头函数,原样取出来,跑在最小的 this 上。
const workflowTools = (bindings) => {
  const { ast, node } = memberNode(SERVICE, 'getWorkflowHost');
  let arrow;
  const visit = (item) => {
    if (arrow) return;
    if (ts.isPropertyAssignment(item) && item.name.getText(ast) === 'tools' && ts.isArrowFunction(item.initializer)) arrow = item.initializer;
    else ts.forEachChild(item, visit);
  };
  visit(node);
  assert.ok(arrow, 'getWorkflowHost: no `tools` arrow function');
  const { outputText } = ts.transpileModule(`const workflowToolsArrow = (${arrow.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  return new Function(...Object.keys(bindings), `return function () { ${outputText}\nreturn workflowToolsArrow; };`)(...Object.values(bindings));
};

test('workflow sub-agents\' host tools are not measured: the workflow worker already records them in the chat\'s agent-io', async () => {
  const make = workflowTools({
    HostToolRegistry,
    buildWebSearchTools: () => [spec('web_search', async () => 'results')],
    buildWebFetchTools: () => [spec('web_fetch', async () => 'page')]
  });
  const tools = make.call({ hostToolPolicies: {}, confirmHostToolCall: async () => true })(undefined, undefined, 'chat-1');
  assert.deepEqual(tools.map((tool) => tool.name), ['web_search', 'web_fetch']);

  // hostIntegration.ts 的 executeTool 在 `workflow:<run>:<agent>`(workflowToolScope)这个会话键里跑它们。
  const key = nextSession('workflow:run-1:agent-1');
  await runInAgentSession(key, async () => {
    assert.equal(await tools[0].execute({ query: 'q' }), 'results');
    assert.equal(await tools[1].execute({ url: 'https://example.test/c' }), 'page');
  });
  // 计量了就会给这个工作流 agent 新建一个目录(挤占保留名额),并算进聊天回合的账本。
  assert.deepEqual(await toolResults(key), []);
  assert.equal(inputBudget.report().session.calls, 0);
});
