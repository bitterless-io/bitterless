import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import test from 'node:test';
import { z } from 'zod';
import { ClaudeAccountRouter } from '../../src/main/claudeSubscription/claudeAccount.router';
import type { ClaudeExecutor } from '../../src/main/claudeSubscription/claudeCli.executor';
import {
  ClaudeExecutionError,
  ClaudeRequestAbortedError
} from '../../src/main/claudeSubscription/claudeSubscription.errors';
import {
  ClaudeResponsesRuntime,
  ClaudeResponsesServer
} from '../../src/main/claudeSubscription/claudeResponses.server';
import {
  FakeClaudeAccountSource,
  parseClaudeSse,
  readClaudeFixture
} from './claudeSubscriptionTest.helper';

const functionCallItemSchema = z
  .object({
    id: z.string(),
    type: z.literal('function_call'),
    status: z.literal('completed'),
    call_id: z.string(),
    name: z.string(),
    namespace: z.string().optional(),
    arguments: z.string()
  })
  .strict();

const functionArgumentsDoneEventSchema = z
  .object({
    type: z.literal('response.function_call_arguments.done'),
    sequence_number: z.number().int().nonnegative(),
    item_id: z.string(),
    output_index: z.number().int().nonnegative(),
    name: z.string(),
    arguments: z.string()
  })
  .strict();

const functionOutputItemDoneEventSchema = z
  .object({
    type: z.literal('response.output_item.done'),
    sequence_number: z.number().int().nonnegative(),
    output_index: z.number().int().nonnegative(),
    item: functionCallItemSchema
  })
  .strict();

const finalExecutor: ClaudeExecutor = {
  async execute() {
    return {
      decision: { action: 'final', text: 'hello from Bitterless' },
      rawUsage: { usage: { input_tokens: 1, output_tokens: 2 } }
    };
  }
};

const requestBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  model: 'claude-sonnet',
  stream: true,
  input: 'Say hello.',
  ...overrides
});

const startServer = async (
  options: {
    source?: FakeClaudeAccountSource;
    executor?: ClaudeExecutor;
    maxBodyBytes?: number;
  } = {}
) => {
  const source = options.source ?? new FakeClaudeAccountSource();
  const router = new ClaudeAccountRouter(source);
  const runtime = new ClaudeResponsesRuntime(router, options.executor ?? finalExecutor);
  const server = new ClaudeResponsesServer(router, runtime, {
    port: 0,
    ...(options.maxBodyBytes ? { maxBodyBytes: options.maxBodyBytes } : {})
  });
  const address = await server.listen();
  return {
    server,
    source,
    address,
    baseUrl: `http://${address.host}:${address.port}`
  };
};

