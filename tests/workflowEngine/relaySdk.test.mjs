import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { createJiti } from 'jiti'
import { Type } from 'typebox'
const root = fileURLToPath(new URL('../../', import.meta.url))
const jiti = createJiti(import.meta.url, { fsCache: false })
const { WorkflowPiSession } = await jiti.import(join(root, 'src/main/agent/workflowEngine/piAgentSession.ts'))
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const relay = { providerId: 'ai-crms', modelId: 'qwen-fixture', apiKey: 'fixture-jwt-not-real', headers: { 'x-region': 'SG', 'x-workspace-id': 'fixture-institution', 'x-iid': '42' }, model: { name: 'Qwen fixture', contextWindow: 262144, maxTokens: 8192 } }

test('real Pi SDK uses session relay auth, streams tool submission across turns, cancels HTTP, and never writes auth/models', { timeout: 25_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-relay-sdk-'))
  const requests = [], io = [], waiting = deferred(), disconnected = deferred()
  const server = createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk
    requests.push({ path: req.url, headers: req.headers, body: JSON.parse(data) })
    const index = requests.length
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = value => res.write(`data: ${JSON.stringify({ id: `response-${index}`, object: 'chat.completion.chunk', created: 1, model: relay.modelId, ...value })}\n\n`)
    send({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
    if (index === 3) { res.once('close', disconnected.resolve); waiting.resolve(); return }
    send({ choices: [{ index: 0, delta: index === 1 ? { content: 'Need a repair turn' } : { tool_calls: [{ index: 0, id: 'submit-1', type: 'function', function: { name: 'workflow_submit_result', arguments: JSON.stringify({ result: { count: 2 } }) } }] }, finish_reason: null }] })
    send({ choices: [{ index: 0, delta: {}, finish_reason: index === 1 ? 'stop' : 'tool_calls' }] })
    send({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } })
    res.end('data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const authPath = join(directory, 'auth.json'), modelsPath = join(directory, 'models.json')
  await writeFile(authPath, 'intentionally not an auth file')
  await writeFile(modelsPath, 'intentionally not a model file')
  const signal = new AbortController()
  const agent = new WorkflowPiSession({ type: 'agent.start', runId: 'run', request: { sessionId: 'chat', cwd: directory },
    runtime: { providerId: relay.providerId, modelId: relay.modelId, authPath, modelsPath, agentDir: directory, tools: [], systemPrompt: 'Follow the task.', thinkingLevel: 'low', relay: { ...relay, baseUrl: `http://127.0.0.1:${server.address().port}/v1/bailian` } },
    attempt: { id: 'attempt', rowId: 1, turnId: 'one', prompt: 'work', providerId: relay.providerId, modelId: relay.modelId, opts: { tools: [], outputSchema: Type.Object({ count: Type.Number() }) } }
  }, signal.signal, { action() {}, usage() {}, io: line => io.push(line), settleTools: async () => {} }, [])
  try {
    const first = await agent.turn('first')
    assert.equal(first.error, undefined); assert.equal(first.text, 'Need a repair turn'); assert.equal(first.submitted, undefined)
    const second = await agent.turn('submit the structured result')
    assert.equal(second.error, undefined)
    assert.deepEqual(second.submitted, { tool: 'workflow_submit_result', arguments: { result: { count: 2 } } })
    assert.equal(second.usage.totalTokens, 8)
    for (const request of requests) {
      assert.equal(request.path, '/v1/bailian/chat/completions')
      assert.equal(request.headers.authorization, `Bearer ${relay.apiKey}`)
      for (const [key, value] of Object.entries(relay.headers)) assert.equal(request.headers[key], value)
      assert.equal(request.body.model, relay.modelId); assert.equal(request.body.stream, true)
      assert.equal(request.body.enable_thinking, true); assert.equal(request.body.reasoning_effort, undefined)
      assert.equal(request.body.store, undefined); assert.equal(request.body.max_completion_tokens, undefined)
      assert.equal(request.body.max_tokens, 8192)
      assert.equal(request.body.messages[0].role, 'system')
      assert.equal(request.body.tools[0].function.strict, undefined)
    }
    assert(requests[1].body.messages.some(message => message.role === 'assistant' && message.content === 'Need a repair turn'))
    const prompts = io.filter(line => line.kind === 'prompt').map(line => JSON.parse(line.text))
    assert.equal(prompts[0].systemPrompt, requests[0].body.messages[0].content)
    assert.deepEqual(prompts[0].messages, [])
    assert.equal(prompts[0].tools[0].name, 'workflow_submit_result')
    assert.deepEqual(prompts[0].tools[0].parameters, requests[0].body.tools[0].function.parameters)
    assert(prompts[1].messages.some(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text === 'Need a repair turn')))
    assert(io.some(line => line.kind === 'tool_result' && line.name === 'workflow_submit_result' && JSON.parse(line.text).args.result.count === 2))
    assert.equal(io.filter(line => line.name === 'assistant').length, 2)
    const third = agent.turn('wait until stopped')
    await waiting.promise
    signal.abort(); await agent.close()
    assert.equal((await third).cancelled, true)
    assert.equal(io.at(-1).kind, 'turn_end')
    assert.equal(io.at(-1).subject, 'cancelled')
    assert.equal(JSON.stringify(io).includes(relay.apiKey), false)
    await disconnected.promise
    assert.equal(await readFile(authPath, 'utf8'), 'intentionally not an auth file')
    assert.equal(await readFile(modelsPath, 'utf8'), 'intentionally not a model file')
    assert.equal((await readdir(directory)).includes('models-store.json'), false)
  } finally {
    signal.abort(); await agent.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true })
  }
})

