import type { TrenchChain, TrenchJsonObject } from './trench.type';
import type {
  TrenchPersonAttachWalletInput,
  TrenchPersonDetail,
  TrenchPersonImportInput,
  TrenchPersonImportReceipt,
  TrenchPersonListInput,
  TrenchPersonListPage,
  TrenchPersonMutationReceipt,
  TrenchPersonUpdateProfileInput,
} from './trenchPerson.type';

export const TRENCH_INDEX_POLICY_VERSION = 'profit-sum-v2' as const;
export const TRENCH_INDEX_CHANGED_EVENT = 'trench/index-changed' as const;
export const TRENCH_INDEX_MAX_CANDIDATES_PER_TARGET = 100;
export const TRENCH_INDEX_MAX_WALLETS = 300;
export const TRENCH_INDEX_MAX_TARGETS = 1_000;

export type TrenchIndexTrigger = 'add-target' | 'reanalyze';
export type TrenchIndexRunStatus = 'running' | 'completed' | 'failed';
export type TrenchIndexJobState = 'idle' | 'running' | 'unavailable';
export type TrenchIndexTargetState = 'pending' | 'analyzing' | 'ready' | 'error';
export type TrenchHighestMarketCapKind =
  | 'provider-ath'
  | 'estimated-ath'
  | 'observed'
  | 'unavailable';
export type TrenchWalletKind = 'user' | 'amm' | 'exchange' | 'contract' | 'unknown';
export type TrenchWalletClassificationSource =
  | 'chain-known'
  | 'gmgn-addr-type'
  | 'gmgn-label'
  | 'import'
  | 'manual'
  | 'agent'
  | 'mixed'
  | 'unclassified';
export type TrenchIndexExclusionReason =
  | 'amm-or-liquidity-pool'
  | 'exchange-or-custody'
  | 'contract-or-program'
  | 'other-non-user'
  | 'unknown-wallet-kind';

export type TrenchIndexErrorCode =
  | 'ANALYSIS_BUSY'
  | 'CHAIN_AMBIGUOUS'
  | 'CURSOR_INVALID'
  | 'CURSOR_STALE'
  | 'EMPTY_TARGET_SET'
  | 'IDENTITY_CONFLICT'
  | 'INTERNAL'
  | 'INVALID_INPUT'
  | 'MEMBERSHIP_CONFLICT'
  | 'NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'REQUEST_CONFLICT'
  | 'REVISION_CONFLICT'
  | 'SOURCE_INVALID'
  | 'STORAGE_UNAVAILABLE'
  | 'TOKEN_NOT_FOUND';

export interface TrenchIndexError {
  code: TrenchIndexErrorCode;
  message: string;
  chains?: TrenchChain[];
}

export type TrenchIndexResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TrenchIndexError };

export interface TrenchIndexTokenMetadata {
  name: string | null;
  symbol: string | null;
  priceUsd: number | null;
  circulatingSupply: number | null;
  currentMarketCapUsd: number | null;
  highestMarketCapUsd: number | null;
  highestMarketCapKind: TrenchHighestMarketCapKind;
  observedAt: number;
}

