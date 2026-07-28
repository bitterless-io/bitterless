import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexRuntimeError,
  CodexRuntimeService,
  type CodexRuntimePiModule,
  type CodexRuntimePiSession,
} from '../../../src/main/codex/codexRuntime.service';

const createPi = (
  session: CodexRuntimePiSession,
  capture: (options: Record<string, unknown>) => void,
): CodexRuntimePiModule => ({
  AuthStorage: { create: () => ({}) },
  ModelRegistry: {
    create: () => ({
      find: () => ({ provider: 'openai-codex', id: 'gpt-5.5' }),
      hasConfiguredAuth: () => true,
    }),
  },
  SessionManager: { inMemory: () => ({ kind: 'memory' }) },
  SettingsManager: { inMemory: (settings) => settings },
  createExtensionRuntime: () => ({}),
  createAgentSession: async (options) => {
    capture(options);
    return { session };
  },
});

test('creates a sterile in-memory Codex session with all tools disabled', async () => {
  let listener: Parameters<CodexRuntimePiSession['subscribe']>[0] = () => undefined;
  let options: Record<string, unknown> = {};
  const session: CodexRuntimePiSession = {
    model: { provider: 'openai-codex', id: 'gpt-5.5' },
    thinkingLevel: 'high',
    subscribe: (value) => {
      listener = value;
      return () => undefined;
    },
    prompt: async () => {
      listener({
        type: 'message_end',
        message: { role: 'assistant', content: '{"ok":true}', stopReason: 'stop' },
      });
    },
    abort: async () => undefined,
    dispose: () => undefined,
  };
  const runtime = new CodexRuntimeService({
    authPath: () => '/private/auth.json',
    modelsPath: () => '/private/models.json',
    loadPiModule: async () => createPi(session, (value) => { options = value; }),
  });

  const result = await runtime.run({
    model: 'gpt-5.5',
    effort: 'high',
    systemPrompt: 'Return strict JSON.',
    prompt: '{"evidence":[]}',
    maxOutputBytes: 1024,
    signal: new AbortController().signal,
  });

  assert.equal(result.text, '{"ok":true}');
  assert.equal(options.noTools, 'all');
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.customTools, []);
  assert.deepEqual(options.sessionManager, { kind: 'memory' });
  const loader = options.resourceLoader as {
    getSkills(): unknown;
    getPrompts(): unknown;
    getAgentsFiles(): unknown;
    getSystemPrompt(): string;
  };
  assert.deepEqual(loader.getSkills(), { skills: [], diagnostics: [] });
  assert.deepEqual(loader.getPrompts(), { prompts: [], diagnostics: [] });
  assert.deepEqual(loader.getAgentsFiles(), { agentsFiles: [] });
  assert.equal(loader.getSystemPrompt(), 'Return strict JSON.');
});

test('maps an explicit Fast tier into the final provider payload', async () => {
  let listener: Parameters<CodexRuntimePiSession['subscribe']>[0] = () => undefined;
  let capturedPayload: unknown;
  const agent = {
    onPayload: async (payload: unknown) => {
      return {
        ...(payload as Record<string, unknown>),
        extensionMarker: 'kept',
      };
    },
  };
  const session: CodexRuntimePiSession = {
    agent,
    model: { provider: 'openai-codex', id: 'gpt-5.5' },
    thinkingLevel: 'low',
    subscribe: (value) => {
      listener = value;
      return () => undefined;
    },
    prompt: async () => {
      capturedPayload = await agent.onPayload({ model: 'gpt-5.5', store: false }, session.model);
      listener({
        type: 'message_end',
        message: { role: 'assistant', content: '{"ok":true}', stopReason: 'stop' },
      });
    },
    abort: async () => undefined,
    dispose: () => undefined,
  };
  const runtime = new CodexRuntimeService({
    authPath: () => '/private/auth.json',
    modelsPath: () => '/private/models.json',
    loadPiModule: async () => createPi(session, () => undefined),
  });

  await runtime.run({
    model: 'gpt-5.5',
    effort: 'low',
    serviceTier: 'fast',
    systemPrompt: 'Return strict JSON.',
    prompt: '{"evidence":[]}',
    maxOutputBytes: 1024,
    signal: new AbortController().signal,
  });

  assert.deepEqual(capturedPayload, {
    model: 'gpt-5.5',
    store: false,
    extensionMarker: 'kept',
    service_tier: 'priority',
  });
});

