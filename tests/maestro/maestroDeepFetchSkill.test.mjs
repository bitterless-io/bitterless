import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const output = await build({
  stdin: { contents: "export * from './src/main/agent/deepFetch.skill'; export { buildAgentTurnPrompt } from './src/main/agent/runtime/agentPrompt';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', tsconfig: resolve(root, 'tsconfig.node.json')
});
const real = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const source = readFileSync(resolve(root, 'src/main/agent/maestroAgent.service.ts'), 'utf8');
const ast = ts.createSourceFile('maestroAgent.service.ts', source, ts.ScriptTarget.Latest, true);
const method = ast.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members])
  .find(node => node.name?.getText(ast) === 'agentSkillBriefs');
assert.ok(method);
const code = ts.transpileModule(`class Actual { ${method.getText(ast)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Actual = new Function('DRILL_BUILTIN_SKILL', 'DEEP_FETCH_BUILTIN_SKILL', 'extractVariablesFromMessage', 'requiredInputNames', `${code}; return Actual;`)(
  { ...real.DEEP_FETCH_BUILTIN_SKILL, id: 'builtin:drill', name: 'Drill', triggers: ['drill'] },
  real.DEEP_FETCH_BUILTIN_SKILL, () => ({}), () => []
);

test('deep-fetch is discoverable without recordings and never asks the registry for a built-in recipe', () => {
  const calls = [];
  const recordings = [{ id: 'recorded:weather', name: 'Weather site', triggers: ['weather'], inputs: [], description: 'Recorded example' }];
  const briefs = new Actual().agentSkillBriefs('deep fetch 上海天气', recordings, { readRecipe(id) { calls.push(id); return null; } });
  assert.deepEqual(calls, ['recorded:weather']);
  assert.deepEqual(recordings.map(item => item.id), ['recorded:weather']);
  const builtin = briefs.find(item => item.id === 'builtin:deep-fetch');
  assert.deepEqual(builtin.inputs, []);
  assert.deepEqual(builtin.seed, {});
  assert.deepEqual(builtin.missing, []);
  assert.equal(new Actual().agentSkillBriefs('deep fetch 上海天气', [], { readRecipe() { assert.fail('No recipe'); } }).length, 2);
});

test('effective prompt includes the built-in workflow and current timestamp for its English and Chinese intents', () => {
  for (const message of ['deep fetch 上海天气', 'deep_fetch Shanghai weather', 'deep search Shanghai', '浏览器搜索上海天气', '用浏览器查天气']) {
    const prompt = real.buildAgentTurnPrompt({
      message, nowLocal: '2026-09-15 14:00:00 +08:00 (Asia/Shanghai)', currentUrl: '',
      activeTab: null, openTabs: [], briefs: [real.DEEP_FETCH_BUILTIN_SKILL],
      context: { compactSummary: 'An old weather page dated 2020-01-01', recentMessages: [] }
    });
    assert.match(prompt, /id: builtin:deep-fetch/);
    assert.ok(prompt.includes(real.DEEP_FETCH_BROWSER_WORKFLOW), 'Real prompt delivers the complete app text skill');
    assert.match(prompt, /Message sent at: 2026-09-15 14:00:00 \+08:00 \(Asia\/Shanghai\)/);
    assert.ok(prompt.endsWith(message));
  }
});
