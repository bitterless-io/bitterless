import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrenchIndexResult } from '../../../src/shared/trench/trenchIndex.type';
import type {
  TrenchPersonAttachWalletInput,
  TrenchPersonDetail,
  TrenchPersonListInput,
  TrenchPersonListPage,
  TrenchPersonMutationReceipt,
  TrenchPersonSummary,
  TrenchPersonUpdateProfileInput,
} from '../../../src/shared/trench/trenchPerson.type';
import { TrenchPersonStore } from '../../../src/renderer/coin/src/views/trenchers/trenchPerson.store';

const PERSON_A = '11111111-1111-4111-8111-111111111111';
const PERSON_B = '22222222-2222-4222-8222-222222222222';
const WALLET_A = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';

const deferred = <T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} => {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};

const summary = (
  personId: string,
  displayName: string | null,
  revision = 1,
): TrenchPersonSummary => ({
  personId,
  status: 'active',
  displayName,
  avatarUrl: null,
  note: null,
  displayNameSource: 'system',
  avatarSource: 'system',
  noteSource: 'system',
  walletCount: 1,
  chains: ['bsc'],
  profit: {
    model: 'wallet-sum-v1',
    totalProfitUsd: 12,
    realizedProfitUsd: null,
    unrealizedProfitUsd: null,
    rankedWalletCount: 1,
  },
  createdAt: revision,
  updatedAt: revision,
});

const detail = (
  personId: string,
  displayName: string | null,
  withWallet = false,
): TrenchPersonDetail => ({
  ...summary(personId, displayName),
  resolvedFromPersonId: null,
  metadata: {},
  wallets: withWallet ? [{
    walletId: WALLET_A,
    addressNamespace: 'evm',
    address: EVM_ADDRESS,
    canonicalAddress: EVM_ADDRESS,
    name: null,
    avatarUrl: null,
    note: null,
    metadata: {},
    membershipSource: 'index-auto',
    accounts: [{
      walletAccountId: ACCOUNT_A,
      chain: 'bsc',
      walletKind: 'user',
      classificationSource: 'gmgn-label',
      classificationUpdatedAt: 1,
      firstSeenAt: 1,
      lastSeenAt: 1,
      currentChainRank: 7,
      currentTotalProfitUsd: 12,
      currentRealizedProfitUsd: null,
      currentUnrealizedProfitUsd: null,
    }],
  }] : [],
  externalIdentities: [],
});

const page = (
  revision: number,
  items: TrenchPersonSummary[],
  nextCursor: string | null = null,
): TrenchPersonListPage => ({
  schema: 'bl-trench-person-list-v1',
  revision,
  items,
  nextCursor,
});

interface ClientOverrides {
  listPersons?: (input?: TrenchPersonListInput) => Promise<TrenchIndexResult<TrenchPersonListPage>>;
  getPerson?: (input: { personId: string }) => Promise<TrenchIndexResult<TrenchPersonDetail>>;
  updatePersonProfile?: (
    input: TrenchPersonUpdateProfileInput,
  ) => Promise<TrenchIndexResult<TrenchPersonMutationReceipt>>;
  attachWalletToPerson?: (
    input: TrenchPersonAttachWalletInput,
  ) => Promise<TrenchIndexResult<TrenchPersonMutationReceipt>>;
}

const client = (overrides: ClientOverrides = {}) => ({
  listPersons: overrides.listPersons ?? (async () => ({
    ok: true as const,
    value: page(1, [summary(PERSON_A, null), summary(PERSON_B, 'Resolved')]),
  })),
  getPerson: overrides.getPerson ?? (async ({ personId }: { personId: string }) => ({
    ok: true as const,
    value: detail(personId, personId === PERSON_A ? null : 'Resolved'),
  })),
  updatePersonProfile: overrides.updatePersonProfile ?? (async () => ({
    ok: true as const,
    value: { personId: PERSON_A, revision: 2 },
  })),
  attachWalletToPerson: overrides.attachWalletToPerson ?? (async () => ({
    ok: true as const,
    value: { personId: PERSON_B, revision: 2 },
  })),
  subscribe: (): void => undefined,
});

test('person cursor initialization keeps Anonymous data and preserves selection on refresh', async () => {
  const store = new TrenchPersonStore(client());
  await store.initialize();
  assert.equal(store.phase, 'ready');
  assert.equal(store.items[0]?.displayName, null);
  assert.equal(store.selectedPersonId, PERSON_A);

  await store.selectPerson(PERSON_B);
  assert.equal(store.detail?.displayName, 'Resolved');
  await store.refresh(true);
  assert.equal(store.selectedPersonId, PERSON_B);
  assert.equal(store.detail?.personId, PERSON_B);
});

