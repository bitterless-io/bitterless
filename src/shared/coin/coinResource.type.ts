export const COIN_RESOURCE_CHAINS = ['robinhood', 'bsc', 'solana'] as const;
export const COIN_SERVICE_IDS = ['monitor', 'screener', 'meme'] as const;

export type CoinResourceChain = (typeof COIN_RESOURCE_CHAINS)[number];
export type CoinServiceId = (typeof COIN_SERVICE_IDS)[number];
export type CoinCodexLoginMethod = 'browser' | 'device_code';
export type CoinGmgnOfficialLinkTarget = 'repository' | 'cliDocs' | 'apiKey';

export interface CoinCodexStatus {
  provider: 'openai-codex';
  connected: boolean;
  loginInProgress: boolean;
  model: 'gpt-5.5';
  effort: 'high';
  lastVerifiedAt: number;
  errorCode?: 'status-unavailable';
}

export interface CoinCodexActionReceipt {
  ok: boolean;
  status: CoinCodexStatus;
  errorCode?:
    | 'login-failed'
    | 'login-in-progress'
    | 'logout-failed'
    | 'status-unavailable'
    | 'timeout';
}

export interface CoinCodexDeviceCodeNotice {
  userCode: string;
  verificationHost: string;
  expiresAt: number | null;
}

export type CoinGmgnProbeCode =
  | 'cancelled'
  | 'cli-missing'
  | 'invalid-response'
  | 'key-missing'
  | 'output-limit'
  | 'private-key-detected'
  | 'process-failed'
  | 'rate-limited'
  | 'timeout'
  | 'unauthorized'
  | 'verified';

export interface CoinGmgnProbeReceipt {
  ok: boolean;
  code: CoinGmgnProbeCode;
  startedAt: number;
  completedAt: number;
  summary: 'read-only-response' | 'unavailable';
  recordCount: number | null;
}

export interface CoinGmgnStatus {
  installed: boolean;
  version: string | null;
  displayPath: string | null;
  apiKeyConfigured: boolean;
  privateKeyDetected: boolean;
  checkedAt: number;
  lastProbe: CoinGmgnProbeReceipt | null;
  errorCode?: 'detect-failed';
}

export interface CoinGmgnSaveReceipt {
  ok: boolean;
  configured: boolean;
  savedAt: number;
  errorCode?: 'invalid-api-key' | 'write-failed';
}

export type CoinAlchemyState =
  | 'configured'
  | 'corrupt'
  | 'missing'
  | 'secure-storage-unavailable';

export interface CoinAlchemyProbeReceipt {
  ok: boolean;
  code: 'invalid-response' | 'network-error' | 'not-configured' | 'timeout' | 'verified';
  chain: CoinResourceChain;
  method: 'eth_chainId' | 'getHealth';
  startedAt: number;
  completedAt: number;
}

export interface CoinAlchemyStatus {
  chain: CoinResourceChain;
  state: CoinAlchemyState;
  configured: boolean;
  maskedHttpEndpoint: string | null;
  maskedWssEndpoint: string | null;
  lastProbe: CoinAlchemyProbeReceipt | null;
}

export interface CoinAlchemySaveInput {
  chain: CoinResourceChain;
  httpUrl: string;
  wssUrl: string;
}

export interface CoinAlchemySaveReceipt {
  ok: boolean;
  status: CoinAlchemyStatus;
  errorCode?: 'invalid-input' | 'secure-storage-unavailable' | 'storage-error';
}

export type CoinServiceState = 'configured' | 'invalid' | 'missing';

export interface CoinServiceStatus {
  service: CoinServiceId;
  state: CoinServiceState;
  configured: boolean;
  httpHost: string | null;
  wsHost: string | null;
  source: 'override' | 'runtime' | null;
}

export type CoinServiceSaveInput =
  | { service: 'monitor'; httpUrl: string; wsUrl: string }
  | { service: 'screener'; httpUrl: string }
  | { service: 'meme'; httpUrl: string };

export interface CoinServiceSaveReceipt {
  ok: boolean;
  status: CoinServiceStatus;
  errorCode?: 'invalid-input' | 'storage-error';
}

export interface CoinResourcesStatus {
  schema: 'coin-resources-v1';
  observedAt: number;
  codex: CoinCodexStatus;
  gmgn: CoinGmgnStatus;
  alchemy: CoinAlchemyStatus[];
  services: CoinServiceStatus[];
}
