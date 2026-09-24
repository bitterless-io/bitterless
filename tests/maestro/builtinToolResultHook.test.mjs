import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/**
 * pi 自带工具(`bash` / `read` / …)的结果也要经过宿主的结果处理
 * (docs/issues/builtin-tools-skip-host-result-hooks.md;任务 builtin-tool-results-204 / agent-io-tool-results-206)。
 *
 * 事故(Cowork 会话 `id8zf8ma51mufa61wh`,本仓同源):发票落地 3 秒后 agent 跑了 `bash ls -lt ~/Downloads`,
 * 结果里没有 NOTE —— NOTE 只挂在 `executeHostTool` 上;本仓的 agent-io 更是从来没记过一条 `tool_result`。
 *
 * 前半(用例 1–6)移植自 micromeet-cowork `tests/unit/builtinToolResultHook.test.mjs`,钩子文件两仓逐字节相同:
 * 用真实的 `drainDownloadNote`、`executeHostTool`、`inputBudget`、`modelIoLog` 与适配器里的记录回调,
 * pi 只假它的 `afterToolCall` 上下文,按 `agent-loop.js` `finalizeExecutedToolCall` 的合并规则算出模型最终看到的结果。
 *
 * 后半(「接线」)是本仓自己的:真的 `PiRuntimeAdapter.createSession()` 建会话,真的 pi `AgentSession` 跑工具循环
 * (pi 自己的 `afterToolCall`、结果合并、自带 bash 的工具定义都是真的;假的只有模型、凭据与 shell),
 * 宿主工具走真的 `HostToolRegistry` → `bindPiTools` → `executeHostTool`。断言对的是模型下一次请求里**真收到的**
 * 工具结果,以及读回来的 jsonl —— 而不是某个桩被调用过。
 */
const root = resolve(import.meta.dirname, '../..');
const aliases = [
  ['@maestro-main/', 'src/main/maestro/'],
  ['@maestro-shared/', 'src/shared/maestro/'],
  ['@main/', 'src/main/'],
  ['@shared/', 'src/shared/']
];

const scratch = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};
let downloadsDir = tempDir('bl-builtin-results-dl-');

// 交给适配器的 pi SDK:除了下面四样全是真的 —— `AgentSession` 的工具循环、`defineTool`、自带 bash 的工具定义、
// 设置与会话管理。换掉的:凭据(`ModelRuntime` / `ModelRegistry`)、shell(`createLocalBashOperations`),
// 以及 `createAgentSession`:它照适配器给的参数建一个真的 `AgentSession`(同 pi `sdk.js` 的做法),只把模型换成剧本。
const pi = await import('@earendil-works/pi-coding-agent');
const { Agent } = await import('@earendil-works/pi-agent-core');
const piFile = (rel) => pathToFileURL(resolve(root, 'node_modules/@earendil-works', rel)).href;
const { convertToLlm } = await import(piFile('pi-coding-agent/dist/core/messages.js'));
const { createAssistantMessageEventStream } = await import(piFile('pi-ai/dist/utils/event-stream.js'));
const model = { id: 'fixture', name: 'fixture', provider: 'fixture', api: 'openai-responses', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1000 };
const modelUsage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
let scenario;
const sdk = {
  ...pi,
  ModelRuntime: { create: async () => ({}) },
  ModelRegistry: class {
    find(provider, id) { return { provider, id, contextWindow: model.contextWindow }; }
    hasConfiguredAuth() { return true; }
  },
  createLocalBashOperations: () => scenario.shell,
  createAgentSession: async (args) => {
    assert.ok(args.tools, 'the fixture models sessions with a tool allowlist (builtins + host tools), like Maestro');
    scenario.args = args;
    scenario.session = new pi.AgentSession({
      agent: new Agent({ convertToLlm, initialState: { model, messages: [] }, streamFn: scenario.streamFn }),
      sessionManager: args.sessionManager,
      settingsManager: args.settingsManager,
      cwd: args.cwd,
      resourceLoader: args.resourceLoader,
      modelRuntime: { hasConfiguredAuth: () => true, getModel: () => model },
      customTools: args.customTools,
      initialActiveToolNames: args.tools,
      allowedToolNames: args.tools
    });
    return { session: scenario.session };
  }
};