test('person selection intent owns narrow-detail presentation without a component payload relay', async () => {
  const store = new TrenchPersonStore(client());
  await store.initialize();
  assert.equal(store.detailPaneRequested, false);
  await store.requestPersonDetail(PERSON_B);
  assert.equal(store.selectedPersonId, PERSON_B);
  assert.equal(store.detailPaneRequested, true);
  store.closePersonDetail();
  assert.equal(store.detailPaneRequested, false);
});

test('failed and emptied requested details always retain a store-owned return-to-list intent', async () => {
  let personAReads = 0;
  let returnEmptyPage = false;
  const store = new TrenchPersonStore(client({
    listPersons: async () => ({
      ok: true,
      value: page(2, returnEmptyPage ? [] : [summary(PERSON_A, 'First'), summary(PERSON_B, 'Gone')]),
    }),
    getPerson: async ({ personId }) => {
      if (personId === PERSON_B || personAReads++ > 0) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'gone' } };
      }
      return { ok: true, value: detail(PERSON_A, 'First') };
    },
  }));
  await store.initialize();

  await store.requestPersonDetail(PERSON_B);
  assert.equal(store.detail, null);
  assert.equal(store.detailError?.code, 'NOT_FOUND');
  assert.equal(store.detailPaneRequested, true);
  store.closePersonDetail();
  assert.equal(store.detailPaneRequested, false);

  await store.requestPersonDetail(PERSON_A);
  returnEmptyPage = true;
  await store.refresh(true);
  assert.equal(store.detail, null);
  assert.equal(store.items.length, 0);
  assert.equal(store.detailPaneRequested, true);
  store.closePersonDetail();
  assert.equal(store.detailPaneRequested, false);
});

test('a newer search wins over an older deferred off-page preservation read', async () => {
  const oldPersonRead = deferred<TrenchIndexResult<TrenchPersonDetail>>();
  const oldPersonReadStarted = deferred<void>();
  let listCalls = 0;
  let personAReads = 0;
  const store = new TrenchPersonStore(client({
    listPersons: async (input) => {
      if (input?.query === 'new') {
        return { ok: true, value: page(3, [summary(PERSON_B, 'New result')]) };
      }
      listCalls += 1;
      return listCalls === 1
        ? { ok: true, value: page(1, [summary(PERSON_A, 'Old selection')]) }
        : { ok: true, value: page(2, []) };
    },
    getPerson: async ({ personId }) => {
      if (personId === PERSON_B) return { ok: true, value: detail(PERSON_B, 'New result') };
      personAReads += 1;
      if (personAReads === 1) return { ok: true, value: detail(PERSON_A, 'Old selection') };
      oldPersonReadStarted.resolve();
      return await oldPersonRead.promise;
    },
  }));
  await store.initialize();

  const oldRefresh = store.refresh(true);
  await oldPersonReadStarted.promise;
  await store.search('new');
  oldPersonRead.resolve({ ok: true, value: detail(PERSON_A, 'Old selection') });
  await oldRefresh;

  assert.equal(store.query, 'new');
  assert.equal(store.items[0]?.personId, PERSON_B);
  assert.equal(store.selectedPersonId, PERSON_B);
  assert.equal(store.detail?.personId, PERSON_B);
});

test('a first-page restart retains a still-active selected person outside the restarted page', async () => {
  let listCount = 0;
  const store = new TrenchPersonStore(client({
    listPersons: async () => ({
      ok: true,
      value: page(2, [summary(listCount++ === 0 ? PERSON_B : PERSON_A, null)]),
    }),
  }));
  await store.initialize();
  assert.equal(store.selectedPersonId, PERSON_B);
  await store.refresh(true);
  assert.equal(store.items[0]?.personId, PERSON_A);
  assert.equal(store.selectedPersonId, PERSON_B);
  assert.equal(store.detail?.personId, PERSON_B);
});

test('a failed identity switch never renders the previously selected person as the new selection', async () => {
  const store = new TrenchPersonStore(client({
    getPerson: async ({ personId }) => personId === PERSON_A
      ? { ok: true, value: detail(PERSON_A, 'First') }
      : { ok: false, error: { code: 'NOT_FOUND', message: 'gone' } },
  }));
  await store.initialize();
  assert.equal(store.detail?.personId, PERSON_A);
  await store.selectPerson(PERSON_B);
  assert.equal(store.selectedPersonId, PERSON_B);
  assert.equal(store.detail, null);
  assert.equal(store.detailError?.code, 'NOT_FOUND');
});

