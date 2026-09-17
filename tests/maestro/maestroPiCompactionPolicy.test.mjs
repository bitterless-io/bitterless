import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import ts from 'typescript';

const file = resolve(import.meta.dirname, '../../src/main/agent/runtime/piCompactionPolicy.ts');
const module = { exports: {} };
const output = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('module', 'exports', output)(module, module.exports);
const { PI_COMPACTION_CONFIG, resolvePiCompactionSettings } = module.exports;
const model = (id = 'gpt-6-astra', contextWindow = 272000, provider = 'openai-codex') => ({
  provider, id, contextWindow,
});

test('all four exact Codex presets reserve 20% and retain 10% of their resolved context window', () => {
  for (const id of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    for (const [contextWindow, reserveTokens, keepRecentTokens] of [[272000, 54400, 27200], [128000, 25600, 12800], [65536, 13107, 6553]]) {
      const settings = resolvePiCompactionSettings(model(id, contextWindow));
      assert.deepEqual(settings, { enabled: true, reserveTokens, keepRecentTokens });
      assert.deepEqual(SettingsManager.inMemory({ compaction: settings }).getCompactionSettings(), settings);
      assert.ok(contextWindow - settings.reserveTokens > settings.keepRecentTokens);
    }
  }
});

test('unlisted keys preserve installed Pi defaults with exact case-sensitive matching', () => {
  const defaults = SettingsManager.inMemory().getCompactionSettings();
  assert.deepEqual(defaults, { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 });
  for (const candidate of [
    model('gpt-6-astra', 272000, 'openai'),
    model('gpt-6-astra', 272000, 'OpenAI-Codex'),
    model('GPT-6-ASTRA'),
    model('gpt-6-astra-preview'),
    model('gpt-6-astra '),
    model('gpt-future'),
    model('fixture', 1, 'fixture'),
  ]) {
    assert.deepEqual(resolvePiCompactionSettings(candidate), defaults);
  }
});

test('disabled child sessions remain disabled for known and unknown models', () => {
  assert.deepEqual(resolvePiCompactionSettings(model(), false), {
    enabled: false, reserveTokens: 54400, keepRecentTokens: 27200,
  });
  assert.deepEqual(resolvePiCompactionSettings(model('fixture'), false), {
    enabled: false, reserveTokens: 16384, keepRecentTokens: 20000,
  });
});

test('known models reject invalid context windows without inventing a fallback', () => {
  for (const contextWindow of [0, -1, NaN, Infinity, 272000.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resolvePiCompactionSettings(model('gpt-6-astra', contextWindow)), {
      name: 'RangeError', message: /expected a positive safe integer/,
    });
  }
});

test('small Codex windows scale both budgets while invalid custom layouts still fail explicitly', () => {
  for (const contextWindow of [1, 20000, 25000]) {
    assert.deepEqual(resolvePiCompactionSettings(model('gpt-6-astra', contextWindow)), {
      enabled: true, reserveTokens: Math.floor(contextWindow * 0.2), keepRecentTokens: Math.floor(contextWindow * 0.1),
    });
    assert.throws(() => resolvePiCompactionSettings(model('gpt-6-astra', contextWindow), true, {
      modelOverrides: { 'openai-codex/gpt-6-astra': { reserveTokens: { ratio: 0.2 }, keepRecentTokens: 20000 } },
    }), {
      name: 'RangeError', message: /too small/,
    });
  }
  assert.deepEqual(resolvePiCompactionSettings(model('gpt-6-astra', 25001)), {
    enabled: true, reserveTokens: 5000, keepRecentTokens: 2500,
  });
});

test('each resolution is independent when callers update their SettingsManager', () => {
  const first = resolvePiCompactionSettings(model());
  first.enabled = false;
  first.reserveTokens = 1;
  assert.deepEqual(resolvePiCompactionSettings(model()), {
    enabled: true, reserveTokens: 54400, keepRecentTokens: 27200,
  });
  const manager = SettingsManager.inMemory({ compaction: resolvePiCompactionSettings(model()) });
  manager.applyOverrides({ compaction: resolvePiCompactionSettings(model('gpt-5.6-sol', 128000)) });
  assert.deepEqual(manager.getCompactionSettings(), {
    enabled: true, reserveTokens: 25600, keepRecentTokens: 12800,
  });
  manager.applyOverrides({ compaction: resolvePiCompactionSettings(model('fixture')) });
  assert.deepEqual(manager.getCompactionSettings(), {
    enabled: true, reserveTokens: 16384, keepRecentTokens: 20000,
  });
});

test('the shipped explicit config overrides both Codex ratios and preserves ordinary Pi defaults', () => {
  assert.equal(PI_COMPACTION_CONFIG.reserveTokens, 16384);
  assert.equal(PI_COMPACTION_CONFIG.keepRecentTokens, 20000);
  assert.deepEqual(Object.keys(PI_COMPACTION_CONFIG.modelOverrides), [
    'openai-codex/gpt-6-astra', 'openai-codex/gpt-5.6-sol',
    'openai-codex/gpt-5.6-terra', 'openai-codex/gpt-5.6-luna',
  ]);
  for (const override of Object.values(PI_COMPACTION_CONFIG.modelOverrides)) {
    assert.deepEqual(override, { reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } });
  }
});

