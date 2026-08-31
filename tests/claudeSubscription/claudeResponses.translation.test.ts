import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClaudeBridgePayload,
  extractClaudeCodexTools,
  parseClaudeResponsesRequest,
  resolveClaudeEffort,
  resolveClaudeSubscriptionModel,
  resolveClaudeSubscriptionModelId
} from '../../src/main/claudeSubscription/claudeResponses.translator';
import {
  buildClaudeResponseEvents,
  makeClaudeCompletedResponse,
  normalizeClaudeUsage
} from '../../src/main/claudeSubscription/claudeResponses.stream';
import { ClaudeSubscriptionInvalidRequestError } from '../../src/main/claudeSubscription/claudeSubscription.errors';
import { readClaudeFixture } from './claudeSubscriptionTest.helper';

test('normalizes Codex text and images without forwarding image bytes', async () => {
  const raw = await readClaudeFixture<unknown>('codex-text-request.json');
  const request = parseClaudeResponsesRequest(raw);
  const payload = buildClaudeBridgePayload(request);

  assert.equal(payload.codex_instructions, 'Answer concisely and use tools only when required.');
  assert.deepEqual(payload.unsupported_codex_tool_types, ['web_search_preview']);
  const serialized = JSON.stringify(payload.conversation);
  assert.doesNotMatch(serialized, /NOT_FORWARDED|image_url|base64/u);
  assert.match(serialized, /Codex must use its own image-inspection tool/u);
});

test('preserves ordered messages, function calls, and function outputs', () => {
  const request = parseClaudeResponsesRequest({
    model: 'claude-opus',
    stream: true,
    instructions: 'Use evidence.',
    input: [
      {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: 'System evidence.' }]
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Read it.' }]
      },
      {
        type: 'function_call',
        id: 'fc_previous',
        call_id: 'call_previous',
        name: 'read_file',
        arguments: '{"path":"package.json"}'
      },
      {
        type: 'function_call_output',
        call_id: 'call_previous',
        output: '{"name":"bitterless"}'
      }
    ],
    tools: [
      {
        type: 'function',
        name: 'read_file',
        description: 'Read one file.',
        parameters: { type: 'object' }
      }
    ]
  });
  const payload = buildClaudeBridgePayload(request);
  assert.deepEqual(
    (payload.conversation as Array<{ type?: string }>).map((item) => item.type),
    ['message', 'message', 'function_call', 'function_call_output']
  );
  assert.deepEqual(
    (payload.conversation as Array<{ role?: string }>).slice(0, 2).map((item) => item.role),
    ['system', 'user']
  );
  assert.match(JSON.stringify(payload.conversation), /call_previous|bitterless/u);
});

test('preserves namespace functions and lists unsupported built-ins once', () => {
  const payload = buildClaudeBridgePayload(
    parseClaudeResponsesRequest({
      model: 'claude-opus',
      stream: true,
      input: 'Open the product page.',
      tools: [
        {
          type: 'namespace',
          name: 'browser',
          tools: [
            {
              type: 'function',
              name: 'open',
              description: 'Open a URL.',
              parameters: { type: 'object' }
            }
          ]
        },
        { type: 'computer_use_preview' },
        { type: 'computer_use_preview' }
      ]
    })
  );
  assert.deepEqual(payload.available_tools, [
    {
      decision_name: 'namespace:browser:open',
      namespace: 'browser',
      name: 'open',
      description: 'Open a URL.',
      parameters: { type: 'object' }
    }
  ]);
  assert.deepEqual(payload.unsupported_codex_tool_types, ['computer_use_preview']);
  assert.equal((payload.conversation[0] as { role: string }).role, 'user');

  assert.throws(
    () =>
      extractClaudeCodexTools([
        { type: 'function', name: 'same' },
        { type: 'function', name: 'same' }
      ]),
    ClaudeSubscriptionInvalidRequestError
  );
});

test('rejects malformed supplied function schemas and defaults only omitted parameters', () => {
  const valid = extractClaudeCodexTools([{ type: 'function', name: 'default_schema' }]);
  assert.deepEqual(valid.functions[0]?.parameters, { type: 'object', properties: {} });

  for (const parameters of [
    null,
    'invalid',
    { type: 'string' },
    { type: 'object', properties: [] },
    { type: 'object', required: ['ok', 2] },
    { type: 'object', additionalProperties: 'no' }
  ]) {
    assert.throws(
      () => extractClaudeCodexTools([{ type: 'function', name: 'invalid_schema', parameters }]),
      ClaudeSubscriptionInvalidRequestError
    );
  }
});

