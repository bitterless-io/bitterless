import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  TrenchAnalysisListResult,
  TrenchCaAnalysisSummary,
  TrenchDataChangedEvent,
  TrenchIndexWalletDetail,
  TrenchIndexWalletListResult,
  TrenchNegativeWalletListResult,
  TrenchStoredIssue
} from '../../../src/shared/trench/trench.type';
import type {
  TrenchAnalysisDetail,
  TrenchNegativeWalletReadDetail,
  TrenchReadResult
} from '../../../src/shared/trench/trenchXpc.type';
import { TrenchVaultStore } from '../../../src/renderer/coin/src/views/vault/trenchVault.store';
import type { TrenchVaultClient } from '../../../src/renderer/coin/src/views/vault/trenchVault.type';
import {
  TRENCH_STRUCTURED_STRING_PREVIEW_CODE_POINTS,
  TRENCH_STRUCTURED_VALUE_PAGE_SIZE,
  trenchStructuredEntries,
  trenchStructuredStringPreview,
  trenchStructuredValueKind
} from '../../../src/renderer/coin/src/components/TrenchStructuredValue/trenchStructuredValue.service';
import {
  createTodoistSyncCredentialOptions,
  TODOIST_SYNC_TEST_PASSWORD
} from '../../../src/preload/sqlite/todoistSync/todoistSyncRuntimePassword.service';
import {
  assertSafeStorageOperationAllowed,
  resolveSafeStorageIsolationMode
} from '../../../src/main/security/safeStoragePolicy.service';

const ADDRESS_A = `0x${'a'.repeat(40)}`;
const ADDRESS_B = `0x${'b'.repeat(40)}`;
const WALLET = `0x${'1'.repeat(40)}`;

const summary = (
  address: string,
  analysisId = `analysis-${address.slice(-2)}`,
  generatedAt = '2026-08-08T10:00:00.000Z'
): TrenchCaAnalysisSummary => ({
  analysisId,
  contractAddress: address,
  generatedAt,
  source: { kind: 'agent', agent: 'test', skill: 'bitterless-trench', providers: ['fixture'] },
  chains: [{ chain: 'bsc', token: { symbol: 'FIX' }, topProfitWalletCount: 1 }],
  contentHash: `sha256:${'a'.repeat(64)}`
});

const analysisDetail = (
  item: TrenchCaAnalysisSummary,
  revision = 0,
  document = `{"analysisId":"${item.analysisId}"}\n`
): TrenchAnalysisDetail => ({
  record: {
    schema: 'bl-trench-ca-analysis-v1',
    analysisId: item.analysisId,
    contractAddress: item.contractAddress,
    generatedAt: item.generatedAt,
    source: item.source,
    chains: [{ chain: 'bsc', topProfitWallets: [], result: {} }]
  },
  document,
  contentHash: item.contentHash,
  references: [],
  revision
});

const analysisList = (
  items: TrenchCaAnalysisSummary[],
  revision = 0,
  options: { nextCursor?: string | null; issues?: TrenchStoredIssue[] } = {}
): TrenchAnalysisListResult => ({
  items,
  total: items.length,
  limit: 50,
  nextCursor: options.nextCursor ?? null,
  revision,
  issues: options.issues ?? []
});

const emptyIndex = (revision = 0): TrenchIndexWalletListResult => ({
  items: [],
  total: 0,
  limit: 50,
  nextCursor: null,
  revision,
  issues: [],
  contentHash: `sha256:${'0'.repeat(64)}`
});

const emptyNegative = (revision = 0): TrenchNegativeWalletListResult => ({
  items: [],
  total: 0,
  limit: 50,
  nextCursor: null,
  revision,
  issues: []
});

