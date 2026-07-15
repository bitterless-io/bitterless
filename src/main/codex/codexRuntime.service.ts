import { Buffer } from 'node:buffer';

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

const extractMessageText = (message?: CodexRuntimePiMessage): string => {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
};

const hasToolContent = (message?: CodexRuntimePiMessage): boolean =>
  Array.isArray(message?.content) && message.content.some(({ type }) =>
    typeof type === 'string' && type.toLowerCase().includes('tool'));

const assertTarget = (
  model: CodexRuntimePiModel | undefined,
  expectedModel: CodexRuntimeModel,
): void => {
  const provider = model?.provider ?? model?.providerId;
  const modelId = model?.id ?? model?.modelId;
  if (provider !== CODEX_RUNTIME_PROVIDER || modelId !== expectedModel) {
    throw new CodexRuntimeError('model-mismatch');
  }
};

const createSterileResourceLoader = (
  pi: CodexRuntimePiModule,
  systemPrompt: string,
): CodexRuntimePiResourceLoader => ({
  getExtensions: () => ({
    extensions: [],
    errors: [],
    runtime: pi.createExtensionRuntime(),
  }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => systemPrompt,
  getAppendSystemPrompt: () => [],
  extendResources: () => undefined,
  reload: async () => undefined,
});

const waitForSession = async (
  creation: Promise<{ session: CodexRuntimePiSession }>,
  signal: AbortSignal,
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
      void creation.then(async ({ session }) => {
        await session.abort().catch(() => undefined);
        session.dispose();
      }).catch(() => undefined);
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
      retry: { enabled: false, maxRetries: 0 },
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
        settingsManager,
      });
    } catch {
      throw new CodexRuntimeError('runtime-unavailable');
    }

    let session: CodexRuntimePiSession | null = null;
    let unsubscribe: (() => void) | undefined;
    let streamed = '';
    let finalText = '';
    let stopReason = '';
    let providerError = false;
    let outputLimit = false;
    let toolViolation = false;

    const acceptText = (value: string): void => {
      if (Buffer.byteLength(value, 'utf8') > input.maxOutputBytes) {
        outputLimit = true;
        void session?.abort().catch(() => undefined);
      }
    };

    try {
      session = await waitForSession(creation, input.signal);
      assertTarget(session.model ?? model, input.model);
      if (session.thinkingLevel !== undefined && session.thinkingLevel !== input.effort) {
        throw new CodexRuntimeError('effort-mismatch');
      }

      const onAbort = (): void => {
        void session?.abort().catch(() => undefined);
      };
      input.signal.addEventListener('abort', onAbort, { once: true });
      unsubscribe = session.subscribe((event) => {
        if (event.type?.startsWith('tool_execution_')) {
          toolViolation = true;
          void session?.abort().catch(() => undefined);
          return;
        }
        if (event.type === 'message_update') {
          const inner = event.assistantMessageEvent;
          if (inner?.type === 'text_delta' && typeof inner.delta === 'string') {
            streamed += inner.delta;
            acceptText(streamed);
          }
          if (inner?.type === 'done' || inner?.type === 'error') {
            const message = inner.message ?? inner.error;
            toolViolation = toolViolation || hasToolContent(message);
            finalText = extractMessageText(message);
            stopReason = typeof inner.reason === 'string' ? inner.reason : '';
            providerError = inner.type === 'error' || Boolean((inner.message ?? inner.error)?.errorMessage);
            acceptText(finalText);
          }
        }
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          toolViolation = toolViolation || hasToolContent(event.message);
          finalText = extractMessageText(event.message);
          stopReason = event.message.stopReason ?? stopReason;
          providerError = providerError || Boolean(event.message.errorMessage);
          acceptText(finalText);
        }
      });

      try {
        await session.prompt(input.prompt);
      } finally {
        input.signal.removeEventListener('abort', onAbort);
      }
      if (input.signal.aborted) throw new CodexRuntimeError('cancelled');
      if (toolViolation) throw new CodexRuntimeError('tool-violation');
      if (outputLimit) throw new CodexRuntimeError('output-limit');
      if (providerError || ['error', 'length', 'aborted'].includes(stopReason)) {
        throw new CodexRuntimeError('provider-error');
      }

      const text = finalText || streamed;
      acceptText(text);
      if (outputLimit) throw new CodexRuntimeError('output-limit');
      if (!text) throw new CodexRuntimeError('provider-error');
      return {
        provider: CODEX_RUNTIME_PROVIDER,
        model: input.model,
        effort: input.effort,
        text,
      };
    } catch (error) {
      if (error instanceof CodexRuntimeError) throw error;
      if (input.signal.aborted) throw new CodexRuntimeError('cancelled');
      if (toolViolation) throw new CodexRuntimeError('tool-violation');
      if (outputLimit) throw new CodexRuntimeError('output-limit');
      throw new CodexRuntimeError('provider-error');
    } finally {
      unsubscribe?.();
      session?.dispose();
    }
  }
}
