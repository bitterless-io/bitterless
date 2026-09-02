import { Buffer } from 'node:buffer';
import type {
  ClaudeBridgePayload,
  ClaudeDecision,
  ClaudeNormalizedCodexTool
} from '@shared/claudeSubscription/claudeSubscription.contract';
import { sanitizeDiagnostic } from '@shared/diagnostics/diagnostic.service';
import {
  CODEX_RUNTIME_MODEL_EFFORTS,
  CODEX_RUNTIME_MODELS,
  CodexRuntimeError,
  assertTarget,
  createPiTargetContext,
  createSterileResourceLoader,
  extractMessageText,
  throwIfAuthRequired,
  waitForAbortable,
  waitForPrompt,
  waitForSession,
  type CodexRuntimeDependencies,
  type CodexRuntimeEffort,
  type CodexRuntimeModel,
  type CodexRuntimePiMessage,
  type CodexRuntimePiModule,
  type CodexRuntimePiSession
} from './codexRuntime.service';

/**
 * A Codex-subscription upstream that can return a **tool call**.
 *
 * `CodexRuntimeService.run()` cannot serve this endpoint, and the difference is
 * deliberate rather than incidental: it is Translator's hardened entry point, so it
 * pins `noTools: 'all'`, treats any tool event as a `tool-violation`, caps the system
 * prompt at 8 KiB and the output at 64 KiB. Every one of those is correct there and
 * fatal here — a Codex Desktop turn carries a multi-kilobyte instruction block, an
 * unbounded transcript, and is worthless if the model cannot call `shell`.
 *
 * So this reuses `run()`'s pi plumbing (module load, auth/model resolution, abort
 * handling) and replaces its policy: the tools the client advertised are registered as
 * real pi tools whose implementations never execute anything. The first invocation
 * records its arguments and aborts the session, and that recorded call is returned to
 * the client as the turn's `function_call`. Execution stays where the protocol puts
 * it — in Codex, not in Bitterless.
 */
export interface CodexResponsesRequest {
  model: CodexRuntimeModel;
  effort: CodexRuntimeEffort;
  payload: ClaudeBridgePayload;
}

export interface CodexResponsesResult {
  decision: ClaudeDecision;
  model: CodexRuntimeModel;
  effort: CodexRuntimeEffort;
}

export interface CodexResponsesUpstream {
  isAvailable(): Promise<boolean>;
  execute(
    request: CodexResponsesRequest,
    options?: { signal?: AbortSignal }
  ): Promise<CodexResponsesResult>;
}

export interface CodexResponsesUpstreamOptions {
  maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** A `provider-error` that still carries what the provider said. */
export class CodexResponsesProviderError extends CodexRuntimeError {
  constructor(readonly detail: string) {
    super('provider-error');
    this.name = 'CodexResponsesProviderError';
  }
}

/**
 * Picks the pi thinking level for a client rung.
 *
 * Matched **by name**, not by rank: `low|medium|high|xhigh` exist on both ladders, and
 * pi pads the bottom of its own with `minimal`, so a positional mapping would push
 * every level down one. `ultra` is the only client rung with no pi level by that name,
 * and it takes pi's top — which `thinkingLevelMap` then translates onto the wire.
 */
export const clampCodexEffort = (model: CodexRuntimeModel, effort: string): CodexRuntimeEffort => {
  const ladder = CODEX_RUNTIME_MODEL_EFFORTS[model];
  const named = ladder.find((level) => level === effort);
  return named ?? (ladder[ladder.length - 1] as CodexRuntimeEffort);
};

/**
 * pi tool names travel to the provider as function names, so they must survive the
 * provider's own naming rules. Codex's `decision_name` may carry a `namespace:` prefix
 * and percent-encoding, neither of which is safe there, so a sanitized alias is
 * registered and mapped back on the way out. The client only ever sees its own name.
 */
const toolAlias = (tool: ClaudeNormalizedCodexTool, taken: Set<string>): string => {
  const base = (tool.namespace ? `${tool.namespace}_${tool.name}` : tool.name)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 60);
  const seed = base || 'tool';
  let alias = seed;
  let suffix = 1;
  while (taken.has(alias)) {
    alias = `${seed}_${suffix}`;
    suffix += 1;
  }
  taken.add(alias);
  return alias;
};

const renderContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part);
      continue;
    }
    if (typeof part !== 'object' || part === null) continue;
    const record = part as Record<string, unknown>;
    if (typeof record.text === 'string') {
      parts.push(record.text);
      continue;
    }
    if (typeof record.note === 'string') parts.push(`(${record.note})`);
  }
  return parts.join('\n');
};

/**
 * Renders the Responses transcript as text.
 *
 * Codex is stateless — it resends the whole thread every turn — so the transcript is
 * the entire context the model gets. pi takes one prompt string per turn, so the items
 * are flattened rather than replayed as a session history; tool calls and their
 * outputs stay paired and labelled so the model can still read what it already did.
 */
export const renderCodexConversation = (conversation: readonly unknown[]): string => {
  const lines: string[] = [];
  const callNames = new Map<string, string>();
  for (const item of conversation) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (record.type === 'function_call') {
      const name = typeof record.name === 'string' ? record.name : 'tool';
      if (typeof record.call_id === 'string') callNames.set(record.call_id, name);
      const args = typeof record.arguments === 'string' ? record.arguments : '{}';
      lines.push(`[assistant calls ${name}]\n${args}`);
      continue;
    }
    if (record.type === 'function_call_output') {
      const name =
        (typeof record.call_id === 'string' ? callNames.get(record.call_id) : undefined) ?? 'tool';
      lines.push(`[${name} result]\n${renderContent(record.output) || String(record.output ?? '')}`);
      continue;
    }
    if (record.type === 'reasoning') continue;
    if (record.type === 'message' || record.role !== undefined) {
      const role = typeof record.role === 'string' ? record.role : 'user';
      const text = renderContent(record.content);
      if (text) lines.push(`[${role}]\n${text}`);
      continue;
    }
    const text = renderContent(record.content);
    if (text) lines.push(text);
  }
  return lines.join('\n\n');
};

const buildSystemPrompt = (payload: ClaudeBridgePayload): string => {
  const sections = [payload.codex_instructions?.trim()].filter(
    (section): section is string => Boolean(section)
  );
  if (payload.unsupported_codex_tool_types.length > 0) {
    sections.push(
      `Tool types not forwarded by this bridge: ${payload.unsupported_codex_tool_types.join(', ')}.`
    );
  }
  sections.push(payload.response_rule);
  return sections.join('\n\n');
};

export class PiCodexResponsesUpstream implements CodexResponsesUpstream {
  readonly #maxOutputBytes: number;

