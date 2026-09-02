import { Buffer } from 'node:buffer';
import type { SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { ModelProviderInvalidationReason } from '@shared/modelProvider/modelProvider.contract';
import { sanitizeDiagnostic } from '@shared/diagnostics/diagnostic.service';

export const CODEX_RUNTIME_PROVIDER = 'openai-codex' as const;
export const CODEX_RUNTIME_MODELS = [
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
] as const;
/** pi's own ladder (`EXTENDED_THINKING_LEVELS` minus `off`), not the client's. */
export const CODEX_RUNTIME_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const;
export const CODEX_RUNTIME_SERVICE_TIERS = ['fast'] as const;

export type CodexRuntimeModel = (typeof CODEX_RUNTIME_MODELS)[number];
export type CodexRuntimeEffort = (typeof CODEX_RUNTIME_EFFORTS)[number];
export type CodexRuntimeServiceTier = (typeof CODEX_RUNTIME_SERVICE_TIERS)[number];
export type CodexRuntimeThinkingLevel = 'off' | CodexRuntimeEffort;
/**
 * Per-model levels, read from what Codex 0.151 itself publishes for these models — its
 * built-in catalogue is embedded in the desktop core. An earlier hand-written guess
 * had `gpt-5.6-sol` at `medium|high|xhigh`; it is in fact `low..ultra`, so both ends
 * of that range were wrong.
 *
 * `ultra` is deliberately absent even where Codex publishes it: this runtime reaches
 * the model through pi, whose thinking level stops at `max`. Declaring a level the
 * transport cannot express puts an option in the picker that fails on selection.
 */
/**
 * The levels pi will actually send, taken from each model's `thinkingLevelMap` in
 * `pi-ai/dist/providers/openai-codex.models.js`: `getSupportedThinkingLevels` admits
 * `xhigh` and `max` only when the map names them, so `gpt-5.5` — whose map is
 * `{ xhigh, minimal }` — has no `max` and stops one rung short of the others.
 *
 * Passing a level pi does not know is worse than an error: `clampThinkingLevel` falls
 * back to `availableLevels[0]`, the *lowest* rung, silently.
 */
export const CODEX_RUNTIME_MODEL_EFFORTS = {
  'gpt-5.5': ['minimal', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.6-luna': ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-sol': ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-terra': ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
} as const satisfies Record<CodexRuntimeModel, readonly CodexRuntimeEffort[]>;

/**
 * The **client** rung a new thread opens at. Codex publishes `medium`/`low` on its own
 * ladder; after the rank shift those sit one rung higher in the client's vocabulary.
 */
export const CODEX_RUNTIME_MODEL_DEFAULT_EFFORT = {
  'gpt-5.5': 'high',
  'gpt-5.6-luna': 'high',
  'gpt-5.6-sol': 'medium',
  'gpt-5.6-terra': 'high'
} as const satisfies Record<CodexRuntimeModel, string>;

/** Context budgets Codex publishes for these models. */
export const CODEX_RUNTIME_MODEL_CONTEXT_WINDOW = {
  'gpt-5.5': 272_000,
  'gpt-5.6-luna': 272_000,
  'gpt-5.6-sol': 272_000,
  'gpt-5.6-terra': 272_000
} as const satisfies Record<CodexRuntimeModel, number>;

/** Codex stretches 5.6 models past the planning budget; 5.5 does not. */
export const CODEX_RUNTIME_MODEL_MAX_CONTEXT_WINDOW = {
  'gpt-5.5': 272_000,
  'gpt-5.6-luna': 872_000,
  'gpt-5.6-sol': 872_000,
  'gpt-5.6-terra': 872_000
} as const satisfies Record<CodexRuntimeModel, number>;
export type CodexRuntimeErrorCode =
  | 'cancelled'
  | 'effort-mismatch'
  | 'model-mismatch'
  | 'not-configured'
  | 'output-limit'
  | 'provider-error'
  | 'runtime-unavailable'
  | 'tool-violation';

export interface CodexRuntimeRunInput {
  model: CodexRuntimeModel;
  effort: CodexRuntimeEffort;
  thinkingLevel?: CodexRuntimeThinkingLevel;
  serviceTier?: CodexRuntimeServiceTier;
  allowModelNetwork?: boolean;
  systemPrompt: string;
  prompt: string;
  maxOutputBytes: number;
  signal: AbortSignal;
  onStage?: (stage: CodexRuntimeStage) => void;
}

export type CodexRuntimeStage =
  | 'pi-load-started'
  | 'pi-load-completed'
  | 'target-context-started'
  | 'target-context-completed'
  | 'session-create-started'
  | 'session-create-completed'
  | 'prompt-started'
  | 'prompt-completed';

export interface CodexRuntimeRunResult {
  provider: typeof CODEX_RUNTIME_PROVIDER;
  model: CodexRuntimeModel;
  effort: CodexRuntimeEffort;
  text: string;
}

export interface CodexRuntimePiModel {
  provider?: string;
  providerId?: string;
  id?: string;
  modelId?: string;
  /**
   * pi thinking level → the effort string pi puts on the wire.
   *
   * Do not try to reach `ultra` through this. Codex's published catalog lists `ultra`
   * for `gpt-5.6-sol` and `gpt-5.6-terra`, and overriding this map does put it on the
   * wire — where the API rejects it outright:
   *
   * > `[reasoning.effort] [invalid_enum_value] Invalid value: 'ultra'. Supported
   * > values are: 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', and 'max'.`
   *
   * Verified against the live subscription on 2026-08-31. `max` is this upstream's
   * ceiling; whatever Desktop does with its own `ultra` rung, it is not this field.
   */
  thinkingLevelMap?: Record<string, string>;
}

export interface CodexRuntimePiModelRegistry {
  find(provider: string, model: string): CodexRuntimePiModel | undefined;
  hasConfiguredAuth(model: CodexRuntimePiModel): boolean;
  refresh?(): Promise<void>;
}

export interface CodexRuntimePiModelRuntime {
  getModel?(provider: string, model: string): CodexRuntimePiModel | undefined;
  hasConfiguredAuth(provider: string): boolean;
}

export interface CodexRuntimePiLegacyModelRegistryFactory {
  create(authStorage: unknown, modelsPath?: string): CodexRuntimePiModelRegistry;
}

export interface CodexRuntimePiModernModelRegistryFactory {
  new (modelRuntime: CodexRuntimePiModelRuntime): CodexRuntimePiModelRegistry;
}

export interface CodexRuntimePiMessage {
  role?: string;
  stopReason?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  errorMessage?: string;
  diagnostics?: CodexRuntimePiDiagnostic[];
}

export interface CodexRuntimePiDiagnostic {
  type?: string;
  error?: {
    name?: unknown;
    message?: unknown;
    code?: unknown;
  };
  details?: Record<string, unknown>;
}

export interface CodexRuntimePiSessionEvent {
  type?: string;
  message?: CodexRuntimePiMessage;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
    reason?: string;
    message?: CodexRuntimePiMessage;
    error?: CodexRuntimePiMessage;
  };
}

export type CodexRuntimePiOnPayload = (payload: unknown, model: unknown) => unknown | Promise<unknown>;

export interface CodexRuntimePiAgent {
  onPayload?: CodexRuntimePiOnPayload;
  onResponse?: SimpleStreamOptions['onResponse'];
}

export interface CodexRuntimePiSession {
  model?: CodexRuntimePiModel;
  thinkingLevel?: string;
  agent?: CodexRuntimePiAgent;
  subscribe(listener: (event: CodexRuntimePiSessionEvent) => void): undefined | (() => void);
  prompt(message: string, options?: Record<string, unknown>): Promise<unknown>;
  abort(): Promise<void>;
  dispose(): void;
}

export interface CodexRuntimePiResourceLoader {
  getExtensions(): unknown;
  getSkills(): unknown;
  getPrompts(): unknown;
  getThemes(): unknown;
  getAgentsFiles(): unknown;
  getSystemPrompt(): string;
  getAppendSystemPrompt(): string[];
  extendResources(): void;
  reload(): Promise<void>;
}

export interface CodexRuntimePiModule {
  AuthStorage: { create(path: string): unknown };
  ModelRuntime?: {
    create(options?: {
      authPath?: string;
      modelsPath?: string | null;
      allowModelNetwork?: boolean;
    }): Promise<CodexRuntimePiModelRuntime>;
  };
  ModelRegistry:
    | CodexRuntimePiLegacyModelRegistryFactory
    | CodexRuntimePiModernModelRegistryFactory;
  SessionManager: { inMemory(): unknown };
  SettingsManager: { inMemory(settings: Record<string, unknown>): unknown };
  createExtensionRuntime(): unknown;
  defineTool?(definition: Record<string, unknown>): unknown;
  createAgentSession(options: Record<string, unknown>): Promise<{ session: CodexRuntimePiSession }>;
}

export interface CodexRuntimeDependencies {
  authPath(): string;
  modelsPath(): string;
  loadPiModule(): Promise<CodexRuntimePiModule>;
}

export type CodexRuntimeDiagnosticCategory =
  | 'auth'
  | 'http'
  | 'provider'
  | 'provider-unknown'
  | 'rate-limit'
  | 'response'
  | 'runtime'
  | 'timeout'
  | 'transport';

export type CodexRuntimeDiagnosticTransport = 'auto' | 'sse' | 'ws' | 'ws-cache';
export type CodexRuntimeDiagnosticProviderPhase = 'after-stream' | 'before-stream';

export interface CodexRuntimeDiagnosticEvidence {
  category: CodexRuntimeDiagnosticCategory;
  configuredTransport?: CodexRuntimeDiagnosticTransport;
  fallbackTransport?: CodexRuntimeDiagnosticTransport;
  providerPhase?: CodexRuntimeDiagnosticProviderPhase;
  httpStatus?: number;
  errorName?: string;
  errorCode?: string;
  detail?: string;
}

export interface CodexRuntimeDiagnosticSummary {
  transportDiagnostic?: CodexRuntimeDiagnosticEvidence;
  terminalDiagnostic?: CodexRuntimeDiagnosticEvidence;
}

export class CodexRuntimeError extends Error {
  constructor(
    readonly code: CodexRuntimeErrorCode,
    readonly diagnostic?: CodexRuntimeDiagnosticSummary
  ) {
    super(code);
    this.name = 'CodexRuntimeError';
  }
}

export class CodexRuntimeAuthRequiredError extends CodexRuntimeError {
  readonly kind = 'auth-required' as const;

  constructor(readonly reason: ModelProviderInvalidationReason) {
    super('provider-error');
    this.name = 'CodexRuntimeAuthRequiredError';
  }
}

const AUTH_ERROR_TEXT_LIMIT = 4_096;
const AUTH_ERROR_MAX_DEPTH = 6;
const AUTH_ERROR_MAX_VALUES = 64;
const AUTH_ERROR_VALUE_FIELDS = [
  'name',
  'code',
  'status',
  'statusCode',
  'type',
  'message',
  'errorMessage',
  'error_description'
] as const;
const AUTH_ERROR_NESTED_FIELDS = ['error', 'response', 'cause', 'data', 'body', 'details'] as const;

const authErrorText = (value: unknown): string => {
  const parts: string[] = [];
  const seen = new WeakSet<object>();
  let length = 0;
  let values = 0;

  const append = (candidate: string | number): void => {
    if (length >= AUTH_ERROR_TEXT_LIMIT || values >= AUTH_ERROR_MAX_VALUES) return;
    const text = String(candidate).trim();
    if (!text) return;
    const remaining = AUTH_ERROR_TEXT_LIMIT - length;
    const bounded = text.slice(0, remaining);
    parts.push(bounded);
    length += bounded.length + 1;
    values += 1;
  };

  const readField = (record: Record<string, unknown>, field: string): unknown => {
    try {
      return record[field];
    } catch {
      return undefined;
    }
  };

  const visit = (candidate: unknown, depth: number): void => {
    if (
      depth > AUTH_ERROR_MAX_DEPTH ||
      length >= AUTH_ERROR_TEXT_LIMIT ||
      values >= AUTH_ERROR_MAX_VALUES
    ) {
      return;
    }
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      append(candidate);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    if (seen.has(candidate)) return;
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      for (let index = 0; index < Math.min(candidate.length, 8); index += 1) {
        visit(candidate[index], depth + 1);
      }
      return;
    }

    const record = candidate as Record<string, unknown>;
    for (const field of AUTH_ERROR_VALUE_FIELDS) {
      const fieldValue = readField(record, field);
      if (typeof fieldValue === 'string' || typeof fieldValue === 'number') append(fieldValue);
    }
    for (const field of AUTH_ERROR_NESTED_FIELDS) {
      visit(readField(record, field), depth + 1);
    }
  };

  visit(value, 0);
  return parts.join(' ').slice(0, AUTH_ERROR_TEXT_LIMIT);
};

