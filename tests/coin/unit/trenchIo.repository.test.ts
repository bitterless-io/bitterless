import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { TrenchIoDatabase } from '../../../src/renderer/trench-io/trenchIo.database';
import {
  TRENCH_IO_INITIAL_SCHEMA,
  TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE,
  TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE,
  TRENCH_IO_CHAIN_SCHEMA,
  TRENCH_IO_PERSON_SCHEMA_VERSION_CODE,
  TRENCH_IO_SCHEMA_VERSION_CODE,
} from '../../../src/renderer/trench-io/trenchIo.migration';
import { TRENCH_IO_TEST_PASSWORD } from '../../../src/renderer/trench-io/trenchIoPassword.service';
import {
  TrenchIndexRepositoryError,
  TrenchIoRepository,
} from '../../../src/renderer/trench-io/trenchIo.repository';
import type {
  TrenchIndexCandidate,
  TrenchIndexTokenMetadata,
} from '../../../src/shared/trench/trenchIndex.type';
import { normalizeTrenchXIdentity } from '../../../src/shared/trench/trenchPerson.validation';

const VERSION = '260813155645';
const ca = '0x1111111111111111111111111111111111111111';
const secondCa = '0x3333333333333333333333333333333333333333';
const wallet = '0x2222222222222222222222222222222222222222';

const metadata = (
  highestMarketCapUsd = 100,
  highestMarketCapKind: TrenchIndexTokenMetadata['highestMarketCapKind'] = 'provider-ath',
  observedAt = 10,
): TrenchIndexTokenMetadata => ({
  name: 'Token',
  symbol: 'TOK',
  priceUsd: 1,
  circulatingSupply: 50,
  currentMarketCapUsd: 50,
  highestMarketCapUsd,
  highestMarketCapKind,
  observedAt,
});

const candidate = (overrides: Partial<TrenchIndexCandidate> = {}): TrenchIndexCandidate => ({
  wallet: {
    chain: 'bsc',
    address: wallet,
    canonicalAddress: wallet,
    name: 'First name',
    avatarUrl: null,
    metadata: { walletScore: 99 },
    walletKind: 'user',
    classificationSource: 'gmgn-addr-type',
    classificationUpdatedAt: 10,
  },
  xIdentity: null,
  sourceRank: 1,
  profitUsd: 50,
  realizedProfitUsd: 40,
  unrealizedProfitUsd: 10,
  eligible: true,
  exclusionReason: null,
  evidence: { transactionCount: 12 },
  ...overrides,
});

const userCandidate = (
  address: string,
  sourceRank: number,
  profitUsd: number,
  name: string,
  xHandle: string | null,
): TrenchIndexCandidate => candidate({
  wallet: {
    ...candidate().wallet,
    address,
    canonicalAddress: address,
    name,
    metadata: {},
  },
  xIdentity: normalizeTrenchXIdentity(xHandle),
  sourceRank,
  profitUsd,
  realizedProfitUsd: profitUsd,
  unrealizedProfitUsd: null,
});

const beginAdd = (repo: TrenchIoRepository, requestId: string, fingerprint: string) =>
  repo.addTargetsAndBeginRun({
    requestId,
    requestFingerprint: fingerprint,
    targets: [{
      chain: 'bsc',
      contractAddress: ca,
      canonicalAddress: ca,
      metadata: metadata(),
    }],
  });

const workspaceTargets = (repo: TrenchIoRepository) => repo.getWorkspace().chainProjections
  .flatMap(({ targets }) => targets);
const workspaceWallets = (repo: TrenchIoRepository) => repo.getWorkspace().chainProjections
  .flatMap(({ wallets }) => wallets);

