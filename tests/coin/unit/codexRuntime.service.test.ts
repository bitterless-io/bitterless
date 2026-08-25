import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexRuntimeAuthRequiredError,
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
      find: () => ({ provider: 'openai-codex', id: 'gpt-5.6-luna' }),
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

test('rejects Sol with low effort before touching the SDK', async () => {
  const runtime = new CodexRuntimeService({
    authPath: () => '/private/auth.json',
    modelsPath: () => '/private/models.json',
    loadPiModule: async () => {
      throw new Error('SDK should not load for an invalid fixed target');
    },
  });

  await assert.rejects(
    runtime.run({
      model: 'gpt-5.6-sol',
      effort: 'low',
      systemPrompt: 'Return strict JSON.',
      prompt: '{"evidence":[]}',
      maxOutputBytes: 1024,
      signal: new AbortController().signal,
    }),
    (error) => error instanceof CodexRuntimeError && error.code === 'effort-mismatch',
  );
});

test('creates a sterile in-memory Codex session with all tools disabled', async () => {
  let listener: Parameters<CodexRuntimePiSession['subscribe']>[0] = () => undefined;
  let options: Record<string, unknown> = {};
  const session: CodexRuntimePiSession = {
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
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
    model: 'gpt-5.6-luna',
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
  assert.equal(options.thinkingLevel, 'high');
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
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
    thinkingLevel: 'low',
    subscribe: (value) => {
      listener = value;
      return () => undefined;
    },
    prompt: async () => {
      capturedPayload = await agent.onPayload({ model: 'gpt-5.6-luna', store: false }, session.model);
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
    model: 'gpt-5.6-luna',
    effort: 'low',
    serviceTier: 'fast',
    systemPrompt: 'Return strict JSON.',
    prompt: '{"evidence":[]}',
    maxOutputBytes: 1024,
    signal: new AbortController().signal,
  });

  assert.deepEqual(capturedPayload, {
    model: 'gpt-5.6-luna',
    store: false,
    extensionMarker: 'kept',
    service_tier: 'priority',
  });
});

test('maps thinking off to Pi and explicit reasoning none while retaining Fast', async () => {
  let listener: Parameters<CodexRuntimePiSession['subscribe']>[0] = () => undefined;
  let options: Record<string, unknown> = {};
  let capturedPayload: unknown;
  const upstreamCalls: string[] = [];
  const agent = {
    onPayload: async (payload: unknown, _model?: unknown) => {
      upstreamCalls.push('upstream');
      return {
        ...(payload as Record<string, unknown>),
        extensionMarker: 'kept',
      };
    },
  };
  const session: CodexRuntimePiSession = {
    agent,
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
    thinkingLevel: 'off',
    subscribe: (value) => {
      listener = value;
      return () => undefined;
    },
    prompt: async () => {
      capturedPayload = await agent.onPayload({
        model: 'gpt-5.6-luna',
        reasoning: { effort: 'low' },
        store: false,
      }, session.model);
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
    model: 'gpt-5.6-luna',
    effort: 'low',
    thinkingLevel: 'off',
    serviceTier: 'fast',
    systemPrompt: 'Return strict JSON.',
    prompt: '{"sourceText":"hi"}',
    maxOutputBytes: 1024,
    signal: new AbortController().signal,
  });

  assert.equal(options.thinkingLevel, 'off');
  assert.deepEqual(upstreamCalls, ['upstream']);
  assert.deepEqual(capturedPayload, {
    model: 'gpt-5.6-luna',
    reasoning: { effort: 'none' },
    store: false,
    extensionMarker: 'kept',
    service_tier: 'priority',
  });
  assert.equal(result.effort, 'low');
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
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
    thinkingLevel: 'low',
    subscribe: (value) => {
      listener = value;
      return () => undefined;
    },
    prompt: async () => {
      await agent.onPayload({ model: 'gpt-5.6-luna', store: false }, session.model);
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
    model: 'gpt-5.6-luna',
    effort: 'low',
    systemPrompt: 'Return strict JSON.',
    prompt: '{"evidence":[]}',
    maxOutputBytes: 1024,
    signal: new AbortController().signal,
  });

  assert.equal(agent.onPayload, originalOnPayload);
  assert.deepEqual(capturedPayload, { model: 'gpt-5.6-luna', store: false });
});