export const classifyCodexRuntimeAuthError = (
  value: unknown
): ModelProviderInvalidationReason | null => {
  const text = authErrorText(value);
  if (!text) return null;

  if (/\binvalid[_-]?grant\b/i.test(text)) return 'invalid-grant';
  if (
    /\b(?:token|credentials?|oauth|authentication)\b[^\n]{0,80}\b(?:revoked|invalidated)\b/i.test(
      text
    )
  ) {
    return 'revoked';
  }
  if (/\b(?:invalid[_-]?token|token[_ -]invalid|invalid authentication token)\b/i.test(text)) {
    return 'invalid-token';
  }
  const ambiguousExpiry =
    /\b(?:token|credentials?|oauth|authentication|session)\b[^\n]{0,80}\b(?:may|might|could)(?:\s+have)?\s+expired\b/i.test(
      text
    ) ||
    /\bexpired\b[^\n]{0,80}\b(?:or|and)\b[^\n]{0,80}\bnetwork(?:\s+is)?\s+unavailable\b/i.test(
      text
    );
  if (
    !ambiguousExpiry &&
    /\b(?:token|credentials?|oauth|authentication|session)\b[^\n]{0,80}\bexpired\b|\bexpired\b[^\n]{0,80}\b(?:token|credentials?|oauth|authentication|session)\b/i.test(
      text
    )
  ) {
    return 'expired';
  }
  if (!ambiguousExpiry && /\bexpired or incomplete\b/i.test(text)) return 'expired';
  if (/\b401\b/i.test(text)) return 'unauthorized';
  if (
    /\b(?:no provider credentials?|missing auth(?:entication)?|auth(?:entication)? (?:is )?missing|not configured|no api key)\b/i.test(
      text
    )
  ) {
    return 'sign-in-required';
  }

  if (
    /\b(?:403|forbidden|cloudflare|timed?\s*out|timeout|rate[ _-]?limit(?:ed|ing)?|blocked|network\s+(?:is\s+)?unavailable)\b/i.test(
      text
    )
  ) {
    return null;
  }
  if (
    /\b(?:sign[ -]?in|required to sign in|not signed in|login required|authentication required)\b/i.test(
      text
    )
  ) {
    return 'sign-in-required';
  }
  if (/\bunauthori[sz]ed\b|\bauthentication failed\b/i.test(text)) {
    return 'unauthorized';
  }
  return null;
};