test('add-target idempotency mutates nothing on conflict and survives interrupted analysis', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-io-'));
  const path = join(root, 'trench', 'trench.db');
  try {
    let db = new TrenchIoDatabase(path, TRENCH_IO_TEST_PASSWORD, VERSION);
    let repo = new TrenchIoRepository(db, () => 100);
    repo.initialize();
    const batch = {
      requestId: '11111111-1111-4111-8111-111111111111',
      requestFingerprint: 'a'.repeat(64),
      targets: [ca, secondCa].map((contractAddress) => ({
        chain: 'bsc' as const,
        contractAddress,
        canonicalAddress: contractAddress,
        metadata: metadata(),
      })),
    };
    const first = repo.addTargetsAndBeginRun(batch);
    const replay = repo.addTargetsAndBeginRun(batch);
    assert.equal(replay.replayed, true);
    assert.equal(replay.runId, first.runId);
    assert.equal(first.targets.length, 2);
    assert.throws(
      () => repo.addTargetsAndBeginRun({
        requestId: '11111111-1111-4111-8111-111111111111',
        requestFingerprint: 'b'.repeat(64),
        targets: [{
          chain: 'bsc',
          contractAddress: '0x4444444444444444444444444444444444444444',
          canonicalAddress: '0x4444444444444444444444444444444444444444',
          metadata: metadata(),
        }],
      }),
      (error) => error instanceof TrenchIndexRepositoryError && error.code === 'REQUEST_CONFLICT',
    );
    assert.equal(workspaceTargets(repo).length, 2);
    db.close();

    db = new TrenchIoDatabase(path, TRENCH_IO_TEST_PASSWORD, VERSION);
    repo = new TrenchIoRepository(db, () => 200);
    repo.initialize();
    const recovered = repo.getWorkspace();
    assert.equal(recovered.chainProjections.flatMap(({ targets }) => targets).length, 2);
    assert.equal(recovered.chainProjections.flatMap(({ targets }) => targets)
      .every(({ state }) => state === 'error'), true);
    assert.equal(recovered.lastFailedRun?.runId, first.runId);
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('repository publishes atomically, preserves central enrichment and rejects rank gaps', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-io-'));
  const db = new TrenchIoDatabase(
    join(root, 'trench', 'trench.db'),
    TRENCH_IO_TEST_PASSWORD,
    VERSION,
  );
  let clock = 100;
  const repo = new TrenchIoRepository(db, () => ++clock);
  try {
    repo.initialize();
    const first = beginAdd(repo, '22222222-2222-4222-8222-222222222222', 'c'.repeat(64));
    repo.completeRun({
      runId: first.runId,
      observedAt: 200,
      targets: [{
        targetId: first.targets[0]!.targetId,
        chain: 'bsc',
        contractAddress: ca,
        metadata: metadata(),
        candidates: [candidate()],
      }],
      wallets: [{
        chain: 'bsc',
        canonicalAddress: wallet,
        xIdentity: null,
        chainRank: 1,
        totalProfitUsd: 50,
        sourceCaCount: 1,
        profitableCaCount: 1,
        bestSourceRank: 1,
        realizedProfitUsd: 40,
        unrealizedProfitUsd: 10,
      }],
    });

    const second = repo.beginRun({
      requestId: '33333333-3333-4333-8333-333333333333',
      requestFingerprint: 'd'.repeat(64),
      trigger: 'reanalyze',
    });
    repo.completeRun({
      runId: second.runId,
      observedAt: 300,
      targets: [{
        targetId: second.targets[0]!.targetId,
        chain: 'bsc',
        contractAddress: ca,
        metadata: metadata(90, 'observed', 20),
        candidates: [candidate({
          wallet: {
            ...candidate().wallet,
            name: 'Replacement name',
            avatarUrl: 'https://example.com/later.png',
            metadata: { walletScore: 88 },
            walletKind: 'unknown',
            classificationSource: 'unclassified',
            classificationUpdatedAt: 20,
          },
          eligible: false,
          exclusionReason: 'unknown-wallet-kind',
        })],
      }],
      wallets: [],
    });
    const central = db.raw.prepare(`
      SELECT w.name,w.avatar_url,w.metadata_json,a.wallet_kind,a.classification_source
      FROM trench_wallets w JOIN trench_wallet_chain_accounts a ON a.wallet_id=w.wallet_id
      WHERE a.chain='bsc' AND w.canonical_address=?
    `).get(wallet) as Record<string, unknown>;
    assert.equal(central.name, 'First name');
    assert.equal(central.avatar_url, 'https://example.com/later.png');
    assert.deepEqual(JSON.parse(String(central.metadata_json)), {
      walletScore: 99,
    });
    assert.equal(central.wallet_kind, 'user');
    assert.equal(central.classification_source, 'gmgn-addr-type');
    assert.equal(workspaceTargets(repo)[0]?.highestMarketCapUsd, 100);
    assert.equal(workspaceTargets(repo)[0]?.highestMarketCapKind, 'provider-ath');
    const auditCount = db.raw.prepare(
      'SELECT COUNT(*) AS count FROM trench_index_wallet_candidates WHERE run_id=?',
    ).get(second.runId) as { count: number };
    assert.equal(auditCount.count, 1);

    const third = repo.beginRun({
      requestId: '44444444-4444-4444-8444-444444444444',
      requestFingerprint: 'e'.repeat(64),
      trigger: 'reanalyze',
    });
    assert.throws(() => repo.completeRun({
      runId: third.runId,
      observedAt: 400,
      targets: [{
        targetId: third.targets[0]!.targetId,
        chain: 'bsc',
        contractAddress: ca,
        metadata: metadata(100, 'provider-ath', 30),
        candidates: [candidate()],
      }],
      wallets: [{
        chain: 'bsc',
        canonicalAddress: wallet,
        xIdentity: null,
        chainRank: 2,
        totalProfitUsd: 50,
        sourceCaCount: 1,
        profitableCaCount: 1,
        bestSourceRank: 1,
        realizedProfitUsd: 40,
        unrealizedProfitUsd: 10,
      }],
    }), (error) => error instanceof TrenchIndexRepositoryError && error.code === 'SOURCE_INVALID');
    assert.equal(repo.getWorkspace().activeRun?.runId, third.runId);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('highest market cap keeps the strongest value and equal-value evidence provenance', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-io-'));
  const db = new TrenchIoDatabase(
    join(root, 'trench', 'trench.db'),
    TRENCH_IO_TEST_PASSWORD,
    VERSION,
  );
  let clock = 500;
  const repo = new TrenchIoRepository(db, () => ++clock);
  const completeWithoutWallets = (
    run: ReturnType<typeof beginAdd>,
    targetMetadata: TrenchIndexTokenMetadata,
    observedAt: number,
  ): void => {
    repo.completeRun({
      runId: run.runId,
      observedAt,
      targets: [{
        targetId: run.targets[0]!.targetId,
        chain: 'bsc',
        contractAddress: ca,
        metadata: targetMetadata,
        candidates: [],
      }],
      wallets: [],
    });
  };
  try {
    repo.initialize();
    const first = beginAdd(repo, '55555555-5555-4555-8555-555555555555', 'f'.repeat(64));
    completeWithoutWallets(first, metadata(100, 'provider-ath', 10), 600);

    const equalObserved = repo.addTargetsAndBeginRun({
      requestId: '66666666-6666-4666-8666-666666666666',
      requestFingerprint: '1'.repeat(64),
      targets: [{
        chain: 'bsc',
        contractAddress: ca,
        canonicalAddress: ca,
        metadata: metadata(100, 'observed', 20),
      }],
    });
    assert.equal(workspaceTargets(repo)[0]?.highestMarketCapKind, 'provider-ath');
    completeWithoutWallets(equalObserved, metadata(100, 'estimated-ath', 21), 700);
    assert.equal(workspaceTargets(repo)[0]?.highestMarketCapKind, 'provider-ath');

    const higherObserved = repo.beginRun({
      requestId: '77777777-7777-4777-8777-777777777777',
      requestFingerprint: '2'.repeat(64),
      trigger: 'reanalyze',
    });
    completeWithoutWallets(higherObserved, metadata(110, 'observed', 30), 800);
    assert.equal(workspaceTargets(repo)[0]?.highestMarketCapUsd, 110);
    assert.equal(workspaceTargets(repo)[0]?.highestMarketCapKind, 'observed');
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('repository rejects wrong-chain candidate evidence without publishing or changing chains', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-io-'));
  const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
  const repo = new TrenchIoRepository(db, () => 1_000);
  try {
    repo.initialize();
    const run = beginAdd(repo, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '5'.repeat(64));
    assert.throws(() => repo.completeRun({
      runId: run.runId,
      observedAt: 1_001,
      targets: [{
        targetId: run.targets[0]!.targetId,
        chain: 'bsc',
        contractAddress: ca,
        metadata: metadata(),
        candidates: [candidate({
          wallet: {
            ...candidate().wallet,
            chain: 'solana',
            address: 'So11111111111111111111111111111111111111112',
            canonicalAddress: 'So11111111111111111111111111111111111111112',
          },
        })],
      }],
      wallets: [],
    }), (error) => error instanceof TrenchIndexRepositoryError && error.code === 'SOURCE_INVALID');
    assert.equal(workspaceWallets(repo).length, 0);
    assert.equal(repo.getWorkspace().activeRun?.runId, run.runId);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('central provider classification is order-independent and structural evidence wins', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-io-'));
  const db = new TrenchIoDatabase(
    join(root, 'trench', 'trench.db'),
    TRENCH_IO_TEST_PASSWORD,
    VERSION,
  );
  let clock = 900;
  const repo = new TrenchIoRepository(db, () => ++clock);
  const structural = candidate({
    wallet: {
      ...candidate().wallet,
      walletKind: 'unknown',
      classificationSource: 'gmgn-label',
    },
    eligible: false,
    exclusionReason: 'other-non-user',
  });
  const completeConflict = (
    run: ReturnType<TrenchIoRepository['addTargetsAndBeginRun']>,
    rows: [TrenchIndexCandidate, TrenchIndexCandidate],
    observedAt: number,
  ): void => repo.completeRun({
    runId: run.runId,
    observedAt,
    targets: run.targets.map((target, index) => ({
      targetId: target.targetId,
      chain: target.chain,
      contractAddress: target.contractAddress,
      metadata: metadata(100, 'provider-ath', observedAt),
      candidates: [rows[index]!],
    })),
    wallets: [],
  });
  try {
    repo.initialize();
    const first = repo.addTargetsAndBeginRun({
      requestId: '88888888-8888-4888-8888-888888888888',
      requestFingerprint: '3'.repeat(64),
      targets: [ca, secondCa].map((contractAddress) => ({
        chain: 'bsc' as const,
        contractAddress,
        canonicalAddress: contractAddress,
        metadata: metadata(),
      })),
    });
    completeConflict(first, [candidate(), structural], 1_000);
    const afterFirst = db.raw.prepare(`
      SELECT a.wallet_kind,a.classification_source FROM trench_wallets w
      JOIN trench_wallet_chain_accounts a ON a.wallet_id=w.wallet_id
      WHERE a.chain='bsc' AND w.canonical_address=?
    `).get(wallet) as { wallet_kind: string; classification_source: string };
    assert.deepEqual(afterFirst, { wallet_kind: 'unknown', classification_source: 'gmgn-label' });
    assert.equal(workspaceWallets(repo).length, 0);

    const second = repo.beginRun({
      requestId: '99999999-9999-4999-8999-999999999998',
      requestFingerprint: '4'.repeat(64),
      trigger: 'reanalyze',
    });
    completeConflict(second, [structural, candidate()], 1_100);
    const afterReverse = db.raw.prepare(`
      SELECT a.wallet_kind,a.classification_source FROM trench_wallets w
      JOIN trench_wallet_chain_accounts a ON a.wallet_id=w.wallet_id
      WHERE a.chain='bsc' AND w.canonical_address=?
    `).get(wallet) as { wallet_kind: string; classification_source: string };
    assert.deepEqual(afterReverse, afterFirst);
    assert.equal(workspaceWallets(repo).length, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('018 databases upgrade without row loss and deterministically rerank each chain like fresh 019', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-io-upgrade-'));
  const path = join(root, 'trench.db');
  const legacy = new Database(path);
  try {
    legacy.pragma("cipher = 'sqlcipher'");
    legacy.pragma('legacy = 4');
    legacy.pragma(`key = '${TRENCH_IO_TEST_PASSWORD}'`);
    legacy.pragma('cipher_page_size = 8192');
    legacy.exec(TRENCH_IO_INITIAL_SCHEMA);
    legacy.prepare('INSERT INTO trench_schema_migrations VALUES (?,?,?)')
      .run(TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE, 'initial-index-schema', 1);
    legacy.prepare(`INSERT INTO trench_index_runs (
      run_id,request_id,request_fingerprint,trigger,status,started_at,completed_at,target_count,
      candidate_count,eligible_count,published_count,policy_version
    ) VALUES (?,?,?,'reanalyze','completed',1,2,1,3,3,3,?)`).run(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'a'.repeat(64),
      'profit-sum-v1',
    );
    legacy.prepare(`INSERT INTO trench_index_runs (
      run_id,request_id,request_fingerprint,trigger,status,started_at,completed_at,target_count,
      candidate_count,eligible_count,published_count,policy_version
    ) VALUES (?,?,?,'reanalyze','completed',0,1,1,1,1,1,?)`).run(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'b'.repeat(64),
      'profit-sum-v1',
    );
    const insertWallet = legacy.prepare(`INSERT INTO trench_wallets (
      wallet_id,chain,canonical_address,address,metadata_json,metadata_source,wallet_kind,
      classification_source,classification_updated_at,first_seen_at,last_seen_at,metadata_updated_at
    ) VALUES (?,?,?,?,?,'gmgn','user','gmgn-addr-type',1,1,1,1)`);
    const rows = [
      ['11111111-1111-4111-8111-111111111111', 'bsc', '0x1111111111111111111111111111111111111111', 1, 10],
      ['22222222-2222-4222-8222-222222222222', 'solana', 'So11111111111111111111111111111111111111112', 2, 100],
      ['33333333-3333-4333-8333-333333333333', 'bsc', '0x3333333333333333333333333333333333333333', 3, 20],
    ] as const;
    const insertIndex = legacy.prepare(`INSERT INTO trench_index_wallets (
      run_id,wallet_id,global_rank,total_profit_usd,source_ca_count,profitable_ca_count,
      best_source_rank,realized_profit_usd,unrealized_profit_usd
    ) VALUES (?,?,?,?,1,1,1,NULL,NULL)`);
    for (const [walletId, chain, address, rank, profit] of rows) {
      insertWallet.run(walletId, chain, address, address, '{}');
      insertIndex.run('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', walletId, rank, profit);
    }
    insertIndex.run(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      '11111111-1111-4111-8111-111111111111',
      1,
      10,
    );
    legacy.prepare('INSERT INTO trench_repository_state VALUES (1,7,?,2)')
      .run('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  } finally {
    legacy.close();
  }

  const upgraded = new TrenchIoDatabase(path, TRENCH_IO_TEST_PASSWORD, VERSION);
  try {
    const rows = upgraded.raw.prepare(`SELECT run_id,chain,chain_rank,total_profit_usd
      FROM trench_index_wallets ORDER BY run_id,chain,chain_rank`).all();
    assert.deepEqual(rows, [
      { run_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', chain: 'bsc', chain_rank: 1, total_profit_usd: 20 },
      { run_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', chain: 'bsc', chain_rank: 2, total_profit_usd: 10 },
      { run_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', chain: 'solana', chain_rank: 1, total_profit_usd: 100 },
      { run_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', chain: 'bsc', chain_rank: 1, total_profit_usd: 10 },
    ]);
    assert.deepEqual(upgraded.raw.prepare(
      'SELECT version_code FROM trench_schema_migrations ORDER BY version_code',
    ).all(), [
      { version_code: TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE },
      { version_code: TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE },
      { version_code: TRENCH_IO_PERSON_SCHEMA_VERSION_CODE },
      { version_code: TRENCH_IO_SCHEMA_VERSION_CODE },
    ]);
    assert.equal(upgraded.raw.prepare('SELECT revision FROM trench_repository_state WHERE id=1')
      .pluck().get(), 7);
  } finally {
    upgraded.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('019 upgrade converges one cross-chain EVM wallet without losing accounts, results, display address, or curated metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-io-global-upgrade-'));
  const path = join(root, 'trench.db');
  const legacy = new Database(path);
  const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const bscWalletId = '11111111-1111-4111-8111-111111111111';
  const robinhoodWalletId = '22222222-2222-4222-8222-222222222222';
  const sharedAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const retainedDisplayAddress = '0xAbcdefabcdefabcdefabcdefabcdefabcdefabcd';
  try {
    legacy.pragma("cipher = 'sqlcipher'");
    legacy.pragma('legacy = 4');
    legacy.pragma(`key = '${TRENCH_IO_TEST_PASSWORD}'`);
    legacy.pragma('cipher_page_size = 8192');
    legacy.exec(TRENCH_IO_CHAIN_SCHEMA);
    legacy.prepare('INSERT INTO trench_schema_migrations VALUES (?,?,?)')
      .run(TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE, 'initial-index-schema', 1);
    legacy.prepare('INSERT INTO trench_schema_migrations VALUES (?,?,?)')
      .run(TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE, 'chain-partitioned-index', 2);
    const targetIds = [
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ];
    for (const [index, chain] of (['bsc', 'robinhood'] as const).entries()) {
      legacy.prepare(`INSERT INTO trench_index_targets (
        target_id,chain,canonical_address,address,metadata_observed_at,created_at,updated_at
      ) VALUES (?,?,?,?,1,1,1)`).run(
        targetIds[index], chain, `0x${String(index + 1).repeat(40)}`, `0x${String(index + 1).repeat(40)}`,
      );
    }
    legacy.prepare(`INSERT INTO trench_index_runs (
      run_id,request_id,request_fingerprint,trigger,status,started_at,completed_at,target_count,
      candidate_count,eligible_count,published_count,policy_version
    ) VALUES (?,?,?,'reanalyze','completed',1,2,2,2,2,2,?)`).run(
      runId, '55555555-5555-4555-8555-555555555555', 'a'.repeat(64), 'profit-sum-v1',
    );
    for (const targetId of targetIds) legacy.prepare(`INSERT INTO trench_index_target_snapshots (
      run_id,target_id,highest_market_cap_kind,observed_at
    ) VALUES (?,?,'unavailable',1)`).run(runId, targetId);
    legacy.prepare(`INSERT INTO trench_wallets (
      wallet_id,chain,canonical_address,address,name,metadata_json,metadata_source,wallet_kind,
      classification_source,classification_updated_at,first_seen_at,last_seen_at,metadata_updated_at
    ) VALUES (?,?,?,?,?,?,'gmgn','user','gmgn-addr-type',1,1,1,1)`).run(
      bscWalletId, 'bsc', sharedAddress, retainedDisplayAddress, 'GMGN name',
      '{"provider":true,"twitterUsername":"@LeGaCy_X"}',
    );
    legacy.prepare(`INSERT INTO trench_wallets (
      wallet_id,chain,canonical_address,address,name,note,metadata_json,metadata_source,wallet_kind,
      classification_source,classification_updated_at,first_seen_at,last_seen_at,metadata_updated_at
    ) VALUES (?,?,?,?,?,?,?,'manual','user','manual',2,2,3,4)`).run(
      robinhoodWalletId, 'robinhood', sharedAddress, sharedAddress, 'Curated name', 'keep me',
      '{"curated":true}',
    );
    const insertCandidate = legacy.prepare(`INSERT INTO trench_index_wallet_candidates (
      run_id,target_id,wallet_id,source_rank,profit_usd,eligible,evidence_json
    ) VALUES (?,?,?,1,?,1,'{}')`);
    insertCandidate.run(runId, targetIds[0], bscWalletId, 10);
    insertCandidate.run(runId, targetIds[1], robinhoodWalletId, 20);
    const insertResult = legacy.prepare(`INSERT INTO trench_index_wallets (
      run_id,wallet_id,chain,chain_rank,total_profit_usd,source_ca_count,profitable_ca_count,
      best_source_rank
    ) VALUES (?,?,?,1,?,1,1,1)`);
    insertResult.run(runId, bscWalletId, 'bsc', 10);
    insertResult.run(runId, robinhoodWalletId, 'robinhood', 20);
    legacy.prepare('INSERT INTO trench_repository_state VALUES (1,9,?,2)').run(runId);
  } finally {
    legacy.close();
  }

  const upgraded = new TrenchIoDatabase(path, TRENCH_IO_TEST_PASSWORD, VERSION);
  try {
    assert.equal(upgraded.raw.prepare('SELECT COUNT(*) FROM trench_wallets').pluck().get(), 1);
    assert.equal(upgraded.raw.prepare('SELECT COUNT(*) FROM trench_wallet_chain_accounts').pluck().get(), 2);
    assert.equal(upgraded.raw.prepare('SELECT COUNT(*) FROM trench_index_wallet_candidates').pluck().get(), 2);
    assert.equal(upgraded.raw.prepare('SELECT COUNT(*) FROM trench_index_wallets').pluck().get(), 2);
    assert.deepEqual(upgraded.raw.prepare(`
      SELECT wallet_id,address_namespace,address,name,note,metadata_source,metadata_json FROM trench_wallets
    `).get(), {
      wallet_id: bscWalletId,
      address_namespace: 'evm',
      address: retainedDisplayAddress,
      name: 'Curated name',
      note: 'keep me',
      metadata_source: 'mixed',
      metadata_json: '{"curated":true,"provider":true}',
    });
    assert.deepEqual(upgraded.raw.prepare(`
      SELECT wallet_account_id,chain,wallet_kind,classification_source
      FROM trench_wallet_chain_accounts ORDER BY chain
    `).all(), [
      { wallet_account_id: bscWalletId, chain: 'bsc', wallet_kind: 'user', classification_source: 'gmgn-addr-type' },
      { wallet_account_id: robinhoodWalletId, chain: 'robinhood', wallet_kind: 'user', classification_source: 'manual' },
    ]);
    assert.equal(upgraded.raw.prepare('SELECT current_run_id FROM trench_repository_state WHERE id=1')
      .pluck().get(), runId);
    assert.equal(upgraded.raw.prepare('SELECT revision FROM trench_repository_state WHERE id=1')
      .pluck().get(), 9);
    const person = upgraded.raw.prepare(`
      SELECT status,merged_into_person_id,display_name,avatar_url,note,display_name_source,
        avatar_source,note_source FROM trench_persons
    `).get();
    assert.deepEqual(person, {
      status: 'active',
      merged_into_person_id: null,
      display_name: null,
      avatar_url: null,
      note: null,
      display_name_source: 'system',
      avatar_source: 'system',
      note_source: 'system',
    });
    const membership = upgraded.raw.prepare(`
      SELECT person_id,wallet_id,link_source,evidence_json FROM trench_person_wallets
    `).get() as { person_id: string; wallet_id: string; link_source: string; evidence_json: string };
    assert.match(membership.person_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(membership.wallet_id, bscWalletId);
    assert.equal(membership.link_source, 'gmgn-x');
    const identity = upgraded.raw.prepare(`
      SELECT person_id,canonical_value,display_value,source,evidence_json
      FROM trench_person_external_identities
    `).get() as {
      person_id: string;
      canonical_value: string;
      display_value: string;
      source: string;
      evidence_json: string;
    };
    assert.equal(identity.person_id, membership.person_id);
    assert.equal(identity.canonical_value, 'legacy_x');
    assert.equal(identity.display_value, '@LeGaCy_X');
    assert.equal(identity.source, 'gmgn');
    assert.deepEqual(JSON.parse(identity.evidence_json), {
      schema: 'bl-trench-x-legacy-wallet-evidence-v1',
      walletId: bscWalletId,
      metadataSource: 'gmgn',
      observedAt: 1,
    });
    assert.deepEqual(JSON.parse(membership.evidence_json), JSON.parse(identity.evidence_json));
    assert.equal(upgraded.raw.prepare(`
      SELECT SUM(results.total_profit_usd)
      FROM trench_person_wallets memberships
      JOIN trench_wallet_chain_accounts accounts ON accounts.wallet_id=memberships.wallet_id
      JOIN trench_index_wallets results ON results.wallet_account_id=accounts.wallet_account_id
      JOIN trench_repository_state state ON state.current_run_id=results.run_id
      WHERE memberships.person_id=?
    `).pluck().get(membership.person_id), 30);
    assert.deepEqual(upgraded.raw.prepare(
      'SELECT version_code FROM trench_schema_migrations ORDER BY version_code',
    ).all(), [
      { version_code: TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE },
      { version_code: TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE },
      { version_code: TRENCH_IO_PERSON_SCHEMA_VERSION_CODE },
      { version_code: TRENCH_IO_SCHEMA_VERSION_CODE },
    ]);
  } finally {
    upgraded.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('019 upgrade rejects invalid legacy wallet X metadata without mutating the 019 schema', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-io-invalid-legacy-x-'));
  const path = join(root, 'trench.db');
  const legacy = new Database(path);
  try {
    legacy.pragma("cipher = 'sqlcipher'");
    legacy.pragma('legacy = 4');
    legacy.pragma(`key = '${TRENCH_IO_TEST_PASSWORD}'`);
    legacy.pragma('cipher_page_size = 8192');
    legacy.exec(TRENCH_IO_CHAIN_SCHEMA);
    legacy.prepare('INSERT INTO trench_schema_migrations VALUES (?,?,?)')
      .run(TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE, 'initial-index-schema', 1);
    legacy.prepare('INSERT INTO trench_schema_migrations VALUES (?,?,?)')
      .run(TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE, 'chain-partitioned-index', 2);
    legacy.prepare(`INSERT INTO trench_wallets (
      wallet_id,chain,canonical_address,address,metadata_json,metadata_source,wallet_kind,
      classification_source,classification_updated_at,first_seen_at,last_seen_at,metadata_updated_at
    ) VALUES (?,'bsc',?,?,?,'gmgn','user','gmgn-addr-type',1,1,1,1)`).run(
      '11111111-1111-4111-8111-111111111111',
      '0x1111111111111111111111111111111111111111',
      '0x1111111111111111111111111111111111111111',
      '{"walletScore":7,"twitter_username":"not a valid handle"}',
    );
    legacy.prepare('INSERT INTO trench_repository_state VALUES (1,5,NULL,2)').run();
  } finally {
    legacy.close();
  }

  assert.throws(
    () => new TrenchIoDatabase(path, TRENCH_IO_TEST_PASSWORD, VERSION),
    /legacy wallet X identity is invalid/,
  );
  const retained = new Database(path);
  try {
    retained.pragma("cipher = 'sqlcipher'");
    retained.pragma('legacy = 4');
    retained.pragma(`key = '${TRENCH_IO_TEST_PASSWORD}'`);
    retained.pragma('cipher_page_size = 8192');
    assert.deepEqual(retained.prepare(`
      SELECT version_code,name FROM trench_schema_migrations ORDER BY version_code
    `).all(), [
      { version_code: TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE, name: 'initial-index-schema' },
      { version_code: TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE, name: 'chain-partitioned-index' },
    ]);
    assert.equal(retained.prepare('SELECT revision FROM trench_repository_state WHERE id=1')
      .pluck().get(), 5);
    assert.equal(retained.prepare(`
      SELECT COUNT(*) FROM sqlite_master
      WHERE type='table' AND (name LIKE '%_019' OR name LIKE 'trench_person%')
    `).pluck().get(), 0);
    assert.equal(retained.prepare('PRAGMA integrity_check').pluck().get(), 'ok');
  } finally {
    retained.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('manual and agent wallet provenance curates person fields and fences later shared-X collisions', () => {
  const scenarios = [
    {
      source: 'manual' as const,
      walletId: '10101010-1010-4010-8010-101010101010',
      firstRequestId: '11111111-1010-4010-8010-101010101010',
      secondRequestId: '12121212-1010-4010-8010-101010101010',
      firstAddress: '0x1010101010101010101010101010101010101010',
      secondAddress: '0x1111111111111111111111111111111111111110',
    },
    {
      source: 'agent' as const,
      walletId: '20202020-2020-4020-8020-202020202020',
      firstRequestId: '21212121-2020-4020-8020-202020202020',
      secondRequestId: '22222222-2020-4020-8020-202020202020',
      firstAddress: '0x2020202020202020202020202020202020202020',
      secondAddress: '0x2222222222222222222222222222222222222220',
    },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const root = mkdtempSync(join(tmpdir(), `bitterless-trench-person-${scenario.source}-`));
    const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
    const repo = new TrenchIoRepository(db, () => 7_000 + index);
    const walletMetadata = JSON.stringify({ keep: scenario.source, walletScore: 88 });
    try {
      repo.initialize();
      db.raw.prepare(`
        INSERT INTO trench_wallets (
          wallet_id,address_namespace,canonical_address,address,name,avatar_url,note,metadata_json,
          metadata_source,first_seen_at,last_seen_at,metadata_updated_at
        ) VALUES (?,'evm',?,?,?,?,'wallet note',?,?,1,1,1)
      `).run(
        scenario.walletId, scenario.firstAddress, scenario.firstAddress,
        `${scenario.source} wallet name`, `https://example.com/${scenario.source}.png`,
        walletMetadata, scenario.source,
      );
      const first = beginAdd(repo, scenario.firstRequestId, `${index + 1}`.repeat(64));
      repo.completeRun({
        runId: first.runId,
        observedAt: 7_100 + index,
        targets: [{
          targetId: first.targets[0]!.targetId,
          chain: 'bsc',
          contractAddress: ca,
          metadata: metadata(),
          candidates: [
            userCandidate(scenario.firstAddress, 1, 20, 'Provider replacement', '@Fence_X'),
            userCandidate(scenario.secondAddress, 2, 10, 'Uncurated contender', null),
          ],
        }],
        wallets: [
          { chain: 'bsc', canonicalAddress: scenario.firstAddress,
            xIdentity: { canonicalValue: 'fence_x', displayValue: '@Fence_X' }, chainRank: 1,
            totalProfitUsd: 20, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
            realizedProfitUsd: 20, unrealizedProfitUsd: null },
          { chain: 'bsc', canonicalAddress: scenario.secondAddress, xIdentity: null, chainRank: 2,
            totalProfitUsd: 10, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
            realizedProfitUsd: 10, unrealizedProfitUsd: null },
        ],
      });
      const curated = db.raw.prepare(`
        SELECT persons.person_id,persons.display_name,persons.avatar_url,
          persons.display_name_source,persons.avatar_source
        FROM trench_persons persons
        JOIN trench_person_wallets memberships ON memberships.person_id=persons.person_id
        JOIN trench_wallets wallets ON wallets.wallet_id=memberships.wallet_id
        WHERE wallets.canonical_address=?
      `).get(scenario.firstAddress) as {
        person_id: string;
        display_name: string;
        avatar_url: string;
        display_name_source: string;
        avatar_source: string;
      };
      assert.deepEqual(curated, {
        person_id: curated.person_id,
        display_name: `${scenario.source} wallet name`,
        avatar_url: `https://example.com/${scenario.source}.png`,
        display_name_source: scenario.source,
        avatar_source: scenario.source,
      });
      assert.deepEqual(db.raw.prepare(`
        SELECT name,avatar_url,note,metadata_json,metadata_source FROM trench_wallets WHERE wallet_id=?
      `).get(scenario.walletId), {
        name: `${scenario.source} wallet name`,
        avatar_url: `https://example.com/${scenario.source}.png`,
        note: 'wallet note',
        metadata_json: walletMetadata,
        metadata_source: scenario.source,
      });

      const second = repo.beginRun({
        requestId: scenario.secondRequestId,
        requestFingerprint: `${index + 3}`.repeat(64),
        trigger: 'reanalyze',
      });
      repo.completeRun({
        runId: second.runId,
        observedAt: 7_200 + index,
        targets: [{
          targetId: second.targets[0]!.targetId,
          chain: 'bsc',
          contractAddress: ca,
          metadata: metadata(),
          candidates: [
            userCandidate(scenario.firstAddress, 1, 20, 'Provider replacement 2', '@Fence_X'),
            userCandidate(scenario.secondAddress, 2, 10, 'Contender replacement', 'fence_x'),
          ],
        }],
        wallets: [
          { chain: 'bsc', canonicalAddress: scenario.firstAddress,
            xIdentity: { canonicalValue: 'fence_x', displayValue: '@Fence_X' }, chainRank: 1,
            totalProfitUsd: 20, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
            realizedProfitUsd: 20, unrealizedProfitUsd: null },
          { chain: 'bsc', canonicalAddress: scenario.secondAddress,
            xIdentity: { canonicalValue: 'fence_x', displayValue: 'fence_x' }, chainRank: 2,
            totalProfitUsd: 10, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
            realizedProfitUsd: 10, unrealizedProfitUsd: null },
        ],
      });
      assert.equal(db.raw.prepare("SELECT COUNT(*) FROM trench_persons WHERE status='active'")
        .pluck().get(), 2);
      assert.equal(db.raw.prepare("SELECT COUNT(*) FROM trench_persons WHERE status='merged'")
        .pluck().get(), 0);
      const conflict = db.raw.prepare(`
        SELECT identity_owner_person_id,contender_person_id,evidence_json
        FROM trench_person_identity_conflicts WHERE status='open'
      `).get() as {
        identity_owner_person_id: string;
        contender_person_id: string;
        evidence_json: string;
      };
      assert.equal(conflict.identity_owner_person_id, curated.person_id);
      assert.notEqual(conflict.contender_person_id, curated.person_id);
      assert.deepEqual(JSON.parse(conflict.evidence_json), {
        schema: 'bl-trench-x-gmgn-evidence-v1',
        walletId: db.raw.prepare(`
          SELECT wallet_id FROM trench_wallets WHERE canonical_address=?
        `).pluck().get(scenario.secondAddress),
        targetId: second.targets[0]!.targetId,
        sourceRank: 2,
        observedAt: 7_200 + index,
        displayValue: 'fence_x',
      });
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('blank manual, agent, and mixed wallet provenance fences GMGN enrichment and later X merge', () => {
  const scenarios = [
    {
      source: 'manual' as const,
      walletId: '50505050-5050-4050-8050-505050505050',
      firstRequestId: '51515151-5151-4151-8151-515151515151',
      secondRequestId: '52525252-5252-4252-8252-525252525252',
      ownerAddress: '0x5151515151515151515151515151515151515151',
      curatedAddress: '0x5050505050505050505050505050505050505050',
      note: 'manual wallet note',
      metadata: {},
    },
    {
      source: 'agent' as const,
      walletId: '60606060-6060-4060-8060-606060606060',
      firstRequestId: '61616161-6161-4161-8161-616161616161',
      secondRequestId: '62626262-6262-4262-8262-626262626262',
      ownerAddress: '0x6161616161616161616161616161616161616161',
      curatedAddress: '0x6060606060606060606060606060606060606060',
      note: null,
      metadata: { agentFinding: 'retain' },
    },
    {
      source: 'mixed' as const,
      walletId: '70707070-7070-4070-8070-707070707070',
      firstRequestId: '71717171-7171-4171-8171-717171717171',
      secondRequestId: '72727272-7272-4272-8272-727272727272',
      ownerAddress: '0x7171717171717171717171717171717171717171',
      curatedAddress: '0x7070707070707070707070707070707070707070',
      note: 'mixed wallet note',
      metadata: { manualFact: true, providerFact: true },
    },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const root = mkdtempSync(join(tmpdir(), `bitterless-trench-blank-${scenario.source}-`));
    const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
    const repo = new TrenchIoRepository(db, () => 9_000 + index);
    const metadataJson = JSON.stringify(scenario.metadata);
    const curatedCandidate = (xHandle: string | null): TrenchIndexCandidate => {
      const row = userCandidate(
        scenario.curatedAddress,
        2,
        10,
        'Provider must not fill curated blank name',
        xHandle,
      );
      return {
        ...row,
        wallet: {
          ...row.wallet,
          avatarUrl: 'https://example.com/provider-must-not-fill.png',
        },
      };
    };
    try {
      repo.initialize();
      db.raw.prepare(`
        INSERT INTO trench_wallets (
          wallet_id,address_namespace,canonical_address,address,name,avatar_url,note,metadata_json,
          metadata_source,first_seen_at,last_seen_at,metadata_updated_at
        ) VALUES (?,'evm',?,?,NULL,NULL,?,?,?,1,1,1)
      `).run(
        scenario.walletId,
        scenario.curatedAddress,
        scenario.curatedAddress,
        scenario.note,
        metadataJson,
        scenario.source,
      );

      const first = beginAdd(repo, scenario.firstRequestId, `${index + 1}`.repeat(64));
      repo.completeRun({
        runId: first.runId,
        observedAt: 9_100 + index,
        targets: [{
          targetId: first.targets[0]!.targetId,
          chain: 'bsc',
          contractAddress: ca,
          metadata: metadata(),
          candidates: [
            userCandidate(scenario.ownerAddress, 1, 20, 'Identity owner', 'blank_fence_x'),
            curatedCandidate(null),
          ],
        }],
        wallets: [
          { chain: 'bsc', canonicalAddress: scenario.ownerAddress,
            xIdentity: { canonicalValue: 'blank_fence_x', displayValue: 'blank_fence_x' }, chainRank: 1,
            totalProfitUsd: 20, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
            realizedProfitUsd: 20, unrealizedProfitUsd: null },
          { chain: 'bsc', canonicalAddress: scenario.curatedAddress, xIdentity: null, chainRank: 2,
            totalProfitUsd: 10, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
            realizedProfitUsd: 10, unrealizedProfitUsd: null },
        ],
      });

      const curatedPerson = db.raw.prepare(`
        SELECT persons.person_id,persons.display_name,persons.avatar_url,
          persons.display_name_source,persons.avatar_source,persons.note,persons.note_source,
          persons.metadata_json
        FROM trench_persons persons
        JOIN trench_person_wallets memberships ON memberships.person_id=persons.person_id
        WHERE memberships.wallet_id=?
      `).get(scenario.walletId) as {
        person_id: string;
        display_name: string | null;
        avatar_url: string | null;
        display_name_source: string;
        avatar_source: string;
        note: string | null;
        note_source: string;
        metadata_json: string;
      };
      assert.deepEqual(curatedPerson, {
        person_id: curatedPerson.person_id,
        display_name: null,
        avatar_url: null,
        display_name_source: 'system',
        avatar_source: 'system',
        note: null,
        note_source: 'system',
        metadata_json: '{}',
      });

      const second = repo.beginRun({
        requestId: scenario.secondRequestId,
        requestFingerprint: `${index + 4}`.repeat(64),
        trigger: 'reanalyze',
      });
      repo.completeRun({
        runId: second.runId,
        observedAt: 9_200 + index,
        targets: [{
          targetId: second.targets[0]!.targetId,
          chain: 'bsc',
          contractAddress: ca,
          metadata: metadata(),
          candidates: [
            userCandidate(scenario.ownerAddress, 1, 20, 'Identity owner updated', 'blank_fence_x'),
            curatedCandidate('@Blank_Fence_X'),
          ],
        }],
        wallets: [
          { chain: 'bsc', canonicalAddress: scenario.ownerAddress,
            xIdentity: { canonicalValue: 'blank_fence_x', displayValue: 'blank_fence_x' }, chainRank: 1,
            totalProfitUsd: 20, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
            realizedProfitUsd: 20, unrealizedProfitUsd: null },
          { chain: 'bsc', canonicalAddress: scenario.curatedAddress,
            xIdentity: { canonicalValue: 'blank_fence_x', displayValue: '@Blank_Fence_X' }, chainRank: 2,
            totalProfitUsd: 10, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
            realizedProfitUsd: 10, unrealizedProfitUsd: null },
        ],
      });

      assert.equal(db.raw.prepare("SELECT COUNT(*) FROM trench_persons WHERE status='active'")
        .pluck().get(), 2);
      assert.equal(db.raw.prepare("SELECT COUNT(*) FROM trench_persons WHERE status='merged'")
        .pluck().get(), 0);
      const ownerPersonId = db.raw.prepare(`
        SELECT memberships.person_id FROM trench_person_wallets memberships
        JOIN trench_wallets wallets ON wallets.wallet_id=memberships.wallet_id
        WHERE wallets.canonical_address=?
      `).pluck().get(scenario.ownerAddress);
      assert.deepEqual(db.raw.prepare(`
        SELECT identity_owner_person_id,contender_person_id,wallet_id
        FROM trench_person_identity_conflicts WHERE status='open'
      `).get(), {
        identity_owner_person_id: ownerPersonId,
        contender_person_id: curatedPerson.person_id,
        wallet_id: scenario.walletId,
      });
      assert.deepEqual(db.raw.prepare(`
        SELECT name,avatar_url,note,metadata_json,metadata_source
        FROM trench_wallets WHERE wallet_id=?
      `).get(scenario.walletId), {
        name: null,
        avatar_url: null,
        note: scenario.note,
        metadata_json: metadataJson,
        metadata_source: scenario.source,
      });
      assert.deepEqual(db.raw.prepare(`
        SELECT display_name,avatar_url,note,metadata_json FROM trench_persons WHERE person_id=?
      `).get(curatedPerson.person_id), {
        display_name: null,
        avatar_url: null,
        note: null,
        metadata_json: '{}',
      });
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('first publication with curated chain-account evidence conflicts instead of attaching by X', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-direct-curated-x-'));
  const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
  const repo = new TrenchIoRepository(db, () => 9_500);
  const ownerAddress = '0x8181818181818181818181818181818181818181';
  const curatedAddress = '0x8080808080808080808080808080808080808080';
  const curatedWalletId = '80808080-8080-4080-8080-808080808080';
  const curatedAccountId = '83838383-8383-4383-8383-838383838383';
  try {
    repo.initialize();
    const first = beginAdd(repo, '81818181-8181-4181-8181-818181818181', '8'.repeat(64));
    repo.completeRun({
      runId: first.runId,
      observedAt: 9_510,
      targets: [{
        targetId: first.targets[0]!.targetId,
        chain: 'bsc',
        contractAddress: ca,
        metadata: metadata(),
        candidates: [userCandidate(ownerAddress, 1, 20, 'Identity owner', 'direct_fence_x')],
      }],
      wallets: [{
        chain: 'bsc', canonicalAddress: ownerAddress,
        xIdentity: { canonicalValue: 'direct_fence_x', displayValue: 'direct_fence_x' }, chainRank: 1,
        totalProfitUsd: 20, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
        realizedProfitUsd: 20, unrealizedProfitUsd: null,
      }],
    });
    db.raw.prepare(`
      INSERT INTO trench_wallets (
        wallet_id,address_namespace,canonical_address,address,name,avatar_url,note,metadata_json,
        metadata_source,first_seen_at,last_seen_at,metadata_updated_at
      ) VALUES (?,'evm',?,?,NULL,NULL,NULL,'{}','gmgn',1,1,1)
    `).run(curatedWalletId, curatedAddress, curatedAddress);
    db.raw.prepare(`
      INSERT INTO trench_wallet_chain_accounts (
        wallet_account_id,wallet_id,chain,wallet_kind,classification_source,
        classification_updated_at,first_seen_at,last_seen_at
      ) VALUES (?,?,'bsc','user','manual',1,1,1)
    `).run(curatedAccountId, curatedWalletId);

    const second = repo.beginRun({
      requestId: '82828282-8282-4282-8282-828282828282',
      requestFingerprint: '9'.repeat(64),
      trigger: 'reanalyze',
    });
    repo.completeRun({
      runId: second.runId,
      observedAt: 9_520,
      targets: [{
        targetId: second.targets[0]!.targetId,
        chain: 'bsc',
        contractAddress: ca,
        metadata: metadata(),
        candidates: [
          userCandidate(ownerAddress, 1, 20, 'Identity owner', 'direct_fence_x'),
          userCandidate(curatedAddress, 2, 10, 'Provider replacement', '@Direct_Fence_X'),
        ],
      }],
      wallets: [
        { chain: 'bsc', canonicalAddress: ownerAddress,
          xIdentity: { canonicalValue: 'direct_fence_x', displayValue: 'direct_fence_x' }, chainRank: 1,
          totalProfitUsd: 20, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
          realizedProfitUsd: 20, unrealizedProfitUsd: null },
        { chain: 'bsc', canonicalAddress: curatedAddress,
          xIdentity: { canonicalValue: 'direct_fence_x', displayValue: '@Direct_Fence_X' }, chainRank: 2,
          totalProfitUsd: 10, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
          realizedProfitUsd: 10, unrealizedProfitUsd: null },
      ],
    });

    const ownerPersonId = db.raw.prepare(`
      SELECT memberships.person_id FROM trench_person_wallets memberships
      JOIN trench_wallets wallets ON wallets.wallet_id=memberships.wallet_id
      WHERE wallets.canonical_address=?
    `).pluck().get(ownerAddress);
    const curatedPersonId = db.raw.prepare(
      'SELECT person_id FROM trench_person_wallets WHERE wallet_id=?',
    ).pluck().get(curatedWalletId);
    assert.notEqual(curatedPersonId, ownerPersonId);
    assert.equal(db.raw.prepare("SELECT COUNT(*) FROM trench_persons WHERE status='merged'")
      .pluck().get(), 0);
    assert.deepEqual(db.raw.prepare(`
      SELECT identity_owner_person_id,contender_person_id,wallet_id
      FROM trench_person_identity_conflicts WHERE status='open'
    `).get(), {
      identity_owner_person_id: ownerPersonId,
      contender_person_id: curatedPersonId,
      wallet_id: curatedWalletId,
    });
    assert.deepEqual(db.raw.prepare(`
      SELECT persons.display_name,persons.avatar_url,
        accounts.classification_source,accounts.wallet_kind
      FROM trench_persons persons
      JOIN trench_person_wallets memberships ON memberships.person_id=persons.person_id
      JOIN trench_wallet_chain_accounts accounts ON accounts.wallet_id=memberships.wallet_id
      WHERE memberships.wallet_id=? AND accounts.chain='bsc'
    `).get(curatedWalletId), {
      display_name: null,
      avatar_url: null,
      classification_source: 'manual',
      wallet_kind: 'user',
    });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

const importDigest = (value: unknown): string => createHash('sha256')
  .update(JSON.stringify(value), 'utf8')
  .digest('hex');

test('person import stages in order, finalizes atomically, never merges names, and replays a value-free receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-person-import-'));
  const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
  let clock = 10_000;
  const repo = new TrenchIoRepository(db, () => ++clock);
  const firstRow = {
    address: '0x9191919191919191919191919191919191919191',
    name: 'Same name',
    displayEmoji: '🧭',
  };
  const secondRow = {
    address: '0x9292929292929292929292929292929292929292',
    name: 'Same name',
    displayEmoji: null,
  };
  const allRows = [firstRow, secondRow, firstRow];
  const base = {
    schema: 'bl-trench-person-import-v1' as const,
    importId: '91919191-9191-4191-8191-919191919191',
    requestId: '92929292-9292-4292-8292-929292929292',
    sourceSha256: 'a'.repeat(64),
    contentSha256: importDigest(allRows),
    normalizationVersion: 'trench-person-import-v1' as const,
    chain: 'bsc' as const,
    walletKind: 'user' as const,
    chunkCount: 2,
    rowCount: allRows.length,
  };
  try {
    repo.initialize();
    assert.throws(
      () => repo.importPersonWallets({
        ...base,
        chunkIndex: 1,
        chunkHash: importDigest([firstRow]),
        rows: [firstRow],
        finalize: true,
      }),
      (error) => error instanceof TrenchIndexRepositoryError && error.code === 'REQUEST_CONFLICT',
    );
    const staged = repo.importPersonWallets({
      ...base,
      chunkIndex: 0,
      chunkHash: importDigest([firstRow, secondRow]),
      rows: [firstRow, secondRow],
      finalize: false,
    });
    assert.equal(staged.completed, false);
    assert.equal(staged.stagedChunkCount, 1);
    assert.equal(repo.listPersons({ limit: 10 }).items.length, 0);
    assert.throws(
      () => repo.importPersonWallets({
        ...base,
        chunkIndex: 0,
        chunkHash: importDigest([secondRow]),
        rows: [secondRow],
        finalize: false,
      }),
      (error) => error instanceof TrenchIndexRepositoryError && error.code === 'REQUEST_CONFLICT',
    );

    const completed = repo.importPersonWallets({
      ...base,
      chunkIndex: 1,
      chunkHash: importDigest([firstRow]),
      rows: [firstRow],
      finalize: true,
    });
    assert.deepEqual({
      completed: completed.completed,
      replayed: completed.replayed,
      createdPersons: completed.createdPersons,
      createdWallets: completed.createdWallets,
      createdChainAccounts: completed.createdChainAccounts,
      collapsedDuplicates: completed.collapsedDuplicates,
    }, {
      completed: true,
      replayed: false,
      createdPersons: 2,
      createdWallets: 2,
      createdChainAccounts: 2,
      collapsedDuplicates: 1,
    });
    const people = repo.listPersons({ limit: 10 });
    assert.equal(people.items.length, 2);
    assert.equal(people.items.every(({ displayName }) => displayName === 'Same name'), true);
    assert.equal(new Set(people.items.map(({ personId }) => personId)).size, 2);
    const imported = db.raw.prepare(`
      SELECT persons.display_name_source,persons.metadata_json,wallets.metadata_source,
        accounts.wallet_kind,accounts.classification_source,memberships.link_source
      FROM trench_persons persons
      JOIN trench_person_wallets memberships ON memberships.person_id=persons.person_id
      JOIN trench_wallets wallets ON wallets.wallet_id=memberships.wallet_id
      JOIN trench_wallet_chain_accounts accounts ON accounts.wallet_id=wallets.wallet_id
      ORDER BY wallets.canonical_address
    `).all();
    assert.deepEqual(imported, [
      {
        display_name_source: 'import',
        metadata_json: '{"displayEmoji":"🧭"}',
        metadata_source: 'import',
        wallet_kind: 'user',
        classification_source: 'import',
        link_source: 'import',
      },
      {
        display_name_source: 'import',
        metadata_json: '{}',
        metadata_source: 'import',
        wallet_kind: 'user',
        classification_source: 'import',
        link_source: 'import',
      },
    ]);
    const replay = repo.importPersonWallets({
      ...base,
      chunkIndex: 1,
      chunkHash: importDigest([firstRow]),
      rows: [firstRow],
      finalize: true,
    });
    assert.deepEqual({ ...replay, replayed: false }, completed);
    assert.equal(replay.replayed, true);
    assert.equal(repo.listPersons({ limit: 10 }).revision, completed.revision);
    assert.throws(
      () => repo.importPersonWallets({
        ...base,
        contentSha256: 'b'.repeat(64),
        chunkIndex: 1,
        chunkHash: importDigest([firstRow]),
        rows: [firstRow],
        finalize: true,
      }),
      (error) => error instanceof TrenchIndexRepositoryError && error.code === 'REQUEST_CONFLICT',
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('person import rolls back every live effect when final content has conflicting duplicates', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-person-import-rollback-'));
  const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
  const repo = new TrenchIoRepository(db, () => 15_000);
  const address = '0x9999999999999999999999999999999999999999';
  const rows = [
    { address, name: 'First', displayEmoji: null },
    { address, name: 'Conflicting', displayEmoji: null },
  ];
  const base = {
    schema: 'bl-trench-person-import-v1' as const,
    importId: '99999999-9999-4999-8999-999999999999',
    requestId: '98989898-9898-4898-8898-989898989898',
    sourceSha256: 'd'.repeat(64),
    contentSha256: importDigest(rows),
    normalizationVersion: 'trench-person-import-v1' as const,
    chain: 'bsc' as const,
    walletKind: 'user' as const,
    chunkCount: 2,
    rowCount: 2,
  };
  try {
    repo.initialize();
    const revision = repo.getWorkspace().revision;
    repo.importPersonWallets({
      ...base,
      chunkIndex: 0,
      chunkHash: importDigest([rows[0]]),
      rows: [rows[0]!],
      finalize: false,
    });
    assert.throws(
      () => repo.importPersonWallets({
        ...base,
        chunkIndex: 1,
        chunkHash: importDigest([rows[1]]),
        rows: [rows[1]!],
        finalize: true,
      }),
      (error) => error instanceof TrenchIndexRepositoryError && error.code === 'REQUEST_CONFLICT',
    );
    assert.equal(db.raw.prepare('SELECT COUNT(*) FROM trench_wallets').pluck().get(), 0);
    assert.equal(db.raw.prepare('SELECT COUNT(*) FROM trench_persons').pluck().get(), 0);
    assert.equal(db.raw.prepare('SELECT COUNT(*) FROM trench_person_import_chunks').pluck().get(), 1);
    assert.equal(repo.getWorkspace().revision, revision);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('person import links an existing unowned wallet and adds only its missing explicit chain account', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-person-import-unowned-'));
  const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
  const repo = new TrenchIoRepository(db, () => 17_000);
  const address = '0xa9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9';
  const row = { address, name: 'Imported person only', displayEmoji: null };
  try {
    repo.initialize();
    db.raw.prepare(`
      INSERT INTO trench_wallets (
        wallet_id,address_namespace,canonical_address,address,name,avatar_url,note,metadata_json,
        metadata_source,first_seen_at,last_seen_at,metadata_updated_at
      ) VALUES (?,'evm',?,?,? ,NULL,?,'{"curated":true}','manual',1,2,3)
    `).run(
      'a9a9a9a9-a9a9-49a9-89a9-a9a9a9a9a9a9', address, address, 'Existing wallet', 'keep note',
    );
    const before = db.raw.prepare('SELECT * FROM trench_wallets').get();
    const receipt = repo.importPersonWallets({
      schema: 'bl-trench-person-import-v1',
      importId: 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8',
      requestId: 'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7',
      sourceSha256: 'e'.repeat(64),
      contentSha256: importDigest([row]),
      normalizationVersion: 'trench-person-import-v1',
      chain: 'robinhood',
      walletKind: 'user',
      chunkIndex: 0,
      chunkCount: 1,
      chunkHash: importDigest([row]),
      rowCount: 1,
      rows: [row],
      finalize: true,
    });
    assert.deepEqual({
      createdWallets: receipt.createdWallets,
      createdPersons: receipt.createdPersons,
      createdChainAccounts: receipt.createdChainAccounts,
      linkedExistingWallets: receipt.linkedExistingWallets,
    }, {
      createdWallets: 0,
      createdPersons: 1,
      createdChainAccounts: 1,
      linkedExistingWallets: 1,
    });
    assert.deepEqual(db.raw.prepare('SELECT * FROM trench_wallets').get(), before);
    assert.deepEqual(db.raw.prepare(`
      SELECT chain,wallet_kind,classification_source FROM trench_wallet_chain_accounts
    `).get(), {
      chain: 'robinhood',
      wallet_kind: 'user',
      classification_source: 'import',
    });
    assert.equal(db.raw.prepare('SELECT COUNT(*) FROM trench_person_wallets').pluck().get(), 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('person import preserves existing wallet, classification, membership, and profile bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-person-import-preserve-'));
  const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
  const repo = new TrenchIoRepository(db, () => 20_000);
  const address = '0x9393939393939393939393939393939393939393';
  const row = { address, name: 'Must not overwrite', displayEmoji: '⚠️' };
  try {
    repo.initialize();
    db.raw.prepare(`
      INSERT INTO trench_wallets (
        wallet_id,address_namespace,canonical_address,address,name,avatar_url,note,metadata_json,
        metadata_source,first_seen_at,last_seen_at,metadata_updated_at
      ) VALUES (?,'evm',?,?,?,?,?,?,'manual',1,2,3)
    `).run(
      '93939393-9393-4393-8393-939393939393', address, address, 'Curated wallet',
      'https://example.com/curated.png', 'curated note', '{"curated":true}',
    );
    db.raw.prepare(`
      INSERT INTO trench_wallet_chain_accounts VALUES (
        ?,?,'bsc','amm','manual',4,4,4
      )
    `).run(
      '94949494-9494-4494-8494-949494949494',
      '93939393-9393-4393-8393-939393939393',
    );
    db.raw.prepare(`
      INSERT INTO trench_persons VALUES (
        ?,'active',NULL,'Curated person',NULL,'person note','manual','system','manual',
        '{"owner":true}',5,6
      )
    `).run('95959595-9595-4595-8595-959595959595');
    db.raw.prepare(`
      INSERT INTO trench_person_wallets VALUES (
        ?,?,?, 'manual','{"proof":true}',7,8
      )
    `).run(
      '96969696-9696-4696-8696-969696969696',
      '95959595-9595-4595-8595-959595959595',
      '93939393-9393-4393-8393-939393939393',
    );
    const before = {
      wallet: db.raw.prepare('SELECT * FROM trench_wallets').get(),
      account: db.raw.prepare('SELECT * FROM trench_wallet_chain_accounts').get(),
      person: db.raw.prepare('SELECT * FROM trench_persons').get(),
      membership: db.raw.prepare('SELECT * FROM trench_person_wallets').get(),
    };
    const receipt = repo.importPersonWallets({
      schema: 'bl-trench-person-import-v1',
      importId: '97979797-9797-4797-8797-979797979797',
      requestId: '98989898-9898-4898-8898-989898989898',
      sourceSha256: 'c'.repeat(64),
      contentSha256: importDigest([row]),
      normalizationVersion: 'trench-person-import-v1',
      chain: 'robinhood',
      walletKind: 'user',
      chunkIndex: 0,
      chunkCount: 1,
      chunkHash: importDigest([row]),
      rowCount: 1,
      rows: [row],
      finalize: true,
    });
    assert.equal(receipt.skippedExistingMemberships, 1);
    assert.equal(receipt.createdPersons, 0);
    assert.equal(receipt.createdChainAccounts, 1);
    assert.deepEqual(db.raw.prepare('SELECT * FROM trench_wallets').get(), before.wallet);
    assert.deepEqual(db.raw.prepare(
      "SELECT * FROM trench_wallet_chain_accounts WHERE chain='bsc'",
    ).get(), before.account);
    assert.deepEqual(db.raw.prepare(`
      SELECT chain,wallet_kind,classification_source FROM trench_wallet_chain_accounts
      WHERE chain='robinhood'
    `).get(), {
      chain: 'robinhood',
      wallet_kind: 'user',
      classification_source: 'import',
    });
    assert.deepEqual(db.raw.prepare('SELECT * FROM trench_persons').get(), before.person);
    assert.deepEqual(db.raw.prepare('SELECT * FROM trench_person_wallets').get(), before.membership);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('publication auto-ensures people, joins equal X identities, and projects current wallet-sum profit', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-person-'));
  const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
  let clock = 2_000;
  const repo = new TrenchIoRepository(db, () => ++clock);
  const firstWallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const secondWallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const thirdWallet = '0xcccccccccccccccccccccccccccccccccccccccc';
  try {
    repo.initialize();
    const run = beginAdd(repo, 'abababab-abab-4bab-8bab-abababababab', '6'.repeat(64));
    repo.completeRun({
      runId: run.runId,
      observedAt: 2_100,
      targets: [{
        targetId: run.targets[0]!.targetId,
        chain: 'bsc',
        contractAddress: ca,
        metadata: metadata(),
        candidates: [
          userCandidate(firstWallet, 1, 70, 'Alice one', '@Shared_X'),
          userCandidate(secondWallet, 2, 30, 'Alice two', 'shared_x'),
          userCandidate(thirdWallet, 3, 10, 'Bob', null),
        ],
      }],
      wallets: [
        { chain: 'bsc', canonicalAddress: firstWallet, xIdentity: { canonicalValue: 'shared_x', displayValue: '@Shared_X' }, chainRank: 1, totalProfitUsd: 70,
          sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
          realizedProfitUsd: 70, unrealizedProfitUsd: null },
        { chain: 'bsc', canonicalAddress: secondWallet, xIdentity: { canonicalValue: 'shared_x', displayValue: 'shared_x' }, chainRank: 2, totalProfitUsd: 30,
          sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
          realizedProfitUsd: 30, unrealizedProfitUsd: null },
        { chain: 'bsc', canonicalAddress: thirdWallet, xIdentity: null, chainRank: 3, totalProfitUsd: 10,
          sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 3,
          realizedProfitUsd: 10, unrealizedProfitUsd: null },
      ],
    });
    const page = repo.listPersons({ limit: 10 });
    assert.equal(page.items.length, 2);
    const shared = page.items.find(({ walletCount }) => walletCount === 2)!;
    assert.equal(shared.displayName, 'Alice one');
    assert.equal(shared.displayNameSource, 'gmgn');
    assert.equal(shared.profit.model, 'wallet-sum-v1');
    assert.equal(shared.profit.totalProfitUsd, 100);
    assert.equal(shared.profit.rankedWalletCount, 2);
    assert.deepEqual(shared.chains, ['bsc']);
    const detail = repo.getPerson(shared.personId);
    assert.equal(detail.wallets.length, 2);
    assert.equal(detail.externalIdentities[0]?.canonicalValue, 'shared_x');
    assert.equal(detail.externalIdentities[0]?.displayValue, '@Shared_X');
    assert.equal(detail.externalIdentities[0]?.source, 'gmgn');
    assert.deepEqual(detail.externalIdentities[0]?.evidence, {
      schema: 'bl-trench-x-gmgn-evidence-v1',
      walletId: detail.wallets.find(({ canonicalAddress }) => canonicalAddress === firstWallet)?.walletId,
      targetId: run.targets[0]!.targetId,
      sourceRank: 1,
      observedAt: 2_100,
    });
    assert.equal(detail.wallets.every(({ metadata }) =>
      !Object.keys(metadata).some((key) => /^(twitter|x)/i.test(key))), true);
    assert.equal(detail.wallets.every(({ accounts }) => accounts.length === 1), true);

    const firstPage = repo.listPersons({ limit: 1 });
    assert.ok(firstPage.nextCursor);
    const edited = repo.updatePersonProfile({
      personId: shared.personId,
      expectedRevision: firstPage.revision,
      displayName: 'Curated Alice',
      note: 'manual note',
    });
    assert.equal(repo.getPerson(shared.personId).displayName, 'Curated Alice');
    assert.throws(
      () => repo.listPersons({ limit: 1, cursor: firstPage.nextCursor! }),
      (error) => error instanceof TrenchIndexRepositoryError && error.code === 'CURSOR_STALE',
    );
    assert.throws(
      () => repo.updatePersonProfile({
        personId: shared.personId,
        expectedRevision: firstPage.revision,
        note: 'stale overwrite',
      }),
      (error) => error instanceof TrenchIndexRepositoryError && error.code === 'REVISION_CONFLICT',
    );
    const thirdMembership = db.raw.prepare(`
      SELECT pw.person_id,w.wallet_id FROM trench_person_wallets pw
      JOIN trench_wallets w ON w.wallet_id=pw.wallet_id WHERE w.canonical_address=?
    `).get(thirdWallet) as { person_id: string; wallet_id: string };
    const moved = repo.attachWalletToPerson({
      personId: shared.personId,
      walletId: thirdMembership.wallet_id,
      expectedRevision: edited.revision,
      expectedCurrentPersonId: thirdMembership.person_id,
    });
    assert.equal(repo.getPerson(shared.personId).wallets.length, 3);
    assert.throws(
      () => repo.attachWalletToPerson({
        personId: shared.personId,
        walletId: thirdMembership.wallet_id,
        expectedRevision: moved.revision,
        expectedCurrentPersonId: thirdMembership.person_id,
      }),
      (error) => error instanceof TrenchIndexRepositoryError && error.code === 'MEMBERSHIP_CONFLICT',
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('later X evidence merges uncurated people but records a conflict for curated profiles', () => {
  const runScenario = (curateSecond: boolean): { active: number; merged: number; conflicts: number } => {
    const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-person-x-'));
    const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
    let clock = 3_000;
    const repo = new TrenchIoRepository(db, () => ++clock);
    const firstWallet = '0xdddddddddddddddddddddddddddddddddddddddd';
    const secondWallet = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    try {
      repo.initialize();
      const first = beginAdd(repo, 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd', '7'.repeat(64));
      repo.completeRun({
        runId: first.runId,
        observedAt: 3_100,
        targets: [{
          targetId: first.targets[0]!.targetId,
          chain: 'bsc',
          contractAddress: ca,
          metadata: metadata(),
          candidates: [
            userCandidate(firstWallet, 1, 20, 'Owner', 'same_x'),
            userCandidate(secondWallet, 2, 10, 'Contender', null),
          ],
        }],
        wallets: [
          { chain: 'bsc', canonicalAddress: firstWallet, xIdentity: { canonicalValue: 'same_x', displayValue: 'same_x' }, chainRank: 1, totalProfitUsd: 20,
            sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
            realizedProfitUsd: 20, unrealizedProfitUsd: null },
          { chain: 'bsc', canonicalAddress: secondWallet, xIdentity: null, chainRank: 2, totalProfitUsd: 10,
            sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
            realizedProfitUsd: 10, unrealizedProfitUsd: null },
        ],
      });
      if (curateSecond) {
        const contender = db.raw.prepare(`
          SELECT pw.person_id FROM trench_person_wallets pw JOIN trench_wallets w ON w.wallet_id=pw.wallet_id
          WHERE w.canonical_address=?
        `).get(secondWallet) as { person_id: string };
        repo.updatePersonProfile({
          personId: contender.person_id,
          expectedRevision: repo.getWorkspace().revision,
          note: 'human-owned',
        });
      }
      const second = repo.beginRun({
        requestId: curateSecond
          ? 'efefefef-efef-4fef-8fef-efefefefefef'
          : '12121212-1212-4212-8212-121212121212',
        requestFingerprint: '8'.repeat(64),
        trigger: 'reanalyze',
      });
      repo.completeRun({
        runId: second.runId,
        observedAt: 3_200,
        targets: [{
          targetId: second.targets[0]!.targetId,
          chain: 'bsc',
          contractAddress: ca,
          metadata: metadata(),
          candidates: [
            userCandidate(firstWallet, 1, 20, 'Owner updated', 'same_x'),
            userCandidate(secondWallet, 2, 10, 'Contender updated', 'same_x'),
          ],
        }],
        wallets: [
          { chain: 'bsc', canonicalAddress: firstWallet, xIdentity: { canonicalValue: 'same_x', displayValue: 'same_x' }, chainRank: 1, totalProfitUsd: 20,
            sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
            realizedProfitUsd: 20, unrealizedProfitUsd: null },
          { chain: 'bsc', canonicalAddress: secondWallet, xIdentity: { canonicalValue: 'same_x', displayValue: 'same_x' }, chainRank: 2, totalProfitUsd: 10,
            sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
            realizedProfitUsd: 10, unrealizedProfitUsd: null },
        ],
      });
      return {
        active: Number(db.raw.prepare("SELECT COUNT(*) FROM trench_persons WHERE status='active'").pluck().get()),
        merged: Number(db.raw.prepare("SELECT COUNT(*) FROM trench_persons WHERE status='merged'").pluck().get()),
        conflicts: Number(db.raw.prepare(
          "SELECT COUNT(*) FROM trench_person_identity_conflicts WHERE status='open'",
        ).pluck().get()),
      };
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  };
  assert.deepEqual(runScenario(false), { active: 1, merged: 1, conflicts: 0 });
  assert.deepEqual(runScenario(true), { active: 2, merged: 0, conflicts: 1 });
});

test('manual and agent memberships fence a later shared-X collision', () => {
  for (const [index, linkSource] of (['manual', 'agent'] as const).entries()) {
    const root = mkdtempSync(join(tmpdir(), `bitterless-trench-membership-${linkSource}-`));
    const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
    const repo = new TrenchIoRepository(db, () => 8_000 + index);
    const ownerAddress = index === 0
      ? '0x3030303030303030303030303030303030303030'
      : '0x4040404040404040404040404040404040404040';
    const contenderAddress = index === 0
      ? '0x3131313131313131313131313131313131313131'
      : '0x4141414141414141414141414141414141414141';
    try {
      repo.initialize();
      const first = beginAdd(
        repo,
        index === 0
          ? '30303030-3030-4030-8030-303030303030'
          : '40404040-4040-4040-8040-404040404040',
        `${index + 5}`.repeat(64),
      );
      repo.completeRun({
        runId: first.runId,
        observedAt: 8_100 + index,
        targets: [{
          targetId: first.targets[0]!.targetId,
          chain: 'bsc',
          contractAddress: ca,
          metadata: metadata(),
          candidates: [
            userCandidate(ownerAddress, 1, 20, 'Owner', 'membership_x'),
            userCandidate(contenderAddress, 2, 10, 'Contender', null),
          ],
        }],
        wallets: [
          { chain: 'bsc', canonicalAddress: ownerAddress,
            xIdentity: { canonicalValue: 'membership_x', displayValue: 'membership_x' }, chainRank: 1,
            totalProfitUsd: 20, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
            realizedProfitUsd: 20, unrealizedProfitUsd: null },
          { chain: 'bsc', canonicalAddress: contenderAddress, xIdentity: null, chainRank: 2,
            totalProfitUsd: 10, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
            realizedProfitUsd: 10, unrealizedProfitUsd: null },
        ],
      });
      db.raw.prepare(`
        UPDATE trench_person_wallets SET link_source=?
        WHERE wallet_id=(SELECT wallet_id FROM trench_wallets WHERE canonical_address=?)
      `).run(linkSource, contenderAddress);
      const second = repo.beginRun({
        requestId: index === 0
          ? '31313131-3131-4131-8131-313131313131'
          : '41414141-4141-4141-8141-414141414141',
        requestFingerprint: `${index + 7}`.repeat(64),
        trigger: 'reanalyze',
      });
      repo.completeRun({
        runId: second.runId,
        observedAt: 8_200 + index,
        targets: [{
          targetId: second.targets[0]!.targetId,
          chain: 'bsc',
          contractAddress: ca,
          metadata: metadata(),
          candidates: [
            userCandidate(ownerAddress, 1, 20, 'Owner', 'membership_x'),
            userCandidate(contenderAddress, 2, 10, 'Contender', '@Membership_X'),
          ],
        }],
        wallets: [
          { chain: 'bsc', canonicalAddress: ownerAddress,
            xIdentity: { canonicalValue: 'membership_x', displayValue: 'membership_x' }, chainRank: 1,
            totalProfitUsd: 20, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
            realizedProfitUsd: 20, unrealizedProfitUsd: null },
          { chain: 'bsc', canonicalAddress: contenderAddress,
            xIdentity: { canonicalValue: 'membership_x', displayValue: '@Membership_X' }, chainRank: 2,
            totalProfitUsd: 10, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
            realizedProfitUsd: 10, unrealizedProfitUsd: null },
        ],
      });
      assert.equal(db.raw.prepare("SELECT COUNT(*) FROM trench_persons WHERE status='active'")
        .pluck().get(), 2);
      assert.equal(db.raw.prepare("SELECT COUNT(*) FROM trench_persons WHERE status='merged'")
        .pluck().get(), 0);
      assert.equal(db.raw.prepare("SELECT COUNT(*) FROM trench_person_identity_conflicts WHERE status='open'")
        .pluck().get(), 1);
      assert.equal(db.raw.prepare(`
        SELECT link_source FROM trench_person_wallets
        WHERE wallet_id=(SELECT wallet_id FROM trench_wallets WHERE canonical_address=?)
      `).pluck().get(contenderAddress), linkSource);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('person ensure and INDEX publication share one rollback boundary', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-person-rollback-'));
  const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
  const repo = new TrenchIoRepository(db, () => 4_000);
  const firstWallet = '0xffffffffffffffffffffffffffffffffffffffff';
  const secondWallet = '0x9999999999999999999999999999999999999999';
  try {
    repo.initialize();
    const run = beginAdd(repo, '34343434-3434-4434-8434-343434343434', '9'.repeat(64));
    assert.throws(() => repo.completeRun({
      runId: run.runId,
      observedAt: 4_100,
      targets: [{
        targetId: run.targets[0]!.targetId,
        chain: 'bsc',
        contractAddress: ca,
        metadata: metadata(),
        candidates: [
          userCandidate(firstWallet, 1, 20, 'First', 'rollback_x'),
          userCandidate(secondWallet, 2, 10, 'Second', null),
        ],
      }],
      wallets: [
        { chain: 'bsc', canonicalAddress: firstWallet, xIdentity: { canonicalValue: 'rollback_x', displayValue: 'rollback_x' }, chainRank: 1, totalProfitUsd: 20,
          sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
          realizedProfitUsd: 20, unrealizedProfitUsd: null },
        { chain: 'bsc', canonicalAddress: secondWallet, xIdentity: null, chainRank: 3, totalProfitUsd: 10,
          sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 2,
          realizedProfitUsd: 10, unrealizedProfitUsd: null },
      ],
    }), (error) => error instanceof TrenchIndexRepositoryError && error.code === 'SOURCE_INVALID');
    assert.equal(db.raw.prepare('SELECT COUNT(*) FROM trench_persons').pluck().get(), 0);
    assert.equal(db.raw.prepare('SELECT COUNT(*) FROM trench_person_wallets').pluck().get(), 0);
    assert.equal(db.raw.prepare('SELECT COUNT(*) FROM trench_index_wallets').pluck().get(), 0);
    assert.equal(repo.getWorkspace().activeRun?.runId, run.runId);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('completeRun reuses one global EVM wallet and person across BSC and Robinhood accounts', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-cross-chain-person-'));
  const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
  const repo = new TrenchIoRepository(db, () => 5_000);
  const sharedWallet = '0x1234512345123451234512345123451234512345';
  const robinCa = '0x7777777777777777777777777777777777777777';
  try {
    repo.initialize();
    const run = repo.addTargetsAndBeginRun({
      requestId: '56565656-5656-4656-8656-565656565656',
      requestFingerprint: 'b'.repeat(64),
      targets: [
        { chain: 'bsc', contractAddress: ca, canonicalAddress: ca, metadata: metadata() },
        { chain: 'robinhood', contractAddress: robinCa, canonicalAddress: robinCa, metadata: metadata() },
      ],
    });
    repo.completeRun({
      runId: run.runId,
      observedAt: 5_100,
      targets: run.targets.map((target, index) => ({
        targetId: target.targetId,
        chain: target.chain,
        contractAddress: target.contractAddress,
        metadata: metadata(),
        candidates: [{
          ...userCandidate(sharedWallet, 1, index === 0 ? 40 : 60, 'Cross chain', 'cross_x'),
          wallet: {
            ...userCandidate(sharedWallet, 1, 1, 'Cross chain', 'cross_x').wallet,
            chain: target.chain,
          },
        }],
      })),
      wallets: [
        { chain: 'bsc', canonicalAddress: sharedWallet, xIdentity: { canonicalValue: 'cross_x', displayValue: 'cross_x' }, chainRank: 1, totalProfitUsd: 40,
          sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
          realizedProfitUsd: 40, unrealizedProfitUsd: null },
        { chain: 'robinhood', canonicalAddress: sharedWallet, xIdentity: { canonicalValue: 'cross_x', displayValue: 'cross_x' }, chainRank: 1, totalProfitUsd: 60,
          sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
          realizedProfitUsd: 60, unrealizedProfitUsd: null },
      ],
    });
    assert.equal(db.raw.prepare('SELECT COUNT(*) FROM trench_wallets').pluck().get(), 1);
    assert.equal(db.raw.prepare('SELECT COUNT(*) FROM trench_wallet_chain_accounts').pluck().get(), 2);
    assert.equal(db.raw.prepare('SELECT COUNT(*) FROM trench_person_wallets').pluck().get(), 1);
    const rows = workspaceWallets(repo);
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(({ walletId }) => walletId)).size, 1);
    assert.equal(new Set(rows.map(({ walletAccountId }) => walletAccountId)).size, 2);
    const person = repo.listPersons({ limit: 10 }).items[0]!;
    assert.equal(person.walletCount, 1);
    assert.deepEqual(person.chains, ['bsc', 'robinhood']);
    assert.equal(person.profit.totalProfitUsd, 100);
    assert.equal(person.profit.rankedWalletCount, 2);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('GMGN reanalysis cannot overwrite manual person fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-trench-profile-priority-'));
  const db = new TrenchIoDatabase(join(root, 'trench', 'trench.db'), TRENCH_IO_TEST_PASSWORD, VERSION);
  let clock = 6_000;
  const repo = new TrenchIoRepository(db, () => ++clock);
  const address = '0x6543265432654326543265432654326543265432';
  const complete = (
    run: ReturnType<typeof beginAdd>,
    observedAt: number,
    name: string,
  ): void => repo.completeRun({
    runId: run.runId,
    observedAt,
    targets: [{
      targetId: run.targets[0]!.targetId,
      chain: 'bsc',
      contractAddress: ca,
      metadata: metadata(),
      candidates: [userCandidate(address, 1, 10, name, 'priority_x')],
    }],
    wallets: [{ chain: 'bsc', canonicalAddress: address, xIdentity: { canonicalValue: 'priority_x', displayValue: 'priority_x' }, chainRank: 1, totalProfitUsd: 10,
      sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
      realizedProfitUsd: 10, unrealizedProfitUsd: null }],
  });
  try {
    repo.initialize();
    const first = beginAdd(repo, '78787878-7878-4878-8878-787878787878', 'c'.repeat(64));
    complete(first, 6_100, 'GMGN original');
    const person = repo.listPersons({ limit: 10 }).items[0]!;
    const edited = repo.updatePersonProfile({
      personId: person.personId,
      expectedRevision: repo.getWorkspace().revision,
      displayName: 'Manual name',
      note: 'Manual note',
    });
    const second = repo.beginRun({
      requestId: '89898989-8989-4989-8989-898989898989',
      requestFingerprint: 'd'.repeat(64),
      trigger: 'reanalyze',
    });
    complete(second, 6_200, 'GMGN replacement');
    const detail = repo.getPerson(person.personId);
    assert.equal(detail.displayName, 'Manual name');
    assert.equal(detail.note, 'Manual note');
    assert.equal(detail.displayNameSource, 'manual');
    assert.equal(detail.noteSource, 'manual');
    assert.ok(repo.getWorkspace().revision > edited.revision);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
