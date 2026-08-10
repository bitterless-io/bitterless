import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TRENCH_CA_ANALYSIS_SCHEMA,
  TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA,
  type TrenchCaAnalysisV1,
  type TrenchChain
} from '../../../src/shared/trench/trench.type';
import {
  TRENCH_INDEX_DETAIL_MAX_BYTES,
  TrenchRepository
} from '../../../src/main/trench/trenchRepository.service';
import { TRENCH_MAX_EXPLANATION_LENGTH } from '../../../src/shared/trench/trench.validation';

const NOW = Date.parse('2026-08-08T12:00:00.000Z');
const EVM_CA_A = `0x${'a'.repeat(40)}`;
const EVM_CA_B = `0x${'b'.repeat(40)}`;
const EVM_WALLET_1 = `0x${'1'.repeat(40)}`;
const EVM_WALLET_2 = `0x${'2'.repeat(40)}`;
const EVM_WALLET_3 = `0x${'3'.repeat(40)}`;
const SOL_CA = 'So11111111111111111111111111111111111111112';
const SOL_WALLET = '11111111111111111111111111111111';

const makeChain = (
  chain: TrenchChain,
  wallet: string,
  overrides: Record<string, unknown> = {}
) => ({
  chain,
  token: { name: `${chain} token`, symbol: chain.toUpperCase() },
  topProfitWallets: [
    {
      address: wallet,
      rank: 1,
      profitUsd: 100,
      winRate: 0.75,
      evidence: { provider: 'fixture' }
    }
  ],
  result: { status: 'fixture' },
  ...overrides
});

const makeAnalysis = (
  params: {
    id?: string;
    address?: string;
    generatedAt?: string;
    chains?: Array<Record<string, unknown>>;
    resultPadding?: Record<string, unknown>;
  } = {}
): TrenchCaAnalysisV1 => {
  const chains = params.chains ?? [makeChain('bsc', EVM_WALLET_1)];
  if (params.resultPadding) chains[0] = { ...chains[0], result: params.resultPadding };
  return {
    schema: TRENCH_CA_ANALYSIS_SCHEMA,
    analysisId: params.id ?? 'analysis-1',
    contractAddress: params.address ?? EVM_CA_A,
    generatedAt: params.generatedAt ?? '2026-08-08T10:00:00.000Z',
    source: {
      kind: 'agent',
      agent: 'unit-test',
      skill: 'bitterless-trench',
      providers: ['gmgn-token']
    },
    chains: chains as TrenchCaAnalysisV1['chains']
  };
};

const createRoot = (name: string): string => mkdtempSync(join(tmpdir(), name));

