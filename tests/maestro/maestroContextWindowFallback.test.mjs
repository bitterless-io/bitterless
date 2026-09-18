/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

/**
 * 解析不到窗口时,**沿用预设里配置的值**,不再整批降到 256K。
 *
 * Ral 2026-09-17:「你配置好就行,压缩后面再处理」。在这之前
 * `applyResolvedContextWindows` 写的是 `resolved[key] || DEFAULT_CONTEXT_WINDOW_TOKENS`,
 * 于是 `describeContextWindows` 解析失败或真正达到 3s 上限时会把
 * 整批**降**到 256K —— 包括那 4 个 Codex 预设,它们配置的 266K 正是实测真值
 * (pi 里 `contextWindow = 272000`)。压缩触发线、reserve 预算、summary 上限都乘在这个数上,
 * 所以一次 3 秒抖动就悄悄改掉了它们,而配置里本来就是对的数。
 */

const root = resolve(import.meta.dirname, '../..');
const bundle = await build({
  stdin: {
    contents: `
      export {
        LLM_PRESETS, applyResolvedContextWindows, contextWindowLabel, DEFAULT_CONTEXT_WINDOW_TOKENS
      } from './src/main/maestro/llm/llmModels';
    `,
    resolveDir: root,
    loader: 'ts'
  },
  write: false, bundle: true, platform: 'node', format: 'esm', target: 'node22',
  tsconfig: resolve(root, 'tsconfig.node.json')
});
const { LLM_PRESETS, applyResolvedContextWindows, contextWindowLabel, DEFAULT_CONTEXT_WINDOW_TOKENS } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const key = (preset) => `${preset.provider}/${preset.model}`;

test('an unresolved window keeps the configured one instead of collapsing to 256K', () => {
  const applied = applyResolvedContextWindows(LLM_PRESETS, {});
  assert.equal(applied.length, LLM_PRESETS.length);
  for (const [index, preset] of LLM_PRESETS.entries()) {
    assert.equal(applied[index].contextLengthK, preset.contextLengthK, key(preset));
    // The label is derived from the same number, so the two can never disagree.
    assert.equal(applied[index].contextLengthLabel, contextWindowLabel(preset.contextLengthK * 1024), key(preset));
  }
  // The case that actually regressed: every Codex preset is configured at the measured 266K.
  const codex = applied.filter((preset) => preset.provider === 'openai-codex');
  assert.ok(codex.length > 0, 'expected Codex presets in the catalog');
  for (const preset of codex) assert.equal(preset.contextLengthK, 266, key(preset));
});

test('a resolved window still wins over the configured one', () => {
  const target = LLM_PRESETS.find((preset) => preset.provider === 'openai-codex');
  const applied = applyResolvedContextWindows(LLM_PRESETS, { [key(target)]: 1024 * 1024 });
  const updated = applied.find((preset) => key(preset) === key(target));
  assert.equal(updated.contextLengthK, 1024);
  assert.equal(updated.contextLengthLabel, '1M');
  // Only the resolved target moves; the rest keep what they were configured with.
  for (const preset of applied) {
    if (key(preset) === key(target)) continue;
    const configured = LLM_PRESETS.find((item) => key(item) === key(preset));
    assert.equal(preset.contextLengthK, configured.contextLengthK, key(preset));
  }
});

test('the 256K default is the last resort, for a preset that configures nothing', () => {
  const unconfigured = { ...LLM_PRESETS[0], provider: 'someone-else', model: 'no-window', contextLengthK: 0 };
  const [applied] = applyResolvedContextWindows([unconfigured], {});
  assert.equal(applied.contextLengthK, Math.round(DEFAULT_CONTEXT_WINDOW_TOKENS / 1024));
  assert.equal(applied.contextLengthK, 256);
});

// Run the production method with controlled resolver promises and Node's fake timers. Extracting
// only this method avoids booting Electron or replacing the timeout/fallback implementation.
const serviceFile = new URL('../../src/main/maestro/llm/maestroLlm.service.ts', import.meta.url);
const serviceSource = ts.createSourceFile(serviceFile.pathname, readFileSync(serviceFile, 'utf8'), ts.ScriptTarget.Latest, true);
const serviceClass = serviceSource.statements.find((node) => ts.isClassDeclaration(node)
  && node.members.some((member) => member.name?.getText(serviceSource) === 'withResolvedContextWindows'));
