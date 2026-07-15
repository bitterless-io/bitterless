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