test('stale cursor restarts from the first page instead of retaining an invalid page', async () => {
  const calls: Array<TrenchPersonListInput | undefined> = [];
  const store = new TrenchPersonStore(client({
    listPersons: async (input) => {
      calls.push(input);
      if (input?.cursor === 'next-cursor') {
        return { ok: false, error: { code: 'CURSOR_STALE', message: 'stale' } };
      }
      return { ok: true, value: page(2, [summary(PERSON_A, null)], 'next-cursor') };
    },
  }));
  await store.initialize();
  await store.nextPage();
  assert.equal(store.pageNumber, 1);
  assert.equal(store.phase, 'ready');
  assert.equal(calls.filter((input) => input?.cursor === 'next-cursor').length, 1);
  assert.equal(calls.at(-1)?.cursor, undefined);
});

test('profile revision conflict keeps the mutation error and rereads current person state', async () => {
  let revision = 4;
  const store = new TrenchPersonStore(client({
    listPersons: async () => ({
      ok: true,
      value: page(revision, [summary(PERSON_A, revision === 4 ? null : 'Current value')]),
    }),
    getPerson: async () => ({
      ok: true,
      value: detail(PERSON_A, revision === 4 ? null : 'Current value'),
    }),
    updatePersonProfile: async () => {
      revision = 5;
      return { ok: false, error: { code: 'REVISION_CONFLICT', message: 'stale' } };
    },
  }));
  await store.initialize();
  const updated = await store.updateProfile({ displayName: 'Old edit' });
  assert.equal(updated, false);
  assert.equal(store.mutationError?.code, 'REVISION_CONFLICT');
  assert.equal(store.page?.revision, 5);
  assert.equal(store.detail?.displayName, 'Current value');
});

test('profile controller normalizes its draft and sends only explicitly changed fields', async () => {
  let updateInput: TrenchPersonUpdateProfileInput | null = null;
  const store = new TrenchPersonStore(client({
    updatePersonProfile: async (input) => {
      updateInput = input;
      return { ok: true, value: { personId: PERSON_A, revision: 2 } };
    },
  }));
  await store.initialize();
  assert.equal(store.beginProfileEdit(), true);
  store.profileDraftDisplayName = '   ';
  store.profileDraftNote = '  Only this note changed  ';
  assert.equal(await store.submitProfileEdit(), true);
  assert.deepEqual(updateInput, {
    personId: PERSON_A,
    expectedRevision: 1,
    note: 'Only this note changed',
  });
  assert.equal(store.profileDraftNote, '');
});

test('profile controller pins the editor-open revision and rebases after a conflict', async () => {
  let revision = 4;
  const updateInputs: TrenchPersonUpdateProfileInput[] = [];
  const store = new TrenchPersonStore(client({
    listPersons: async () => ({
      ok: true,
      value: page(revision, [summary(PERSON_A, revision === 4 ? null : 'Current value')]),
    }),
    getPerson: async () => ({
      ok: true,
      value: detail(PERSON_A, revision === 4 ? null : 'Current value'),
    }),
    updatePersonProfile: async (input) => {
      updateInputs.push(input);
      if (updateInputs.length === 1) {
        revision = 5;
        return { ok: false, error: { code: 'REVISION_CONFLICT', message: 'stale editor' } };
      }
      return { ok: true, value: { personId: PERSON_A, revision: 6 } };
    },
  }));
  await store.initialize();
  assert.equal(store.beginProfileEdit(), true);
  store.profileDraftDisplayName = 'Draft';
  assert.equal(await store.submitProfileEdit(), false);
  assert.equal(updateInputs[0]?.expectedRevision, 4);
  assert.equal(store.mutationError?.code, 'REVISION_CONFLICT');
  assert.equal(store.profileDraftDisplayName, 'Current value');

  store.profileDraftNote = 'Rebased note';
  assert.equal(await store.submitProfileEdit(), true);
  assert.equal(updateInputs[1]?.expectedRevision, 5);
  assert.deepEqual(updateInputs[1], {
    personId: PERSON_A,
    expectedRevision: 5,
    note: 'Rebased note',
  });
});

test('pending mutation cancel intents preserve profile drafts and wallet confirmation state', async () => {
  const store = new TrenchPersonStore(client({
    listPersons: async (input) => input?.query
      ? { ok: true, value: page(3, [summary(PERSON_A, 'Source')]) }
      : { ok: true, value: page(3, [summary(PERSON_B, 'Target')]) },
    getPerson: async ({ personId }) => ({
      ok: true,
      value: detail(personId, personId === PERSON_A ? 'Source' : 'Target', personId === PERSON_A),
    }),
  }));
  await store.initialize();

  assert.equal(store.beginProfileEdit(), true);
  store.profileDraftNote = 'Pending draft';
  store.profileSubmitPending = true;
  store.cancelProfileEdit();
  assert.equal(store.profileDraftNote, 'Pending draft');
  store.profileSubmitPending = false;

  store.beginMoveWallet();
  store.setMoveAddress(EVM_ADDRESS);
  assert.equal(await store.advanceMoveWallet(), 'lookup-ready');
  const candidate = store.moveCandidate;
  store.movePending = true;
  store.cancelMoveWallet();
  assert.equal(store.moveAddress, EVM_ADDRESS);
  assert.equal(store.moveCandidate, candidate);
  store.movePending = false;
});