test('ordinary absolute counts and each omitted field fall back independently to Pi defaults', () => {
  for (const [config, reserveTokens, keepRecentTokens] of [
    [{}, 16384, 20000],
    [{ reserveTokens: 4096 }, 4096, 20000],
    [{ keepRecentTokens: 8192 }, 16384, 8192],
    [{ reserveTokens: 4096, keepRecentTokens: 8192 }, 4096, 8192],
    [{ reserveTokens: 0, keepRecentTokens: 0 }, 0, 0],
  ]) {
    assert.deepEqual(resolvePiCompactionSettings(model(), true, config), {
      enabled: true, reserveTokens, keepRecentTokens,
    });
  }
});

test('both ordinary budgets support ratios, mixed forms and floor rounding against the actual window', () => {
  for (const [config, reserveTokens, keepRecentTokens] of [
    [{ reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } }, 13107, 6553],
    [{ reserveTokens: 4096, keepRecentTokens: { ratio: 0.1 } }, 4096, 6553],
    [{ reserveTokens: { ratio: 0.2 }, keepRecentTokens: 20000 }, 13107, 20000],
    [{ reserveTokens: { ratio: 0 }, keepRecentTokens: { ratio: 0 } }, 0, 0],
  ]) {
    assert.deepEqual(resolvePiCompactionSettings(model('fixture', 65536), true, config), {
      enabled: true, reserveTokens, keepRecentTokens,
    });
  }
  assert.deepEqual(resolvePiCompactionSettings(model('fixture', 101), true, {
    reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 },
  }), { enabled: true, reserveTokens: 20, keepRecentTokens: 10 });
});

test('exact provider/model overrides support slash IDs and independent override > ordinary > native fallback', () => {
  const candidate = model('family/model', 65536, 'provider');
  const key = 'provider/family/model';
  for (const [config, reserveTokens, keepRecentTokens] of [
    [{ modelOverrides: { [key]: { reserveTokens: 2048 } } }, 2048, 20000],
    [{ reserveTokens: 4096, modelOverrides: { [key]: { keepRecentTokens: 8192 } } }, 4096, 8192],
    [{ keepRecentTokens: 8192, modelOverrides: { [key]: { reserveTokens: { ratio: 0.2 } } } }, 13107, 8192],
    [{ reserveTokens: 4096, modelOverrides: { [key]: { keepRecentTokens: { ratio: 0.1 } } } }, 4096, 6553],
    [{ modelOverrides: { [key]: { reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } } } }, 13107, 6553],
  ]) {
    assert.deepEqual(resolvePiCompactionSettings(candidate, false, config), {
      enabled: false, reserveTokens, keepRecentTokens,
    });
  }
  const config = { reserveTokens: 4096, modelOverrides: { [key]: { reserveTokens: 2048 } } };
  assert.equal(resolvePiCompactionSettings(model('family/model/extra', 65536, 'provider'), true, config).reserveTokens, 4096);
  assert.equal(resolvePiCompactionSettings(model('family/model', 65536, 'Provider'), true, config).reserveTokens, 4096);
  const inherited = Object.create({ [key]: { reserveTokens: 123 } });
  assert.equal(resolvePiCompactionSettings(candidate, true, { modelOverrides: inherited }).reserveTokens, 16384);
});

test('absolute budgets reject invalid values in ordinary and model configuration without coercion', () => {
  for (const field of ['reserveTokens', 'keepRecentTokens']) {
    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '4096', null, [], {}, { percent: 20 }]) {
      assert.throws(() => resolvePiCompactionSettings(model(), true, { [field]: value }), /Invalid/);
      assert.throws(() => resolvePiCompactionSettings(model(), true, {
        modelOverrides: { 'openai-codex/gpt-6-astra': { [field]: value } },
      }), /Invalid/);
    }
  }
});

test('ratios reject invalid values and ambiguous shapes in either budget', () => {
  for (const field of ['reserveTokens', 'keepRecentTokens']) {
    for (const ratio of [-0.1, 1, 1.1, NaN, Infinity, '0.2', null, undefined]) {
      assert.throws(() => resolvePiCompactionSettings(model(), true, { [field]: { ratio } }), /Invalid/);
      assert.throws(() => resolvePiCompactionSettings(model(), true, {
        modelOverrides: { 'openai-codex/gpt-6-astra': { [field]: { ratio } } },
      }), /Invalid/);
    }
    assert.throws(() => resolvePiCompactionSettings(model(), true, { [field]: { ratio: 0.2, tokens: 4096 } }), /Invalid/);
  }
});

test('ordinary invalid fields are not hidden by a valid model override', () => {
  for (const field of ['reserveTokens', 'keepRecentTokens']) {
    assert.throws(() => resolvePiCompactionSettings(model(), true, {
      [field]: -1,
      modelOverrides: { 'openai-codex/gpt-6-astra': { [field]: 1000 } },
    }), /Invalid/);
  }
});

test('ratios validate unknown model windows and configured budgets never auto-clamp', () => {
  for (const contextWindow of [0, -1, NaN, Infinity, 65536.5, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of ['reserveTokens', 'keepRecentTokens']) {
      assert.throws(() => resolvePiCompactionSettings(model('fixture', contextWindow), true, {
        [field]: { ratio: 0.2 },
      }), /expected a positive safe integer/);
    }
  }
  for (const config of [
    { reserveTokens: { ratio: 0.5 }, keepRecentTokens: { ratio: 0.5 } },
    { modelOverrides: { 'openai-codex/fixture': { reserveTokens: 30000, keepRecentTokens: 40000 } } },
  ]) {
    assert.throws(() => resolvePiCompactionSettings(model('fixture', 65536), true, config), /too small/);
  }
});
