export const TRENCH_CHAINS = ['bsc', 'solana', 'robinhood'] as const;

export type TrenchChain = (typeof TRENCH_CHAINS)[number];
export type TrenchJsonObject = Record<string, unknown>;

export const TRENCH_CA_ANALYSIS_SCHEMA = 'bl-trench-ca-analysis-v1' as const;
export const TRENCH_NEGATIVE_WALLET_SCHEMA = 'bl-trench-negative-wallet-v1' as const;
export const TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA =
  'bl-trench-negative-wallet-holdings-v1' as const;

export interface TrenchAnalysisSourceV1 {
  kind: 'agent' | 'legacy-coin-state';
  agent?: string;
  skill?: string;
  providers: string[];
}

export interface TrenchTokenIdentity {
  name?: string;
  symbol?: string;
}

export interface TrenchTopProfitWallet {
  address: string;
  rank: number;
  profitUsd?: number;
  winRate?: number;
  evidence?: TrenchJsonObject;
}

export interface TrenchWalletExposure {
  address: string;
  holding: boolean | null;
  balance?: string;
  sharePercent?: number;
  valueUsd?: number;
  evidence?: TrenchJsonObject;
}

export interface TrenchCaChainAnalysisV1 {
  chain: TrenchChain;
  token?: TrenchTokenIdentity;
  topProfitWallets: TrenchTopProfitWallet[];
  indexWalletExposure?: TrenchWalletExposure[];
  negativeWalletExposure?: TrenchWalletExposure[];
  result: TrenchJsonObject;
}

export interface TrenchCaAnalysisV1 {
  schema: typeof TRENCH_CA_ANALYSIS_SCHEMA;
  analysisId: string;
  contractAddress: string;
  generatedAt: string;
  source: TrenchAnalysisSourceV1;
  chains: TrenchCaChainAnalysisV1[];
}

export interface TrenchNegativeWalletV1 {
  schema: typeof TRENCH_NEGATIVE_WALLET_SCHEMA;
  tagId: string;
  chain: TrenchChain;
  address: string;
  explanation: string;
  source: 'human-via-agent';
  createdAt: string;
  updatedAt: string;
}

export interface TrenchNegativeWalletHoldingsV1 {
  schema: typeof TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA;
  analysisId: string;
  chain: TrenchChain;
  address: string;
  generatedAt: string;
  holdings: TrenchWalletHolding[];
  result: TrenchJsonObject;
}

export interface TrenchWalletHolding {
  contractAddress?: string;
  symbol?: string;
  balance?: string;
  valueUsd?: number;
  portfolioPercent?: number;
  evidence?: TrenchJsonObject;
}

export type TrenchContentHash = `sha256:${string}`;

export interface TrenchDocument<T> {
  record: T;
  document: string;
  contentHash: TrenchContentHash;
}

export interface TrenchCaAnalysisSummary {
  analysisId: string;
  contractAddress: string;
  generatedAt: string;
  source: TrenchAnalysisSourceV1;
  chains: Array<{
    chain: TrenchChain;
    token?: TrenchTokenIdentity;
    topProfitWalletCount: number;
  }>;
  contentHash: TrenchContentHash;
}

export interface TrenchNegativeWalletSummary {
  tagId: string;
  chain: TrenchChain;
  address: string;
  explanation: string;
  source: 'human-via-agent';
  createdAt: string;
  updatedAt: string;
  hasHoldings: boolean;
  holdingsAnalysisId?: string;
  holdingsGeneratedAt?: string;
  contentHash: TrenchContentHash;
}

export interface TrenchIndexWalletSource {
  chain: TrenchChain;
  contractAddress: string;
  analysisId: string;
  analysisContentHash: TrenchContentHash;
  generatedAt: string;
  rank: number;
  profitUsd?: number;
  winRate?: number;
  evidenceAvailable: boolean;
  exposure?: Omit<TrenchWalletExposure, 'evidence'> & { evidenceAvailable: boolean };
}

export interface TrenchIndexWallet {
  chain: TrenchChain;
  address: string;
  sourceCount: number;
  bestRank: number;
  lastSeenAt: string;
}

export interface TrenchStoredIssue {
  code: 'INVALID_STORED_RECORD' | 'STORED_RECORD_LIMIT';
  entity: 'analysis' | 'negative-wallet' | 'negative-wallet-holdings';
  identity: string;
  message: string;
}

export interface TrenchCursorPage<T> {
  items: T[];
  total: number;
  limit: number;
  nextCursor: string | null;
  revision: number;
  issues: TrenchStoredIssue[];
}

export interface TrenchAnalysisListResult extends TrenchCursorPage<TrenchCaAnalysisSummary> {}

export interface TrenchIndexWalletListResult extends TrenchCursorPage<TrenchIndexWallet> {
  contentHash: TrenchContentHash;
}

export interface TrenchIndexWalletDetail extends TrenchCursorPage<TrenchIndexWalletSource> {
  wallet: TrenchIndexWallet;
  contentHash: TrenchContentHash;
}

export interface TrenchNegativeWalletListResult extends TrenchCursorPage<TrenchNegativeWalletSummary> {}

export interface TrenchNegativeWalletDetail {
  tag: TrenchNegativeWalletV1;
  tagDocument: string;
  tagContentHash: TrenchContentHash;
  holdings: TrenchNegativeWalletHoldingsV1 | null;
  holdingsDocument: string | null;
  holdingsContentHash: TrenchContentHash | null;
  contentHash: TrenchContentHash;
}

export interface TrenchExposureReferenceStatus {
  kind: 'index-wallet' | 'negative-wallet';
  chain: TrenchChain;
  address: string;
  status: 'active' | 'no-longer-current';
}

export interface TrenchDataChangedEvent {
  schema: 'bl-trench-data-changed-v1';
  revision: number;
  entity: 'analysis' | 'negative-wallet' | 'negative-wallet-holdings';
  identity: string;
  operation: 'put' | 'archive';
}

export const TRENCH_DATA_CHANGED_EVENT = 'trench/data-changed';
