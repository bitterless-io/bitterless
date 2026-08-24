export const CLAUDE_SUBSCRIPTION_HOST = '127.0.0.1' as const;
export const CLAUDE_SUBSCRIPTION_PORT = 8741 as const;
export const CLAUDE_SUBSCRIPTION_SNAPSHOT_CHANGED_EVENT =
  'claude-subscription/snapshot-changed' as const;

export const CLAUDE_SUBSCRIPTION_CODEX_PROFILE = `model = "claude-sonnet"
model_provider = "bitterless_claude"

[model_providers.bitterless_claude]
name = "Bitterless Claude Subscription"
base_url = "http://127.0.0.1:8741/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 900000
` as const;

export const CLAUDE_SUBSCRIPTION_MODELS = {
  'claude-sonnet': 'sonnet',
  'claude-opus': 'opus',
  'claude-haiku': 'haiku'
} as const;

export type ClaudeSubscriptionModel = keyof typeof CLAUDE_SUBSCRIPTION_MODELS;
export type ClaudeCliModel = (typeof CLAUDE_SUBSCRIPTION_MODELS)[ClaudeSubscriptionModel];
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type ClaudeAccountId = string;
export type ClaudeSubscriptionType = 'pro' | 'max' | 'team' | 'enterprise';

export const CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA = 'claude-subscription-snapshot-v1' as const;

export type ClaudeSubscriptionAccountStatus =
  | 'checking'
  | 'usable'
  | 'busy'
  | 'limited'
  | 'reconnect'
  | 'disabled';

export interface ClaudeSubscriptionAccountView {
  id: ClaudeAccountId;
  label: string;
  email?: string;
  subscriptionType: ClaudeSubscriptionType;
  enabled: boolean;
  status: ClaudeSubscriptionAccountStatus;
  activeRequests: number;
  cooldownUntil?: number;
  createdAt: string;
  updatedAt: string;
}

export type ClaudeSubscriptionServerState = 'starting' | 'ready' | 'attention' | 'stopped';

export interface ClaudeSubscriptionServerView {
  state: ClaudeSubscriptionServerState;
  host: typeof CLAUDE_SUBSCRIPTION_HOST;
  port: typeof CLAUDE_SUBSCRIPTION_PORT;
}

export type ClaudeSubscriptionAuthFlowStatus =
  | 'starting'
  | 'browser_open'
  | 'awaiting_code'
  | 'saving';

export interface ClaudeSubscriptionAuthFlowView {
  flowId: string;
  accountId: ClaudeAccountId;
  status: ClaudeSubscriptionAuthFlowStatus;
  canSubmitCode: boolean;
  error?: {
    code: string;
    retryable: boolean;
  };
}

export const CLAUDE_SUBSCRIPTION_OPERATION_ERROR_CODES = [
  'invalid_input',
  'secure_storage_unavailable',
  'claude_cli_unavailable',
  'subscription_required',
  'auth_busy',
  'account_not_found',
  'auth_flow_not_found',
  'invalid_authorization_code',
  'auth_cancelled',
  'auth_timeout',
  'authorization_output_invalid',
  'browser_open_failed',
  'account_save_failed',
  'claude_logout_failed',
  'partition_clear_failed',
  'claude_authentication',
  'claude_usage_limit',
  'claude_execution',
  'profile_copy_failed',
  'runtime_unavailable'
] as const;

export type ClaudeSubscriptionOperationErrorCode =
  (typeof CLAUDE_SUBSCRIPTION_OPERATION_ERROR_CODES)[number];

export interface ClaudeSubscriptionOperationError {
  code: ClaudeSubscriptionOperationErrorCode;
  retryable: boolean;
}

export interface ClaudeSubscriptionSnapshot {
  schema: typeof CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA;
  revision: number;
  observedAt: number;
  secureStorageAvailable: boolean;
  accounts: ClaudeSubscriptionAccountView[];
  server: ClaudeSubscriptionServerView;
  authFlow: ClaudeSubscriptionAuthFlowView | null;
}

export type ClaudeSubscriptionActionResult =
  | {
      ok: true;
      snapshot: ClaudeSubscriptionSnapshot;
    }
  | {
      ok: false;
      snapshot: ClaudeSubscriptionSnapshot;
      error: ClaudeSubscriptionOperationError;
    };

