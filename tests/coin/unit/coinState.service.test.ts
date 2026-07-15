import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDefaultCoinPersistentData } from '../../../src/shared/coin/coinAnalysis.type';
import { CoinStateService } from '../../../src/main/coin/state/coinState.service';

test('persists strict versioned JSON atomically and rejects stale revisions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-coin-state-'));
  try {
    let now = 10_000;
    const service = new CoinStateService({ userDataRoot: () => root, now: () => ++now });
    const initial = service.load();
    assert.equal(initial.status, 'ready');
    if (initial.status !== 'ready') return;
    const data = createDefaultCoinPersistentData();
    data.drafts.monitor.symbolsText = 'BTCUSDT';
    const saved = await service.save({ expectedRevision: 0, data });
    assert.equal(saved.status, 'saved');
    assert.equal(existsSync(service.filePath), true);
    assert.equal(readdirSync(dirname(service.filePath)).some((name) => name.endsWith('.tmp')), false);
    const disk = JSON.parse(readFileSync(service.filePath, 'utf8')) as { schema: string; revision: number };
    assert.deepEqual(disk, { ...disk, schema: 'coin-state-v1', revision: 1 });
    if (process.platform !== 'win32') {
      assert.equal(statSync(dirname(service.filePath)).mode & 0o777, 0o700);
      assert.equal(statSync(service.filePath).mode & 0o777, 0o600);
    }
    const conflict = await service.save({ expectedRevision: 0, data });
    assert.equal(conflict.status, 'conflict');
    if (conflict.status === 'conflict') assert.equal(conflict.snapshot.revision, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('surfaces malformed state and archives it only after explicit recovery', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-coin-state-corrupt-'));
  try {
    const service = new CoinStateService({ userDataRoot: () => root, now: () => 20_000 });
    const first = await service.save({ expectedRevision: 0, data: createDefaultCoinPersistentData() });
    assert.equal(first.status, 'saved');
    writeFileSync(service.filePath, '{"schema":"wrong"}\n', 'utf8');
    assert.equal(service.load().status, 'malformed');
    assert.equal(readFileSync(service.filePath, 'utf8'), '{"schema":"wrong"}\n');
    const recovered = await service.recover();
    assert.equal(recovered.status, 'recovered');
    assert.equal(service.load().status, 'ready');
    assert.equal(readdirSync(dirname(service.filePath)).includes('coin-state.corrupt-20000.json'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('persists only main-validated AI receipts and rejects stale or cancelled appends', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-coin-ai-state-'));
  try {
    const service = new CoinStateService({ userDataRoot: () => root, now: () => 30_000 });
    const data = createDefaultCoinPersistentData();
    data.analyses.push({
      id: 'monitor-result-1',
      type: 'monitor',
      chain: null,
      asset: 'BTCUSDT',
      createdAt: 29_000,
      result: {
        schema: 'coin-monitor-v1',
        requestedSymbols: ['BTCUSDT'],
        rows: [],
        missingSymbols: ['BTCUSDT'],
        readAt: 29_000,
        connection: 'closed',
        receipts: [],
      },
    });
    const initial = await service.save({ expectedRevision: 0, data });
    assert.equal(initial.status, 'saved');
    const receipt = {
      schema: 'coin-ai-analysis-receipt-v1' as const,
      runId: '33333333-3333-4333-8333-333333333333',
      target: { kind: 'monitor' as const, resultId: 'monitor-result-1' },
      provider: 'openai-codex' as const,
      model: 'gpt-5.5' as const,
      effort: 'high' as const,
      contextHash: `sha256:${'a'.repeat(64)}`,
      startedAt: 29_100,
      completedAt: 29_200,
      evidenceRefs: ['derived:monitor:monitor-result-1'],
      result: {
        schema: 'coin-ai-analysis-v1' as const,
        summary: 'Bounded fixture interpretation.',
        attentionThesis: [],
        risks: [],
        evidenceRefs: ['derived:monitor:monitor-result-1'],
        unsupportedClaims: [],
        confidence: 0.5,
      },
    };
    const appended = await service.appendAiReceipt(receipt, 1);
    assert.equal(appended.status, 'saved');
    if (appended.status !== 'saved') return;
    assert.equal(appended.snapshot.data.ai.receipts.length, 1);

    const rendererData = structuredClone(appended.snapshot.data);
    rendererData.ai.model = 'gpt-5.4';
    rendererData.ai.receipts = [];
    const rendererSave = await service.save({ expectedRevision: 2, data: rendererData });
    assert.equal(rendererSave.status, 'saved');
    if (rendererSave.status === 'saved') {
      assert.equal(rendererSave.snapshot.data.ai.model, 'gpt-5.4');
      assert.equal(rendererSave.snapshot.data.ai.receipts[0].runId, receipt.runId);
    }

    assert.equal((await service.appendAiReceipt(receipt, 1)).status, 'conflict');
    const controller = new AbortController();
    controller.abort();
    assert.equal((await service.appendAiReceipt(receipt, 3, controller.signal)).status, 'cancelled');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
