export const CLAUDE_SUBSCRIPTION_HOST = '127.0.0.1' as const;
/**
 * Default only. The active port is owner-configurable and lives in the snapshot;
 * anything that builds a URL must read it from there rather than from this
 * constant, which is merely where a fresh install starts.
 */
export const CLAUDE_SUBSCRIPTION_DEFAULT_PORT = 12842;
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
/**
 * What Codex Desktop's picker actually offers.
 *
 * Its schema accepts `none|minimal|low|medium|high|xhigh|max|ultra`, but the UI renders
 * a shorter list — `enabledReasoningEfforts` defaults to
 * `[low, medium, high, xhigh, ultra]`, both arrays sitting side by side in the app
 * bundle. **`max` is excluded from the picker**, so declaring it puts a rung in the
 * catalog that no one can select.
 *
 * Dropping it leaves five client rungs against five upstream rungs — the Claude CLI's
 * `low..max` and pi's `low..max` — which align by rank with only the top rung renamed:
 * `ultra` is the upstream's `max`. Everything below is identity.
 *
 * This was briefly six rungs including `max`, which shifted four of the five visible
 * levels down one: `high` ran the upstream's `medium`. The client ladder has to be what
 * the client shows, not what its schema tolerates.
 */
export const SUB2API_CLIENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'ultra'] as const;

export type Sub2ApiClientEffort = (typeof SUB2API_CLIENT_EFFORTS)[number];

/**
 * Maps a client rung onto an upstream ladder **by rank, anchored at the top**.
 *
 * Used where the upstream's ladder is longer at the *top* than the client's: the Claude
 * CLI carries a sixth level, `ultracode`, above `max`, while Desktop's picker shows
 * five. Aligning the tops spends that extra rung on `ultra` and drops the CLI's `low`,
 * which is the rung least worth reaching.
 *
 * Not used for the Codex upstream: pi's extra rung (`minimal`) sits at the *bottom*, so
 * rank alignment there would push every level down one. That path matches by name.
 *
 * A level outside the client ladder — `max`, which Desktop's schema allows but its
 * picker hides — resolves to the top rather than being rejected.
 */
export const shiftClientEffortToUpstream = <T extends string>(
  effort: string,
  upstream: readonly T[]
): T => {
  if (upstream.length === 0) throw new Error('An upstream effort ladder cannot be empty.');
  const clientIndex = SUB2API_CLIENT_EFFORTS.indexOf(effort as Sub2ApiClientEffort);
  const offsetFromTop =
    clientIndex === -1 ? 0 : SUB2API_CLIENT_EFFORTS.length - 1 - clientIndex;
  return upstream[Math.max(0, upstream.length - 1 - offsetFromTop)] as T;
};

/**
 * The Claude CLI's own ladder.
 *
 * `ultracode` is **not** in the CLI's own "Valid values: low, medium, high, xhigh, max"
 * message, but it is accepted: `--effort ultracode` runs without the *Unknown --effort
 * value* warning that `ultra` and any other unknown string produce. Verified against
 * the live CLI on 2026-08-31 by comparing all four.
 */
export const CLAUDE_SUBSCRIPTION_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultracode'
] as const;

/**
 * The Claude CLI's own baseline, read from its bundle: `_er = 200000`.
 *
 * Not 1M. The CLI does carry a `context-1m-2025-08-07` beta, but `fro()` only returns
 * a larger window when the model is **`claude-sonnet-4-6`** *and* a server-side
 * `kelp_forest_sonnet` value is present. Neither `claude-sonnet-5` nor
 * `claude-opus-5` qualifies, so the beta header is never added for the models this
 * bridge serves.
 *
 * Briefly set to the GPT figures (272000/872000) to unify the two families. That was
 * reverted once the CLI was actually read: overstating the budget by 36% does not give
 * Codex more room, it removes the compaction that keeps a transcript inside what
 * `claude -p` will accept, and the resulting refusal arrives as an opaque 502.
 */
export const CLAUDE_SUBSCRIPTION_CONTEXT_WINDOW = 200_000;
export const CLAUDE_SUBSCRIPTION_MAX_CONTEXT_WINDOW = 200_000;

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
export interface ClaudeSubscriptionCatalogEntry {
  slug: string;
  label: string;
  /** Only the levels this upstream actually accepts — see the note below. */
  efforts: readonly string[];
  /** Must be one of `efforts`; Codex needs a level to start a thread at. */
  defaultEffort: string;
  /** Tokens Codex plans against before compacting. */
  contextWindow: number;
  /** The ceiling Codex will stretch to; matches Codex's own `max_context_window`. */
  maxContextWindow: number;
  description: string;
}