const ok = <T>(value: T): TrenchReadResult<T> => ({ ok: true, value });
const fail = (code: 'CURSOR_STALE' | 'INVALID_STORED_RECORD' | 'REPOSITORY_UNAVAILABLE') => ({
  ok: false as const,
  error: { code, message: code }
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('Timed out waiting for store state');
};

const createClient = (overrides: Partial<TrenchVaultClient> = {}) => {
  let listener: ((event: TrenchDataChangedEvent) => void) | null = null;
  const calls = { listAnalyses: 0, getAnalysis: 0, getIndexWallet: 0 };
  const defaultSummary = summary(ADDRESS_A);
  const client: TrenchVaultClient = {
    subscribe: (next) => {
      listener = next;
    },
    listAnalyses: async () => {
      calls.listAnalyses += 1;
      return ok(analysisList([defaultSummary]));
    },
    getAnalysis: async () => {
      calls.getAnalysis += 1;
      return ok(analysisDetail(defaultSummary));
    },
    listIndexWallets: async () => ok(emptyIndex()),
    getIndexWallet: async () => {
      calls.getIndexWallet += 1;
      return fail('INVALID_STORED_RECORD');
    },
    listNegativeWallets: async () => ok(emptyNegative()),
    getNegativeWallet: async () => fail('INVALID_STORED_RECORD'),
    ...overrides
  };
  return {
    client,
    calls,
    emit: (event: TrenchDataChangedEvent) => listener?.(event)
  };
};

const event = (revision: number): TrenchDataChangedEvent => ({
  schema: 'bl-trench-data-changed-v1',
  revision,
  entity: 'analysis',
  identity: ADDRESS_A,
  operation: 'put'
});

test('chunks structured values and shortens long Unicode strings without losing their source', () => {
  const object = Object.fromEntries(
    Array.from({ length: 45 }, (_, index) => [`field-${index}`, index])
  );
  const entries = trenchStructuredEntries(object, 'result');
  assert.equal(trenchStructuredValueKind(object), 'object');
  assert.equal(trenchStructuredValueKind([true, null]), 'array');
  assert.equal(entries.length, 45);
  assert.equal(entries.slice(0, TRENCH_STRUCTURED_VALUE_PAGE_SIZE).length, 20);
  assert.equal(entries[0].path, 'result.field-0');

  const source = '中'.repeat(TRENCH_STRUCTURED_STRING_PREVIEW_CODE_POINTS + 3);
  const preview = trenchStructuredStringPreview(source);
  assert.equal(preview.shortened, true);
  assert.equal(Array.from(preview.text).length, TRENCH_STRUCTURED_STRING_PREVIEW_CODE_POINTS + 1);
  assert.equal(source.endsWith('中中中'), true);
});

test('subscribes before first list and rejects an initial response overtaken by a broadcast', async () => {
  const first = deferred<TrenchReadResult<TrenchAnalysisListResult>>();
  const oldItem = summary(ADDRESS_A, 'old');
  const newItem = summary(ADDRESS_B, 'new');
  const order: string[] = [];
  let call = 0;
  let broadcast: ((value: TrenchDataChangedEvent) => void) | null = null;
  const fake = createClient({
    subscribe: (listener) => {
      order.push('subscribe');
      broadcast = listener;
    },
    listAnalyses: async () => {
      order.push('list');
      call += 1;
      return call === 1 ? await first.promise : ok(analysisList([newItem], 1));
    },
    getAnalysis: async ({ contractAddress }) =>
      ok(analysisDetail(contractAddress === ADDRESS_B ? newItem : oldItem, 1)),
    listIndexWallets: async () => ok(emptyIndex(1)),
    listNegativeWallets: async () => ok(emptyNegative(1))
  });
  const store = new TrenchVaultStore(fake.client);
  const initializing = store.initialize();
  assert.deepEqual(order, ['subscribe', 'list']);
  broadcast?.(event(1));
  first.resolve(ok(analysisList([oldItem], 0)));
  await initializing;
  await waitFor(
    () => store.lists.ca.items.length === 1 && store.lists.ca.items[0].analysisId === 'new'
  );
  assert.equal(store.observedRevision, 1);
  assert.equal(store.details.ca.phase, 'ready');
});

test('preserves a selected identity on refresh and falls back when it disappears', async () => {
  const a = summary(ADDRESS_A, 'a');
  const b = summary(ADDRESS_B, 'b');
  let items = [a, b];
  const fake = createClient({
    listAnalyses: async () => ok(analysisList(items)),
    getAnalysis: async ({ contractAddress }) =>
      ok(analysisDetail(contractAddress === ADDRESS_A ? a : b))
  });
  const store = new TrenchVaultStore(fake.client);
  await store.initialize();
  await store.selectRecord(b);
  await store.refresh();
  assert.equal(store.selections.ca, `ca:${ADDRESS_B}`);
  items = [a];
  await store.refresh();
  assert.equal(store.selections.ca, `ca:${ADDRESS_A}`);
  assert.equal((store.details.ca.value as TrenchAnalysisDetail).record.analysisId, 'a');
});

test('keeps exact detail evidence visible while a same-identity refresh is pending', async () => {
  const item = summary(ADDRESS_A, 'evidence');
  const nextDetail = deferred<TrenchReadResult<TrenchAnalysisDetail>>();
  const originalDocument = '{\n  "evidence": "original"\n}\n';
  const refreshedDocument = '{\n  "evidence": "refreshed"\n}\n';
  let detailCalls = 0;
  const fake = createClient({
    listAnalyses: async () => ok(analysisList([item])),
    getAnalysis: async () => {
      detailCalls += 1;
      return detailCalls === 1
        ? ok(analysisDetail(item, 0, originalDocument))
        : await nextDetail.promise;
    }
  });
  const store = new TrenchVaultStore(fake.client);
  await store.initialize();

  const refreshing = store.refresh();
  await waitFor(() => store.details.ca.refreshing);
  assert.equal(store.details.ca.phase, 'ready');
  assert.equal((store.details.ca.value as TrenchAnalysisDetail).document, originalDocument);

  nextDetail.resolve(ok(analysisDetail(item, 0, refreshedDocument)));
  await refreshing;
  assert.equal(store.details.ca.refreshing, false);
  assert.equal(store.details.ca.phase, 'ready');
  assert.equal((store.details.ca.value as TrenchAnalysisDetail).document, refreshedDocument);
});

test('refreshes a stale list when an equal-revision broadcast follows a detail read', async () => {
  const oldItem = summary(ADDRESS_A, 'old');
  const newItem = summary(ADDRESS_A, 'new');
  let repositoryRevision = 0;
  let listCalls = 0;
  const fake = createClient({
    listAnalyses: async () => {
      listCalls += 1;
      return ok(analysisList([repositoryRevision === 0 ? oldItem : newItem], repositoryRevision));
    },
    getAnalysis: async () =>
      ok(analysisDetail(repositoryRevision === 0 ? oldItem : newItem, repositoryRevision)),
    listIndexWallets: async () => ok(emptyIndex(repositoryRevision)),
    listNegativeWallets: async () => ok(emptyNegative(repositoryRevision))
  });
  const store = new TrenchVaultStore(fake.client);
  await store.initialize();

  repositoryRevision = 1;
  await store.retryDetail();
  assert.equal(store.observedRevision, 1);
  assert.equal(store.lists.ca.items[0].analysisId, 'old');

  fake.emit(event(1));
  await waitFor(() => store.lists.ca.revision === 1);
  assert.equal(store.lists.ca.items[0].analysisId, 'new');

  const callsAfterRefresh = listCalls;
  fake.emit(event(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(listCalls, callsAfterRefresh);
});

test('restarts the current query when an append cursor is stale', async () => {
  const a = summary(ADDRESS_A, 'a');
  const b = summary(ADDRESS_B, 'b');
  let call = 0;
  const fake = createClient({
    listAnalyses: async (params) => {
      call += 1;
      if (call === 1) return ok(analysisList([a], 0, { nextCursor: 'cursor-1' }));
      if (params?.cursor) return fail('CURSOR_STALE');
      return ok(analysisList([a, b], 0));
    },
    getAnalysis: async ({ contractAddress }) =>
      ok(analysisDetail(contractAddress === ADDRESS_A ? a : b))
  });
  const store = new TrenchVaultStore(fake.client);
  await store.initialize();
  await store.loadMoreRecords();
  await waitFor(() => store.lists.ca.items.length === 2);
  assert.equal(call, 3);
  assert.deepEqual(
    store.lists.ca.items.map((item) => item.analysisId),
    ['a', 'b']
  );
});

test('ignores a re-entrant record append without scheduling a replacing refresh', async () => {
  const a = summary(ADDRESS_A, 'a');
  const b = summary(ADDRESS_B, 'b');
  const append = deferred<TrenchReadResult<TrenchAnalysisListResult>>();
  let calls = 0;
  const fake = createClient({
    listAnalyses: async (params) => {
      calls += 1;
      if (!params?.cursor) return ok(analysisList([a], 0, { nextCursor: 'cursor-1' }));
      return await append.promise;
    },
    getAnalysis: async ({ contractAddress }) =>
      ok(analysisDetail(contractAddress === ADDRESS_A ? a : b))
  });
  const store = new TrenchVaultStore(fake.client);
  await store.initialize();
  const firstAppend = store.loadMoreRecords();
  await store.loadMoreRecords();
  assert.equal(calls, 2);
  assert.equal(store.lists.ca.appending, true);
  append.resolve(
    ok({
      ...analysisList([b]),
      total: 2
    })
  );
  await firstAppend;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  assert.equal(store.lists.ca.appending, false);
  assert.deepEqual(
    store.lists.ca.items.map((item) => item.analysisId),
    ['a', 'b']
  );
});

test('keeps unvisited module totals unknown until their first fetch', async () => {
  const fake = createClient();
  const store = new TrenchVaultStore(fake.client);
  await store.initialize();
  assert.equal(store.lists.ca.total, 1);
  assert.equal(store.lists['index-wallets'].total, null);
  assert.equal(store.lists['negative-wallets'].total, null);
  await store.setModule('index-wallets');
  assert.equal(store.lists['index-wallets'].total, 0);
});

test('splits repository/list and invalid-detail failures without clearing valid list data', async () => {
  const unavailable = createClient({
    listAnalyses: async () => fail('REPOSITORY_UNAVAILABLE')
  });
  const unavailableStore = new TrenchVaultStore(unavailable.client);
  await unavailableStore.initialize();
  assert.equal(unavailableStore.lists.ca.phase, 'unavailable');

  const item = summary(ADDRESS_A);
  const invalid = createClient({
    listAnalyses: async () => ok(analysisList([item])),
    getAnalysis: async () => fail('INVALID_STORED_RECORD')
  });
  const invalidStore = new TrenchVaultStore(invalid.client);
  await invalidStore.initialize();
  assert.equal(invalidStore.lists.ca.items.length, 1);
  assert.equal(invalidStore.details.ca.phase, 'invalid');
});

test('keeps missing Negative holdings as null rather than an empty portfolio', async () => {
  const negativeSummary = {
    tagId: 'negative-1',
    chain: 'bsc' as const,
    address: WALLET,
    explanation: 'Human supplied\ncontext',
    source: 'human-via-agent' as const,
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
    hasHoldings: false,
    contentHash: `sha256:${'2'.repeat(64)}` as const
  };
  const detail: TrenchNegativeWalletReadDetail = {
    tag: {
      schema: 'bl-trench-negative-wallet-v1',
      tagId: negativeSummary.tagId,
      chain: 'bsc',
      address: WALLET,
      explanation: negativeSummary.explanation,
      source: 'human-via-agent',
      createdAt: negativeSummary.createdAt,
      updatedAt: negativeSummary.updatedAt
    },
    tagDocument: '{"tag":true}\n',
    tagContentHash: `sha256:${'3'.repeat(64)}`,
    holdings: null,
    holdingsDocument: null,
    holdingsContentHash: null,
    holdingsIssue: null,
    contentHash: negativeSummary.contentHash,
    revision: 0
  };
  const fake = createClient({
    listNegativeWallets: async () =>
      ok({
        items: [negativeSummary],
        total: 1,
        limit: 50,
        nextCursor: null,
        revision: 0,
        issues: []
      }),
    getNegativeWallet: async () => ok(detail)
  });
  const store = new TrenchVaultStore(fake.client);
  await store.initialize();
  await store.setModule('negative-wallets');
  assert.equal(
    (store.details['negative-wallets'].value as TrenchNegativeWalletReadDetail).holdings,
    null
  );
  assert.equal(
    (store.details['negative-wallets'].value as TrenchNegativeWalletReadDetail).holdingsDocument,
    null
  );
});

test('keeps a valid Negative tag readable when its holdings document is invalid', async () => {
  const issue: TrenchStoredIssue = {
    code: 'INVALID_STORED_RECORD',
    entity: 'negative-wallet-holdings',
    identity: `bsc:${WALLET}`,
    message: 'The stored Negative Wallet holdings document is invalid.'
  };
  const negativeSummary = {
    tagId: 'negative-invalid-holdings',
    chain: 'bsc' as const,
    address: WALLET,
    explanation: 'Valid tag evidence',
    source: 'human-via-agent' as const,
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
    hasHoldings: false,
    contentHash: `sha256:${'5'.repeat(64)}` as const
  };
  const exactTagDocument = '{\n  "tag": "exact evidence"\n}\n';
  const detail: TrenchNegativeWalletReadDetail = {
    tag: {
      schema: 'bl-trench-negative-wallet-v1',
      tagId: negativeSummary.tagId,
      chain: 'bsc',
      address: WALLET,
      explanation: negativeSummary.explanation,
      source: negativeSummary.source,
      createdAt: negativeSummary.createdAt,
      updatedAt: negativeSummary.updatedAt
    },
    tagDocument: exactTagDocument,
    tagContentHash: `sha256:${'6'.repeat(64)}`,
    holdings: null,
    holdingsDocument: null,
    holdingsContentHash: null,
    holdingsIssue: issue,
    contentHash: negativeSummary.contentHash,
    revision: 0
  };
  const fake = createClient({
    listNegativeWallets: async () =>
      ok({
        items: [negativeSummary],
        total: 1,
        limit: 50,
        nextCursor: null,
        revision: 0,
        issues: [issue]
      }),
    getNegativeWallet: async () => ok(detail)
  });
  const store = new TrenchVaultStore(fake.client);
  await store.initialize();
  await store.setModule('negative-wallets');

  const stored = store.details['negative-wallets'];
  assert.equal(stored.phase, 'ready');
  assert.equal((stored.value as TrenchNegativeWalletReadDetail).tagDocument, exactTagDocument);
  assert.equal((stored.value as TrenchNegativeWalletReadDetail).holdings, null);
  assert.deepEqual((stored.value as TrenchNegativeWalletReadDetail).holdingsIssue, issue);
});

test('verifies Index source id/hash, refreshes on a race, and preserves exact document text', async () => {
  const sourceSummary = summary(ADDRESS_A, 'expected');
  const indexDetail: TrenchIndexWalletDetail = {
    wallet: {
      chain: 'bsc',
      address: WALLET,
      sourceCount: 1,
      bestRank: 1,
      lastSeenAt: sourceSummary.generatedAt
    },
    items: [
      {
        chain: 'bsc',
        contractAddress: ADDRESS_A,
        analysisId: 'expected',
        analysisContentHash: sourceSummary.contentHash,
        generatedAt: sourceSummary.generatedAt,
        rank: 1,
        evidenceAvailable: true
      }
    ],
    total: 1,
    limit: 50,
    nextCursor: null,
    revision: 0,
    issues: [],
    contentHash: `sha256:${'4'.repeat(64)}`
  };
  let getIndexCount = 0;
  let raced = true;
  const exactDocument = '{\n  "z": 1,\n  "a": "exact"\n}\n';
  const fake = createClient({
    listIndexWallets: async () =>
      ok({
        items: [indexDetail.wallet],
        total: 1,
        limit: 50,
        nextCursor: null,
        revision: 0,
        issues: [],
        contentHash: indexDetail.contentHash
      }),
    getIndexWallet: async () => {
      getIndexCount += 1;
      return ok(indexDetail);
    },
    getAnalysis: async () =>
      ok(
        analysisDetail(raced ? summary(ADDRESS_A, 'replacement') : sourceSummary, 0, exactDocument)
      )
  });
  const store = new TrenchVaultStore(fake.client);
  await store.initialize();
  await store.setModule('index-wallets');
  await store.openIndexSource(indexDetail.items[0]);
  assert.equal(store.sourceDocument.phase, 'idle');
  assert.ok(getIndexCount >= 2);
  raced = false;
  await store.openIndexSource(indexDetail.items[0]);
  assert.equal(store.sourceDocument.phase, 'ready');
  assert.equal(store.sourceDocument.value?.document, exactDocument);
});

test('discards an in-flight Index source when the user changes detail context', async () => {
  const selectedSummary = summary(ADDRESS_B, 'selected');
  const sourceSummary = summary(ADDRESS_A, 'source');
  const source = {
    chain: 'bsc' as const,
    contractAddress: ADDRESS_A,
    analysisId: sourceSummary.analysisId,
    analysisContentHash: sourceSummary.contentHash,
    generatedAt: sourceSummary.generatedAt,
    rank: 1,
    evidenceAvailable: true
  };
  const issue: TrenchStoredIssue = {
    code: 'INVALID_STORED_RECORD',
    entity: 'analysis',
    identity: 'invalid-context',
    message: 'Stored Analysis is invalid.'
  };
  const runRace = async (
    changeContext: (store: TrenchVaultStore) => Promise<void> | void
  ): Promise<TrenchVaultStore> => {
    const pendingSource = deferred<TrenchReadResult<TrenchAnalysisDetail>>();
    const fake = createClient({
      listAnalyses: async () => ok(analysisList([selectedSummary])),
      getAnalysis: async ({ contractAddress }) =>
        contractAddress === ADDRESS_A
          ? await pendingSource.promise
          : ok(analysisDetail(selectedSummary))
    });
    const store = new TrenchVaultStore(fake.client);
    await store.initialize();
    const opening = store.openIndexSource(source);
    assert.equal(store.sourceDocument.phase, 'loading');
    await changeContext(store);
    pendingSource.resolve(ok(analysisDetail(sourceSummary)));
    await opening;
    assert.deepEqual(store.sourceDocument, {
      phase: 'idle',
      source: null,
      value: null,
      error: null
    });
    return store;
  };

  const searched = await runRace(async (store) => await store.setSearch('selected'));
  assert.equal(searched.details.ca.phase, 'ready');
  const selected = await runRace(async (store) => await store.selectRecord(selectedSummary));
  assert.equal((selected.details.ca.value as TrenchAnalysisDetail).record.analysisId, 'selected');
  const invalid = await runRace((store) => store.selectIssue(issue));
  assert.equal(invalid.details.ca.phase, 'invalid');
  assert.equal(invalid.details.ca.issue?.identity, issue.identity);

  let refreshedItems = [selectedSummary];
  const pendingRefreshSource = deferred<TrenchReadResult<TrenchAnalysisDetail>>();
  const refreshFake = createClient({
    listAnalyses: async () => ok(analysisList(refreshedItems)),
    getAnalysis: async ({ contractAddress }) =>
      contractAddress === ADDRESS_A
        ? await pendingRefreshSource.promise
        : ok(analysisDetail(selectedSummary))
  });
  const refreshed = new TrenchVaultStore(refreshFake.client);
  await refreshed.initialize();
  const opening = refreshed.openIndexSource(source);
  refreshedItems = [sourceSummary];
  const refreshing = refreshed.refresh();
  await waitFor(() => refreshed.sourceDocument.phase === 'idle');
  pendingRefreshSource.resolve(ok(analysisDetail(sourceSummary)));
  await Promise.all([opening, refreshing]);
  assert.equal(refreshed.selections.ca, `ca:${ADDRESS_A}`);
  assert.deepEqual(refreshed.sourceDocument, {
    phase: 'idle',
    source: null,
    value: null,
    error: null
  });
});

test('shows issue-only collections as invalid evidence and never calls get with an issue identity', async () => {
  const issue: TrenchStoredIssue = {
    code: 'INVALID_STORED_RECORD',
    entity: 'analysis',
    identity: 'bad-file-key',
    message: 'Stored Analysis is invalid.'
  };
  let revision = 0;
  let items: TrenchCaAnalysisSummary[] = [];
  const fake = createClient({
    listAnalyses: async () => ok(analysisList(items, revision, { issues: [issue] })),
    listIndexWallets: async () => ok(emptyIndex(revision)),
    listNegativeWallets: async () => ok(emptyNegative(revision))
  });
  const store = new TrenchVaultStore(fake.client);
  await store.initialize();
  assert.equal(store.lists.ca.phase, 'ready');
  assert.equal(store.details.ca.phase, 'invalid');
  assert.equal(store.details.ca.issue?.identity, issue.identity);
  assert.equal(store.details.ca.identity, store.issueIdentity(issue));
  assert.equal(fake.calls.getAnalysis, 0);
  revision = 1;
  items = [summary(ADDRESS_A)];
  fake.emit(event(1));
  await waitFor(() => store.lists.ca.revision === 1);
  assert.equal(store.details.ca.phase, 'invalid');
  assert.equal(store.details.ca.identity, store.issueIdentity(issue));
  assert.equal(store.selections.ca, null);
  assert.equal(fake.calls.getAnalysis, 0);
});

test('isolates E2E and debug Todoist passwords while release retains the OS protection capability', async () => {
  let protectionFactories = 0;
  let protectionCalls = 0;
  const createProtection = () => {
    protectionFactories += 1;
    return {
      encryptString: async (value: string) => {
        protectionCalls += 1;
        return Buffer.from(value);
      },
      decryptString: async (value: Buffer) => {
        protectionCalls += 1;
        return value.toString();
      }
    };
  };

  const e2e = createTodoistSyncCredentialOptions(
    { e2e: true, viteMode: 'release' },
    createProtection
  );
  assert.equal(e2e.runtimePassword, TODOIST_SYNC_TEST_PASSWORD);
  assert.equal(e2e.passwordProtection, undefined);
  assert.equal(e2e.databaseDirectoryName, undefined);

  const debug = createTodoistSyncCredentialOptions(
    { e2e: false, viteMode: 'debug' },
    createProtection
  );
  assert.equal(debug.runtimePassword, TODOIST_SYNC_TEST_PASSWORD);
  assert.equal(debug.passwordProtection, undefined);
  assert.equal(debug.databaseDirectoryName, 'todoist-sync-v1-debug');
  assert.equal(protectionFactories, 0);
  assert.equal(protectionCalls, 0);

  const release = createTodoistSyncCredentialOptions(
    { e2e: false, viteMode: 'release' },
    createProtection
  );
  assert.equal(release.runtimePassword, undefined);
  assert.ok(release.passwordProtection);
  assert.equal(protectionFactories, 1);
  await release.passwordProtection.encryptString('release-value');
  assert.equal(protectionCalls, 1);
});

test('blocks every Main safeStorage operation in E2E and debug while release stays available', () => {
  for (const mode of [
    resolveSafeStorageIsolationMode({ e2e: true, viteMode: 'release' }),
    resolveSafeStorageIsolationMode({ e2e: false, viteMode: 'debug' })
  ]) {
    for (const operation of ['availability', 'encrypt', 'decrypt'] as const) {
      assert.throws(
        () =>
          assertSafeStorageOperationAllowed({
            mode,
            operation,
            caller: 'todoist-sync',
            packaged: false
          }),
        new RegExp(`tripwire blocked ${operation}; mode=${mode}; caller=todoist-sync`)
      );
    }
  }

  assert.doesNotThrow(() =>
    assertSafeStorageOperationAllowed({
      mode: resolveSafeStorageIsolationMode({ e2e: false, viteMode: 'release' }),
      operation: 'encrypt',
      caller: 'sqlite-password',
      packaged: true
    })
  );
});
