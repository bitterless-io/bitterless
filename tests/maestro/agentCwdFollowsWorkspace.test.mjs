import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

/**
 * **cwd 跟随工作区**(Ral 2026-09-21 在 PQ-CWD 上拍板 A)。
 *
 * 缺陷见 `docs/issues/agent-cwd-frozen-when-workspace-switches.md`:cwd 在建会话那一刻被 pi 冻死
 * (`core/agent-session.js:145` 赋一次、无 setter,`:2191` 还把它烤进内置工具定义),
 * 而换工作区只调 `setSystemPrompt`。结果是内置工具(read/grep/bash…)留在旧根,
 * D2 与宿主工具已经走新根 —— 同一个相对路径落在两个目录。
 *
 * **与 pi 对齐**:pi 自己也不在会话中途改 cwd —— `dist/main.js:527` 写着「Decide the final runtime
 * cwd before creating cwd-bound runtime services」,换 cwd 的唯一做法是 `:543` 的
 * `SessionManager.open(sessionFile, sessionDir, selectedCwd)`,换 override 重开、重建 cwd-bound 服务,
 * 会话文件不变。我们这里就是同一套:`reset()` 丢会话,下一轮用新 cwd 重建,`sessionFile` 不变。
 *
 * 这里钉两件事,**两条都会红才算守住**:
 *  · 根变了 → 丢会话,下一轮用新 cwd 重建;
 *  · 根没变 → **绝不**丢会话。`handleAgentTurn` 每轮都用同一个值调一次 `setProjectRoot`,
 *    少了这道比较,每一轮都会把会话推倒重来 —— 比原缺陷更糟。
 */
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
const { BaseAgent } = load('src/main/agent/BaseAgent.ts');

const agentWith = (cwd) => {
  const created = []
  const runtime = {
    createSession: async (options) => {
      created.push(options.cwd)
      // `init()` 只走 `ensureSession()`,所以这里只需要能被建出来 + 能接 setSystemPrompt。
      return { subscribe: () => () => {}, setSystemPrompt: async () => {}, abort: async () => {}, dispose: async () => {} }
    }
  }
  const agent = new BaseAgent({
    runtime,
    describeTarget: () => ({ providerId: 'fixture', modelId: 'fixture', label: 'Fixture' }),
    buildTools: () => [],
    cwd,
    providerId: 'fixture',
    modelId: 'fixture'
  })
  return { agent, created }
}

test('换工作区之后,下一轮用新根重建会话', async () => {
  const { agent, created } = agentWith('/fixture/default')
  await agent.setProjectRoot('/fixture/project-a')
  await agent.init()
  assert.deepEqual(created, ['/fixture/project-a'], '第一个会话按当前根建')

  await agent.setProjectRoot('/fixture/project-b')
  await agent.init()
  assert.deepEqual(created, ['/fixture/project-a', '/fixture/project-b'], '换根必须换会话,且带上新根')

  // 清空 = 回落到构造时的 cwd,同样是一次变化。
  await agent.setProjectRoot(undefined)
  await agent.init()
  assert.deepEqual(created, ['/fixture/project-a', '/fixture/project-b', '/fixture/default'])
})

test('根没变就不丢会话 —— 每轮都会调一次 setProjectRoot', async () => {
  const { agent, created } = agentWith('/fixture/default')
  await agent.setProjectRoot('/fixture/project-a')
  await agent.init()
  for (let turn = 0; turn < 5; turn += 1) {
    await agent.setProjectRoot('/fixture/project-a')
    await agent.init()
  }
  assert.deepEqual(created, ['/fixture/project-a'], '同一个根重复设置不能重建会话')
})

test('尾斜杠不算变化', async () => {
  const { agent, created } = agentWith('/fixture/default')
  await agent.setProjectRoot('/fixture/project-a')
  await agent.init()
  await agent.setProjectRoot('/fixture/project-a/')
  await agent.init()
  assert.deepEqual(created, ['/fixture/project-a'], '`/a` 与 `/a/` 是同一个目录')
})

test('explicitly selecting the same cwd refreshes the live system prompt without dropping history', async () => {
  const updates = [];
  const { agent, created } = agentWith('/fixture/work');
  const source = readFileSync(resolve(import.meta.dirname, '../../src/main/agent/MaestroAgent.ts'), 'utf8');
  const ast = ts.createSourceFile('agent.ts', source, ts.ScriptTarget.Latest, true);
  const member = ast.statements.filter(ts.isClassDeclaration).flatMap(c => [...c.members]).find(m => m.name?.getText(ast) === 'systemPrompt');
  const code = ts.transpileModule('class Subject { ' + member.getText(ast) + ' }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  agent.systemPrompt = new Function('STATIC_TURN_GUIDANCE', code + '; return Subject.prototype.systemPrompt')('static guidance');
  await agent.init();
  const session = await agent.sessionPromise;
  session.setSystemPrompt = async prompt => updates.push(prompt);
  await agent.setProjectRoot('/fixture/work');
  assert.equal(created.length, 1);
  assert.equal(updates.length, 1);
  assert.match(updates[0], /selected/);
  assert.doesNotMatch(updates[0], /No workspace selected|shared work directory/);
  await agent.setProjectRoot('/fixture/chosen');
  assert.match(agent.composedSystemPrompt(), /Active workspace: \/fixture\/chosen/);
  assert.doesNotMatch(agent.composedSystemPrompt(), /\/fixture\/work/);
});
