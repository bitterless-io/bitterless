import type { TrenchChain, TrenchJsonObject } from './trench.type';
import type { TrenchIndexResult, TrenchWalletClassificationSource, TrenchWalletKind } from './trenchIndex.type';

export const TRENCH_PERSON_CHANGED_EVENT = 'trench/person-changed' as const;
export const TRENCH_PERSON_MAX_PAGE_SIZE = 100;
export const TRENCH_PERSON_DEFAULT_PAGE_SIZE = 50;
export const TRENCH_PERSON_PROFIT_MODEL = 'wallet-sum-v1' as const;
export const TRENCH_PERSON_IMPORT_SCHEMA = 'bl-trench-person-import-v1' as const;
export const TRENCH_PERSON_IMPORT_NORMALIZATION_VERSION = 'trench-person-import-v1' as const;
export const TRENCH_PERSON_IMPORT_MAX_ROWS_PER_CHUNK = 250;
export const TRENCH_PERSON_IMPORT_MAX_CHUNKS = 10_000;

export type TrenchPersonStatus = 'active' | 'merged';
export type TrenchPersonProfileSource = 'system' | 'import' | 'gmgn' | 'agent' | 'manual';
export type TrenchPersonWalletLinkSource =
  | 'index-auto'
  | 'gmgn-x'
  | 'import'
  | 'manual'
  | 'agent'
  | 'transfer-evidence';

export interface TrenchPersonProfitProjection {
  model: typeof TRENCH_PERSON_PROFIT_MODEL;
  totalProfitUsd: number;
  realizedProfitUsd: number | null;
  unrealizedProfitUsd: number | null;
  rankedWalletCount: number;
}

export interface TrenchPersonSummary {
  personId: string;
  status: 'active';
  displayName: string | null;
  avatarUrl: string | null;
  note: string | null;
  displayNameSource: TrenchPersonProfileSource;
  avatarSource: TrenchPersonProfileSource;
  noteSource: TrenchPersonProfileSource;
  walletCount: number;
  chains: TrenchChain[];
  profit: TrenchPersonProfitProjection;
  createdAt: number;
  updatedAt: number;
}

export interface TrenchPersonWalletAccountRow {
  walletAccountId: string;
  chain: TrenchChain;
  walletKind: TrenchWalletKind;
  classificationSource: TrenchWalletClassificationSource;
  classificationUpdatedAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
  currentChainRank: number | null;
  currentTotalProfitUsd: number | null;
  currentRealizedProfitUsd: number | null;
  currentUnrealizedProfitUsd: number | null;
}

export interface TrenchPersonWalletRow {
  walletId: string;
  addressNamespace: 'evm' | 'solana';
  address: string;
  canonicalAddress: string;
  name: string | null;
  avatarUrl: string | null;
  note: string | null;
  metadata: TrenchJsonObject;
  membershipSource: TrenchPersonWalletLinkSource;
  accounts: TrenchPersonWalletAccountRow[];
}

export interface TrenchPersonExternalIdentity {
  provider: 'x';
  canonicalValue: string;
  displayValue: string;
  source: TrenchPersonProfileSource;
  evidence: TrenchJsonObject;
  createdAt: number;
  updatedAt: number;
}

export interface TrenchPersonDetail extends TrenchPersonSummary {
  resolvedFromPersonId: string | null;
  metadata: TrenchJsonObject;
  wallets: TrenchPersonWalletRow[];
  externalIdentities: TrenchPersonExternalIdentity[];
}

export interface TrenchPersonListInput {
  query?: string;
  cursor?: string;
  limit?: number;
}

export interface TrenchPersonListPage {
  schema: 'bl-trench-person-list-v1';
  revision: number;
  items: TrenchPersonSummary[];
  nextCursor: string | null;
}

export interface TrenchPersonGetInput {
  personId: string;
}

export interface TrenchPersonUpdateProfileInput {
  personId: string;
  expectedRevision: number;
  displayName?: string | null;
  avatarUrl?: string | null;
  note?: string | null;
}

export interface TrenchPersonAttachWalletInput {
  personId: string;
  walletId: string;
  expectedRevision: number;
  expectedCurrentPersonId: string | null;
}

export interface TrenchPersonMutationReceipt {
  personId: string;
  revision: number;
}

export interface TrenchPersonImportRow {
  address: string;
  name: string | null;
  displayEmoji: string | null;
}

export interface TrenchPersonImportInput {
  schema: typeof TRENCH_PERSON_IMPORT_SCHEMA;
  importId: string;
  requestId: string;
  sourceSha256: string;
  contentSha256: string;
  normalizationVersion: typeof TRENCH_PERSON_IMPORT_NORMALIZATION_VERSION;
  chain: TrenchChain;
  walletKind: 'user';
  chunkIndex: number;
  chunkCount: number;
  chunkHash: string;
  rowCount: number;
  rows: TrenchPersonImportRow[];
  finalize: boolean;
}

export interface TrenchPersonImportReceipt {
  schema: 'bl-trench-person-import-receipt-v1';
  importId: string;
  requestId: string;
  sourceSha256: string;
  contentSha256: string;
  chain: TrenchChain;
  chunkCount: number;
  rowCount: number;
  stagedChunkCount: number;
  completed: boolean;
  replayed: boolean;
  createdPersons: number;
  createdWallets: number;
  createdChainAccounts: number;
  linkedExistingWallets: number;
  skippedExistingMemberships: number;
  collapsedDuplicates: number;
  revision: number;
}

export interface TrenchPersonChangedEvent {
  schema: 'bl-trench-person-changed-v1';
  revision: number;
}

export interface TrenchPersonApi {
  listPersons(input?: TrenchPersonListInput): Promise<TrenchIndexResult<TrenchPersonListPage>>;
  getPerson(input: TrenchPersonGetInput): Promise<TrenchIndexResult<TrenchPersonDetail>>;
  updatePersonProfile(
    input: TrenchPersonUpdateProfileInput,
  ): Promise<TrenchIndexResult<TrenchPersonMutationReceipt>>;
  attachWalletToPerson(
    input: TrenchPersonAttachWalletInput,
  ): Promise<TrenchIndexResult<TrenchPersonMutationReceipt>>;
  importPersonWallets(
    input: TrenchPersonImportInput,
  ): Promise<TrenchIndexResult<TrenchPersonImportReceipt>>;
}