  constructor(
    private readonly dependencies: CodexRuntimeDependencies,
    options: CodexResponsesUpstreamOptions = {}
  ) {
    this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  /**
   * Whether a Codex credential can actually serve a request. `/v1/models` must not
   * advertise a family that fails on first use, and the only honest answer comes from
   * resolving the credential rather than checking that a file exists.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const pi = await this.dependencies.loadPiModule();
      const context = await createPiTargetContext(
        pi,
        this.dependencies.authPath(),
        this.dependencies.modelsPath(),
        CODEX_RUNTIME_MODELS[0]
      );
      return Boolean(context.model && context.modelRegistry.hasConfiguredAuth(context.model));
    } catch {
      return false;
    }
  }

  async execute(
    request: CodexResponsesRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<CodexResponsesResult> {
    const signal = options.signal ?? new AbortController().signal;
    if (!CODEX_RUNTIME_MODELS.includes(request.model)) {
      throw new CodexRuntimeError('model-mismatch');
    }
    const effort = clampCodexEffort(request.model, request.effort);

    let pi: CodexRuntimePiModule;
    try {
      pi = await waitForAbortable(
        Promise.resolve().then(() => this.dependencies.loadPiModule()),
        signal
      );
    } catch {
      if (signal.aborted) throw new CodexRuntimeError('cancelled');
      throw new CodexRuntimeError('runtime-unavailable');
    }
    if (typeof pi.defineTool !== 'function') {
      // Without tool definitions this upstream can only chat, and a Codex Desktop
      // thread that cannot call `shell` is worse than an honest failure.
      throw new CodexRuntimeError('runtime-unavailable');
    }

    const targetContext = await waitForAbortable(
      createPiTargetContext(
        pi,
        this.dependencies.authPath(),
        this.dependencies.modelsPath(),
        request.model
      ),
      signal
    ).catch((error: unknown) => {
      if (signal.aborted) throw new CodexRuntimeError('cancelled');
      if (error instanceof CodexRuntimeError) throw error;
      throw new CodexRuntimeError('runtime-unavailable');
    });
    const { model, modelRegistry } = targetContext;
    assertTarget(model, request.model);
    if (!model || !modelRegistry.hasConfiguredAuth(model)) {
      throw new CodexRuntimeError('not-configured');
    }

    // Held in an object rather than a `let`: the only assignment happens inside the
    // tool callback, which control-flow analysis cannot see, so a bare binding narrows
    // to `null` and every later read becomes `never`.
    const capture: { value: { tool: ClaudeNormalizedCodexTool; argumentsJson: string } | null } = {
      value: null
    };
    let session: CodexRuntimePiSession | null = null;
    const abortSession = (): void => {
      void session?.abort().catch(() => undefined);
    };
    const aliases = new Set<string>();
    const customTools = request.payload.available_tools.map((tool) => {
      const alias = toolAlias(tool, aliases);
      return (pi.defineTool as (definition: Record<string, unknown>) => unknown)({
        name: alias,
        label: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (_toolCallId: string, parameters: Record<string, unknown>) => {
          // The bridge never runs the tool: the client owns execution. Recording the
          // first call and aborting turns pi's agent loop into the single decision the
          // Responses protocol expects.
          capture.value ??= { tool, argumentsJson: JSON.stringify(parameters ?? {}) };
          abortSession();
          return { content: [{ type: 'text', text: '' }] };
        }
      });
    });

    const settingsManager = pi.SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 }
    });
    let creation: Promise<{ session: CodexRuntimePiSession }>;
    try {
      creation = pi.createAgentSession({
        model,
        ...(targetContext.modelRuntime
          ? { modelRuntime: targetContext.modelRuntime }
          : { authStorage: targetContext.authStorage, modelRegistry }),
        thinkingLevel: effort,
        // 'builtin' silences pi's own read/bash/edit/write tools while keeping the
        // client's; 'all' would strip the very tools this upstream exists to forward.
        noTools: customTools.length > 0 ? 'builtin' : 'all',
        customTools,
        resourceLoader: createSterileResourceLoader(pi, buildSystemPrompt(request.payload)),
        sessionManager: pi.SessionManager.inMemory(),
        settingsManager
      });
    } catch {
      throw new CodexRuntimeError('runtime-unavailable');
    }

    let unsubscribe: (() => void) | undefined;
    let streamed = '';
    let streamedBytes = 0;
    let finalText = '';
    let stopReason = '';
    let providerError = false;
    let outputLimit = false;
    // Without this the upstream's own words are discarded and every failure arrives as
    // a bare `provider-error` — the same opaque shape that made the endpoint's 502s
    // unreadable. Bounded and sanitized: it reaches a log, not a persisted record.
    const providerErrorDetails: string[] = [];
    const noteProviderError = (message: CodexRuntimePiMessage | undefined): void => {
      if (!message || providerErrorDetails.join('').length > 2_000) return;
      const text = message.errorMessage ?? extractMessageText(message, 2_000).text;
      if (text) providerErrorDetails.push(sanitizeDiagnostic(text));
    };

    const appendStreamedText = (delta: string): void => {
      if (outputLimit) return;
      const deltaBytes = Buffer.byteLength(delta, 'utf8');
      if (streamedBytes + deltaBytes > this.#maxOutputBytes) {
        outputLimit = true;
        abortSession();
        return;
      }
      streamed += delta;
      streamedBytes += deltaBytes;
    };
    const acceptFinalMessage = (message: CodexRuntimePiMessage | undefined): void => {
      if (outputLimit) return;
      const bounded = extractMessageText(message, this.#maxOutputBytes);
      if (bounded.exceeded) {
        outputLimit = true;
        abortSession();
        return;
      }
      if (bounded.text) finalText = bounded.text;
    };

    try {
      session = await waitForSession(creation, signal);
      assertTarget(session.model ?? model, request.model);

      unsubscribe = session.subscribe((event) => {
        if (event.type === 'message_update') {
          const inner = event.assistantMessageEvent;
          if (inner?.type === 'text_delta' && typeof inner.delta === 'string') {
            appendStreamedText(inner.delta);
          }
          if (inner?.type === 'done' || inner?.type === 'error') {
            const message = inner.message ?? inner.error;
            acceptFinalMessage(message);
            stopReason = typeof inner.reason === 'string' ? inner.reason : stopReason;
            if (inner.type === 'error' || message?.errorMessage) noteProviderError(message);
            providerError = providerError || inner.type === 'error' || Boolean(message?.errorMessage);
          }
        }
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          acceptFinalMessage(event.message);
          stopReason = event.message.stopReason ?? stopReason;
          if (event.message.errorMessage) noteProviderError(event.message);
          providerError = providerError || Boolean(event.message.errorMessage);
        }
      });

      // Images ride `PromptOptions.images`, which is the only structured channel pi
      // offers — `prompt()` itself takes a plain string. PDFs have no equivalent, so a
      // document reaches the model as its marker text and nothing more; that gap is
      // pi's, not this bridge's, and is stated in the payload rather than hidden.
      const images = (request.payload.media ?? [])
        .filter((block) => block.type === 'image')
        .map((block) => ({
          type: 'image' as const,
          data: block.source.data,
          mimeType: block.source.media_type
        }));
      await waitForPrompt(
        session,
        renderCodexConversation(request.payload.conversation),
        signal,
        abortSession,
        images.length > 0 ? { images } : undefined
      );
    } catch (error) {
      // A captured tool call is the reason the session was aborted, so it is a result,
      // not a failure — the abort must not be reported as one.
      if (!capture.value) {
        if (error instanceof CodexRuntimeError) throw error;
        if (signal.aborted) throw new CodexRuntimeError('cancelled');
        if (outputLimit) throw new CodexRuntimeError('output-limit');
        throwIfAuthRequired(error);
        throw new CodexResponsesProviderError(
          providerErrorDetails.join(' | ') ||
            sanitizeDiagnostic(error instanceof Error ? error.message : String(error))
        );
      }
    } finally {
      unsubscribe?.();
      session?.dispose();
    }

    const toolCall = capture.value;
    if (toolCall) {
      return {
        model: request.model,
        effort,
        decision: {
          action: 'tool_call',
          toolName: toolCall.tool.name,
          ...(toolCall.tool.namespace ? { toolNamespace: toolCall.tool.namespace } : {}),
          argumentsJson: toolCall.argumentsJson
        }
      };
    }
    if (signal.aborted) throw new CodexRuntimeError('cancelled');
    if (outputLimit) throw new CodexRuntimeError('output-limit');
    if (providerError || ['error', 'aborted'].includes(stopReason)) {
      throw new CodexResponsesProviderError(providerErrorDetails.join(' | '));
    }
    const text = finalText || streamed;
    if (!text) throw new CodexRuntimeError('provider-error');
    return { model: request.model, effort, decision: { action: 'final', text } };
  }
}