export const throwIfAuthRequired = (value: unknown): void => {
  const reason = classifyCodexRuntimeAuthError(value);
  if (reason) throw new CodexRuntimeAuthRequiredError(reason);
};

const PROVIDER_ERROR_CODE_ALIASES: Record<string, string> = {
  websocket_connection_limit_reached: 'ws-limit',
  und_err_connect_timeout: 'connect-timeout',
  und_err_headers_timeout: 'headers-timeout',
  und_err_socket: 'socket-error'
};

const readDiagnosticField = (
  record: Record<string, unknown> | undefined,
  field: string
): unknown => {
  if (!record) return undefined;
  try {
    return record[field];
  } catch {
    return undefined;
  }
};

const diagnosticStatus = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
};

const diagnosticIdentifier = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, 12);
  if (typeof value !== 'string') return undefined;
  const candidate = value.trim();
  if (!candidate || candidate.length > 64 || !/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(candidate)) {
    return undefined;
  }
  const alias = PROVIDER_ERROR_CODE_ALIASES[candidate.toLowerCase()];
  if (alias) return alias;
  if (candidate.length >= 24) return undefined;
  const sanitized = sanitizeDiagnostic(candidate, 32);
  return sanitized && sanitized !== '***' ? sanitized : undefined;
};

const transportValue = (value: unknown): CodexRuntimeDiagnosticTransport | undefined => {
  const transports: Record<string, CodexRuntimeDiagnosticTransport> = {
    auto: 'auto',
    sse: 'sse',
    websocket: 'ws',
    'websocket-cached': 'ws-cache'
  };
  return typeof value === 'string' ? transports[value] : undefined;
};