const method = serviceClass.members.find((member) => member.name?.getText(serviceSource) === 'withResolvedContextWindows');
const timeout = serviceSource.statements.filter(ts.isVariableStatement)
  .flatMap((node) => [...node.declarationList.declarations])
  .find((node) => node.name.getText(serviceSource) === 'CONTEXT_WINDOW_TIMEOUT_MS');
const methodCode = ts.transpileModule(
  `const ${timeout.getText(serviceSource)}; class Actual { ${method.getText(serviceSource)} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function lookupHarness(t, describeContextWindows) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const warnings = [];
  const lookup = runInNewContext(methodCode + '; Actual.prototype.withResolvedContextWindows', {
    Promise, Error, setTimeout, clearTimeout, applyResolvedContextWindows,
    PiRuntimeAdapter: class { describeContextWindows = describeContextWindows; },
    maestroAuthPath: () => '/test/auth.json',
    maestroModelsPath: () => '/test/models.json',
    console: { warn: (...args) => warnings.push(args) }
  });
  return { lookup: (presets = LLM_PRESETS) => lookup(presets), warnings };
}

function assertConfiguredFallback(result) {
  assert.equal(Object.keys(result.windows).length, 0);
  for (const [index, preset] of LLM_PRESETS.entries()) {
    assert.equal(result.presets[index].contextLengthK, preset.contextLengthK, key(preset));
  }
}

test('a successful lookup retains its resolved window and never logs a delayed timeout', async (t) => {
  const target = LLM_PRESETS.find((preset) => preset.provider === 'openai-codex');
  const windows = { [key(target)]: 1024 * 1024 };
  const { lookup, warnings } = lookupHarness(t, async () => windows);
  const result = await lookup();
  assert.equal(result.windows, windows);
  assert.equal(result.presets.find((preset) => key(preset) === key(target)).contextLengthK, 1024);
  t.mock.timers.tick(3000);
  assert.deepEqual(warnings, []);
});

test('a rejected lookup logs its failure once without a delayed timeout warning', async (t) => {
  const { lookup, warnings } = lookupHarness(t, async () => { throw new Error('metadata unavailable'); });
  assertConfiguredFallback(await lookup());
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /解析上下文窗口失败/);
  assert.equal(warnings[0][1], 'metadata unavailable');
  t.mock.timers.tick(3000);
  assert.equal(warnings.length, 1);
});

test('a pending lookup falls back exactly at 3000ms; late success does not change that result', async (t) => {
  const resolver = deferred();
  const { lookup, warnings } = lookupHarness(t, () => resolver.promise);
  let settled = false;
  const pending = lookup().then((result) => { settled = true; return result; });
  t.mock.timers.tick(2999);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(warnings.length, 0);
  t.mock.timers.tick(1);
  const result = await pending;
  assertConfiguredFallback(result);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /解析上下文窗口超时\(3000ms\)/);
  resolver.resolve({ [key(LLM_PRESETS[0])]: 1024 * 1024 });
  await Promise.resolve();
  t.mock.timers.tick(3000);
  assertConfiguredFallback(result);
  assert.equal(warnings.length, 1);
});

test('a rejection after the deadline adds no failure warning or unhandled rejection', async (t) => {
  const resolver = deferred();
  const { lookup, warnings } = lookupHarness(t, () => resolver.promise);
  const pending = lookup();
  t.mock.timers.tick(3000);
  assertConfiguredFallback(await pending);
  resolver.reject(new Error('late metadata failure'));
  await Promise.resolve();
  t.mock.timers.tick(3000);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /解析上下文窗口超时/);
});

test('concurrent lookups clear only their own timeout timer', async (t) => {
  const first = deferred(), second = deferred();
  const resolvers = [first, second];
  const { lookup, warnings } = lookupHarness(t, () => resolvers.shift().promise);
  const firstResult = lookup();
  t.mock.timers.tick(1000);
  const secondResult = lookup();
  first.resolve({ [key(LLM_PRESETS[0])]: 1024 * 1024 });
  assert.equal((await firstResult).presets[0].contextLengthK, 1024);
  t.mock.timers.tick(2000);
  assert.equal(warnings.length, 0, 'the completed first call must not warn at its deadline');
  t.mock.timers.tick(1000);
  assertConfiguredFallback(await secondResult);
  assert.equal(warnings.length, 1, 'the still-pending second call keeps its own deadline');
});