test('stores one canonical address document atomically with owner-only permissions', async () => {
  const root = createRoot('bitterless-trench-store-');
  const events: unknown[] = [];
  try {
    const repository = new TrenchRepository({
      userDataRoot: () => root,
      now: () => NOW,
      randomId: () => 'fixture-random',
      onChanged: (event) => events.push(event)
    });
    const input = makeAnalysis({
      address: EVM_CA_A.toUpperCase().replace('0X', '0x'),
      chains: [
        makeChain('robinhood', EVM_WALLET_2),
        makeChain('bsc', EVM_WALLET_1, { result: { 2: 'two', 10: 'ten' } })
      ]
    });
    const put = await repository.putAnalysis({ record: input });
    assert.equal(put.changed, true);
    assert.equal(put.record.contractAddress, EVM_CA_A);
    assert.deepEqual(
      put.record.chains.map((chain) => chain.chain),
      ['bsc', 'robinhood']
    );
    assert.equal(readdirSync(join(root, 'trench', 'analyses')).length, 1);
    assert.equal(readFileSync(repository.getAnalysisFilePath(EVM_CA_A), 'utf8'), put.document);
    assert.equal(put.document.endsWith('\n'), true);
    assert.equal(put.document.includes('\n  "analysisId"'), true);
    assert(put.document.indexOf('"10"') < put.document.indexOf('"2"'));
    assert.equal(
      put.contentHash,
      `sha256:${createHash('sha256').update(put.document).digest('hex')}`
    );
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(root, 'trench')).mode & 0o777, 0o700);
      assert.equal(statSync(join(root, 'trench', 'analyses')).mode & 0o777, 0o700);
      assert.equal(statSync(repository.getAnalysisFilePath(EVM_CA_A)).mode & 0o777, 0o600);
    }
    assert.deepEqual(events, [
      {
        schema: 'bl-trench-data-changed-v1',
        revision: 1,
        entity: 'analysis',
        identity: EVM_CA_A,
        operation: 'put'
      }
    ]);

    const retry = await repository.putAnalysis({ record: structuredClone(input) });
    assert.equal(retry.changed, false);
    assert.equal(repository.revision, 1);
    assert.equal(events.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('enforces idempotency, stale writes, and preserves prior bytes on failed commit', async () => {
  const root = createRoot('bitterless-trench-conflict-');
  let failBeforeCommit = false;
  try {
    const repository = new TrenchRepository({
      userDataRoot: () => root,
      now: () => NOW,
      beforeCommit: () => {
        if (failBeforeCommit) throw new Error('synthetic disk failure');
      }
    });
    const original = await repository.putAnalysis({ record: makeAnalysis() });
    await assert.rejects(
      repository.putAnalysis({
        record: makeAnalysis({ chains: [makeChain('bsc', EVM_WALLET_2)] })
      }),
      /IDEMPOTENCY_CONFLICT/
    );
    await assert.rejects(
      repository.putAnalysis({
        record: makeAnalysis({ id: 'analysis-stale', generatedAt: '2026-08-08T09:00:00.000Z' })
      }),
      /STALE_WRITE/
    );
    assert.equal(repository.getAnalysis(EVM_CA_A).document, original.document);

    const forced = await repository.putAnalysis({
      record: makeAnalysis({
        id: 'analysis-forced',
        generatedAt: '2026-08-08T09:00:00.000Z'
      }),
      replaceNewer: true
    });
    assert.equal(forced.record.analysisId, 'analysis-forced');
    const restored = await repository.putAnalysis({ record: makeAnalysis() });
    assert.equal(restored.document, original.document);

    failBeforeCommit = true;
    await assert.rejects(
      repository.putAnalysis({
        record: makeAnalysis({ id: 'analysis-2', generatedAt: '2026-08-08T11:00:00.000Z' })
      }),
      /synthetic disk failure/
    );
    assert.equal(repository.getAnalysis(EVM_CA_A).document, original.document);
    assert.equal(
      readdirSync(join(root, 'trench', 'analyses')).some((name) => name.startsWith('.tmp-')),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves Solana case and rejects incompatible, duplicate, gapped, future, and contradictory input', async () => {
  const root = createRoot('bitterless-trench-validation-');
  try {
    const repository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    const solana = await repository.putAnalysis({
      record: makeAnalysis({
        address: SOL_CA,
        chains: [makeChain('solana', SOL_WALLET)]
      })
    });
    assert.equal(solana.record.contractAddress, SOL_CA);
    await assert.rejects(
      repository.putAnalysis({
        record: makeAnalysis({
          id: 'bad-mixed',
          address: SOL_CA,
          chains: [makeChain('solana', SOL_WALLET), makeChain('bsc', EVM_WALLET_1)]
        })
      }),
      /cannot share/
    );
    await assert.rejects(
      repository.putAnalysis({
        record: makeAnalysis({
          id: 'bad-rank',
          address: EVM_CA_B,
          chains: [
            makeChain('bsc', EVM_WALLET_1, {
              topProfitWallets: [{ address: EVM_WALLET_1, rank: 2 }]
            })
          ]
        })
      }),
      /contiguous/
    );
    await assert.rejects(
      repository.putAnalysis({
        record: makeAnalysis({
          id: 'future',
          address: EVM_CA_B,
          generatedAt: '2026-08-08T12:05:00.001Z'
        })
      }),
      /FUTURE_TIMESTAMP/
    );
    await assert.rejects(
      repository.putAnalysis({
        record: makeAnalysis({
          id: 'contradiction',
          address: EVM_CA_B,
          chains: [
            makeChain('bsc', EVM_WALLET_1, {
              indexWalletExposure: [
                {
                  address: EVM_WALLET_1,
                  holding: false,
                  balance: '0'
                }
              ]
            })
          ]
        })
      }),
      /cannot contain measurements/
    );
    assert.throws(() => repository.getAnalysis('../../outside'), /valid EVM or Solana address/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('derives Index Wallet summaries and bounded source pages without flexible evidence', async () => {
  const root = createRoot('bitterless-trench-index-');
  try {
    const repository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    const nearLimitResult = Object.fromEntries(
      Array.from({ length: 28 }, (_, index) => [`padding${index}`, 'x'.repeat(60_000)])
    );
    const analysisIds: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      const address = `0x${(index + 256).toString(16).padStart(40, '0')}`;
      const analysisId = `large-analysis-${index}`;
      analysisIds.push(analysisId);
      const put = await repository.putAnalysis({
        record: makeAnalysis({
          id: analysisId,
          address,
          generatedAt: new Date(
            Date.parse('2026-08-08T10:00:00.000Z') + index * 1_000
          ).toISOString(),
          chains: [makeChain('bsc', EVM_WALLET_1)],
          ...(index === 0 ? { resultPadding: nearLimitResult } : {})
        })
      });
      if (index === 0) assert(Buffer.byteLength(put.document, 'utf8') > 1_500_000);
    }
    const list = repository.listIndexWallets({ limit: 1 });
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].sourceCount, 100);
    assert.equal(Object.hasOwn(list.items[0], 'sources'), false);

    const seen = [];
    let cursor: string | undefined;
    do {
      const detail = repository.getIndexWallet({
        chain: 'bsc',
        address: EVM_WALLET_1,
        limit: 100,
        cursor
      });
      assert(jsonByteLength(detail) < TRENCH_INDEX_DETAIL_MAX_BYTES);
      for (const source of detail.items) {
        assert.equal(Object.hasOwn(source, 'evidence'), false);
        assert.equal(Object.hasOwn(source.exposure ?? {}, 'evidence'), false);
        assert.match(source.analysisContentHash, /^sha256:[0-9a-f]{64}$/);
        seen.push(source.analysisId);
      }
      cursor = detail.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(new Set(seen), new Set(analysisIds));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates prospective Index and Negative references and reports later reference retirement', async () => {
  const root = createRoot('bitterless-trench-references-');
  try {
    const repository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    await assert.rejects(
      repository.putAnalysis({
        record: makeAnalysis({
          chains: [
            makeChain('bsc', EVM_WALLET_1, {
              indexWalletExposure: [{ address: EVM_WALLET_2, holding: null }]
            })
          ]
        })
      }),
      /REFERENCE_NOT_FOUND/
    );

    const tag = await repository.putNegativeWallet({
      requestId: 'negative-tag-1',
      chain: 'bsc',
      address: EVM_WALLET_3,
      explanation: 'Human supplied\nnegative evidence.'
    });
    const analysis = await repository.putAnalysis({
      record: makeAnalysis({
        chains: [
          makeChain('bsc', EVM_WALLET_1, {
            indexWalletExposure: [{ address: EVM_WALLET_1, holding: true, balance: '1' }],
            negativeWalletExposure: [{ address: EVM_WALLET_3, holding: null }]
          })
        ]
      })
    });
    assert.deepEqual(
      analysis.references.map((item) => item.status),
      ['active', 'active']
    );
    await repository.archiveNegativeWallet({
      chain: 'bsc',
      address: EVM_WALLET_3,
      expectedTagId: tag.tag.tagId,
      expectedContentHash: tag.contentHash
    });
    const reread = repository.getAnalysis(EVM_CA_A);
    assert.equal(
      reread.references.find((item) => item.kind === 'negative-wallet')?.status,
      'no-longer-current'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps Negative tag and holdings separate and archives their directory with one rename', async () => {
  const root = createRoot('bitterless-trench-negative-');
  try {
    const repository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    await assert.rejects(
      repository.putNegativeWalletHoldings({
        record: {
          schema: TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA,
          analysisId: 'holdings-missing-tag',
          chain: 'bsc',
          address: EVM_WALLET_2,
          generatedAt: '2026-08-08T10:00:00.000Z',
          holdings: [],
          result: {}
        }
      }),
      /REFERENCE_NOT_FOUND/
    );
    const tag = await repository.putNegativeWallet({
      requestId: 'negative-tag-2',
      chain: 'bsc',
      address: EVM_WALLET_2,
      explanation: '  Multi-line reason.\r\nSecond line.  '
    });
    assert.equal(tag.tag.explanation, 'Multi-line reason.\nSecond line.');
    const tagRetry = await repository.putNegativeWallet({
      requestId: 'negative-tag-2',
      chain: 'bsc',
      address: EVM_WALLET_2,
      explanation: 'Multi-line reason.\nSecond line.'
    });
    assert.equal(tagRetry.changed, false);
    await assert.rejects(
      repository.putNegativeWallet({
        requestId: 'negative-tag-2',
        chain: 'bsc',
        address: EVM_WALLET_2,
        explanation: 'Different content'
      }),
      /IDEMPOTENCY_CONFLICT/
    );
    const correctedTag = await repository.putNegativeWallet({
      requestId: 'negative-tag-3',
      chain: 'bsc',
      address: EVM_WALLET_2,
      explanation: 'Corrected human explanation.'
    });
    assert.equal(correctedTag.tag.createdAt, tag.tag.createdAt);
    assert(Date.parse(correctedTag.tag.updatedAt) > Date.parse(tag.tag.updatedAt));
    const holdings = await repository.putNegativeWalletHoldings({
      record: {
        schema: TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA,
        analysisId: 'holdings-1',
        chain: 'bsc',
        address: EVM_WALLET_2,
        generatedAt: '2026-08-08T10:30:00.000Z',
        holdings: [
          { contractAddress: EVM_CA_A, balance: '2.5', valueUsd: 5 },
          { symbol: 'BNB', balance: '1' }
        ],
        result: { status: 'fixture' }
      }
    });
    const holdingsRetry = await repository.putNegativeWalletHoldings({
      record: holdings.record
    });
    assert.equal(holdingsRetry.changed, false);
    await assert.rejects(
      repository.putNegativeWalletHoldings({
        record: { ...holdings.record, result: { changed: true } }
      }),
      /IDEMPOTENCY_CONFLICT/
    );
    const directory = repository.getNegativeWalletDirectory('bsc', EVM_WALLET_2);
    assert.deepEqual(readdirSync(directory).sort(), ['holdings.json', 'tag.json']);
    assert.notEqual(holdings.compositeContentHash, holdings.contentHash);
    const detail = repository.getNegativeWallet('bsc', EVM_WALLET_2);
    assert.equal(detail.contentHash, holdings.compositeContentHash);
    await assert.rejects(
      repository.archiveNegativeWallet({
        chain: 'bsc',
        address: EVM_WALLET_2,
        expectedTagId: correctedTag.tag.tagId,
        expectedContentHash: `sha256:${'0'.repeat(64)}`
      }),
      /CONFLICT/
    );
    assert.equal(existsSync(directory), true);
    await repository.archiveNegativeWallet({
      chain: 'bsc',
      address: EVM_WALLET_2,
      expectedTagId: correctedTag.tag.tagId,
      expectedContentHash: detail.contentHash
    });
    assert.equal(existsSync(directory), false);
    const archiveRoot = join(root, 'trench', 'archive', 'negative-wallets', 'bsc');
    const archivedDirectories = readdirSync(archiveRoot);
    assert.equal(archivedDirectories.length, 1);
    const archiveContainer = join(archiveRoot, archivedDirectories[0]);
    const archivedRecords = readdirSync(archiveContainer);
    assert.equal(archivedRecords.length, 1);
    assert.deepEqual(readdirSync(join(archiveContainer, archivedRecords[0])).sort(), [
      'holdings.json',
      'tag.json'
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binds list cursors to query and revision and removes archived Index evidence', async () => {
  const root = createRoot('bitterless-trench-cursor-');
  try {
    const repository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    const first = await repository.putAnalysis({ record: makeAnalysis() });
    await repository.putAnalysis({
      record: makeAnalysis({
        id: 'analysis-b',
        address: EVM_CA_B,
        generatedAt: '2026-08-08T11:00:00.000Z',
        chains: [makeChain('bsc', EVM_WALLET_2)]
      })
    });
    const page = repository.listAnalyses({ query: 'analysis', limit: 1 });
    assert(page.nextCursor);
    await repository.putNegativeWallet({
      requestId: 'cursor-revision',
      chain: 'bsc',
      address: EVM_WALLET_3,
      explanation: 'Revision mutation'
    });
    assert.throws(
      () =>
        repository.listAnalyses({
          query: 'analysis',
          limit: 1,
          cursor: page.nextCursor ?? undefined
        }),
      /CURSOR_STALE/
    );
    assert.equal(repository.listIndexWallets().total, 2);
    await repository.putAnalysis({
      record: makeAnalysis({
        id: 'analysis-b-new',
        address: EVM_CA_B,
        generatedAt: '2026-08-08T11:30:00.000Z',
        chains: [makeChain('bsc', EVM_WALLET_3)]
      })
    });
    const replacedIndex = repository.listIndexWallets();
    assert.equal(
      replacedIndex.items.some((item) => item.address === EVM_WALLET_2),
      false
    );
    assert.equal(
      replacedIndex.items.some((item) => item.address === EVM_WALLET_3),
      true
    );
    await repository.archiveAnalysis({
      contractAddress: EVM_CA_A,
      expectedAnalysisId: first.record.analysisId,
      expectedContentHash: first.contentHash
    });
    const index = repository.listIndexWallets();
    assert.equal(
      index.items.some((item) => item.address === EVM_WALLET_1),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maps an Analysis corrupted after listing to INVALID_STORED_RECORD', async () => {
  const root = createRoot('bitterless-trench-issues-');
  try {
    const repository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    await repository.putAnalysis({ record: makeAnalysis() });
    assert.equal(repository.listAnalyses().items.length, 1);
    writeFileSync(
      repository.getAnalysisFilePath(EVM_CA_A),
      '{"schema":"wrong"}\n',
      'utf8'
    );
    assert.throws(() => repository.getAnalysis(EVM_CA_A), /INVALID_STORED_RECORD/);
    const list = repository.listAnalyses();
    assert.equal(list.items.length, 0);
    assert.equal(list.issues.length, 1);
    assert.equal(list.issues[0].code, 'INVALID_STORED_RECORD');
    assert.equal(list.issues[0].message.includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'rejects Trench root, nested directory, and final-file symlinks without touching outside data',
  { skip: process.platform === 'win32' },
  async () => {
    const roots: string[] = [];
    const createTrackedRoot = (name: string): string => {
      const root = createRoot(name);
      roots.push(root);
      return root;
    };
    try {
      const rootSymlinkUserData = createTrackedRoot('bitterless-trench-root-link-');
      const rootSymlinkOutside = createTrackedRoot('bitterless-trench-root-link-outside-');
      const rootSentinel = join(rootSymlinkOutside, 'sentinel.txt');
      writeFileSync(rootSentinel, 'outside-root', 'utf8');
      chmodSync(rootSymlinkOutside, 0o755);
      symlinkSync(rootSymlinkOutside, join(rootSymlinkUserData, 'trench'), 'dir');
      const rootRepository = new TrenchRepository({
        userDataRoot: () => rootSymlinkUserData,
        now: () => NOW
      });
      await assert.rejects(
        rootRepository.putAnalysis({ record: makeAnalysis() }),
        /real directory|symlink|path escape/
      );
      assert.equal(readFileSync(rootSentinel, 'utf8'), 'outside-root');
      assert.equal(statSync(rootSymlinkOutside).mode & 0o777, 0o755);

      const nestedUserData = createTrackedRoot('bitterless-trench-nested-link-');
      const nestedOutside = createTrackedRoot('bitterless-trench-nested-link-outside-');
      const nestedRepository = new TrenchRepository({
        userDataRoot: () => nestedUserData,
        now: () => NOW
      });
      nestedRepository.listAnalyses();
      rmSync(join(nestedUserData, 'trench', 'analyses'), { recursive: true });
      symlinkSync(nestedOutside, join(nestedUserData, 'trench', 'analyses'), 'dir');
      await assert.rejects(
        nestedRepository.putAnalysis({ record: makeAnalysis() }),
        /real directory|symlink|path escape/
      );
      assert.deepEqual(readdirSync(nestedOutside), []);

      const finalUserData = createTrackedRoot('bitterless-trench-final-link-');
      const finalOutside = createTrackedRoot('bitterless-trench-final-link-outside-');
      const finalSentinel = join(finalOutside, 'sentinel.json');
      writeFileSync(finalSentinel, 'outside-final', 'utf8');
      const finalRepository = new TrenchRepository({
        userDataRoot: () => finalUserData,
        now: () => NOW
      });
      finalRepository.listAnalyses();
      symlinkSync(finalSentinel, finalRepository.getAnalysisFilePath(EVM_CA_A), 'file');
      await assert.rejects(
        finalRepository.putAnalysis({ record: makeAnalysis() }),
        /bounded regular file|real file/
      );
      assert.equal(readFileSync(finalSentinel, 'utf8'), 'outside-final');

      const swappedUserData = createTrackedRoot('bitterless-trench-swapped-link-');
      const swappedOutside = createTrackedRoot('bitterless-trench-swapped-link-outside-');
      const swappedSentinel = join(swappedOutside, 'sentinel.json');
      writeFileSync(swappedSentinel, 'outside-before-commit', 'utf8');
      const swappedRepository = new TrenchRepository({
        userDataRoot: () => swappedUserData,
        now: () => NOW,
        beforeCommit: ({ targetPath }) => symlinkSync(swappedSentinel, targetPath, 'file')
      });
      await assert.rejects(
        swappedRepository.putAnalysis({ record: makeAnalysis() }),
        /bounded regular file|real file/
      );
      assert.equal(readFileSync(swappedSentinel, 'utf8'), 'outside-before-commit');

      const temporaryUserData = createTrackedRoot('bitterless-trench-temp-link-');
      const temporaryOutside = createTrackedRoot('bitterless-trench-temp-link-outside-');
      const temporarySentinel = join(temporaryOutside, 'sentinel.json');
      writeFileSync(temporarySentinel, 'outside-temporary', 'utf8');
      const fixedTemporaryId = 'fixed-temporary-id';
      const temporaryRepository = new TrenchRepository({
        userDataRoot: () => temporaryUserData,
        now: () => NOW,
        randomId: () => fixedTemporaryId
      });
      temporaryRepository.listAnalyses();
      const temporaryName = `.tmp-${process.pid}-${createHash('sha256')
        .update(fixedTemporaryId)
        .digest('hex')
        .slice(0, 24)}`;
      symlinkSync(
        temporarySentinel,
        join(temporaryUserData, 'trench', 'analyses', temporaryName),
        'file'
      );
      await assert.rejects(
        temporaryRepository.putAnalysis({ record: makeAnalysis() }),
        /exclusive temporary Trench record/
      );
      assert.equal(readFileSync(temporarySentinel, 'utf8'), 'outside-temporary');
    } finally {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    }
  }
);

test('archives into exclusive collision-retried containers without overwriting history', async () => {
  const root = createRoot('bitterless-trench-archive-collision-');
  try {
    const events: unknown[] = [];
    const repository = new TrenchRepository({
      userDataRoot: () => root,
      now: () => NOW,
      randomId: () => 'fixed-random',
      archiveId: () => 'fixed-archive',
      onChanged: (event) => events.push(event)
    });
    const firstAnalysis = await repository.putAnalysis({ record: makeAnalysis() });
    await assert.rejects(
      repository.archiveAnalysis({
        contractAddress: EVM_CA_A,
        expectedAnalysisId: 'wrong-analysis-id',
        expectedContentHash: firstAnalysis.contentHash
      }),
      /CONFLICT/
    );
    await assert.rejects(
      repository.archiveAnalysis({
        contractAddress: EVM_CA_A,
        expectedAnalysisId: firstAnalysis.record.analysisId,
        expectedContentHash: `sha256:${'0'.repeat(64)}`
      }),
      /CONFLICT/
    );
    assert.equal(repository.getAnalysis(EVM_CA_A).document, firstAnalysis.document);
    assert.equal(repository.revision, 1);
    assert.equal(events.length, 1);
    assert.equal(existsSync(join(root, 'trench', 'archive', 'analyses')), false);

    await repository.archiveAnalysis({
      contractAddress: EVM_CA_A,
      expectedAnalysisId: firstAnalysis.record.analysisId,
      expectedContentHash: firstAnalysis.contentHash
    });
    const secondAnalysis = await repository.putAnalysis({
      record: makeAnalysis({
        id: 'analysis-2',
        generatedAt: '2026-08-08T11:00:00.000Z'
      })
    });
    await repository.archiveAnalysis({
      contractAddress: EVM_CA_A,
      expectedAnalysisId: secondAnalysis.record.analysisId,
      expectedContentHash: secondAnalysis.contentHash
    });

    const analysisArchiveRoot = join(root, 'trench', 'archive', 'analyses');
    const analysisContainers = readdirSync(analysisArchiveRoot).sort();
    assert.equal(analysisContainers.length, 2);
    const archivedAnalysisIds = analysisContainers.map((containerName) => {
      const container = join(analysisArchiveRoot, containerName);
      const records = readdirSync(container);
      assert.equal(records.length, 1);
      return JSON.parse(readFileSync(join(container, records[0]), 'utf8')).analysisId;
    });
    assert.deepEqual(new Set(archivedAnalysisIds), new Set(['analysis-1', 'analysis-2']));

    const archiveNegativeGeneration = async (
      requestId: string,
      analysisId: string
    ): Promise<void> => {
      await repository.putNegativeWallet({
        requestId,
        chain: 'bsc',
        address: EVM_WALLET_2,
        explanation: `Archive generation ${requestId}`
      });
      await repository.putNegativeWalletHoldings({
        record: {
          schema: TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA,
          analysisId,
          chain: 'bsc',
          address: EVM_WALLET_2,
          generatedAt: '2026-08-08T10:30:00.000Z',
          holdings: [{ contractAddress: EVM_CA_A, balance: '1' }],
          result: { generation: requestId }
        }
      });
      const detail = repository.getNegativeWallet('bsc', EVM_WALLET_2);
      await repository.archiveNegativeWallet({
        chain: 'bsc',
        address: EVM_WALLET_2,
        expectedTagId: requestId,
        expectedContentHash: detail.contentHash
      });
    };
    await archiveNegativeGeneration('negative-generation-1', 'holdings-generation-1');
    await archiveNegativeGeneration('negative-generation-2', 'holdings-generation-2');

    const negativeArchiveRoot = join(root, 'trench', 'archive', 'negative-wallets', 'bsc');
    const negativeContainers = readdirSync(negativeArchiveRoot).sort();
    assert.equal(negativeContainers.length, 2);
    const archivedNegativeIds = negativeContainers.map((containerName) => {
      const container = join(negativeArchiveRoot, containerName);
      const records = readdirSync(container);
      assert.equal(records.length, 1);
      const recordDirectory = join(container, records[0]);
      assert.deepEqual(readdirSync(recordDirectory).sort(), ['holdings.json', 'tag.json']);
      return JSON.parse(readFileSync(join(recordDirectory, 'tag.json'), 'utf8')).tagId;
    });
    assert.deepEqual(
      new Set(archivedNegativeIds),
      new Set(['negative-generation-1', 'negative-generation-2'])
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binds cursors to a repository-instance epoch even when revisions alias', async () => {
  const root = createRoot('bitterless-trench-cursor-epoch-');
  try {
    const firstRepository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    await firstRepository.putAnalysis({ record: makeAnalysis() });
    await firstRepository.putAnalysis({
      record: makeAnalysis({
        id: 'analysis-b',
        address: EVM_CA_B,
        generatedAt: '2026-08-08T11:00:00.000Z'
      })
    });
    const firstPage = firstRepository.listAnalyses({ limit: 1 });
    assert(firstPage.nextCursor);
    const cursorPayload = JSON.parse(
      Buffer.from(firstPage.nextCursor, 'base64url').toString('utf8')
    );
    assert.equal(cursorPayload.version, 2);
    assert.match(cursorPayload.epoch, /^[0-9a-f-]{36}$/);
    assert.equal(
      firstRepository.listAnalyses({ limit: 1, cursor: firstPage.nextCursor }).items.length,
      1
    );

    const secondRepository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    await secondRepository.putNegativeWallet({
      requestId: 'epoch-mutation-1',
      chain: 'bsc',
      address: EVM_WALLET_2,
      explanation: 'Epoch mutation one'
    });
    await secondRepository.putNegativeWallet({
      requestId: 'epoch-mutation-2',
      chain: 'bsc',
      address: EVM_WALLET_3,
      explanation: 'Epoch mutation two'
    });
    assert.equal(secondRepository.revision, cursorPayload.revision);
    assert.throws(
      () => secondRepository.listAnalyses({ limit: 1, cursor: firstPage.nextCursor }),
      /CURSOR_STALE/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('serializes same-instance concurrent writes and continues after a queued failure', async () => {
  const root = createRoot('bitterless-trench-concurrent-');
  try {
    const repository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    const operations = Array.from({ length: 21 }, (_, index) => {
      const second = index === 10 ? 9 : index;
      return repository.putAnalysis({
        record: makeAnalysis({
          id: `concurrent-${index}`,
          generatedAt: new Date(
            Date.parse('2026-08-08T10:00:00.000Z') + second * 1_000
          ).toISOString()
        })
      });
    });
    const results = await Promise.allSettled(operations);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 20);
    assert.equal(results[10].status, 'rejected');
    assert.match(String((results[10] as PromiseRejectedResult).reason), /STALE_WRITE/);
    assert.equal(repository.revision, 20);
    assert.equal(repository.getAnalysis(EVM_CA_A).record.analysisId, 'concurrent-20');
    assert.equal(readdirSync(join(root, 'trench', 'analyses')).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('enforces explanation and holdings stale/future boundaries without changing active bytes', async () => {
  const root = createRoot('bitterless-trench-holdings-boundaries-');
  try {
    const repository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    const explanation = '😀'.repeat(TRENCH_MAX_EXPLANATION_LENGTH);
    const tag = await repository.putNegativeWallet({
      requestId: 'bounded-explanation',
      chain: 'bsc',
      address: EVM_WALLET_2,
      explanation
    });
    assert.equal(Array.from(tag.tag.explanation).length, TRENCH_MAX_EXPLANATION_LENGTH);
    await assert.rejects(
      repository.putNegativeWallet({
        requestId: 'too-long-explanation',
        chain: 'bsc',
        address: EVM_WALLET_2,
        explanation: `${explanation}😀`
      }),
      /at most 2000 code points/
    );

    const makeHoldings = (analysisId: string, generatedAt: string) => ({
      schema: TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA,
      analysisId,
      chain: 'bsc',
      address: EVM_WALLET_2,
      generatedAt,
      holdings: [{ contractAddress: EVM_CA_A, balance: '1' }],
      result: { analysisId }
    });
    const original = await repository.putNegativeWalletHoldings({
      record: makeHoldings('holdings-current', '2026-08-08T10:30:00.000Z')
    });
    await assert.rejects(
      repository.putNegativeWalletHoldings({
        record: makeHoldings('holdings-stale', '2026-08-08T10:29:00.000Z')
      }),
      /STALE_WRITE/
    );
    await assert.rejects(
      repository.putNegativeWalletHoldings({
        record: makeHoldings('holdings-future', '2026-08-08T12:05:00.001Z')
      }),
      /FUTURE_TIMESTAMP/
    );
    assert.equal(
      repository.getNegativeWalletHoldings('bsc', EVM_WALLET_2).document,
      original.document
    );
    const forced = await repository.putNegativeWalletHoldings({
      record: makeHoldings('holdings-forced', '2026-08-08T09:00:00.000Z'),
      replaceNewer: true
    });
    assert.equal(forced.record.analysisId, 'holdings-forced');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('surfaces malformed Negative tag and holdings files as bounded sanitized issues', async () => {
  const root = createRoot('bitterless-trench-negative-issues-');
  try {
    const repository = new TrenchRepository({ userDataRoot: () => root, now: () => NOW });
    await repository.putNegativeWallet({
      requestId: 'malformed-tag',
      chain: 'bsc',
      address: EVM_WALLET_2,
      explanation: 'Will become malformed'
    });
    writeFileSync(
      join(repository.getNegativeWalletDirectory('bsc', EVM_WALLET_2), 'tag.json'),
      '{"schema":"wrong"}\n',
      'utf8'
    );

    await repository.putNegativeWallet({
      requestId: 'malformed-holdings',
      chain: 'bsc',
      address: EVM_WALLET_3,
      explanation: 'Valid tag with malformed holdings'
    });
    await repository.putNegativeWalletHoldings({
      record: {
        schema: TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA,
        analysisId: 'malformed-holdings-source',
        chain: 'bsc',
        address: EVM_WALLET_3,
        generatedAt: '2026-08-08T10:00:00.000Z',
        holdings: [],
        result: {}
      }
    });
    const validDetail = repository.getNegativeWallet('bsc', EVM_WALLET_3);
    writeFileSync(
      join(repository.getNegativeWalletDirectory('bsc', EVM_WALLET_3), 'holdings.json'),
      '{"schema":"wrong"}\n',
      'utf8'
    );

    const list = repository.listNegativeWallets();
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].address, EVM_WALLET_3);
    assert.equal(list.items[0].hasHoldings, false);
    assert(list.issues.length <= 100);
    assert.deepEqual(
      new Set(list.issues.map((issue) => issue.entity)),
      new Set(['negative-wallet', 'negative-wallet-holdings'])
    );
    assert.equal(
      list.issues.some((issue) => issue.message.includes(root)),
      false
    );
    assert.throws(
      () => repository.getNegativeWallet('bsc', EVM_WALLET_2),
      /INVALID_STORED_RECORD/
    );
    assert.throws(
      () => repository.getNegativeWalletForBrowser('bsc', EVM_WALLET_2),
      /INVALID_STORED_RECORD/
    );
    assert.throws(
      () => repository.getNegativeWallet('bsc', EVM_WALLET_3),
      /INVALID_STORED_RECORD/
    );
    assert.throws(
      () => repository.getNegativeWalletHoldings('bsc', EVM_WALLET_3),
      /INVALID_STORED_RECORD/
    );

    const browserDetail = repository.getNegativeWalletForBrowser('bsc', EVM_WALLET_3);
    assert.equal(browserDetail.tagDocument, validDetail.tagDocument);
    assert.equal(browserDetail.tag.explanation, 'Valid tag with malformed holdings');
    assert.equal(browserDetail.holdings, null);
    assert.equal(browserDetail.holdingsDocument, null);
    assert.equal(browserDetail.holdingsContentHash, null);
    assert.equal(browserDetail.holdingsIssue?.code, 'INVALID_STORED_RECORD');
    assert.equal(browserDetail.holdingsIssue?.entity, 'negative-wallet-holdings');
    assert.equal(browserDetail.holdingsIssue?.message.includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const jsonByteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
