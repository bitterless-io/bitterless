/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

/**
 * 解析不到窗口时,**沿用预设里配置的值**,不再整批降到 256K。
 *
 * Ral 2026-09-17:「你配置好就行,压缩后面再处理」。在这之前
 * `applyResolvedContextWindows` 写的是 `resolved[key] || DEFAULT_CONTEXT_WINDOW_TOKENS`,
 * 于是 `describeContextWindows` 每次撞上 3s 上限(冷启动 import pi + 建 ModelRuntime)都会把
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
