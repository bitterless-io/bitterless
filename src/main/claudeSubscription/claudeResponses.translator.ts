import {
  CLAUDE_SUBSCRIPTION_EFFORTS,
  SUB2API_CLIENT_EFFORTS,
  shiftClientEffortToUpstream,
  CLAUDE_SUBSCRIPTION_MODELS,
  type ClaudeBridgePayload,
  type ClaudeCliModel,
  type ClaudeEffort,
  type ClaudeNormalizedCodexTool,
  type ClaudeResponsesRequest,
  type ClaudeSubscriptionModel,
  type Sub2ApiClientEffort,
  type ClaudeSubscriptionJsonObject
} from '@shared/claudeSubscription/claudeSubscription.contract';
import {
  CODEX_RUNTIME_MODELS,
  type CodexRuntimeEffort,
  type CodexRuntimeModel
} from '@main/codex/codexRuntime.service';
import { clampCodexEffort } from '@main/codex/codexResponses.upstream';
import { ClaudeSubscriptionInvalidRequestError } from './claudeSubscription.errors';

const isObject = (value: unknown): value is ClaudeSubscriptionJsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseParameters = (value: unknown): ClaudeSubscriptionJsonObject => {
  if (value === undefined) return { type: 'object', properties: {} };
  if (!isObject(value)) {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Codex function parameters must be a JSON schema object.'
    );
  }
  if (value.type !== undefined && value.type !== 'object') {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Codex function parameters must describe an object.'
    );
  }
  if (value.properties !== undefined && !isObject(value.properties)) {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Codex function schema properties must be an object.'
    );
  }
  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) || value.required.some((entry) => typeof entry !== 'string'))
  ) {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Codex function schema required must be a string array.'
    );
  }
  if (
    value.additionalProperties !== undefined &&
    typeof value.additionalProperties !== 'boolean' &&
    !isObject(value.additionalProperties)
  ) {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Codex function schema additionalProperties is invalid.'
    );
  }
  return value;
};

const normalizeFunctionTool = (
  tool: ClaudeSubscriptionJsonObject,
  namespace?: string
): ClaudeNormalizedCodexTool => {
  if (typeof tool.name !== 'string' || tool.name.trim() === '') {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Every Codex function tool requires a non-empty name.'
    );
  }

  const name = tool.name.trim();
  return {
    decision_name: namespace
      ? `namespace:${encodeURIComponent(namespace)}:${encodeURIComponent(name)}`
      : name,
    name,
    ...(namespace ? { namespace } : {}),
    description: typeof tool.description === 'string' ? tool.description : '',
    parameters: parseParameters(tool.parameters)
  };
};

export const extractClaudeCodexTools = (
  tools: readonly unknown[]
): { functions: ClaudeNormalizedCodexTool[]; unsupported: string[] } => {
  const functions: ClaudeNormalizedCodexTool[] = [];
  const unsupported: string[] = [];

  for (const value of tools) {
    if (!isObject(value)) {
      unsupported.push('unknown');
      continue;
    }
    if (value.type === 'function') {
      functions.push(normalizeFunctionTool(value));
      continue;
    }
    if (
      value.type === 'namespace' &&
      typeof value.name === 'string' &&
      Array.isArray(value.tools)
    ) {
      const namespace = value.name.trim();
      if (!namespace) {
        throw new ClaudeSubscriptionInvalidRequestError(
          'Every Codex tool namespace requires a non-empty name.'
        );
      }
      for (const child of value.tools) {
        if (isObject(child) && child.type === 'function') {
          functions.push(normalizeFunctionTool(child, namespace));
        } else if (isObject(child)) {
          unsupported.push(typeof child.type === 'string' ? child.type : 'unknown');
        } else {
          unsupported.push('unknown');
        }
      }
      continue;
    }
    unsupported.push(typeof value.type === 'string' ? value.type : 'unknown');
  }

  const names = new Set<string>();
  for (const tool of functions) {
    if (names.has(tool.decision_name)) {
      throw new ClaudeSubscriptionInvalidRequestError('Codex function tool names must be unique.');
    }
    names.add(tool.decision_name);
  }
  return { functions, unsupported: [...new Set(unsupported)] };
};