export type ClaudeSubscriptionCopyResult =
  | { ok: true }
  | {
      ok: false;
      error: ClaudeSubscriptionOperationError;
    };

export interface ClaudeSubscriptionStartAuthInput {
  label: string;
  accountId?: ClaudeAccountId;
}

export interface ClaudeSubscriptionSubmitAuthCodeInput {
  flowId: string;
  code: string;
}

export interface ClaudeSubscriptionFlowIdInput {
  flowId: string;
}

export interface ClaudeSubscriptionAccountIdInput {
  accountId: ClaudeAccountId;
}

export interface ClaudeSubscriptionRenameAccountInput {
  accountId: ClaudeAccountId;
  label: string;
}

export interface ClaudeSubscriptionSetAccountEnabledInput {
  accountId: ClaudeAccountId;
  enabled: boolean;
}

export interface ClaudeSubscriptionApi {
  getSnapshot(): Promise<ClaudeSubscriptionSnapshot>;
  startAuthorization(
    input: ClaudeSubscriptionStartAuthInput
  ): Promise<ClaudeSubscriptionActionResult>;
  submitAuthorizationCode(
    input: ClaudeSubscriptionSubmitAuthCodeInput
  ): Promise<ClaudeSubscriptionActionResult>;
  cancelAuthorization(
    input: ClaudeSubscriptionFlowIdInput
  ): Promise<ClaudeSubscriptionActionResult>;
  renameAccount(
    input: ClaudeSubscriptionRenameAccountInput
  ): Promise<ClaudeSubscriptionActionResult>;
  setAccountEnabled(
    input: ClaudeSubscriptionSetAccountEnabledInput
  ): Promise<ClaudeSubscriptionActionResult>;
  testAccount(input: ClaudeSubscriptionAccountIdInput): Promise<ClaudeSubscriptionActionResult>;
  removeAccount(input: ClaudeSubscriptionAccountIdInput): Promise<ClaudeSubscriptionActionResult>;
  copyCodexProfile(): Promise<ClaudeSubscriptionCopyResult>;
}

export interface ClaudeSubscriptionRoutingHealth {
  total: number;
  enabled: number;
  eligible: number;
  busy: number;
  cooling: number;
  needsLogin: number;
  activeRequests: number;
}

export type ClaudeSubscriptionJsonObject = Record<string, unknown>;

export type ClaudeResponsesRequest = ClaudeSubscriptionJsonObject & {
  model: string;
  stream: true;
  instructions: string;
  input: unknown[] | string;
  tools: unknown[];
  prompt_cache_key?: string;
  claudeEffort: ClaudeEffort;
};

export interface ClaudeNormalizedCodexTool {
  decision_name: string;
  name: string;
  namespace?: string;
  description: string;
  parameters: ClaudeSubscriptionJsonObject;
}

export interface ClaudeBridgePayload {
  codex_instructions: string;
  conversation: unknown[];
  available_tools: ClaudeNormalizedCodexTool[];
  unsupported_codex_tool_types: string[];
  response_rule: string;
}

export type ClaudeDecision =
  | { action: 'final'; text: string }
  | {
      action: 'tool_call';
      toolName: string;
      toolNamespace?: string;
      argumentsJson: string;
    };

export interface ClaudeUsageEnvelope {
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
}

export interface ClaudeOpenAiUsage {
  input_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number };
  total_tokens: number;
}

export interface ClaudeResponseOutputText {
  type: 'output_text';
  text: string;
  annotations: unknown[];
  logprobs: unknown[];
}

export interface ClaudeResponseMessage {
  id: string;
  type: 'message';
  status: 'completed';
  role: 'assistant';
  content: ClaudeResponseOutputText[];
}

export interface ClaudeResponseFunctionCall {
  id: string;
  type: 'function_call';
  status: 'completed';
  call_id: string;
  name: string;
  namespace?: string;
  arguments: string;
}

export interface ClaudeCompletedResponse {
  id: string;
  object: 'response';
  created_at: number;
  status: 'completed';
  error: null;
  incomplete_details: null;
  model: string;
  output: [ClaudeResponseMessage | ClaudeResponseFunctionCall];
  parallel_tool_calls: false;
  tool_choice: 'auto';
  tools: unknown[];
  usage: ClaudeOpenAiUsage;
}