test('leaves the provider payload hook unchanged without a Fast selection', async () => {
  let listener: Parameters<CodexRuntimePiSession['subscribe']>[0] = () => undefined;
  let capturedPayload: unknown;
  const originalOnPayload = async (payload: unknown) => {
    capturedPayload = payload;
    return payload;
  };
  const agent = { onPayload: originalOnPayload };
  const session: CodexRuntimePiSession = {
    agent,
    model: { provider: 'openai-codex', id: 'gpt-5.5' },
    thinkingLevel: 'low',
    subscribe: (value) => {
      listener = value;
      return () => undefined;
    },
    prompt: async () => {
      await agent.onPayload({ model: 'gpt-5.5', store: false }, session.model);
      listener({
        type: 'message_end',
        message: { role: 'assistant', content: '{"ok":true}', stopReason: 'stop' },
      });
    },
    abort: async () => undefined,
    dispose: () => undefined,
  };
  const runtime = new CodexRuntimeService({
    authPath: () => '/private/auth.json',
    modelsPath: () => '/private/models.json',
    loadPiModule: async () => createPi(session, () => undefined),
  });

  await runtime.run({
    model: 'gpt-5.5',
    effort: 'low',
    systemPrompt: 'Return strict JSON.',
    prompt: '{"evidence":[]}',
    maxOutputBytes: 1024,
    signal: new AbortController().signal,
  });

  assert.equal(agent.onPayload, originalOnPayload);
  assert.deepEqual(capturedPayload, { model: 'gpt-5.5', store: false });
});

test('fails closed when a Fast session does not expose its Agent', async () => {
  let prompted = false;
  let disposed = false;
  const session: CodexRuntimePiSession = {
    model: { provider: 'openai-codex', id: 'gpt-5.5' },
    thinkingLevel: 'low',
    subscribe: () => () => undefined,
    prompt: async () => {
      prompted = true;
    },
    abort: async () => undefined,
    dispose: () => {
      disposed = true;
    },
  };
  const runtime = new CodexRuntimeService({
    authPath: () => '/private/auth.json',
    modelsPath: () => '/private/models.json',
    loadPiModule: async () => createPi(session, () => undefined),
  });

  await assert.rejects(
    runtime.run({
      model: 'gpt-5.5',
      effort: 'low',
      serviceTier: 'fast',
      systemPrompt: 'Return strict JSON.',
      prompt: '{"evidence":[]}',
      maxOutputBytes: 1024,
      signal: new AbortController().signal,
    }),
    (error) => error instanceof CodexRuntimeError && error.code === 'runtime-unavailable',
  );
  assert.equal(prompted, false);
  assert.equal(disposed, true);
});

test('fails closed when the SDK skips the Fast provider payload hook', async () => {
  let listener: Parameters<CodexRuntimePiSession['subscribe']>[0] = () => undefined;
  const session: CodexRuntimePiSession = {
    agent: {},
    model: { provider: 'openai-codex', id: 'gpt-5.5' },
    thinkingLevel: 'low',
    subscribe: (value) => {
      listener = value;
      return () => undefined;
    },
    prompt: async () => {
      listener({
        type: 'message_end',
        message: { role: 'assistant', content: '{"standard":true}', stopReason: 'stop' },
      });
    },
    abort: async () => undefined,
    dispose: () => undefined,
  };
  const runtime = new CodexRuntimeService({
    authPath: () => '/private/auth.json',
    modelsPath: () => '/private/models.json',
    loadPiModule: async () => createPi(session, () => undefined),
  });

  await assert.rejects(
    runtime.run({
      model: 'gpt-5.5',
      effort: 'low',
      serviceTier: 'fast',
      systemPrompt: 'Return strict JSON.',
      prompt: '{"evidence":[]}',
      maxOutputBytes: 1024,
      signal: new AbortController().signal,
    }),
    (error) => error instanceof CodexRuntimeError && error.code === 'runtime-unavailable',
  );
});

test('aborts the active in-memory session without returning partial output', async () => {
  let releasePrompt = (): void => undefined;
  let markStarted = (): void => undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const session: CodexRuntimePiSession = {
    model: { provider: 'openai-codex', id: 'gpt-5.5' },
    thinkingLevel: 'medium',
    subscribe: () => () => undefined,
    prompt: async () => {
      markStarted();
      await new Promise<void>((resolve) => { releasePrompt = resolve; });
    },
    abort: async () => { releasePrompt(); },
    dispose: () => undefined,
  };
  const runtime = new CodexRuntimeService({
    authPath: () => '/private/auth.json',
    modelsPath: () => '/private/models.json',
    loadPiModule: async () => createPi(session, () => undefined),
  });
  const controller = new AbortController();
  const pending = runtime.run({
    model: 'gpt-5.5',
    effort: 'medium',
    systemPrompt: 'Return strict JSON.',
    prompt: '{"evidence":[]}',
    maxOutputBytes: 1024,
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(pending, (error) =>
    error instanceof CodexRuntimeError && error.code === 'cancelled');
});