const providerPhaseValue = (
  value: unknown
): CodexRuntimeDiagnosticProviderPhase | undefined => {
  if (value === 'before_message_stream_start') return 'before-stream';
  if (value === 'after_message_stream_start') return 'after-stream';
  return undefined;
};

const categoryFromHttpStatus = (
  status: number
): CodexRuntimeDiagnosticCategory | undefined => {
  if (status === 401) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 408 || status === 504) return 'timeout';
  return status >= 400 ? 'http' : undefined;
};

const categoryFromStructuralCode = (
  code: string | undefined
): CodexRuntimeDiagnosticCategory => {
  if (code === 'ETIMEDOUT' || code === 'connect-timeout' || code === 'headers-timeout') {
    return 'timeout';
  }
  if (
    code &&
    ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'socket-error'].includes(code)
  ) {
    return 'transport';
  }
  return 'provider-unknown';
};

const canonicalProviderDetail = (category: CodexRuntimeDiagnosticCategory): string => {
  const details: Record<CodexRuntimeDiagnosticCategory, string> = {
    auth: 'authentication rejected',
    http: 'http request rejected',
    provider: 'provider request rejected',
    'provider-unknown': 'provider request failed',
    'rate-limit': 'rate limit exceeded',
    response: 'provider response invalid',
    runtime: 'runtime request failed',
    timeout: 'provider request timed out',
    transport: 'provider transport failed'
  };
  return sanitizeDiagnostic(details[category], 64);
};

const summarizeTerminalStatus = (
  status: number | undefined
): CodexRuntimeDiagnosticEvidence => {
  const category = status
    ? (categoryFromHttpStatus(status) ?? 'provider-unknown')
    : 'provider-unknown';
  return {
    category,
    ...(status ? { httpStatus: status } : {}),
    detail: canonicalProviderDetail(category)
  };
};

const summarizeCaughtProviderError = (
  value: unknown,
  observedStatus: number | undefined
): CodexRuntimeDiagnosticEvidence => {
  if (!(value instanceof Error)) return summarizeTerminalStatus(observedStatus);
  const record = value as unknown as Record<string, unknown>;
  const status =
    observedStatus ??
    diagnosticStatus(readDiagnosticField(record, 'status')) ??
    diagnosticStatus(readDiagnosticField(record, 'statusCode'));
  const errorName = diagnosticIdentifier(readDiagnosticField(record, 'name'));
  const errorCode = diagnosticIdentifier(readDiagnosticField(record, 'code'));
  const category =
    (status ? categoryFromHttpStatus(status) : undefined) ??
    categoryFromStructuralCode(errorCode);
  return {
    category,
    ...(status ? { httpStatus: status } : {}),
    ...(errorName ? { errorName } : {}),
    ...(errorCode ? { errorCode } : {}),
    detail: canonicalProviderDetail(category)
  };
};

const summarizePiTransportDiagnostic = (
  diagnostic: CodexRuntimePiDiagnostic
): CodexRuntimeDiagnosticEvidence | undefined => {
  if (diagnostic.type !== 'provider_transport_failure') return undefined;
  const error = diagnostic.error;
  const errorRecord = error as Record<string, unknown> | undefined;
  const details = diagnostic.details;
  const configuredTransport = transportValue(readDiagnosticField(details, 'configuredTransport'));
  const fallbackTransport = transportValue(readDiagnosticField(details, 'fallbackTransport'));
  const providerPhase = providerPhaseValue(readDiagnosticField(details, 'phase'));
  const errorName = diagnosticIdentifier(readDiagnosticField(errorRecord, 'name'));
  const errorCode = diagnosticIdentifier(readDiagnosticField(errorRecord, 'code'));
  return {
    category: 'transport',
    ...(configuredTransport ? { configuredTransport } : {}),
    ...(fallbackTransport ? { fallbackTransport } : {}),
    ...(providerPhase ? { providerPhase } : {}),
    ...(errorName ? { errorName } : {}),
    ...(errorCode ? { errorCode } : {}),
    detail: canonicalProviderDetail('transport')
  };
};