export interface TrenchIndexTargetRow extends TrenchIndexTokenMetadata {
  targetId: string;
  chain: TrenchChain;
  contractAddress: string;
  canonicalAddress: string;
  state: TrenchIndexTargetState;
  lastSuccessAt: number | null;
  errorCode: TrenchIndexErrorCode | null;
  errorMessage: string | null;
  errorAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TrenchIndexWalletRow {
  walletId: string;
  walletAccountId: string;
  chain: TrenchChain;
  address: string;
  canonicalAddress: string;
  name: string | null;
  avatarUrl: string | null;
  note: string | null;
  metadata: TrenchJsonObject;
  metadataSource: 'manual' | 'gmgn' | 'import' | 'agent' | 'mixed';
  walletKind: TrenchWalletKind;
  classificationSource: TrenchWalletClassificationSource;
  classificationUpdatedAt: number;
  chainRank: number;
  totalProfitUsd: number;
  sourceCaCount: number;
  profitableCaCount: number;
  bestSourceRank: number;
  realizedProfitUsd: number | null;
  unrealizedProfitUsd: number | null;
}

export interface TrenchIndexChainProjection {
  chain: TrenchChain;
  targets: TrenchIndexTargetRow[];
  wallets: TrenchIndexWalletRow[];
}

export interface TrenchIndexRunSummary {
  runId: string;
  trigger: TrenchIndexTrigger;
  status: TrenchIndexRunStatus;
  startedAt: number;
  completedAt: number | null;
  targetCount: number;
  candidateCount: number;
  eligibleCount: number;
  publishedCount: number;
  errorCode: TrenchIndexErrorCode | null;
  errorMessage: string | null;
}

export interface TrenchIndexWorkspaceSnapshot {
  schema: 'bl-trench-index-workspace-v2';
  revision: number;
  jobState: TrenchIndexJobState;
  activeRun: TrenchIndexRunSummary | null;
  currentRun: TrenchIndexRunSummary | null;
  lastFailedRun: TrenchIndexRunSummary | null;
  chainProjections: TrenchIndexChainProjection[];
}

export interface TrenchIndexTargetInput {
  contractAddress: string;
  chain?: 'auto' | TrenchChain;
}

export interface TrenchIndexAddTargetInput {
  requestId: string;
  targets: TrenchIndexTargetInput[];
}

export interface TrenchIndexReanalyzeInput {
  requestId: string;
}

export interface TrenchIndexCommandReceipt {
  requestId: string;
  runId: string;
  revision: number;
  targetPersistedCount: number;
  analysisStarted: boolean;
  replayed: boolean;
}

export interface TrenchIndexChangedEvent {
  schema: 'bl-trench-index-changed-v1';
  revision: number;
  jobState: TrenchIndexJobState;
}

export interface TrenchIndexApi {
  getIndexWorkspace(): Promise<TrenchIndexResult<TrenchIndexWorkspaceSnapshot>>;
  addIndexTargets(
    input: TrenchIndexAddTargetInput,
  ): Promise<TrenchIndexResult<TrenchIndexCommandReceipt>>;
  reanalyzeIndex(
    input: TrenchIndexReanalyzeInput,
  ): Promise<TrenchIndexResult<TrenchIndexCommandReceipt>>;
}

export interface TrenchIndexWalletDiscovery {
  chain: TrenchChain;
  address: string;
  canonicalAddress: string;
  name: string | null;
  avatarUrl: string | null;
  metadata: TrenchJsonObject;
  walletKind: TrenchWalletKind;
  classificationSource: TrenchWalletClassificationSource;
  classificationUpdatedAt: number;
}

export interface TrenchIndexXIdentityEvidence {
  canonicalValue: string;
  displayValue: string;
}

export interface TrenchIndexCandidate {
  wallet: TrenchIndexWalletDiscovery;
  xIdentity: TrenchIndexXIdentityEvidence | null;
  sourceRank: number;
  profitUsd: number;
  realizedProfitUsd: number | null;
  unrealizedProfitUsd: number | null;
  eligible: boolean;
  exclusionReason: TrenchIndexExclusionReason | null;
  evidence: TrenchJsonObject;
}

export interface TrenchIndexTargetAnalysis {
  targetId: string;
  chain: TrenchChain;
  contractAddress: string;
  metadata: TrenchIndexTokenMetadata;
  candidates: TrenchIndexCandidate[];
}

export interface TrenchIndexRankedWallet {
  chain: TrenchChain;
  canonicalAddress: string;
  xIdentity: TrenchIndexXIdentityEvidence | null;
  chainRank: number;
  totalProfitUsd: number;
  sourceCaCount: number;
  profitableCaCount: number;
  bestSourceRank: number;
  realizedProfitUsd: number | null;
  unrealizedProfitUsd: number | null;
}

export interface TrenchIndexCompletedBatch {
  runId: string;
  observedAt: number;
  targets: TrenchIndexTargetAnalysis[];
  wallets: TrenchIndexRankedWallet[];
}

export interface TrenchIndexStorageTarget {
  targetId: string;
  chain: TrenchChain;
  contractAddress: string;
  canonicalAddress: string;
}

export interface TrenchIndexStorageBeginRunResult {
  runId: string;
  revision: number;
  targets: TrenchIndexStorageTarget[];
  replayed: boolean;
  status: TrenchIndexRunStatus;
}

export interface TrenchIndexStorageTargetUpsert {
  chain: TrenchChain;
  contractAddress: string;
  canonicalAddress: string;
  metadata: TrenchIndexTokenMetadata;
}

export interface TrenchIndexStorageAddTargetsAndBeginRunInput {
  requestId: string;
  requestFingerprint: string;
  targets: TrenchIndexStorageTargetUpsert[];
}

export interface TrenchIndexStorageBeginRunInput {
  requestId: string;
  requestFingerprint: string;
  trigger: TrenchIndexTrigger;
}

export interface TrenchIndexStorageFailRunInput {
  runId: string;
  targetId: string | null;
  error: TrenchIndexError;
  failedAt: number;
}

export interface TrenchIoRuntimeReadyInput {
  capability: string;
  instanceId: string;
}

export interface TrenchIoRuntimeRequest<T> extends TrenchIoRuntimeReadyInput {
  request: T;
}

export interface TrenchIoRuntimeApi {
  ready(
    input: TrenchIoRuntimeReadyInput,
  ): Promise<TrenchIndexResult<{ revision: number }>>;
  getWorkspace(
    input: TrenchIoRuntimeRequest<Record<string, never>>,
  ): Promise<TrenchIndexResult<TrenchIndexWorkspaceSnapshot>>;
  addTargetsAndBeginRun(
    input: TrenchIoRuntimeRequest<TrenchIndexStorageAddTargetsAndBeginRunInput>,
  ): Promise<TrenchIndexResult<TrenchIndexStorageBeginRunResult>>;
  beginRun(
    input: TrenchIoRuntimeRequest<TrenchIndexStorageBeginRunInput>,
  ): Promise<TrenchIndexResult<TrenchIndexStorageBeginRunResult>>;
  completeRun(
    input: TrenchIoRuntimeRequest<TrenchIndexCompletedBatch>,
  ): Promise<TrenchIndexResult<{ revision: number }>>;
  failRun(
    input: TrenchIoRuntimeRequest<TrenchIndexStorageFailRunInput>,
  ): Promise<TrenchIndexResult<{ revision: number }>>;
  listPersons(
    input: TrenchIoRuntimeRequest<TrenchPersonListInput>,
  ): Promise<TrenchIndexResult<TrenchPersonListPage>>;
  getPerson(
    input: TrenchIoRuntimeRequest<{ personId: string }>,
  ): Promise<TrenchIndexResult<TrenchPersonDetail>>;
  updatePersonProfile(
    input: TrenchIoRuntimeRequest<TrenchPersonUpdateProfileInput>,
  ): Promise<TrenchIndexResult<TrenchPersonMutationReceipt>>;
  attachWalletToPerson(
    input: TrenchIoRuntimeRequest<TrenchPersonAttachWalletInput>,
  ): Promise<TrenchIndexResult<TrenchPersonMutationReceipt>>;
  importPersonWallets(
    input: TrenchIoRuntimeRequest<TrenchPersonImportInput>,
  ): Promise<TrenchIndexResult<TrenchPersonImportReceipt>>;
}

export interface TrenchIoSystemRequest {
  capability: string;
  instanceId: string;
}

export interface TrenchIoSystemApi {
  getUserDataPath(input: TrenchIoSystemRequest): Promise<string>;
  encryptKey(input: TrenchIoSystemRequest & { plaintext: string }): Promise<string>;
  decryptKey(input: TrenchIoSystemRequest & { ciphertext: string }): Promise<string>;
}

export const trenchIoRuntimeHandlerName = (capability: string): string =>
  `TrenchIoRuntime_${capability}`;
