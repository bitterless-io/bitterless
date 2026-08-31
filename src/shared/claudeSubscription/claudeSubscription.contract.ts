export const CLAUDE_SUBSCRIPTION_HOST = '127.0.0.1' as const;
/**
 * Default only. The active port is owner-configurable and lives in the snapshot;
 * anything that builds a URL must read it from there rather than from this
 * constant, which is merely where a fresh install starts.
 */
export const CLAUDE_SUBSCRIPTION_DEFAULT_PORT = 12841;
export const CLAUDE_SUBSCRIPTION_MIN_PORT = 1024;
export const CLAUDE_SUBSCRIPTION_MAX_PORT = 65535;
export const CLAUDE_SUBSCRIPTION_SNAPSHOT_CHANGED_EVENT =
  'claude-subscription/snapshot-changed' as const;

/**
 * Built from the live port so a copied snippet always matches the running server.
 * A hard-coded snippet silently pointed Codex at the wrong port once the port
 * became configurable.
 */
/**
 * Mirrors `claude --effort` exactly: low, medium, high, xhigh, max. Declaring a
 * level the CLI does not accept would put a broken option in Codex's picker.
 */
export const CLAUDE_SUBSCRIPTION_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

const CODEX_EFFORT_DESCRIPTIONS: Record<string, string> = {
  low: 'Fastest, least reasoning',
  medium: 'Balanced',
  high: 'More reasoning',
  xhigh: 'Very high reasoning',
  max: 'Maximum reasoning'
};

/**
 * Codex populates its model picker from `model_catalog_json`, not from the
 * provider's `/v1/models` — a provider block alone leaves the built-in OpenAI list
 * in place (verified against `codex debug models`). Publishing a catalog is
 * therefore the only way to let Codex choose the model and effort itself.
 *
 * The field set is the intersection that both codex-cli 0.137 and the desktop's
 * bundled 0.149 accept: 0.137 rejects an entry missing
 * `supports_reasoning_summaries` or `supports_parallel_tool_calls`, which 0.149
 * tolerates. A single missing field silently discards the whole catalog.
 */
export const buildClaudeSubscriptionCodexModelCatalog = (): {
  models: Array<Record<string, unknown>>;
} => ({
  models: Object.keys(CLAUDE_SUBSCRIPTION_MODELS).map((slug, index) => ({
    slug,
    display_name: `${CLAUDE_SUBSCRIPTION_MODEL_LABELS[slug] ?? slug} (Bitterless)`,
    description: 'Claude through the Bitterless local subscription pool',
    shell_type: 'default',
    visibility: 'list',
    supported_in_api: true,
    supported_reasoning_levels: CLAUDE_SUBSCRIPTION_EFFORTS.map((effort) => ({
      effort,
      description: CODEX_EFFORT_DESCRIPTIONS[effort] ?? effort
    })),
    supports_reasoning_summaries: true,
    supports_parallel_tool_calls: true,
    priority: index,
    support_verbosity: true,
    truncation_policy: { mode: 'tokens', limit: 200000 },
    experimental_supported_tools: [],
    base_instructions: 'You are a coding agent.'
  }))
});

/**
 * Built from the live port so a copied snippet always matches the running server.
 *
 * `model_catalog_json` is emitted **before any table header**: TOML would otherwise
 * scope it into `[model_providers.bitterless_claude]`, where it is silently ignored
 * as an unknown provider field and the picker keeps showing the OpenAI models.
 */
export const buildClaudeSubscriptionCodexProfile = (port: number, catalogPath?: string): string =>
  `model = "claude-sonnet"
model_provider = "bitterless_claude"
${catalogPath ? `model_catalog_json = ${JSON.stringify(catalogPath)}
` : ''}
[model_providers.bitterless_claude]
name = "Bitterless Claude Subscription"
base_url = "http://${CLAUDE_SUBSCRIPTION_HOST}:${port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 900000
`;

export const CLAUDE_SUBSCRIPTION_MODELS = {
  'claude-sonnet': 'sonnet',
  'claude-opus': 'opus',
  'claude-haiku': 'haiku'
} as const;

export const CLAUDE_SUBSCRIPTION_MODEL_LABELS: Record<string, string> = {
  'claude-sonnet': 'Claude Sonnet',
  'claude-opus': 'Claude Opus',
  'claude-haiku': 'Claude Haiku'
};

export type ClaudeSubscriptionModel = keyof typeof CLAUDE_SUBSCRIPTION_MODELS;
export type ClaudeCliModel = (typeof CLAUDE_SUBSCRIPTION_MODELS)[ClaudeSubscriptionModel];
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
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
  port: number;
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

/**
 * Registers a `~/.claude<slot>` directory the owner already logged in from a
 * terminal. No PTY, no browser, no credential is written — only verified and
 * recorded.
 */
/** Changes the loopback port the Responses endpoint listens on. */
export interface ClaudeSubscriptionSetServerPortInput {
  port: number;
}

export interface ClaudeSubscriptionAdoptAccountInput {
  slot: number;
  label: string;
}

/** A slot present on disk but not yet registered. */
export interface ClaudeSubscriptionAdoptableSlot {
  slot: number;
  /** The CLI has been run in this directory at least once. */
  initialized: boolean;
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
  adoptAccount(value: unknown): Promise<ClaudeSubscriptionActionResult>;
  setServerPort(value: unknown): Promise<ClaudeSubscriptionActionResult>;
  listAdoptableSlots(): Promise<ClaudeSubscriptionAdoptableSlot[]>;
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