const summarizePiMessageTransportDiagnostic = (
  message: CodexRuntimePiMessage | undefined
): CodexRuntimeDiagnosticEvidence | undefined => {
  if (!Array.isArray(message?.diagnostics)) return undefined;
  return message.diagnostics.reduce<CodexRuntimeDiagnosticEvidence | undefined>(
    (summary, diagnostic) => summarizePiTransportDiagnostic(diagnostic) ?? summary,
    undefined
  );
};

export interface BoundedMessageText {
  text: string;
  exceeded: boolean;
}

const utf8Prefix = (value: string, maxBytes: number): BoundedMessageText => {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return { text: value, exceeded: false };
  const characters: string[] = [];
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    characters.push(character);
    bytes += characterBytes;
  }
  return { text: characters.join(''), exceeded: true };
};

export const extractMessageText = (
  message: CodexRuntimePiMessage | undefined,
  maxBytes: number
): BoundedMessageText => {
  if (!message) return { text: '', exceeded: false };
  if (typeof message.content === 'string') return utf8Prefix(message.content, maxBytes);
  if (!Array.isArray(message.content)) return { text: '', exceeded: false };
  const parts: string[] = [];
  let remainingBytes = maxBytes;
  for (const part of message.content) {
    if (part?.type !== 'text' || typeof part.text !== 'string') continue;
    const bounded = utf8Prefix(part.text, remainingBytes);
    parts.push(bounded.text);
    remainingBytes -= Buffer.byteLength(bounded.text, 'utf8');
    if (bounded.exceeded) return { text: parts.join(''), exceeded: true };
  }
  return { text: parts.join(''), exceeded: false };
};

const hasToolContent = (message?: CodexRuntimePiMessage): boolean =>
  Array.isArray(message?.content) &&
  message.content.some(
    ({ type }) => typeof type === 'string' && type.toLowerCase().includes('tool')
  );

export const assertTarget = (
  model: CodexRuntimePiModel | undefined,
  expectedModel: CodexRuntimeModel
): void => {
  const provider = model?.provider ?? model?.providerId;
  const modelId = model?.id ?? model?.modelId;
  if (provider !== CODEX_RUNTIME_PROVIDER || modelId !== expectedModel) {
    throw new CodexRuntimeError('model-mismatch');
  }
};

const CODEX_FAST_UNAVAILABLE_SENTINEL = 'bitterless-codex-fast-unavailable';
const CODEX_REASONING_NONE_UNAVAILABLE_SENTINEL = 'bitterless-codex-reasoning-none-unavailable';

const enableFastServiceTier = (session: CodexRuntimePiSession): (() => void) => {
  try {
    const agent = session.agent;
    if (!agent) throw new CodexRuntimeError('runtime-unavailable');
    const onPayload = agent.onPayload;
    let applied = false;
    const fastOnPayload: CodexRuntimePiOnPayload = async (payload, model) => {
      const transformed = onPayload ? await onPayload.call(agent, payload, model) : payload;
      const finalPayload = transformed === undefined ? payload : transformed;
      if (!finalPayload || typeof finalPayload !== 'object' || Array.isArray(finalPayload)) {
        throw new Error(CODEX_FAST_UNAVAILABLE_SENTINEL);
      }
      applied = true;
      return {
        ...(finalPayload as Record<string, unknown>),
        service_tier: 'priority'
      };
    };
    agent.onPayload = fastOnPayload;
    if (agent.onPayload !== fastOnPayload) throw new CodexRuntimeError('runtime-unavailable');
    return () => {
      if (!applied) throw new CodexRuntimeError('runtime-unavailable');
    };
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw new CodexRuntimeError('runtime-unavailable');
  }
};

const enableReasoningNone = (session: CodexRuntimePiSession): (() => void) => {
  try {
    const agent = session.agent;
    if (!agent) throw new CodexRuntimeError('runtime-unavailable');
    const onPayload = agent.onPayload;
    let applied = false;
    const reasoningNoneOnPayload: CodexRuntimePiOnPayload = async (payload, model) => {
      const transformed = onPayload ? await onPayload.call(agent, payload, model) : payload;
      const finalPayload = transformed === undefined ? payload : transformed;
      if (!finalPayload || typeof finalPayload !== 'object' || Array.isArray(finalPayload)) {
        throw new Error(CODEX_REASONING_NONE_UNAVAILABLE_SENTINEL);
      }
      applied = true;
      return {
        ...(finalPayload as Record<string, unknown>),
        reasoning: { effort: 'none' }
      };
    };
    agent.onPayload = reasoningNoneOnPayload;
    if (agent.onPayload !== reasoningNoneOnPayload) {
      throw new CodexRuntimeError('runtime-unavailable');
    }
    return () => {
      if (!applied) throw new CodexRuntimeError('runtime-unavailable');
    };
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw new CodexRuntimeError('runtime-unavailable');
  }
};