test('validates streaming request fields and exact model mapping', () => {
  assert.equal(resolveClaudeSubscriptionModel('claude-sonnet'), 'sonnet');
  assert.equal(resolveClaudeSubscriptionModel('claude-opus'), 'opus');
  // Haiku is no longer offered, so its slug is an unknown model and takes the
  // fallback like any other.
  assert.equal(resolveClaudeSubscriptionModel('claude-haiku'), 'sonnet');
  // Codex Desktop switches provider globally, so a thread created before the
  // switch still sends its OpenAI slug here. Rejecting those made every
  // pre-existing thread unusable; Sonnet answers instead, and the response
  // reports the model that actually ran rather than echoing the request.
  assert.equal(resolveClaudeSubscriptionModel('gpt-5'), 'sonnet');
  assert.equal(resolveClaudeSubscriptionModelId('gpt-5'), 'claude-sonnet');
  assert.equal(resolveClaudeSubscriptionModelId('claude-opus'), 'claude-opus');
  assert.throws(
    () => parseClaudeResponsesRequest({ model: 'claude-sonnet', stream: false }),
    /stream=true/u
  );
  assert.throws(
    () =>
      parseClaudeResponsesRequest({
        model: 'claude-sonnet',
        stream: true,
        prompt_cache_key: 2
      }),
    /prompt_cache_key/u
  );
  const defaults = parseClaudeResponsesRequest({ model: 'claude-sonnet', stream: true });
  assert.deepEqual(defaults.input, []);
  assert.deepEqual(defaults.tools, []);
  assert.equal(defaults.claudeEffort, 'high');
});

test('maps every Codex reasoning effort per request and rejects malformed values', () => {
  const mappings = [
    // Read in the client's own vocabulary; the shift onto an upstream ladder happens
    // at dispatch, once the upstream is known.
    ['none', 'low'],
    ['minimal', 'low'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    // Desktop hides `max` from its picker but its schema still allows it; a request
    // that names it is legal on the wire and resolves to the top rung at dispatch.
    ['max', 'ultra'],
    ['ultra', 'ultra']
  ] as const;
  for (const [codex, claude] of mappings) {
    assert.equal(resolveClaudeEffort({ effort: codex }), claude);
    assert.equal(
      parseClaudeResponsesRequest({
        model: 'claude-sonnet',
        stream: true,
        reasoning: { effort: codex }
      }).claudeEffort,
      claude
    );
  }
  assert.equal(resolveClaudeEffort(undefined), 'high');
  assert.equal(resolveClaudeEffort({}), 'high');
  for (const reasoning of [null, 'high', { effort: 3 }, { effort: 'extreme' }]) {
    assert.throws(
      () =>
        parseClaudeResponsesRequest({
          model: 'claude-sonnet',
          stream: true,
          reasoning
        }),
      ClaudeSubscriptionInvalidRequestError
    );
  }
});

test('emits ordered complete text Responses SSE events and normalized usage', () => {
  const usage = normalizeClaudeUsage({
    usage: { input_tokens: 7, cache_read_input_tokens: 2, output_tokens: 3 }
  });
  const response = makeClaudeCompletedResponse(
    'claude-sonnet',
    { action: 'final', text: 'Hello' },
    usage,
    { createId: () => '00000000-0000-4000-8000-000000000001', now: () => 1_000 }
  );
  const events = buildClaudeResponseEvents(response);
  assert.deepEqual(
    events.map((event) => event.type),
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
  assert.deepEqual(
    events.map((event) => event.sequence_number),
    [0, 1, 2, 3, 4, 5, 6, 7]
  );
  assert.equal(events[3]?.delta, 'Hello');
  assert.deepEqual(usage, {
    input_tokens: 9,
    input_tokens_details: { cached_tokens: 2 },
    output_tokens: 3,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 12
  });
});

test('emits one complete Responses function call and per-model usage totals', () => {
  const response = makeClaudeCompletedResponse(
    'claude-opus',
    {
      action: 'tool_call',
      toolName: 'read_file',
      argumentsJson: '{"path":"package.json"}'
    },
    normalizeClaudeUsage({
      modelUsage: {
        sonnet: { inputTokens: 3, cacheReadInputTokens: 4, outputTokens: 5 },
        opus: { inputTokens: 2, cacheReadInputTokens: 1, outputTokens: 6 }
      }
    })
  );
  const events = buildClaudeResponseEvents(response);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      'response.created',
      'response.output_item.added',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
      'response.output_item.done',
      'response.completed'
    ]
  );
  assert.equal(events[2]?.delta, '{"path":"package.json"}');
  assert.equal(events[3]?.name, 'read_file');
  assert.equal(response.usage.total_tokens, 21);
  assert.equal(response.output[0].type, 'function_call');
});

test('emits separate namespace and child name on function items and done events', () => {
  const response = makeClaudeCompletedResponse(
    'claude-sonnet',
    {
      action: 'tool_call',
      toolNamespace: 'browser',
      toolName: 'open',
      argumentsJson: '{"url":"https://example.test"}'
    },
    normalizeClaudeUsage()
  );
  const events = buildClaudeResponseEvents(response);
  const output = response.output[0];
  assert.equal(output.type, 'function_call');
  if (output.type !== 'function_call') assert.fail('expected function call output');
  assert.equal(output.namespace, 'browser');
  assert.equal(output.name, 'open');
  assert.equal(events[3]?.name, 'open');
  assert.equal('namespace' in (events[3] ?? {}), false);
});
