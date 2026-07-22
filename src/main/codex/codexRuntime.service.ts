import { Buffer } from 'node:buffer';
import type { ModelProviderInvalidationReason } from '@shared/modelProvider/modelProvider.contract';

export const CODEX_RUNTIME_PROVIDER = 'openai-codex' as const;
export const CODEX_RUNTIME_MODELS = ['gpt-5.5', 'gpt-5.4'] as const;
export const CODEX_RUNTIME_EFFORTS = ['low', 'medium', 'high'] as const;

export type CodexRuntimeModel = (typeof CODEX_RUNTIME_MODELS)[number];
export type CodexRuntimeEffort = (typeof CODEX_RUNTIME_EFFORTS)[number];
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
  systemPrompt: string;
  prompt: string;
  maxOutputBytes: number;
  signal: AbortSignal;
}

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
}

export interface CodexRuntimePiModelRegistry {
  find(provider: string, model: string): CodexRuntimePiModel | undefined;
  hasConfiguredAuth(model: CodexRuntimePiModel): boolean;
}

export interface CodexRuntimePiMessage {
  role?: string;
  stopReason?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  errorMessage?: string;
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

export interface CodexRuntimePiSession {
  model?: CodexRuntimePiModel;
  thinkingLevel?: string;
  subscribe(listener: (event: CodexRuntimePiSessionEvent) => void): undefined | (() => void);
  prompt(message: string): Promise<unknown>;
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
  ModelRegistry: {
    create(authStorage: unknown, modelsPath?: string): CodexRuntimePiModelRegistry;
  };
  SessionManager: { inMemory(): unknown };
  SettingsManager: { inMemory(settings: Record<string, unknown>): unknown };
  createExtensionRuntime(): unknown;
  createAgentSession(options: Record<string, unknown>): Promise<{ session: CodexRuntimePiSession }>;
}

export interface CodexRuntimeDependencies {
  authPath(): string;
  modelsPath(): string;
  loadPiModule(): Promise<CodexRuntimePiModule>;
}

export class CodexRuntimeError extends Error {
  constructor(readonly code: CodexRuntimeErrorCode) {
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

const throwIfAuthRequired = (value: unknown): void => {
  const reason = classifyCodexRuntimeAuthError(value);
  if (reason) throw new CodexRuntimeAuthRequiredError(reason);
};

interface BoundedMessageText {
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

const extractMessageText = (
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

const assertTarget = (
  model: CodexRuntimePiModel | undefined,
  expectedModel: CodexRuntimeModel
): void => {
  const provider = model?.provider ?? model?.providerId;
  const modelId = model?.id ?? model?.modelId;
  if (provider !== CODEX_RUNTIME_PROVIDER || modelId !== expectedModel) {
    throw new CodexRuntimeError('model-mismatch');
  }
};

const createSterileResourceLoader = (
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

const waitForSession = async (
  creation: Promise<{ session: CodexRuntimePiSession }>,
  signal: AbortSignal
): Promise<CodexRuntimePiSession> => {
  if (signal.aborted) throw new CodexRuntimeError('cancelled');
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(new CodexRuntimeError('cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = () => signal.removeEventListener('abort', onAbort);
  });
  try {
    return (await Promise.race([creation, aborted])).session;
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
  } finally {
    removeAbort();
  }
};

const waitForPrompt = async (
  session: CodexRuntimePiSession,
  prompt: string,
  signal: AbortSignal,
  abortSession: () => void
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
    promptPromise = Promise.resolve(session.prompt(prompt));
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
    if (!CODEX_RUNTIME_MODELS.includes(input.model)) {
      throw new CodexRuntimeError('model-mismatch');
    }
    if (!CODEX_RUNTIME_EFFORTS.includes(input.effort)) {
      throw new CodexRuntimeError('effort-mismatch');
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
      pi = await this.dependencies.loadPiModule();
    } catch {
      throw new CodexRuntimeError('runtime-unavailable');
    }

    let authStorage: unknown;
    let modelRegistry: CodexRuntimePiModelRegistry;
    let model: CodexRuntimePiModel | undefined;
    try {
      authStorage = pi.AuthStorage.create(this.dependencies.authPath());
      modelRegistry = pi.ModelRegistry.create(authStorage, this.dependencies.modelsPath());
      model = modelRegistry.find(CODEX_RUNTIME_PROVIDER, input.model);
    } catch {
      throw new CodexRuntimeError('runtime-unavailable');
    }
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
      creation = pi.createAgentSession({
        model,
        authStorage,
        modelRegistry,
        thinkingLevel: input.effort,
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
    const providerErrorDetails: string[] = [];
    let providerErrorDetailsLength = 0;
    let outputLimit = false;
    let toolViolation = false;
    let abortRequested = false;

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

    try {
      session = await waitForSession(creation, input.signal);
      assertTarget(session.model ?? model, input.model);
      if (session.thinkingLevel !== undefined && session.thinkingLevel !== input.effort) {
        throw new CodexRuntimeError('effort-mismatch');
      }

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
          toolViolation = toolViolation || hasToolContent(event.message);
          if (toolViolation) abortSession();
          acceptFinalMessage(event.message);
          stopReason = event.message.stopReason ?? stopReason;
          providerError = providerError || Boolean(event.message.errorMessage);
          if (event.message.errorMessage) appendProviderErrorDetail(event.message.errorMessage);
        }
      });

      await waitForPrompt(session, input.prompt, input.signal, abortSession);
      if (input.signal.aborted) throw new CodexRuntimeError('cancelled');
      if (toolViolation) throw new CodexRuntimeError('tool-violation');
      if (outputLimit) throw new CodexRuntimeError('output-limit');
      if (providerError || ['error', 'length', 'aborted'].includes(stopReason)) {
        throwIfAuthRequired(providerErrorDetails.join('\n'));
        throw new CodexRuntimeError('provider-error');
      }

      const text = finalText || streamed;
      if (!text) throw new CodexRuntimeError('provider-error');
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
      throw new CodexRuntimeError('provider-error');
    } finally {
      unsubscribe?.();
      session?.dispose();
    }
  }
}