test('fails closed when a Fast session does not expose its Agent', async () => {
  let prompted = false;
  let disposed = false;
  const session: CodexRuntimePiSession = {
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
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
      model: 'gpt-5.6-luna',
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
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
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
      model: 'gpt-5.6-luna',
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
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
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
    model: 'gpt-5.6-luna',
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

test('aborts while the Pi module loader is still pending', async () => {
  let resolvePi = (_pi: CodexRuntimePiModule): void => undefined;
  const piPending = new Promise<CodexRuntimePiModule>((resolve) => { resolvePi = resolve; });
  const runtime = new CodexRuntimeService({
    authPath: () => '/private/auth.json',
    modelsPath: () => '/private/models.json',
    loadPiModule: () => piPending,
  });
  const controller = new AbortController();
  const pending = runtime.run({
    model: 'gpt-5.5',
    effort: 'low',
    systemPrompt: 'Return strict JSON.',
    prompt: '{"sourceText":"hi"}',
    maxOutputBytes: 1024,
    signal: controller.signal,
  });

  controller.abort();
  await assert.rejects(pending, (error) =>
    error instanceof CodexRuntimeError && error.code === 'cancelled');
  resolvePi(createPi({
    subscribe: () => () => undefined,
    prompt: async () => undefined,
    abort: async () => undefined,
    dispose: () => undefined,
  }, () => undefined));
});

test('aborts while modern fixed-target preparation is still pending', async () => {
  let markStarted = (): void => undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const runtime = new CodexRuntimeService({
    authPath: () => '/private/auth.json',
    modelsPath: () => '/private/models.json',
    loadPiModule: async () => ({
      AuthStorage: { create: () => ({}) },
      ModelRuntime: {
        create: async () => {
          markStarted();
          return await new Promise<never>(() => undefined);
        },
      },
      ModelRegistry: class {
        constructor(_runtime: unknown) {}
        find(): undefined { return undefined; }
        hasConfiguredAuth(): boolean { return false; }
      },
      SessionManager: { inMemory: () => ({}) },
      SettingsManager: { inMemory: (settings) => settings },
      createExtensionRuntime: () => ({}),
      createAgentSession: async () => { throw new Error('unreachable'); },
    }),
  });
  const controller = new AbortController();
  const pending = runtime.run({
    model: 'gpt-5.5',
    effort: 'low',
    systemPrompt: 'Return strict JSON.',
    prompt: '{"sourceText":"hi"}',
    maxOutputBytes: 1024,
    signal: controller.signal,
  });

  await started;
  controller.abort();
  await assert.rejects(pending, (error) =>
    error instanceof CodexRuntimeError && error.code === 'cancelled');
});

test('fixed-target preparation disables model network and skips registry refresh', async () => {
  let createOptions: Record<string, unknown> = {};
  let refreshCalls = 0;
  let listener: Parameters<CodexRuntimePiSession['subscribe']>[0] = () => undefined;
  const model = { provider: 'openai-codex', id: 'gpt-5.5' };
  const session: CodexRuntimePiSession = {
    model,
    thinkingLevel: 'low',
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
    loadPiModule: async () => ({
      AuthStorage: { create: () => ({}) },
      ModelRuntime: {
        create: async (options) => {
          createOptions = options ?? {};
          return {
            getModel: () => model,
            hasConfiguredAuth: () => true,
          };
        },
      },
      ModelRegistry: class {
        constructor(_runtime: unknown) {}
        find(): typeof model { return model; }
        hasConfiguredAuth(): boolean { return true; }
        async refresh(): Promise<void> { refreshCalls += 1; }
      },
      SessionManager: { inMemory: () => ({}) },
      SettingsManager: { inMemory: (settings) => settings },
      createExtensionRuntime: () => ({}),
      createAgentSession: async () => ({ session }),
    }),
  });

  const result = await runtime.run({
    model: 'gpt-5.5',
    effort: 'low',
    allowModelNetwork: false,
    systemPrompt: 'Return strict JSON.',
    prompt: '{"sourceText":"hi"}',
    maxOutputBytes: 1024,
    signal: new AbortController().signal,
  });

  assert.equal(result.text, '{"ok":true}');
  assert.equal(createOptions.allowModelNetwork, false);
  assert.equal(refreshCalls, 0);
});

test('carries allowlisted Pi transport and final provider diagnostics without raw fields', async () => {
  let listener: Parameters<CodexRuntimePiSession['subscribe']>[0] = () => undefined;
  let upstreamResponseStatus = 0;
  const upstreamOnResponse = async (response: {
    status: number;
    headers: Record<string, string>;
  }) => {
    upstreamResponseStatus = response.status;
  };
  const agent = {
    onResponse: upstreamOnResponse,
  };
  const session: CodexRuntimePiSession = {
    agent,
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
    thinkingLevel: 'low',
    subscribe: (value) => {
      listener = value;
      return () => undefined;
    },
    prompt: async () => {
      await agent.onResponse({ status: 429, headers: { 'x-private-id': 'response-secret' } });
      listener({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'error',
          reason: 'error',
          error: {
            role: 'assistant',
            stopReason: 'error',
            errorMessage:
              'HTTP 503 FetchError code=ECONNRESET rate limit timeout websocket SSE tenant Acme private source',
            diagnostics: [
              {
                type: 'provider_transport_failure',
                error: {
                  name: 'WebSocketError',
                  code: 'websocket_connection_limit_reached',
                  message: 'WebSocket connection failed with token=provider-secret-value',
                },
                details: {
                  configuredTransport: 'auto',
                  fallbackTransport: 'sse',
                  phase: 'before_message_stream_start',
                  requestBytes: 987654,
                  eventsEmitted: false,
                },
              },
            ],
          },
        },
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
      model: 'gpt-5.6-luna',
      effort: 'low',
      systemPrompt: 'Return strict JSON.',
      prompt: '{"sourceText":"private source"}',
      maxOutputBytes: 1024,
      signal: new AbortController().signal,
    }),
    (error) => {
      assert.ok(error instanceof CodexRuntimeError);
      assert.equal(error.code, 'provider-error');
      assert.deepEqual(error.diagnostic, {
        transportDiagnostic: {
          category: 'transport',
          configuredTransport: 'auto',
          fallbackTransport: 'sse',
          providerPhase: 'before-stream',
          errorName: 'WebSocketError',
          errorCode: 'ws-limit',
          detail: 'provider transport failed',
        },
        terminalDiagnostic: {
          category: 'rate-limit',
          httpStatus: 429,
          detail: 'rate limit exceeded',
        },
      });
      assert.equal(Object.hasOwn(error.diagnostic ?? {}, 'requestBytes'), false);
      const serialized = JSON.stringify(error.diagnostic);
      assert.equal(serialized.includes('requestBytes'), false);
      assert.equal(serialized.includes('provider-secret-value'), false);
      assert.equal(serialized.includes('private source'), false);
      assert.equal(serialized.includes('response-secret'), false);
      assert.equal(error.diagnostic?.transportDiagnostic?.errorName, 'WebSocketError');
      assert.equal(error.diagnostic?.terminalDiagnostic?.errorName, undefined);
      assert.equal(error.diagnostic?.terminalDiagnostic?.errorCode, undefined);
      return true;
    },
  );
  assert.equal(upstreamResponseStatus, 429);
  assert.equal(agent.onResponse, upstreamOnResponse);
});

test('never carries JSON, HTML, or plaintext provider bodies into diagnostic detail', async () => {
  const bodies = [
    '{"maintenance":"HTTP 429 FetchError code=ECONNRESET rate limit timeout websocket SSE tenant Acme private source"}',
    '<html><body>HTTP 429 FetchError code=ECONNRESET rate limit timeout websocket SSE tenant Acme private source</body></html>',
    'HTTP 429 FetchError code=ECONNRESET rate limit timeout websocket SSE tenant Acme private source',
  ];

  for (const body of bodies) {
    let listener: Parameters<CodexRuntimePiSession['subscribe']>[0] = () => undefined;
    const session: CodexRuntimePiSession = {
      model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
      thinkingLevel: 'low',
      subscribe: (value) => {
        listener = value;
        return () => undefined;
      },
      prompt: async () => {
        listener({
          type: 'message_end',
          message: { role: 'assistant', stopReason: 'error', errorMessage: body },
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
        model: 'gpt-5.6-luna',
        effort: 'low',
        systemPrompt: 'Return strict JSON.',
        prompt: '{"sourceText":"private source"}',
        maxOutputBytes: 1024,
        signal: new AbortController().signal,
      }),
      (error) => {
        assert.ok(error instanceof CodexRuntimeError);
        assert.deepEqual(error.diagnostic, {
          terminalDiagnostic: {
            category: 'provider-unknown',
            detail: 'provider request failed',
          },
        });
        const serialized = JSON.stringify(error.diagnostic);
        assert.equal(serialized.includes('Acme'), false);
        assert.equal(serialized.includes('private source'), false);
        assert.equal(serialized.includes('<html>'), false);
        assert.equal(serialized.includes('maintenance'), false);
        return true;
      },
    );
  }
});

test('summarizes only structural fields from a caught Error object', async () => {
  const thrown = Object.assign(
    new Error('HTTP 429 WebSocketError code=ETIMEDOUT rate limit tenant Acme private source'),
    {
      name: 'FetchError',
      code: 'ECONNRESET',
      status: 503,
      body: '{"sourceText":"private source","access_token":"secret"}',
    },
  );
  const session: CodexRuntimePiSession = {
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
    thinkingLevel: 'low',
    subscribe: () => () => undefined,
    prompt: async () => {
      throw thrown;
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
      model: 'gpt-5.6-luna',
      effort: 'low',
      systemPrompt: 'Return strict JSON.',
      prompt: '{"sourceText":"private source"}',
      maxOutputBytes: 1024,
      signal: new AbortController().signal,
    }),
    (error) => {
      assert.ok(error instanceof CodexRuntimeError);
      assert.deepEqual(error.diagnostic, {
        terminalDiagnostic: {
          category: 'http',
          httpStatus: 503,
          errorName: 'FetchError',
          errorCode: 'ECONNRESET',
          detail: 'http request rejected',
        },
      });
      const serialized = JSON.stringify(error.diagnostic);
      assert.equal(serialized.includes('private source'), false);
      assert.equal(serialized.includes('secret'), false);
      return true;
    },
  );
});

test('keeps auth invalidation classification ahead of log-only provider diagnostics', async () => {
  let listener: Parameters<CodexRuntimePiSession['subscribe']>[0] = () => undefined;
  const session: CodexRuntimePiSession = {
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
    thinkingLevel: 'low',
    subscribe: (value) => {
      listener = value;
      return () => undefined;
    },
    prompt: async () => {
      listener({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: '401 invalid token',
          diagnostics: [
            {
              type: 'provider_transport_failure',
              error: { name: 'WebSocketError', message: 'connection failed' },
              details: { configuredTransport: 'auto', fallbackTransport: 'sse' },
            },
          ],
        },
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
      model: 'gpt-5.6-luna',
      effort: 'low',
      systemPrompt: 'Return strict JSON.',
      prompt: '{"sourceText":"hi"}',
      maxOutputBytes: 1024,
      signal: new AbortController().signal,
    }),
    (error) =>
      error instanceof CodexRuntimeAuthRequiredError &&
      error.reason === 'invalid-token' &&
      error.diagnostic === undefined,
  );
});