/**
 * Reads the level the **client** asked for, in the client's own vocabulary. The shift
 * onto an upstream ladder happens at dispatch, once the upstream is known.
 */
export const resolveClaudeEffort = (reasoning: unknown): Sub2ApiClientEffort => {
  if (reasoning === undefined) return 'high';
  if (!isObject(reasoning)) {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Responses reasoning must be an object when provided.'
    );
  }
  const effort = reasoning.effort;
  if (effort === undefined) return 'high';
  if (typeof effort !== 'string') {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Responses reasoning effort must be a supported string.'
    );
  }
  // Codex's enum starts one rung below the client ladder; `none`/`minimal` have no
  // rung of their own and land on the lowest.
  if (effort === 'none' || effort === 'minimal' || effort === 'low') return 'low';
  // Desktop's picker hides `max` (its `enabledReasoningEfforts` default omits it) but
  // its schema still accepts it, so a thread can legally send it. It names the same
  // intent as the client ladder's top rung.
  if (effort === 'max') return 'ultra';
  if ((SUB2API_CLIENT_EFFORTS as readonly string[]).includes(effort)) {
    return effort as Sub2ApiClientEffort;
  }
  throw new ClaudeSubscriptionInvalidRequestError('Responses reasoning effort is unsupported.');
};

const normalizeContentPart = (part: unknown): unknown => {
  if (!isObject(part)) return part;
  if (part.type !== 'input_image' && part.type !== 'output_image') return part;
  return {
    type: part.type,
    ...(typeof part.detail === 'string' ? { detail: part.detail } : {}),
    note: 'Image bytes are not forwarded by Bitterless. Codex must use its own image-inspection tool.'
  };
};

export const normalizeClaudeConversation = (input: unknown[] | string): unknown[] => {
  if (typeof input === 'string') {
    return [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: input }]
      }
    ];
  }
  return input.map((item) => {
    if (!isObject(item)) return item;
    if (item.type === 'input_image' || item.type === 'output_image') {
      return normalizeContentPart(item);
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) return item;
    return { ...item, content: item.content.map(normalizeContentPart) };
  });
};

export const parseClaudeResponsesRequest = (value: unknown): ClaudeResponsesRequest => {
  if (!isObject(value)) {
    throw new ClaudeSubscriptionInvalidRequestError('Expected a JSON object request body.');
  }
  if (value.stream !== true) {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Bitterless requires stream=true for Responses requests.'
    );
  }
  if (typeof value.model !== 'string' || value.model.trim() === '') {
    throw new ClaudeSubscriptionInvalidRequestError('A non-empty model is required.');
  }
  if (value.instructions !== undefined && typeof value.instructions !== 'string') {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Responses instructions must be a string when provided.'
    );
  }
  if (value.input !== undefined && typeof value.input !== 'string' && !Array.isArray(value.input)) {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Responses input must be a string or an array of input items.'
    );
  }
  if (value.tools !== undefined && !Array.isArray(value.tools)) {
    throw new ClaudeSubscriptionInvalidRequestError(
      'Responses tools must be an array when provided.'
    );
  }
  if (value.prompt_cache_key !== undefined && typeof value.prompt_cache_key !== 'string') {
    throw new ClaudeSubscriptionInvalidRequestError(
      'prompt_cache_key must be a string when provided.'
    );
  }

  return {
    ...value,
    model: value.model,
    stream: true,
    instructions: value.instructions ?? '',
    input: value.input ?? [],
    tools: value.tools ?? [],
    claudeEffort: resolveClaudeEffort(value.reasoning),
    ...(typeof value.prompt_cache_key === 'string'
      ? { prompt_cache_key: value.prompt_cache_key }
      : {})
  };
};

export const CLAUDE_SUBSCRIPTION_FALLBACK_MODEL = 'claude-sonnet' as const;

/**
 * Resolves the requested model, falling back to Sonnet for anything unrecognised.
 *
 * Codex Desktop switches provider **globally** — it has no per-thread provider
 * (openai/codex#29156) — so a thread created before the switch keeps an OpenAI
 * slug like `gpt-5.6-sol` and sends it here. Rejecting those made every
 * pre-existing thread unusable the moment the provider was enabled. This bridge
 * only ever serves Claude, so a request naming something else can only have come
 * from a client pointed at it deliberately; answering is more useful than failing.
 *
 * The substitution is **not** silent: `resolveClaudeSubscriptionModelId` reports
 * the model that actually served the request, so the response says `claude-sonnet`
 * rather than echoing a model that never ran.
 */