test('wallet move resolves one exact linked user wallet and sends membership CAS only after lookup', async () => {
  let attachInput: TrenchPersonAttachWalletInput | null = null;
  const store = new TrenchPersonStore(client({
    listPersons: async (input) => input?.query
      ? { ok: true, value: page(9, [summary(PERSON_A, 'Source')]) }
      : { ok: true, value: page(9, [summary(PERSON_B, 'Target')]) },
    getPerson: async ({ personId }) => ({
      ok: true,
      value: detail(personId, personId === PERSON_A ? 'Source' : 'Target', personId === PERSON_A),
    }),
    attachWalletToPerson: async (input) => {
      attachInput = input;
      return { ok: true, value: { personId: PERSON_B, revision: 10 } };
    },
  }));
  await store.initialize();
  store.beginMoveWallet();
  store.setMoveAddress(EVM_ADDRESS.toUpperCase().replace('0X', '0x'));
  assert.equal(await store.advanceMoveWallet(), 'lookup-ready');
  assert.equal(attachInput, null);
  assert.equal(store.moveCandidate?.sourcePersonId, PERSON_A);
  assert.equal(store.moveCandidate?.targetPersonId, PERSON_B);
  assert.equal(await store.advanceMoveWallet(), 'moved');
  assert.deepEqual(attachInput, {
    personId: PERSON_B,
    walletId: WALLET_A,
    expectedRevision: 9,
    expectedCurrentPersonId: PERSON_A,
  });
});

test('wallet move rejects unknown and non-user matches without calling attach', async () => {
  let attached = false;
  const source = detail(PERSON_A, 'Source', true);
  source.wallets[0]!.accounts[0]!.walletKind = 'exchange';
  const store = new TrenchPersonStore(client({
    listPersons: async (input) => input?.query
      ? { ok: true, value: page(3, [summary(PERSON_A, 'Source')]) }
      : { ok: true, value: page(3, [summary(PERSON_B, 'Target')]) },
    getPerson: async ({ personId }) => ({
      ok: true,
      value: personId === PERSON_A ? source : detail(PERSON_B, 'Target'),
    }),
    attachWalletToPerson: async () => {
      attached = true;
      return { ok: true, value: { personId: PERSON_B, revision: 4 } };
    },
  }));
  await store.initialize();
  assert.equal(await store.lookupMoveWallet('bsc', EVM_ADDRESS), false);
  assert.equal(store.mutationError?.code, 'NOT_FOUND');
  assert.equal(await store.confirmMoveWallet(), false);
  assert.equal(attached, false);
});

test('wallet membership conflict invalidates the candidate and rereads current membership', async () => {
  let revision = 9;
  const store = new TrenchPersonStore(client({
    listPersons: async (input) => input?.query
      ? { ok: true, value: page(revision, [summary(PERSON_A, 'Source')]) }
      : { ok: true, value: page(revision, [summary(PERSON_B, 'Target')]) },
    getPerson: async ({ personId }) => ({
      ok: true,
      value: detail(personId, personId === PERSON_A ? 'Source' : 'Target', personId === PERSON_A),
    }),
    attachWalletToPerson: async () => {
      revision = 10;
      return { ok: false, error: { code: 'MEMBERSHIP_CONFLICT', message: 'moved elsewhere' } };
    },
  }));
  await store.initialize();
  assert.equal(await store.lookupMoveWallet('bsc', EVM_ADDRESS), true);
  assert.equal(await store.confirmMoveWallet(), false);
  assert.equal(store.mutationError?.code, 'MEMBERSHIP_CONFLICT');
  assert.equal(store.moveCandidate, null);
  assert.equal(store.moveLookupPhase, 'error');
  assert.equal(store.page?.revision, 10);
});

test('empty and unavailable pages remain explicit without fabricated detail', async () => {
  const empty = new TrenchPersonStore(client({
    listPersons: async () => ({ ok: true, value: page(1, []) }),
  }));
  await empty.initialize();
  assert.equal(empty.phase, 'ready');
  assert.equal(empty.selectedPersonId, null);
  assert.equal(empty.detail, null);

  const unavailable = new TrenchPersonStore(client({
    listPersons: async () => ({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'offline' },
    }),
  }));
  await unavailable.initialize();
  assert.equal(unavailable.phase, 'unavailable');
  assert.equal(unavailable.listError?.code, 'STORAGE_UNAVAILABLE');
  assert.equal(unavailable.detail, null);
});
