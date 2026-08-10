import type {
  TrenchAnalysisListResult,
  TrenchCaAnalysisV1,
  TrenchChain,
  TrenchContentHash,
  TrenchCursorPage,
  TrenchDocument,
  TrenchExposureReferenceStatus,
  TrenchIndexWalletDetail,
  TrenchIndexWalletListResult,
  TrenchNegativeWalletDetail,
  TrenchNegativeWalletListResult,
  TrenchStoredIssue,
} from './trench.type';

export type TrenchReadErrorCode =
  | 'CURSOR_INVALID'
  | 'CURSOR_STALE'
  | 'INTERNAL'
  | 'INVALID_INPUT'
  | 'INVALID_STORED_RECORD'
  | 'NOT_FOUND'
  | 'REPOSITORY_UNAVAILABLE';

export interface TrenchReadError {
  code: TrenchReadErrorCode;
  message: string;
}

export type TrenchReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TrenchReadError };

export interface TrenchListParams {
  query?: string;
  cursor?: string;
  limit?: number;
}

export interface TrenchAnalysisGetParams {
  contractAddress: string;
}

export interface TrenchIndexWalletGetParams {
  chain: TrenchChain;
  address: string;
  cursor?: string;
  limit?: number;
}

export interface TrenchNegativeWalletGetParams {
  chain: TrenchChain;
  address: string;
}

export interface TrenchAnalysisDetail extends TrenchDocument<TrenchCaAnalysisV1> {
  references: TrenchExposureReferenceStatus[];
  revision: number;
}

export interface TrenchNegativeWalletReadDetail extends TrenchNegativeWalletDetail {
  holdingsIssue: TrenchStoredIssue | null;
  revision: number;
}

export interface TrenchReadApi {
  listAnalyses(params?: TrenchListParams): Promise<TrenchReadResult<TrenchAnalysisListResult>>;
  getAnalysis(params: TrenchAnalysisGetParams): Promise<TrenchReadResult<TrenchAnalysisDetail>>;
  listIndexWallets(
    params?: TrenchListParams,
  ): Promise<TrenchReadResult<TrenchIndexWalletListResult>>;
  getIndexWallet(
    params: TrenchIndexWalletGetParams,
  ): Promise<TrenchReadResult<TrenchIndexWalletDetail>>;
  listNegativeWallets(
    params?: TrenchListParams,
  ): Promise<TrenchReadResult<TrenchNegativeWalletListResult>>;
  getNegativeWallet(
    params: TrenchNegativeWalletGetParams,
  ): Promise<TrenchReadResult<TrenchNegativeWalletReadDetail>>;
}

export type TrenchListPage = TrenchCursorPage<unknown> & {
  contentHash?: TrenchContentHash;
};

export interface TrenchHostContext {
  host: 'standalone' | 'omni';
  platform: 'darwin' | 'win32' | 'other';
}
