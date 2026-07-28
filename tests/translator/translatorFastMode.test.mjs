import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeSource = readFileSync(
  new URL('../../src/main/codex/codexRuntime.service.ts', import.meta.url),
  'utf8'
);
const translatorSource = readFileSync(
  new URL('../../src/main/translator/translator.service.ts', import.meta.url),
  'utf8'
);

test('Translator explicitly opts every translation into Fast mode', () => {
  assert.match(
    translatorSource,
    /this\.dependencies\.runtime\.run\(\{[\s\S]*?model: TRANSLATOR_MODEL,[\s\S]*?effort: TRANSLATOR_EFFORT,[\s\S]*?serviceTier: 'fast',/
  );
});

test('Fast is a per-request runtime option mapped to provider priority', () => {
  assert.match(runtimeSource, /serviceTier\?: CodexRuntimeServiceTier;/);
  assert.match(
    runtimeSource,
    /const enableFastServiceTier = \(session: CodexRuntimePiSession\): \(\(\) => void\) =>/
  );
  assert.match(runtimeSource, /service_tier: 'priority'/);
  assert.match(
    runtimeSource,
    /if \(input\.serviceTier === 'fast'\) \{\s*assertFastServiceTierApplied = enableFastServiceTier\(session\);\s*\}/
  );
});

test('Fast cannot silently continue without a writable Agent payload hook', () => {
  assert.match(
    runtimeSource,
    /if \(!agent\) throw new CodexRuntimeError\('runtime-unavailable'\);/
  );
  assert.match(
    runtimeSource,
    /agent\.onPayload = fastOnPayload;\s*if \(agent\.onPayload !== fastOnPayload\) throw new CodexRuntimeError\('runtime-unavailable'\);/
  );
  assert.match(runtimeSource, /CODEX_FAST_UNAVAILABLE_SENTINEL/);
  assert.match(runtimeSource, /if \(!applied\) throw new CodexRuntimeError\('runtime-unavailable'\);/);
  assert.match(runtimeSource, /assertFastServiceTierApplied\(\);/);
});
