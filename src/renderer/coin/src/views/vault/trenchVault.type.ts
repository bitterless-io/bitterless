import type {
  TrenchCaAnalysisSummary,
  TrenchDataChangedEvent,
  TrenchIndexWallet,
  TrenchIndexWalletDetail,
  TrenchIndexWalletSource,
  TrenchNegativeWalletSummary,
  TrenchStoredIssue,
} from '@shared/trench/trench.type';
import type {
  TrenchAnalysisDetail,
  TrenchNegativeWalletReadDetail,
  TrenchReadApi,
  TrenchReadError,
} from '@shared/trench/trenchXpc.type';

export type TrenchModule = 'ca' | 'index-wallets' | 'negative-wallets';
export type TrenchRecordSummary =
  | TrenchCaAnalysisSummary
  | TrenchIndexWallet
  | TrenchNegativeWalletSummary;

export type TrenchListPhase =
  | 'loading'
  | 'ready'
  | 'refreshing'
  | 'empty'
  | 'no-match'
  | 'unavailable'
  | 'error';

export type TrenchDetailPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'missing'
  | 'invalid'
  | 'error';

export interface TrenchListState {
  query: string;
  items: TrenchRecordSummary[];
  issues: TrenchStoredIssue[];
  phase: TrenchListPhase;
  error: TrenchReadError | null;
  nextCursor: string | null;
  total: number | null;
  appending: boolean;
  revision: number;
}

export type TrenchDetailValue =
  | TrenchAnalysisDetail
  | TrenchIndexWalletDetail
  | TrenchNegativeWalletReadDetail;

export interface TrenchDetailState {
  module: TrenchModule;
  identity: string | null;
  phase: TrenchDetailPhase;
  refreshing: boolean;
  value: TrenchDetailValue | null;
  error: TrenchReadError | null;
  issue: TrenchStoredIssue | null;
  indexSourcePhase: 'idle' | 'loading-more' | 'error';
  indexSourceError: TrenchReadError | null;
}

export interface TrenchSourceDocumentState {
  phase: 'idle' | 'loading' | 'ready' | 'missing' | 'invalid' | 'error';
  source: TrenchIndexWalletSource | null;
  value: TrenchAnalysisDetail | null;
  error: TrenchReadError | null;
}

export interface TrenchVaultClient extends TrenchReadApi {
  subscribe(listener: (event: TrenchDataChangedEvent) => void): void;
}