test('binds loopback and serves aggregate health plus the exact model catalog', async () => {
  const running = await startServer();
  try {
    assert.equal(running.address.host, '127.0.0.1');
    const healthResponse = await fetch(`${running.baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    const health = (await healthResponse.json()) as {
      ok: boolean;
      accounts: Record<string, number>;
    };
    assert.equal(health.ok, true);
    assert.deepEqual(health.accounts, {
      total: 2,
      enabled: 2,
      eligible: 2,
      busy: 0,
      cooling: 0,
      needsLogin: 0,
      activeRequests: 0
    });
    assert.doesNotMatch(JSON.stringify(health), /account-a|token-a/u);

    const modelsResponse = await fetch(`${running.baseUrl}/v1/models?client_version=test`);
    const models = (await modelsResponse.json()) as { data: Array<{ id: string }> };
    assert.deepEqual(
      models.data.map((model) => model.id),
      ['claude-sonnet', 'claude-opus', 'claude-haiku']
    );
  } finally {
    await running.server.close();
    await running.server.close();
  }
});

test('streams an ordered complete text response and DONE sentinel', async () => {
  const running = await startServer();
  try {
    const response = await fetch(`${running.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(requestBody())
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/u);
    const events = parseClaudeSse(await response.text());
    assert.equal(events.at(-1)?.data, '[DONE]');
    assert.deepEqual(
      events.filter((event) => event.event).map((event) => event.event),
      [
        'response.created',
        'response.output_item.added',
        'response.content_part.added',
        'response.output_text.delta',
        'response.output_text.done',
        'response.content_part.done',
        'response.output_item.done',
        'response.completed'
      ]
    );
  } finally {
    await running.server.close();
  }
});

test('round-trips flat and namespace function fixtures through HTTP SSE', async () => {
  const observed: Array<{ decisionName: string; effort: string }> = [];
  const toolExecutor: ClaudeExecutor = {
    async execute(execution) {
      const [tool] = execution.payload.available_tools;
      assert.ok(tool);
      observed.push({ decisionName: tool.decision_name, effort: execution.effort });
      assert.equal(execution.effort, tool.namespace === 'browser' ? 'max' : 'high');
      return {
        decision: {
          action: 'tool_call',
          toolName: tool.name,
          ...(tool.namespace ? { toolNamespace: tool.namespace } : {}),
          argumentsJson: '{"value":"fixture"}'
        },
        rawUsage: {}
      };
    }
  };
  const running = await startServer({ executor: toolExecutor });
  try {
    const fixtures = [
      {
        body: await readClaudeFixture<Record<string, unknown>>('codex-tool-request.json'),
        decisionName: 'read_file',
        name: 'read_file',
        effort: 'high',
        namespace: undefined
      },
      {
        body: await readClaudeFixture<Record<string, unknown>>('codex-namespace-request.json'),
        decisionName: 'namespace:browser:open',
        name: 'open',
        effort: 'max',
        namespace: 'browser'
      }
    ] as const;

    for (const fixture of fixtures) {
      const response = await fetch(`${running.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fixture.body)
      });
      const events = parseClaudeSse(await response.text());
      assert.deepEqual(observed.at(-1), {
        decisionName: fixture.decisionName,
        effort: fixture.effort
      });
      const completed = events.find((event) => event.event === 'response.completed')?.data as {
        response: { output: Array<Record<string, unknown>> };
      };
      const done = events.find((event) => event.event === 'response.function_call_arguments.done')
        ?.data as Record<string, unknown>;
      const outputDone = events.find((event) => event.event === 'response.output_item.done')?.data;
      const item = functionCallItemSchema.parse(completed.response.output[0]);
      const parsedDone = functionArgumentsDoneEventSchema.parse(done);
      const parsedOutputDone = functionOutputItemDoneEventSchema.parse(outputDone);
      assert.equal(item.name, fixture.name);
      assert.equal(item.namespace, fixture.namespace);
      assert.equal(parsedDone.name, fixture.name);
      assert.equal('namespace' in parsedDone, false);
      assert.deepEqual(parsedOutputDone.item, item);
      assert.equal(events.at(-1)?.data, '[DONE]');
    }
  } finally {
    await running.server.close();
  }
});

test('rejects Origin, wrong content type, malformed JSON, oversized bodies, and unknown routes', async () => {
  const running = await startServer({ maxBodyBytes: 128 });
  try {
    const origin = await fetch(`${running.baseUrl}/health`, {
      headers: { origin: 'https://untrusted.example' }
    });
    assert.equal(origin.status, 403);

    const contentType = await fetch(`${running.baseUrl}/v1/responses`, {
      method: 'POST',
      body: JSON.stringify(requestBody())
    });
    assert.equal(contentType.status, 415);

    const malformed = await fetch(`${running.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid'
    });
    assert.equal(malformed.status, 400);

    const oversized = await fetch(`${running.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ input: 'x'.repeat(256) }))
    });
    assert.equal(oversized.status, 413);

    const missing = await fetch(`${running.baseUrl}/unknown`);
    assert.equal(missing.status, 404);
  } finally {
    await running.server.close();
  }
});

test('returns typed request and no-account errors without account identity', async () => {
  const source = new FakeClaudeAccountSource(['private-account-id']);
  source.accounts[0]!.enabled = false;
  const running = await startServer({ source });
  try {
    const noAccount = await fetch(`${running.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody())
    });
    assert.equal(noAccount.status, 429);
    const noAccountBody = await noAccount.text();
    assert.match(noAccountBody, /no_eligible_account/u);
    assert.doesNotMatch(noAccountBody, /private-account-id|token-a/u);

    const invalidModel = await fetch(`${running.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ model: 'gpt-5' }))
    });
    assert.equal(invalidModel.status, 400);
    assert.match(await invalidModel.text(), /invalid_request/u);

    const nonStreaming = await fetch(`${running.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ stream: false }))
    });
    assert.equal(nonStreaming.status, 400);
  } finally {
    await running.server.close();
  }
});

