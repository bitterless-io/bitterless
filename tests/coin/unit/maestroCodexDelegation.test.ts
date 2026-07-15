import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Maestro delegates only Codex credential operations to the host service', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/main/maestro/llm/maestroLlm.service.ts'),
    'utf8',
  );
  assert.match(source, /codexCredentialService\.getStatus\(\)/);
  assert.match(source, /codexCredentialService\.connect\(/);
  assert.match(source, /codexCredentialService\.disconnect\(\)/);
  assert.doesNotMatch(source, /ensureCodexIpv6Server|codexCaptureResolve/);

  assert.match(source, /provider === 'ai-crms'/);
  assert.match(source, /openAiCrmsLoginTab/);
  assert.match(source, /ensureAnthropicIpv6Server/);
  assert.match(source, /writeStoredLlmTarget/);
  assert.match(source, /resetLlmAgentSessions/);
});

test('Coin AI stays isolated from Maestro contracts and exposes no chat surface', () => {
  const sources = [
    'src/main/codex/codexRuntime.service.ts',
    'src/main/coin/ai/coinAiAnalysis.service.ts',
    'src/main/coin/ai/coinAiEvidence.service.ts',
    'src/preload/coin/coin.preload.ts',
    'src/shared/coin/coinBridge.type.ts',
    'src/renderer/coin/src/views/analysis/coinWorkspace.store.ts',
    'src/renderer/coin/src/views/analysis/CoinAiInterpretation.vue',
    'src/renderer/coin/src/views/resources/CoinResourcesView.vue',
  ].map((path) => readFileSync(join(process.cwd(), path), 'utf8')).join('\n');

  assert.doesNotMatch(sources, /MaestroLlmService|setLlmConfig|@main\/maestro|@shared\/maestro/);
  assert.doesNotMatch(sources, /chatSession|newChat|messageList|chatComposer|<textarea/i);
  assert.doesNotMatch(sources, /v-model[^\n]*provider/i);
  assert.match(sources, /noTools:\s*'all'/);
  assert.match(sources, /SessionManager\.inMemory\(\)/);
});