/**
 * Builds the catalog from whatever entries the caller says are servable.
 *
 * Efforts are per entry, not one shared list: Claude accepts low..max while Codex
 * stops at xhigh, and `gpt-5.6-sol` accepts only medium..xhigh. Advertising a level
 * an upstream rejects puts an option in the picker that fails when selected.
 */
export const buildClaudeSubscriptionCodexModelCatalog = (
  entries: readonly ClaudeSubscriptionCatalogEntry[]
): { models: Array<Record<string, unknown>> } => ({
  models: entries.map((entry, index) => ({
    slug: entry.slug,
    display_name: `${entry.label} (Bitterless)`,
    description: entry.description,
    shell_type: 'default',
    visibility: 'list',
    supported_in_api: true,
    // Codex's own entries carry this, and without it the picker would not know which
    // level to open a thread at. Its absence is the difference between a catalogue
    // Codex reads fully and one it falls back on.
    default_reasoning_level: entry.defaultEffort,
    minimal_client_version: '0.144.0',
    supported_reasoning_levels: entry.efforts.map((effort) => ({
      effort,
      description: CODEX_EFFORT_DESCRIPTIONS[effort] ?? effort
    })),
    supports_reasoning_summaries: true,
    supports_reasoning_summary_parameter: true,
    default_reasoning_summary: 'none',
    supports_parallel_tool_calls: true,
    priority: index,
    support_verbosity: true,
    default_verbosity: 'low',
    // Codex plans compaction against these. Omitting them left it with no budget to
    // reason about for a model whose entry replaced the built-in one.
    //
    // Per family, from each upstream's own published figure — deliberately not one
    // shared number. A budget that overstates the upstream removes the compaction that
    // keeps a transcript inside what the upstream accepts.
    context_window: entry.contextWindow,
    max_context_window: entry.maxContextWindow,
    auto_compact_token_limit: null,
    input_modalities: ['text'],
    apply_patch_tool_type: 'freeform',
    supports_search_tool: false,
    // `service_tiers` is deliberately absent rather than an empty list. Ral's config
    // carries `service_tier = "priority"` from his OpenAI-provider days; Bitterless
    // ignores the field, and an explicit empty list is a claim that this model offers
    // no tier — which Codex may then validate that setting against. Absent is the
    // permissive value, and the difference has not been tested.
    // Bounds a single tool output — not the context; 200000 was a misreading of the
    // field. Derived from the budget rather than fixed at Codex's 10000: the ratio is
    // what makes the number correct, so a constant silently becomes wrong the moment a
    // window changes. Codex uses ~3.7% of 272000; this keeps that proportion.
    truncation_policy: {
      mode: 'tokens',
      limit: Math.max(4_000, Math.round(entry.contextWindow * 0.04))
    },
    experimental_supported_tools: [],
    base_instructions: 'You are a coding agent.'
  }))
});

/** The Claude half of the catalog; the Codex half comes from the Codex runtime. */
export const claudeSubscriptionCatalogEntries = (): ClaudeSubscriptionCatalogEntry[] =>
  Object.keys(CLAUDE_SUBSCRIPTION_MODELS).map((slug) => ({
    slug,
    label: CLAUDE_SUBSCRIPTION_MODEL_LABELS[slug] ?? slug,
    // `claude --effort` accepts exactly low|medium|high|xhigh|max — the CLI names them
    // in its own rejection message, and `ultra` is not among them: passing it prints
    // "Unknown --effort value" and silently falls back to the default.
    efforts: SUB2API_CLIENT_EFFORTS,
    defaultEffort: 'high',
    // Owner decision (2026-08-31): unified with the GPT entries. See the risk note in
    // buildClaudeSubscriptionCodexModelCatalog.
    contextWindow: CLAUDE_SUBSCRIPTION_CONTEXT_WINDOW,
    maxContextWindow: CLAUDE_SUBSCRIPTION_MAX_CONTEXT_WINDOW,
    description: 'Claude through the Bitterless local subscription pool'
  }));

/**
 * Built from the live port so a copied snippet always matches the running server.
 *
 * `model_catalog_json` is emitted **before any table header**: TOML would otherwise
 * scope it into `[model_providers.bitterless_claude]`, where it is silently ignored
 * as an unknown provider field and the picker keeps showing the OpenAI models.
 */
/**
 * Built from the live port so a copied snippet always matches the running server.
 *
 * Deliberately omits a top-level `model`. Setting one rewrites the default for
 * **existing** Codex threads too, and a thread created under the OpenAI provider
 * then asks ChatGPT for a Claude model — which fails with "not supported when
 * using Codex with a ChatGPT account". The catalog already supplies the default
 * model for new threads, so the line bought nothing and broke old ones.
 *
 * `model_catalog_json` is emitted **before any table header**: TOML would otherwise
 * scope it into `[model_providers.bitterless_claude]`, where it is silently ignored
 * as an unknown provider field and the picker keeps showing the OpenAI models.
 *
 * Note this switches Codex Desktop **globally** — it has no per-thread provider
 * (openai/codex#29156). The CLI can keep both by putting this in a Profiles V2
 * file and using `codex -p <name>`.
 */