const stubs = {
  electron: { app: { getPath: (name) => (name === 'downloads' ? downloadsDir : tmpdir()) } },
  '@earendil-works/pi-coding-agent': sdk,
  // 适配器另外两条依赖与本题无关,真加载要拖进 electron-xpc:bitterless provider 与应用账号会话。
  './bitterlessProvider': { isBitterlessProvider: () => false, registerBitterlessProvider: async () => {} },
  '@main/auth/customerSession.service': { customerSessionService: { current: null }, revalidateRejectedCustomerSession: async () => {} }
};

// 一份模块缓存:钩子、适配器、hostToolRegistry 拿到的 inputBudget / modelIoLog / downloadManager
// 与下面断言读的是同一个实例 —— 否则账本记在一份上、断言读另一份。
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
const fromRoot = (rel) => load(resolve(root, rel));

const manager = fromRoot('src/main/net/downloadManager.ts');
const { installBuiltinToolResultHook } = fromRoot('src/main/agent/runtime/builtinToolResultHook.ts');
const { executeHostTool } = fromRoot('src/main/agent/runtime/hostToolExecution.ts');
const { HostToolRegistry } = fromRoot('src/main/agent/runtime/hostToolRegistry.ts');
const { PiRuntimeAdapter, recordBuiltinToolResult } = fromRoot('src/main/agent/runtime/piRuntimeAdapter.ts');
const { inputBudget } = fromRoot('src/main/agent/runtime/inputBudget.ts');
const { modelIoLog, setModelIoRoot } = fromRoot('src/main/agent/runtime/modelIoLog.ts');
const { runInAgentSession } = fromRoot('src/main/agent/runtime/agentSessionContext.ts');

const ioRoot = tempDir('bl-builtin-results-io-');
setModelIoRoot(() => ioRoot);

// 每个用例一个会话:行按会话键分桶落盘,各读各的。
const sessions = [];
const nextSession = () => {
  const key = `builtin-results-${sessions.length + 1}`;
  sessions.push(key);
  return key;
};