test('redacts all executor secrets at the HTTP boundary', async () => {
  const secretExecutor: ClaudeExecutor = {
    async execute() {
      throw new ClaudeExecutionError(
        'Bearer bearer-secret sk-ant-oat01-secret https://claude.ai/oauth/authorize?client_id=secret-client&redirect_uri=secret-redirect&state=secret-state ' +
          '{"authorization_code":"secret-code","CLAUDE_CODE_OAUTH_TOKEN":"opaque-token","auth":"opaque-auth"}'
      );
    }
  };
  const running = await startServer({ executor: secretExecutor });
  try {
    const response = await fetch(`${running.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody())
    });
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.doesNotMatch(
      body,
      /bearer-secret|oat01-secret|secret-client|secret-redirect|secret-code|secret-state|opaque-token|opaque-auth|claude\.ai|oauth\/authorize/u
    );
    assert.match(body, /REDACTED_AUTHORIZATION_URL/u);
  } finally {
    await running.server.close();
  }
});

test('client abort and server close both cancel the active execution', async () => {
  let startedResolve!: () => void;
  let abortedResolve!: () => void;
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });
  const aborted = new Promise<void>((resolve) => {
    abortedResolve = resolve;
  });
  const hangingExecutor: ClaudeExecutor = {
    async execute(_execution, options) {
      startedResolve();
      return await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            abortedResolve();
            reject(new ClaudeRequestAbortedError());
          },
          { once: true }
        );
      });
    }
  };
  const running = await startServer({ executor: hangingExecutor });
  const controller = new AbortController();
  const pending = fetch(`${running.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody()),
    signal: controller.signal
  });
  await started;
  controller.abort();
  await assert.rejects(pending);
  await aborted;
  await running.server.close();

  let closeStartedResolve!: () => void;
  let closeAbortedResolve!: () => void;
  const closeStarted = new Promise<void>((resolve) => {
    closeStartedResolve = resolve;
  });
  const closeAborted = new Promise<void>((resolve) => {
    closeAbortedResolve = resolve;
  });
  const closeExecutor: ClaudeExecutor = {
    async execute(_execution, options) {
      closeStartedResolve();
      return await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            closeAbortedResolve();
            reject(new ClaudeRequestAbortedError());
          },
          { once: true }
        );
      });
    }
  };
  const closing = await startServer({ executor: closeExecutor });
  const closeFetch = fetch(`${closing.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody())
  });
  await closeStarted;
  const closePromise = closing.server.close();
  await closeAborted;
  await Promise.allSettled([closeFetch, closePromise]);
});

test('server close cancels an unfinished request body within a bounded time', async () => {
  const running = await startServer();
  const socket = createConnection({ host: running.address.host, port: running.address.port });
  socket.on('error', () => undefined);
  await once(socket, 'connect');
  socket.write(
    [
      'POST /v1/responses HTTP/1.1',
      `Host: ${running.address.host}:${running.address.port}`,
      'Content-Type: application/json',
      'Content-Length: 1000',
      'Connection: keep-alive',
      '',
      '{'
    ].join('\r\n')
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 25));

  let timeout: NodeJS.Timeout | undefined;
  try {
    const startedAt = Date.now();
    await Promise.race([
      running.server.close(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('server close timed out on unfinished body')),
          1_000
        );
      })
    ]);
    assert.ok(Date.now() - startedAt < 1_000);
  } finally {
    if (timeout) clearTimeout(timeout);
    socket.destroy();
    await running.server.close();
  }
});

test('server close wins a concurrent startup without leaving a listener', async () => {
  const source = new FakeClaudeAccountSource();
  const router = new ClaudeAccountRouter(source);
  const runtime = new ClaudeResponsesRuntime(router, finalExecutor);
  const server = new ClaudeResponsesServer(router, runtime, { port: 0 });

  const listening = server.listen();
  const closing = server.close();
  const [listenResult, closeResult] = await Promise.allSettled([listening, closing]);
  assert.equal(closeResult.status, 'fulfilled');
  assert.equal(listenResult.status, 'rejected');
  assert.throws(() => server.address(), /not listening/u);
  await server.close();
});