export const buildClaudeSubscriptionCodexProfile = (port: number, catalogPath?: string): string =>
  `model_provider = "bitterless_claude"
${catalogPath ? `model_catalog_json = ${JSON.stringify(catalogPath)}\n` : ''}
[model_providers.bitterless_claude]
name = "Bitterless Sub2API"
base_url = "http://${CLAUDE_SUBSCRIPTION_HOST}:${port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 900000
`;

/**
 * Haiku is not offered: the pool exists for coding turns, where it is the wrong
 * trade, and every slot it occupies in the picker is one the owner has to skip past.
 *
 * The CLI aliases resolve to the 5 generation — `--model sonnet` reports
 * `claude-sonnet-5` and `--model opus` reports `claude-opus-5`, both verified against
 * the live CLI — so the labels say so rather than leaving the generation ambiguous.
 */
export const CLAUDE_SUBSCRIPTION_MODELS = {
  'claude-sonnet': 'sonnet',
  'claude-opus': 'opus'
} as const;

export const CLAUDE_SUBSCRIPTION_MODEL_LABELS: Record<string, string> = {
  'claude-sonnet': 'Claude Sonnet 5',
  'claude-opus': 'Claude Opus 5'
};

export type ClaudeSubscriptionModel = keyof typeof CLAUDE_SUBSCRIPTION_MODELS;
export type ClaudeCliModel = (typeof CLAUDE_SUBSCRIPTION_MODELS)[ClaudeSubscriptionModel];
/** Derived from the CLI ladder so the two cannot drift; includes `ultracode`. */
export type ClaudeEffort = (typeof CLAUDE_SUBSCRIPTION_EFFORTS)[number];
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

/**
 * Anthropic's own rate-limit state for an account, as last observed.
 *
 * There is **no usage percentage** here because the CLI does not report one: its
 * `rate_limit_event` carries a window, a status and a reset time, nothing more. A
 * percentage would have to be invented, so the window is shown instead.
 */
export interface ClaudeSubscriptionAccountUsage {
  /** `allowed`, `allowed_warning`, `rejected`, … — Anthropic's own wording. */
  status?: string;
  /** `five_hour`, `weekly`, … — which window the status describes. */
  window?: string;
  resetsAt?: number;
  usingOverage?: boolean;
  /** Percent of the five-hour window consumed, from the CLI's `/usage` report. */
  sessionUsedPercent?: number;
  /** Percent of the weekly window consumed — what the switching policy watches. */
  weekUsedPercent?: number;
  sessionResetsAt?: string;
  weekResetsAt?: string;
  observedAt: number;
}

/**
 * Below this much weekly quota remaining an account is treated as spent and routing
 * moves to the healthiest sibling on the same platform.
 *
 * When **every** account is under it the threshold is ignored rather than failing the
 * request: the pool then runs the account with the most left until it is genuinely at
 * zero. Refusing at 5% would strand quota the owner has paid for.
 */
export const CLAUDE_SUBSCRIPTION_LOW_QUOTA_PERCENT = 5;

export interface ClaudeSubscriptionAccountView {
  id: ClaudeAccountId;
  label: string;
  /** `~/.claude<N>` — the directory this account's CLI session lives in. */
  directory?: string;
  email?: string;
  subscriptionType: ClaudeSubscriptionType;
  enabled: boolean;
  status: ClaudeSubscriptionAccountStatus;
  activeRequests: number;
  cooldownUntil?: number;
  usage?: ClaudeSubscriptionAccountUsage;
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
  /**
   * How many times the CLI has asked for a code. Above 1 the owner needs to know the
   * ask is a *new* one — either a second factor or the previous code being refused —
   * because the status text alone is identical to the first ask.
   */
  codeAttempt: number;
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

/**
 * The GPT half of the endpoint. It is a single ChatGPT OAuth credential shared with
 * Translator, not a pool — Codex sign-in is browser OAuth against a subscription and
 * Bitterless holds exactly one at a time.
 */
export interface ClaudeSubscriptionCodexUpstreamView {
  connected: boolean;
  models: string[];
}

export interface ClaudeSubscriptionSnapshot {
  schema: typeof CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA;
  revision: number;
  observedAt: number;
  secureStorageAvailable: boolean;
  accounts: ClaudeSubscriptionAccountView[];
  server: ClaudeSubscriptionServerView;
  authFlow: ClaudeSubscriptionAuthFlowView | null;
  codexUpstream: ClaudeSubscriptionCodexUpstreamView;
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
  /** The level the client asked for, in the client's vocabulary — not an upstream's. */
  claudeEffort: Sub2ApiClientEffort;
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