const observeProviderResponseStatus = (
  session: CodexRuntimePiSession,
  observe: (status: number) => void
): (() => void) => {
  try {
    const agent = session.agent;
    if (!agent) return () => undefined;
    const onResponse = agent.onResponse;
    const observedOnResponse: NonNullable<SimpleStreamOptions['onResponse']> = async (
      response,
      model
    ) => {
      const status = diagnosticStatus(response.status);
      if (status) observe(status);
      if (onResponse) await onResponse.call(agent, response, model);
    };
    agent.onResponse = observedOnResponse;
    if (agent.onResponse !== observedOnResponse) return () => undefined;
    return () => {
      if (agent.onResponse === observedOnResponse) agent.onResponse = onResponse;
    };
  } catch {
    return () => undefined;
  }
};

export const createSterileResourceLoader = (
  pi: CodexRuntimePiModule,
  systemPrompt: string
): CodexRuntimePiResourceLoader => ({
  getExtensions: () => ({
    extensions: [],
    errors: [],
    runtime: pi.createExtensionRuntime()
  }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => systemPrompt,
  getAppendSystemPrompt: () => [],
  extendResources: () => undefined,
  reload: async () => undefined
});

export interface CodexRuntimePiTargetContext {
  authStorage?: unknown;
  modelRuntime?: CodexRuntimePiModelRuntime;
  modelRegistry: CodexRuntimePiModelRegistry;
  model: CodexRuntimePiModel | undefined;
}

const createModernModelRegistry = (
  pi: CodexRuntimePiModule,
  modelRuntime: CodexRuntimePiModelRuntime
): CodexRuntimePiModelRegistry =>
  new (pi.ModelRegistry as CodexRuntimePiModernModelRegistryFactory)(modelRuntime);

export const createPiTargetContext = async (
  pi: CodexRuntimePiModule,
  authPath: string,
  modelsPath: string,
  modelId: CodexRuntimeModel,
  allowModelNetwork?: boolean
): Promise<CodexRuntimePiTargetContext> => {
  if (pi.ModelRuntime?.create) {
    const modelRuntime = await pi.ModelRuntime.create({
      authPath,
      modelsPath,
      allowModelNetwork
    });
    const modelRegistry = createModernModelRegistry(pi, modelRuntime);
    return {
      modelRuntime,
      modelRegistry,
      model: modelRegistry.find(CODEX_RUNTIME_PROVIDER, modelId)
    };
  }

  const authStorage = pi.AuthStorage.create(authPath);
  const modelRegistry = (pi.ModelRegistry as CodexRuntimePiLegacyModelRegistryFactory).create(
    authStorage,
    modelsPath
  );
  return {
    authStorage,
    modelRegistry,
    model: modelRegistry.find(CODEX_RUNTIME_PROVIDER, modelId)
  };
};

export const waitForAbortable = async <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => {
  void operation.catch(() => undefined);
  if (signal.aborted) throw new CodexRuntimeError('cancelled');

  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(new CodexRuntimeError('cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = () => signal.removeEventListener('abort', onAbort);
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    removeAbort();
  }
};

export const waitForSession = async (
  creation: Promise<{ session: CodexRuntimePiSession }>,
  signal: AbortSignal
): Promise<CodexRuntimePiSession> => {
  try {
    return (await waitForAbortable(creation, signal)).session;
  } catch (error) {
    if (signal.aborted) {
      void creation
        .then(async ({ session }) => {
          await session.abort().catch(() => undefined);
          session.dispose();
        })
        .catch(() => undefined);
    }
    throw error;
  }
};

export const waitForPrompt = async (
  session: CodexRuntimePiSession,
  prompt: string,
  signal: AbortSignal,
  abortSession: () => void,
  options?: Record<string, unknown>
): Promise<void> => {
  if (signal.aborted) {
    abortSession();
    throw new CodexRuntimeError('cancelled');
  }

  let aborted = false;
  let removeAbort = (): void => undefined;
  const abortedPromise = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      aborted = true;
      abortSession();
      reject(new CodexRuntimeError('cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = () => signal.removeEventListener('abort', onAbort);
    if (signal.aborted) onAbort();
  });

  if (aborted) {
    removeAbort();
    await abortedPromise;
  }

  let promptPromise: Promise<unknown>;
  try {
    promptPromise = Promise.resolve(
      options ? session.prompt(prompt, options) : session.prompt(prompt)
    );
  } catch (error) {
    removeAbort();
    throw error;
  }

  try {
    await Promise.race([promptPromise, abortedPromise]);
  } catch (error) {
    if (aborted || signal.aborted) {
      void promptPromise.catch(() => undefined);
      throw new CodexRuntimeError('cancelled');
    }
    throw error;
  } finally {
    removeAbort();
  }
};

export class CodexRuntimeService {
  constructor(private readonly dependencies: CodexRuntimeDependencies) {}

  async run(input: CodexRuntimeRunInput): Promise<CodexRuntimeRunResult> {
    const thinkingLevel = input.thinkingLevel ?? input.effort;
    const emitStage = (stage: CodexRuntimeStage): void => {
      try {
        input.onStage?.(stage);
      } catch {
        // Runtime progress observation must not affect the provider request.
      }
    };

    if (!CODEX_RUNTIME_MODELS.includes(input.model)) {
      throw new CodexRuntimeError('model-mismatch');
    }
    if (!CODEX_RUNTIME_EFFORTS.includes(input.effort)) {
      throw new CodexRuntimeError('effort-mismatch');
    }
    if (!CODEX_RUNTIME_MODEL_EFFORTS[input.model].some((effort) => effort === input.effort)) {
      throw new CodexRuntimeError('effort-mismatch');
    }
    if (thinkingLevel !== 'off' && !CODEX_RUNTIME_EFFORTS.includes(thinkingLevel)) {
      throw new CodexRuntimeError('effort-mismatch');
    }
    if (
      input.serviceTier !== undefined &&
      !CODEX_RUNTIME_SERVICE_TIERS.includes(input.serviceTier)
    ) {
      throw new CodexRuntimeError('runtime-unavailable');
    }
    if (
      !input.systemPrompt ||
      Buffer.byteLength(input.systemPrompt, 'utf8') > 8 * 1024 ||
      !input.prompt ||
      !Number.isInteger(input.maxOutputBytes) ||
      input.maxOutputBytes < 1 ||
      input.maxOutputBytes > 64 * 1024
    ) {
      throw new CodexRuntimeError('runtime-unavailable');
    }

    let pi: CodexRuntimePiModule;
    try {
      emitStage('pi-load-started');
      pi = await waitForAbortable(
        Promise.resolve().then(() => this.dependencies.loadPiModule()),
        input.signal
      );
      emitStage('pi-load-completed');
    } catch (error) {
      if (input.signal.aborted) throw new CodexRuntimeError('cancelled');
      throw new CodexRuntimeError('runtime-unavailable');
    }

    let targetContext: CodexRuntimePiTargetContext;
    try {
      emitStage('target-context-started');
      targetContext = await waitForAbortable(
        createPiTargetContext(
          pi,
          this.dependencies.authPath(),
          this.dependencies.modelsPath(),
          input.model,
          input.allowModelNetwork
        ),
        input.signal
      );
      emitStage('target-context-completed');
    } catch (error) {
      if (input.signal.aborted) throw new CodexRuntimeError('cancelled');
      throw new CodexRuntimeError('runtime-unavailable');
    }
    const { model, modelRegistry } = targetContext;
    assertTarget(model, input.model);
    if (!model || !modelRegistry.hasConfiguredAuth(model)) {
      throw new CodexRuntimeError('not-configured');
    }

    const settingsManager = pi.SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 }
    });
    let creation: Promise<{ session: CodexRuntimePiSession }>;
    try {
      emitStage('session-create-started');
      creation = pi.createAgentSession({
        model,
        ...(targetContext.modelRuntime
          ? { modelRuntime: targetContext.modelRuntime }
          : { authStorage: targetContext.authStorage, modelRegistry }),
        thinkingLevel,
        noTools: 'all',
        tools: [],
        customTools: [],
        resourceLoader: createSterileResourceLoader(pi, input.systemPrompt),
        sessionManager: pi.SessionManager.inMemory(),
        settingsManager
      });
    } catch {
      throw new CodexRuntimeError('runtime-unavailable');
    }

    let session: CodexRuntimePiSession | null = null;
    let unsubscribe: (() => void) | undefined;
    let streamed = '';
    let streamedBytes = 0;
    let finalText = '';
    let stopReason = '';
    let providerError = false;
    let transportDiagnostic: CodexRuntimeDiagnosticEvidence | undefined;
    let observedProviderStatus: number | undefined;
    // Process-local only: free-form Pi text may classify existing auth/runtime failures, but it
    // must never feed the persisted Translator diagnostic summary.
    const providerErrorDetails: string[] = [];
    let providerErrorDetailsLength = 0;
    let outputLimit = false;
    let toolViolation = false;
    let abortRequested = false;
    let assertFastServiceTierApplied = (): void => undefined;
    let assertReasoningNoneApplied = (): void => undefined;
    let restoreProviderResponseObserver = (): void => undefined;

    const abortSession = (): void => {
      if (abortRequested) return;
      abortRequested = true;
      void session?.abort().catch(() => undefined);
    };
    const markOutputLimit = (): void => {
      if (outputLimit) return;
      outputLimit = true;
      abortSession();
    };
    const appendStreamedText = (delta: string): void => {
      if (outputLimit) return;
      const deltaBytes = Buffer.byteLength(delta, 'utf8');
      if (streamedBytes + deltaBytes > input.maxOutputBytes) {
        markOutputLimit();
        return;
      }
      streamed += delta;
      streamedBytes += deltaBytes;
    };
    const acceptFinalMessage = (message: CodexRuntimePiMessage | undefined): void => {
      if (outputLimit) return;
      const bounded = extractMessageText(message, input.maxOutputBytes);
      if (bounded.exceeded) {
        markOutputLimit();
        return;
      }
      finalText = bounded.text;
    };
    const appendProviderErrorDetail = (value: string): void => {
      if (!value || providerErrorDetailsLength >= AUTH_ERROR_TEXT_LIMIT) return;
      const bounded = value.slice(0, AUTH_ERROR_TEXT_LIMIT - providerErrorDetailsLength);
      providerErrorDetails.push(bounded);
      providerErrorDetailsLength += bounded.length + 1;
    };
    const observeProviderDiagnostic = (message: CodexRuntimePiMessage | undefined): void => {
      transportDiagnostic =
        summarizePiMessageTransportDiagnostic(message) ?? transportDiagnostic;
    };
    const providerDiagnosticSummary = (
      terminal: CodexRuntimeDiagnosticEvidence
    ): CodexRuntimeDiagnosticSummary => ({
      ...(transportDiagnostic ? { transportDiagnostic } : {}),
      terminalDiagnostic: terminal
    });

    try {
      session = await waitForSession(creation, input.signal);
      emitStage('session-create-completed');
      assertTarget(session.model ?? model, input.model);
      if (session.thinkingLevel !== undefined && session.thinkingLevel !== thinkingLevel) {
        throw new CodexRuntimeError('effort-mismatch');
      }
      if (input.serviceTier === 'fast') {
        assertFastServiceTierApplied = enableFastServiceTier(session);
      }
      if (thinkingLevel === 'off') {
        assertReasoningNoneApplied = enableReasoningNone(session);
      }
      restoreProviderResponseObserver = observeProviderResponseStatus(session, (status) => {
        observedProviderStatus = status;
      });

      unsubscribe = session.subscribe((event) => {
        if (event.type?.startsWith('tool_execution_')) {
          toolViolation = true;
          abortSession();
          return;
        }
        if (event.type === 'message_update') {
          const inner = event.assistantMessageEvent;
          if (inner?.type === 'text_delta' && typeof inner.delta === 'string') {
            appendStreamedText(inner.delta);
          }
          if (inner?.type === 'done' || inner?.type === 'error') {
            const message = inner.message ?? inner.error;
            observeProviderDiagnostic(message);
            toolViolation = toolViolation || hasToolContent(message);
            if (toolViolation) abortSession();
            acceptFinalMessage(message);
            stopReason = typeof inner.reason === 'string' ? inner.reason : '';
            providerError =
              inner.type === 'error' || Boolean((inner.message ?? inner.error)?.errorMessage);
            if (message?.errorMessage) appendProviderErrorDetail(message.errorMessage);
            if (inner.type === 'error') {
              appendProviderErrorDetail(extractMessageText(message, AUTH_ERROR_TEXT_LIMIT).text);
            }
          }
        }
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          observeProviderDiagnostic(event.message);
          toolViolation = toolViolation || hasToolContent(event.message);
          if (toolViolation) abortSession();
          acceptFinalMessage(event.message);
          stopReason = event.message.stopReason ?? stopReason;
          providerError = providerError || Boolean(event.message.errorMessage);
          if (event.message.errorMessage) appendProviderErrorDetail(event.message.errorMessage);
        }
      });

      emitStage('prompt-started');
      await waitForPrompt(session, input.prompt, input.signal, abortSession);
      emitStage('prompt-completed');
      assertFastServiceTierApplied();
      assertReasoningNoneApplied();
      if (input.signal.aborted) throw new CodexRuntimeError('cancelled');
      if (toolViolation) throw new CodexRuntimeError('tool-violation');
      if (outputLimit) throw new CodexRuntimeError('output-limit');
      if (providerError || ['error', 'length', 'aborted'].includes(stopReason)) {
        throwIfAuthRequired(providerErrorDetails.join('\n'));
        if (
          providerErrorDetails.some(
            (detail) =>
              detail.includes(CODEX_FAST_UNAVAILABLE_SENTINEL) ||
              detail.includes(CODEX_REASONING_NONE_UNAVAILABLE_SENTINEL)
          )
        ) {
          throw new CodexRuntimeError('runtime-unavailable');
        }
        throw new CodexRuntimeError(
          'provider-error',
          providerDiagnosticSummary(summarizeTerminalStatus(observedProviderStatus))
        );
      }

      const text = finalText || streamed;
      if (!text) {
        throw new CodexRuntimeError(
          'provider-error',
          providerDiagnosticSummary({
            category: 'response',
            ...(observedProviderStatus ? { httpStatus: observedProviderStatus } : {}),
            detail: canonicalProviderDetail('response')
          })
        );
      }
      return {
        provider: CODEX_RUNTIME_PROVIDER,
        model: input.model,
        effort: input.effort,
        text
      };
    } catch (error) {
      if (error instanceof CodexRuntimeError) throw error;
      if (input.signal.aborted) throw new CodexRuntimeError('cancelled');
      if (toolViolation) throw new CodexRuntimeError('tool-violation');
      if (outputLimit) throw new CodexRuntimeError('output-limit');
      throwIfAuthRequired(error);
      throw new CodexRuntimeError(
        'provider-error',
        providerDiagnosticSummary(summarizeCaughtProviderError(error, observedProviderStatus))
      );
    } finally {
      restoreProviderResponseObserver();
      unsubscribe?.();
      session?.dispose();
    }
  }
}