test('real Pi SDK accepts a once-encoded result and returns each rejected submit to Kimchi without a tool retry loop', { timeout: 25_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-submit-sdk-'))
  const completed = { status: 'completed', output: ['first', 'second', 'third'] }
  const outputSchema = Type.Union([
    Type.Object({ status: Type.Literal('completed'), output: Type.Array(Type.String()) }),
    Type.Object({ status: Type.Literal('stopped'), error: Type.String() }),
    Type.Object({ status: Type.Literal('failed'), error: Type.String() })
  ], { 'x-desktop-agent': { label: 'fixture', tools: [], timeoutMs: 600000, retries: 0 } })
  const cases = [
    { result: JSON.stringify(completed), completed },
    { result: JSON.stringify({ status: 'completed', output: 12 }), error: /Validation failed/ },
    { result: JSON.stringify({ status: 'stopped', error: 'model cannot stop itself' }), error: /Only the workflow host/ },
    { result: JSON.stringify(JSON.stringify(completed)), error: /Validation failed/ },
    { result: '{invalid-json', error: /Validation failed/ },
    { result: completed, completed }
  ]
  const requests = [], io = []
  const server = createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk
    requests.push(JSON.parse(data))
    const index = requests.length - 1
    if (!cases[index]) { res.writeHead(400); res.end('Unexpected internal retry'); return }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = value => res.write(`data: ${JSON.stringify({ id: `response-${index}`, object: 'chat.completion.chunk', created: 1, model: relay.modelId, ...value })}\n\n`)
    send({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
    send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `submit-${index}`, type: 'function', function: { name: 'workflow_submit_result', arguments: JSON.stringify({ result: cases[index].result }) } }] }, finish_reason: null }] })
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    send({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } })
    res.end('data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const controller = new AbortController()
  const agent = new WorkflowPiSession({ type: 'agent.start', runId: 'run', request: { sessionId: 'chat', cwd: directory },
    runtime: { providerId: relay.providerId, modelId: relay.modelId, agentDir: directory, tools: [], systemPrompt: 'Submit your assigned result.', thinkingLevel: 'low', relay: { ...relay, baseUrl: `http://127.0.0.1:${server.address().port}/v1/bailian` } },
    attempt: { id: 'attempt', rowId: 1, turnId: 'one', prompt: 'work', providerId: relay.providerId, modelId: relay.modelId, opts: { tools: [], outputSchema } }
  }, controller.signal, { action() {}, usage() {}, io: line => io.push(line), settleTools: async () => {} }, [])
  try {
    for (const [index, fixture] of cases.entries()) {
      const result = await agent.turn('Submit the workflow result')
      assert.equal(requests.length, index + 1, 'one submission ends a Pi turn even when schema validation rejects it')
      assert.equal(result.error, undefined); assert.equal(result.cancelled, undefined)
      if (fixture.completed) {
        assert.deepEqual(result.submitted?.arguments.result, fixture.completed)
        assert.equal(result.submissionError, undefined)
      } else {
        assert.equal(result.submitted, undefined)
        assert.match(result.submissionError, fixture.error)
        assert(!result.submissionError.includes('Received arguments:'), 'repair guidance omits repeated raw payloads')
      }
    }
    assert.deepEqual(requests[0].tools.map(tool => tool.function.name), ['workflow_submit_result'])
    assert.deepEqual(requests[0].tools[0].function.parameters.properties.result, outputSchema, 'provider schema remains strict')
    const rawCall = io.find(line => line.name === 'assistant')
    assert.equal(JSON.parse(rawCall.text).content.find(part => part.type === 'toolCall').arguments.result, cases[0].result)
    assert.deepEqual(io.find(line => line.kind === 'turn_end').detail.submitted.arguments.result, completed)
  } finally {
    controller.abort(); await agent.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true })
  }
})
