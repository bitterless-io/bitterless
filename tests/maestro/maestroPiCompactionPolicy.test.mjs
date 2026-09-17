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
const { resolvePiCompactionSettings } = module.exports;
const model = (id = 'gpt-6-astra', contextWindow = 272000, provider = 'openai-codex') => ({
  provider, id, contextWindow,
});

test('all four exact Codex presets reserve 20% of their resolved context window', () => {
  for (const id of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    for (const [contextWindow, reserveTokens] of [[272000, 54400], [128000, 25600], [65536, 13107]]) {
      const settings = resolvePiCompactionSettings(model(id, contextWindow));
      assert.deepEqual(settings, { enabled: true, reserveTokens, keepRecentTokens: 20000 });
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
    enabled: false, reserveTokens: 54400, keepRecentTokens: 20000,
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

test('small known windows fail explicitly when the fixed recent tail consumes the threshold', () => {
  for (const contextWindow of [1, 20000, 25000]) {
    assert.throws(() => resolvePiCompactionSettings(model('gpt-6-astra', contextWindow)), {
      name: 'RangeError', message: /too small/,
    });
  }
  assert.deepEqual(resolvePiCompactionSettings(model('gpt-6-astra', 25001)), {
    enabled: true, reserveTokens: 5000, keepRecentTokens: 20000,
  });
});

test('each resolution is independent when callers update their SettingsManager', () => {
  const first = resolvePiCompactionSettings(model());
  first.enabled = false;
  first.reserveTokens = 1;
  assert.deepEqual(resolvePiCompactionSettings(model()), {
    enabled: true, reserveTokens: 54400, keepRecentTokens: 20000,
  });
});
