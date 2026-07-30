import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { zstdDecompressSync } from 'node:zlib';
import test from 'node:test';
import * as piCodingAgent from '@earendil-works/pi-coding-agent';
import { streamSimple as streamOpenAiCodexSimple } from '@earendil-works/pi-ai/api/openai-codex-responses';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const runtimeSource = readFileSync(
  new URL('../../src/main/codex/codexRuntime.service.ts', import.meta.url),
  'utf8'
);

const loadRuntime = () => {
  const transpiled = ts.transpileModule(runtimeSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: 'src/main/codex/codexRuntime.service.ts',
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    []
  );

  const loadedModule = { exports: {} };
  const execute = new Function(
    'require',
    'module',
    'exports',
    `${transpiled.outputText}\n//# sourceURL=codexRuntime.service.ts`
  );
  execute(nodeRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
};

const accountClaim = 'https://api.openai.com/auth';
const tokenPayload = Buffer.from(
  JSON.stringify({ [accountClaim]: { chatgpt_account_id: 'acct_wire_test' } })
).toString('base64url');
const testToken = `e30.${tokenPayload}.signature`;

const createSseResponse = () => {
  const events = [
    {
      type: 'response.created',
      response: { id: 'resp_wire_test' }
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        type: 'message',
        id: 'msg_wire_test',
        role: 'assistant',
        status: 'in_progress',
        content: []
      }
    },
    {
      type: 'response.content_part.added',
      part: { type: 'output_text', text: '', annotations: [] }
    },
    {
      type: 'response.output_text.delta',
      output_index: 0,
      delta: '{"ok":true}'
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        type: 'message',
        id: 'msg_wire_test',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }]
      }
    },
    {
      type: 'response.completed',
      response: {
        id: 'resp_wire_test',
        status: 'completed',
        service_tier: 'priority',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          input_tokens_details: { cached_tokens: 0 }
        }
      }
    }
  ];
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
};

const parseCodexBody = (init) => {
  const headers = new Headers(init?.headers);
  const raw = init?.body;
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : typeof raw === 'string'
          ? Buffer.from(raw)
          : Buffer.from(String(raw));
  const text =
    headers.get('content-encoding') === 'zstd'
      ? zstdDecompressSync(bytes).toString('utf8')
      : Buffer.from(bytes).toString('utf8');
  return JSON.parse(text);
};

const createRealPiModule = (model) => {
  const modelRuntime = {
    getModel: () => model,
    getModels: () => [model],
    getAvailable: async () => [model],
    getAvailableSnapshot: () => [model],
    getProvider: () => ({ id: 'openai-codex', name: 'OpenAI Codex' }),
    getError: () => undefined,
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({ type: 'oauth', source: 'fixture' }),
    isUsingOAuth: () => true,
    getAuth: async () => ({ auth: { apiKey: testToken, headers: {} } }),
    getCompatibilityRequestConfig: () => ({}),
    getProviderAuthStatus: () => ({ configured: true, source: 'stored' }),
    getRegisteredProviderConfig: () => undefined,
    getRegisteredProviderIds: () => [],
    registerProvider: () => undefined,
    unregisterProvider: () => undefined,
    reloadConfig: async () => undefined,
    refresh: async () => undefined,
    streamSimple: (activeModel, context, options) =>
      streamOpenAiCodexSimple(activeModel, context, {
        ...options,
        apiKey: testToken,
        transport: 'sse'
      })
  };
  return {
    ModelRuntime: { create: async () => modelRuntime },
    ModelRegistry: piCodingAgent.ModelRegistry,
    SessionManager: piCodingAgent.SessionManager,
    SettingsManager: {
      inMemory: (settings) =>
        piCodingAgent.SettingsManager.inMemory({
          ...settings,
          transport: 'sse'
        })
    },
    createExtensionRuntime: piCodingAgent.createExtensionRuntime,
    createAgentSession: piCodingAgent.createAgentSession
  };
};

test('real Pi Codex provider writes priority only for Fast runtime requests', async () => {
  const { CodexRuntimeService } = loadRuntime();
  const model = openaiCodexProvider().getModels().find(
    (candidate) => candidate.id === 'gpt-5.6-luna'
  );
  assert.ok(model, 'Installed Pi must expose the fixed Translator model');
  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    bodies.push(parseCodexBody(init));
    return createSseResponse();
  };

  try {
    const runtime = new CodexRuntimeService({
      authPath: () => '/private/auth.json',
      modelsPath: () => '/private/models.json',
      loadPiModule: async () => createRealPiModule(model)
    });
    const baseInput = {
      model: 'gpt-5.6-luna',
      effort: 'low',
      systemPrompt: 'Return strict JSON.',
      prompt: '{"evidence":[]}',
      maxOutputBytes: 1024
    };

    const fastResult = await runtime.run({
      ...baseInput,
      serviceTier: 'fast',
      signal: new AbortController().signal
    });
    const standardResult = await runtime.run({
      ...baseInput,
      signal: new AbortController().signal
    });

    assert.equal(fastResult.text, '{"ok":true}');
    assert.equal(standardResult.text, '{"ok":true}');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].service_tier, 'priority');
    assert.equal(Object.hasOwn(bodies[1], 'service_tier'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
