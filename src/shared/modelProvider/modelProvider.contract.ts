export const MODEL_PROVIDER_SETTING_KEY = 'model_provider' as const;
export const MODEL_PROVIDER_CODEX_ID = 'openai-codex' as const;
export const MODEL_PROVIDER_CODEX_MODEL = 'gpt-5.6-luna' as const;
export const MODEL_PROVIDER_CODEX_EFFORT = 'low' as const;
export const MODEL_PROVIDER_RECORD_SCHEMA_VERSION = 1 as const;
export const MODEL_PROVIDER_SNAPSHOT_SCHEMA = 'model-provider-snapshot-v1' as const;

export const MODEL_PROVIDER_SNAPSHOT_CHANGED_EVENT = 'model-provider/snapshot-changed' as const;
export const MODEL_PROVIDER_DEVICE_CODE_EVENT = 'model-provider/device-code' as const;

export type ModelProviderId = typeof MODEL_PROVIDER_CODEX_ID;
export type ModelProviderModel = typeof MODEL_PROVIDER_CODEX_MODEL;
export type ModelProviderEffort = typeof MODEL_PROVIDER_CODEX_EFFORT;
export type ModelProviderLoginMethod = 'browser' | 'device_code';

export type ModelProviderAuthState =
  | 'login_required'
  | 'authenticating'
  | 'ready'
  | 'invalidated'
  | 'unavailable';

export type ModelProviderInvalidationReason =
  | 'expired'
  | 'invalid-grant'
  | 'invalid-token'
  | 'revoked'
  | 'sign-in-required'
  | 'unauthorized';

export interface ModelProviderTarget {
  provider: ModelProviderId;
  model: ModelProviderModel;
  effort: ModelProviderEffort;
}

export interface ModelProviderRecord {
  schemaVersion: typeof MODEL_PROVIDER_RECORD_SCHEMA_VERSION;
  provider: ModelProviderId;
  configuredModels: ModelProviderModel[];
  defaultTarget: ModelProviderTarget;
  authState: ModelProviderAuthState;
  invalidationReason: ModelProviderInvalidationReason | null;
  lastObservedAt: number;
  lastSuccessfulRuntimeAt: number | null;
}

export interface ModelProviderSnapshot {
  schema: typeof MODEL_PROVIDER_SNAPSHOT_SCHEMA;
  observedAt: number;
  providers: ModelProviderRecord[];
  availableTargets: ModelProviderTarget[];
}

export interface ModelProviderConnectInput {
  provider: ModelProviderId;
  method: ModelProviderLoginMethod;
}

export interface ModelProviderDisconnectInput {
  provider: ModelProviderId;
}

export type ModelProviderActionErrorCode =
  | 'cancelled'
  | 'invalid-input'
  | 'login-failed'
  | 'login-in-progress'
  | 'logout-failed'
  | 'persistence-unavailable'
  | 'status-unavailable'
  | 'timeout';

export interface ModelProviderActionError {
  code: ModelProviderActionErrorCode;
  retryable: boolean;
}

export type ModelProviderActionResult =
  | {
      ok: true;
      snapshot: ModelProviderSnapshot;
    }
  | {
      ok: false;
      snapshot: ModelProviderSnapshot;
      error: ModelProviderActionError;
    };

export interface ModelProviderDeviceCodeNotice {
  provider: ModelProviderId;
  userCode: string;
  verificationHost: string;
  expiresAt: number | null;
}

export interface ModelProviderApi {
  getSnapshot(): Promise<ModelProviderSnapshot>;
  connect(params: ModelProviderConnectInput): Promise<ModelProviderActionResult>;
  cancelConnect(params: ModelProviderDisconnectInput): Promise<ModelProviderActionResult>;
  disconnect(params: ModelProviderDisconnectInput): Promise<ModelProviderActionResult>;
}
