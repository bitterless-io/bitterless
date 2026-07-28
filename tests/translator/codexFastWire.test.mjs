import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as piCodingAgent from '@earendil-works/pi-coding-agent';
import { getModel } from '@earendil-works/pi-ai';
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
      delta: '{"ok":true}'
    },
    {
      type: 'response.output_item.done',
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

const createRealPiModule = (model) => {
  const registry = {
    find: () => model,
    hasConfiguredAuth: () => true,
    getApiKeyAndHeaders: async () => ({
      ok: true,
      apiKey: testToken,
      headers: {}
    })
  };
  return {
    AuthStorage: { create: () => ({}) },
    ModelRegistry: { create: () => registry },
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
  const model = getModel('openai-codex', 'gpt-5.5');
  assert.ok(model, 'Installed Pi must expose the fixed Translator model');
  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return createSseResponse();
  };

  try {
    const runtime = new CodexRuntimeService({
      authPath: () => '/private/auth.json',
      modelsPath: () => '/private/models.json',
      loadPiModule: async () => createRealPiModule(model)
    });
    const baseInput = {
      model: 'gpt-5.5',
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