export const resolveClaudeSubscriptionModelId = (model: string): ClaudeSubscriptionModel =>
  Object.prototype.hasOwnProperty.call(CLAUDE_SUBSCRIPTION_MODELS, model)
    ? (model as ClaudeSubscriptionModel)
    : CLAUDE_SUBSCRIPTION_FALLBACK_MODEL;

export const resolveClaudeSubscriptionModel = (model: string): ClaudeCliModel =>
  CLAUDE_SUBSCRIPTION_MODELS[resolveClaudeSubscriptionModelId(model)];

export const buildClaudeBridgePayload = (request: ClaudeResponsesRequest): ClaudeBridgePayload => {
  const { functions, unsupported } = extractClaudeCodexTools(request.tools);
  return {
    codex_instructions: request.instructions,
    conversation: normalizeClaudeConversation(request.input),
    available_tools: functions,
    unsupported_codex_tool_types: unsupported,
    response_rule:
      functions.length > 0
        ? 'Return one final response or request exactly one available tool.'
        : 'No callable tools are available; return a final response.'
  };
};

export type Sub2ApiTarget =
  | {
      upstream: 'claude';
      modelId: ClaudeSubscriptionModel;
      cliModel: ClaudeCliModel;
      effort: ClaudeEffort;
    }
  | { upstream: 'codex'; modelId: CodexRuntimeModel; effort: CodexRuntimeEffort };

export const isCodexUpstreamModel = (model: string): model is CodexRuntimeModel =>
  (CODEX_RUNTIME_MODELS as readonly string[]).includes(model);

export const isClaudeUpstreamModel = (model: string): model is ClaudeSubscriptionModel =>
  Object.prototype.hasOwnProperty.call(CLAUDE_SUBSCRIPTION_MODELS, model);

export const claudeUpstreamTarget = (
  request: ClaudeResponsesRequest
): Extract<Sub2ApiTarget, { upstream: 'claude' }> => {
  const modelId = resolveClaudeSubscriptionModelId(request.model);
  return {
    upstream: 'claude',
    modelId,
    cliModel: CLAUDE_SUBSCRIPTION_MODELS[modelId],
    // The CLI ladder has one rung fewer than the client's, so its two lowest client
    // rungs share `low`. Collapsing at the bottom keeps `ultra` on the CLI's `max`.
    effort: shiftClientEffortToUpstream(request.claudeEffort, CLAUDE_SUBSCRIPTION_EFFORTS)
  };
};

/**
 * Picks the upstream from the requested model.
 *
 * Codex Desktop has a single global provider (openai/codex#29156), so this endpoint is
 * the only provider a thread can reach. Dispatching on the model name is what lets one
 * provider carry both subscriptions: `gpt-*` is served from the ChatGPT session,
 * `claude-*` from the Claude account pool, and the picker decides per thread.
 *
 * Anything unrecognised still falls back to Claude — see
 * `resolveClaudeSubscriptionModelId` for why refusing an unknown slug breaks threads
 * that predate the provider switch.
 */
export const resolveSub2ApiTarget = (request: ClaudeResponsesRequest): Sub2ApiTarget =>
  isCodexUpstreamModel(request.model)
    ? {
        upstream: 'codex',
        modelId: request.model,
        effort: clampCodexEffort(request.model, request.claudeEffort)
      }
    : claudeUpstreamTarget(request);

export interface Sub2ApiUpstreamAvailability {
  claude: boolean;
  codex: boolean;
}

/**
 * Lists only what can actually be served. Advertising a family whose upstream is not
 * connected puts an option in the client's picker that fails on first use.
 */
export const claudeSubscriptionModelCatalog = (
  availability: Sub2ApiUpstreamAvailability = { claude: true, codex: false }
) => ({
  object: 'list',
  data: [
    ...(availability.claude ? Object.keys(CLAUDE_SUBSCRIPTION_MODELS) : []),
    ...(availability.codex ? CODEX_RUNTIME_MODELS : [])
  ].map((id) => ({
    id,
    object: 'model',
    created: 0,
    owned_by: 'bitterless'
  }))
});