after(async () => {
  // 先等每个会话的写队列排空,再删目录 —— 否则收尾的写入撞上已删的目录。
  for (const key of sessions) await modelIoLog.dirForSession(key);
  manager.resetDownloadLedgerForTests();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// 回合号推到 2:行里的 `turn` 必须是账本当下的回合号,写死 0 或 1 都会在这里露馅。
const fresh = () => {
  manager.resetDownloadLedgerForTests();
  downloadsDir = tempDir('bl-builtin-results-dl-');
  inputBudget.reset();
  inputBudget.turnStart();
  inputBudget.turnStart();
};

/** 一次下载(同 downloadManager.test.mjs 的假 DownloadItem,只留用到的);`finish()` 让它落地。 */
const download = (filename) => {
  let done = () => {};
  const item = {
    savePath: '',
    getFilename: () => filename,
    getMimeType: () => 'application/pdf',
    getReceivedBytes: () => 37054,
    getSavePath: () => item.savePath,
    setSavePath: (path) => {
      item.savePath = path;
    },
    once: (event, listener) => {
      if (event === 'done') done = listener;
    }
  };
  manager.adoptDownload(item);
  return {
    path: item.savePath,
    finish: () => {
      writeFileSync(item.savePath, 'pdf');
      done({}, 'completed');
    }
  };
};

/** 一次已经落地的下载。 */
const landed = (filename) => {
  const item = download(filename);
  item.finish();
  return item.path;
};

/** 一个假 pi 会话:`afterToolCall` 就是 pi 自己装的那一个,记下每次调用,返回 `own(context)`。 */
const fakeSession = (own = () => undefined) => {
  const calls = [];
  const session = { agent: { afterToolCall: async (context, signal) => { calls.push({ context, signal }); return own(context); } } };
  return { session, calls };
};

const context = (name, text, { isError = false, args = {} } = {}) => ({
  assistantMessage: { role: 'assistant' },
  toolCall: { type: 'toolCall', id: `call_${name}`, name, arguments: args },
  args,
  result: { content: [{ type: 'text', text }], details: null },
  isError,
  context: { messages: [] }
});

/** `agent-loop.js` 的 `finalizeExecutedToolCall`:给了的字段替换,没给的保持原值。 */
const finalize = async (session, ctx, signal) => {
  const after = await session.agent.afterToolCall(ctx, signal);
  const result = after
    ? { ...ctx.result, content: after.content ?? ctx.result.content, details: after.details ?? ctx.result.details,
        usage: after.usage ?? ctx.result.usage, terminate: after.terminate ?? ctx.result.terminate }
    : ctx.result;
  return { after, result, isError: after?.isError ?? ctx.isError, text: result.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n') };
};

const HOST = new Set(['preview_file']);
const install = (session, record) =>
  installBuiltinToolResultHook(session, { isHostTool: (name) => HOST.has(name), drainNote: manager.drainDownloadNote, record });

const toolResults = async (key) => {
  const dir = await modelIoLog.dirForSession(key);
  if (!dir) return [];
  return readFileSync(join(dir, 'session.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.kind === 'tool_result')
    .map(({ name, subject, text, turn }) => ({ name, subject, text, turn }));
};

test('1a · bash:已有落地的下载 → 结果末尾带 NOTE,台账随之清空', async () => {
  fresh();
  const path = landed('Invoice-0CSZ9QB2-0004.pdf');
  const { session } = fakeSession();
  install(session);
  const listing = '-rw-r--r--  1 ral  staff  37054 Sep 24 16:42 Invoice-0CSZ9QB2-0004.pdf';
  const { text } = await finalize(session, context('bash', listing, { args: { command: 'ls -lt ~/Downloads' } }));
  assert.ok(text.startsWith(listing), '原结果原样保留在前面');
  assert.ok(text.includes(path), 'NOTE 带绝对路径');
  assert.match(text, /\n\nNOTE: 1 file finished downloading:/, '与 host 工具的 text + note 同形');
  assert.equal(await manager.drainDownloadNote(), '', '已经报给 agent 了,不许再报一次');
});

test('1b · bash:没有下载 → 结果文本不变,而且一个 tick 都不等', async () => {
  fresh();
  const { session } = fakeSession();
  install(session);
  const started = Date.now();
  const { after, text } = await finalize(session, context('bash', 'total 0'));
  assert.equal(after, undefined, '没有 NOTE 时返回 pi 自己的值(这里是 undefined)= 结果一个字不改');
  assert.equal(text, 'total 0');
  assert.ok(Date.now() - started < 50);
});

test('1c · read 读图:最后一块是图片时,NOTE 另起一个文本块、放在最后', async () => {
  fresh();
  const path = landed('chart.pdf');
  const { session } = fakeSession();
  install(session);
  const ctx = context('read', 'Read image file [image/png]');
  ctx.result.content.push({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
  const { result } = await finalize(session, ctx);
  assert.deepEqual(result.content.slice(0, 2), ctx.result.content, '原有的两块不动');
  assert.equal(result.content[2].type, 'text');
  assert.ok(result.content[2].text.includes(path));
});

test('1d · 不传记录回调:NOTE 照挂,什么都不记,也不报错', async () => {
  fresh();
  const path = landed('e.pdf');
  const { session } = fakeSession();
  install(session);
  const key = nextSession();
  const { text } = await runInAgentSession(key, () => finalize(session, context('bash', 'e.pdf', { args: { command: 'ls' } })));
  assert.ok(text.includes(path));
  assert.deepEqual(await toolResults(key), []);
  assert.equal(inputBudget.report().session.calls, 0);
});

test('2 · host 工具:钩子原样放过 —— NOTE 只出现一次、不替它排空、不重复记录', async () => {
  fresh();
  const first = landed('a.pdf');
  const { text: hostText } = await executeHostTool({ execute: async () => '{"ok":true}' }, {});
  assert.ok(hostText.includes(first), 'executeHostTool 自己已经挂了 NOTE');
  const second = landed('b.pdf');
  const recorded = [];
  const { session } = fakeSession();
  install(session, (entry) => recorded.push(entry));
  const { after, text } = await finalize(session, context('preview_file', hostText, { args: { path: first } }));
  assert.equal(after, undefined, 'host 工具拿到的就是 pi 自己的返回值');
  assert.equal(text, hostText);
  assert.equal(text.split('finished downloading').length - 1, 1, 'NOTE 只出现一次');
  assert.deepEqual(recorded, [], 'host 工具由 measuredTool 记,钩子不记');
  assert.ok((await manager.drainDownloadNote()).includes(second), '钩子不许替 host 工具排空 —— 那一份留给下一次返回');
});

test('3 · 本仓记录:一次 bash 写一条 tool_result,text = 模型看到的文本(含 NOTE),并计入 inputBudget', async () => {
  fresh();
  const path = landed('发票-0004.pdf');
  const { session } = fakeSession();
  install(session, recordBuiltinToolResult);
  const key = nextSession();
  const { text } = await runInAgentSession(key, () =>
    finalize(session, context('bash', '发票-0004.pdf', { args: { command: 'ls ~/Downloads' } })));
  assert.ok(text.includes(path), '含 NOTE');
  assert.deepEqual(await toolResults(key), [{ name: 'bash', subject: '', text, turn: 2 }], '一次调用一条,记的是模型最终看到的那一份');
  const bytes = Buffer.byteLength(text, 'utf8');
  assert.notEqual(bytes, text.length, 'fixture must be multi-byte so a character count cannot pass');
  const bash = inputBudget.report().turn.top.find((row) => row.tool === 'bash');
  assert.deepEqual(bash && { calls: bash.calls, bytes: bash.bytes }, { calls: 1, bytes });
});

test('3b · subject 用 inputBudget 的白名单短标签(同 measuredTool),两处一致', async () => {
  fresh();
  const { session } = fakeSession();
  install(session, recordBuiltinToolResult);
  const key = nextSession();
  const { text } = await runInAgentSession(key, () =>
    finalize(session, context('read', '# 今天', { args: { path: 'notes/今天.md', offset: 1 } })));
  const subject = 'path=notes/今天.md';
  assert.deepEqual(await toolResults(key), [{ name: 'read', subject, text, turn: 2 }]);
  assert.equal(inputBudget.report().turn.top.find((row) => row.tool === 'read')?.maxSubject, subject);
});

test('4 · 报错的自带工具结果记为 `bash (threw)`', async () => {
  fresh();
  const path = landed('f.pdf');
  const { session } = fakeSession();
  install(session, recordBuiltinToolResult);
  const key = nextSession();
  const failure = 'ls: /nope: No such file or directory\n\nCommand exited with code 1';
  const { isError, text } = await runInAgentSession(key, () => finalize(session, context('bash', failure, { isError: true })));
  assert.equal(isError, true, '报错照旧是报错,钩子不改它');
  assert.ok(text.startsWith(failure) && text.includes(path), '失败的结果照样带 NOTE(同 executeHostTool 的失败路)');
  assert.deepEqual((await toolResults(key)).map((row) => [row.name, row.text]), [['bash (threw)', text]]);
  assert.equal(inputBudget.report().session.top.find((row) => row.tool === 'bash')?.calls, 1, '账本按工具名计,同 measuredTool');
});

test('5 · pi 自己的 afterToolCall 先被调用,它的返回值一个字段都不丢', async () => {
  fresh();
  const path = landed('c.pdf');
  const usage = { input: 1, output: 2 };
  const { session, calls } = fakeSession(() => ({
    content: [{ type: 'text', text: 'rewritten by an extension' }], details: { ext: true }, isError: false, usage, terminate: true
  }));
  const recorded = [];
  install(session, (entry) => recorded.push(entry));
  const signal = new AbortController().signal;
  const ctx = context('bash', 'raw output', { isError: true });
  const { result, isError } = await finalize(session, ctx, signal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context, ctx, 'pi 拿到的是原上下文');
  assert.equal(calls[0].signal, signal, 'abort signal 原样传给 pi');
  assert.ok(result.content[0].text.startsWith('rewritten by an extension'), 'NOTE 接在 pi 改过的内容上,而不是原始输出上');
  assert.ok(result.content[0].text.includes(path));
  assert.deepEqual([result.details, result.usage, result.terminate, isError], [{ ext: true }, usage, true, false]);
  assert.equal(recorded[0].isError, false, '记录用的也是 pi 改过之后的 isError');
});

test('6 · pi 没装自己的 afterToolCall 时也照常工作', async () => {
  fresh();
  const path = landed('d.pdf');
  const session = { agent: {} };
  install(session);
  const { text } = await finalize(session, context('grep', 'match'));
  assert.ok(text.includes(path));
});

// ——— 本仓接线:真的 createSession + 真的 pi 工具循环 ———

/** 假 shell:不起进程,输出与退出码由用例定。形状同 pi 的 `BashOperations.exec`。 */
const shell = (output, exitCode = 0) => {
  const commands = [];
  return {
    commands,
    exec: async (command, _cwd, options) => {
      commands.push(command);
      options.onData(Buffer.from(output));
      return { exitCode };
    }
  };
};

/**
 * 按剧本出工具调用的模型。每次请求都记下 pi 交给它的上下文 —— 工具结果**模型真正收到的**那一份就在里面。
 * `turns[i]` 给第 i 次请求的回复;剧本走完就收尾。
 */
const scripted = (turns) => {
  const requests = [];
  const streamFn = async (_model, llmContext) => {
    requests.push(llmContext);
    const content = turns[requests.length - 1]?.() ?? [{ type: 'text', text: 'done' }];
    const stopReason = content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop';
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: stopReason, message: { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage: modelUsage, stopReason, timestamp: Date.now() } });
    return stream;
  };
  return { streamFn, requests };
};
const call = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args });

/** 最后一次请求里模型收到的工具结果:文本块按 provider 的方式用 `\n` 连起来(pi-ai `api/*.js`)。 */
const received = (requests) => requests.at(-1).messages
  .filter((message) => message.role === 'toolResult')
  .map((message) => ({
    tool: message.toolName,
    isError: message.isError,
    text: message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
  }));

const previewFile = () => new HostToolRegistry({ scope: 'cowork' })
  .add({ name: 'preview_file', description: 'preview fixture', params: [{ name: 'path', type: 'string', required: true }], execute: async () => '{"ok":true}' })
  .toRuntimeTools();

const workDir = tempDir('bl-builtin-results-cwd-');
const runTurn = async ({ shell: operations, turns }) => {
  const script = scripted(turns);
  scenario = { shell: operations, streamFn: script.streamFn };
  await new PiRuntimeAdapter().createSession({
    target: { providerId: 'openai-codex', modelId: 'gpt-test', thinkingLevel: 'medium' },
    authPath: join(workDir, 'auth.json'),
    scope: 'maestro',
    systemPrompt: 'HOST',
    cwd: workDir,
    tools: previewFile(),
    builtinTools: ['read', 'bash']
  });
  const key = nextSession();
  await runInAgentSession(key, () => scenario.session.prompt('go'));
  await scenario.session.dispose();
  return { key, requests: script.requests, args: scenario.args };
};

test('接线 · createSession 装上钩子:bash 带 NOTE 且记一条(= 模型收到的);host 工具只由 measuredTool 记一条、NOTE 只一次', async () => {
  fresh();
  const first = landed('a.pdf');
  let second;
  const listing = '-rw-r--r--  1 ral  staff  37054 Sep 24 16:42 发票-0004.pdf';
  const operations = shell(listing);
  const { key, requests, args } = await runTurn({
    shell: operations,
    turns: [
      () => [call('c1', 'preview_file', { path: 'report.txt' })],
      // preview_file 返回之后又落地一个 —— 下一次工具返回(bash)要把它报出来。
      () => {
        second = landed('发票-0004.pdf');
        return [call('c2', 'bash', { command: 'ls -lt ~/Downloads' })];
      }
    ]
  });
  // bash 在工具表里(宿主给的可中断替身,经 customTools 顶替 pi 的那一个),却不是 host 工具。
  assert.deepEqual(args.customTools.map((tool) => tool.name), ['preview_file', 'bash']);
  assert.deepEqual(operations.commands, ['ls -lt ~/Downloads'], 'the real pi bash definition ran on the host shell operations');
  assert.equal(requests.length, 3);

  const [preview, bash] = received(requests);
  assert.equal(preview.tool, 'preview_file');
  assert.equal(preview.text.split('finished downloading').length - 1, 1, 'host 工具的 NOTE 只出现一次 —— 钩子没再挂一遍');
  assert.ok(preview.text.startsWith('{"ok":true}') && preview.text.includes(first) && !preview.text.includes(second));
  assert.equal(bash.tool, 'bash');
  assert.equal(bash.isError, false);
  assert.ok(bash.text.startsWith(listing), 'pi 的原结果在前');
  assert.match(bash.text, /\n\nNOTE: 1 file finished downloading:/);
  assert.ok(bash.text.includes(second), '文件落地之后的那次 bash,结果里就有 NOTE');
  assert.equal(await manager.drainDownloadNote(), '', '两份都已经报给 agent 了');

  assert.deepEqual(await toolResults(key), [
    // host 工具:measuredTool 记它自己的结果(NOTE 在它之后才追加 —— issue 里的已知残留),钩子不再记。
    { name: 'preview_file', subject: 'path=report.txt', text: '{"ok":true}', turn: 2 },
    { name: 'bash', subject: '', text: bash.text, turn: 2 }
  ]);
  const budget = inputBudget.report().turn;
  assert.deepEqual(budget.top.map((row) => [row.tool, row.calls]).sort(), [['bash', 1], ['preview_file', 1]]);
  assert.equal(budget.top.find((row) => row.tool === 'bash').bytes, Buffer.byteLength(bash.text, 'utf8'));
});

test('接线 · bash 退出码非 0:pi 当报错结果交回,agent-io 记为 `bash (threw)`,文本 = 模型收到的', async () => {
  fresh();
  const { key, requests } = await runTurn({
    shell: shell('ls: /nope: No such file or directory', 1),
    turns: [() => [call('c1', 'bash', { command: 'ls /nope' })]]
  });
  const [bash] = received(requests);
  assert.deepEqual(bash, { tool: 'bash', isError: true, text: 'ls: /nope: No such file or directory\n\nCommand exited with code 1' });
  assert.deepEqual(await toolResults(key), [{ name: 'bash (threw)', subject: '', text: bash.text, turn: 2 }]);
  assert.equal(inputBudget.report().turn.top.find((row) => row.tool === 'bash')?.calls, 1);
});

test('接线 · 在途的下载:自带工具的结果按默认预算等它落地(钩子无参调 drainNote,同 host 工具的口径)', async () => {
  fresh();
  let slow;
  let finished;
  const { requests } = await runTurn({
    shell: shell('total 0'),
    turns: [() => {
      slow = download('slow.pdf');
      finished = new Promise((resolve) => setTimeout(() => resolve(slow.finish()), 250));
      return [call('c1', 'bash', { command: 'ls' })];
    }]
  });
  await finished;
  const [bash] = received(requests);
  assert.match(bash.text, /^total 0\n\nNOTE: 1 file finished downloading:/, 'waited for it, instead of "still downloading"');
  assert.ok(bash.text.includes(slow.path));
});

const cowork = resolve(root, '../micromeet-cowork/apps/cowork/src/main/agent/runtime/builtinToolResultHook.ts');
test('builtinToolResultHook.ts 与 micromeet-cowork 逐字节相同', { skip: existsSync(cowork) ? false : 'micromeet-cowork is not checked out next to this repo — NOT compared' }, () => {
  assert.ok(readFileSync(cowork).equals(readFileSync(resolve(root, 'src/main/agent/runtime/builtinToolResultHook.ts'))), 'change both copies in the same change');
});
