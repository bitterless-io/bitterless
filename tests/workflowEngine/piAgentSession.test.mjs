import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createJiti } from 'jiti'
import { Type } from 'typebox'
const root = fileURLToPath(new URL('../../', import.meta.url))
const jiti = createJiti(import.meta.url, { fsCache: false })
const { WorkflowPiSession, WORKFLOW_SUBMIT_RESULT } = await jiti.import(join(root, 'src/main/agent/workflowEngine/piAgentSession.ts'))
const { AgentHostTools } = await jiti.import(join(root, 'src/main/agent/workflowEngine/agentHostTools.ts'))
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const schema = Type.Object({ count: Type.Number() })
const start = (outputSchema = schema) => ({ type: 'agent.start', request: { sessionId: 'chat', cwd: '/tmp' }, runId: 'run', runtime: { tools: [] }, attempt: { id: 'attempt', rowId: 1, turnId: 'turn1', prompt: 'work', opts: { outputSchema } } })
const assistant = (text, usage = { totalTokens: 3 }, extra = {}) => ({ role: 'assistant', content: [{ type: 'text', text }], usage, ...extra })
function fakeSession(prompt = async () => {}) {
 let listener
 const operations = []
 const session = {
  messages: [],
  async prompt(text) { operations.push(['prompt', text]); await prompt(text, session, event => listener?.(event)) },
  subscribe(fn) { listener = fn; operations.push(['subscribe']); return () => { operations.push(['unsubscribe']); listener = undefined } },
  setAutoRetryEnabled(enabled) { operations.push(['autoRetry', enabled]) },
  async abort() { operations.push(['abort']) },
  dispose() { operations.push(['dispose']) },
  getLastAssistantText() { return session.messages.findLast(message => message.role === 'assistant')?.content?.[0]?.text }
 }
 return { session, operations }
}
function fixture(prompt, outputSchema = schema, extra = {}) {
 const controller = new AbortController(), usage = [], actions = [], io = []
 const fake = fakeSession(prompt)
 let registered, factoryCalls = 0
 const agent = new WorkflowPiSession(start(outputSchema), controller.signal, { action: (...args) => actions.push(args), usage: messages => usage.push(messages), io: line => io.push(line), settleTools: async () => {}, ...extra }, [], async (_start, tools) => { registered = tools; factoryCalls++; return fake.session })
 return { agent, controller, usage, actions, io, ...fake, tools: () => registered, factoryCalls: () => factoryCalls }
}

test('diagnostics retain effective prompts, repair history, active tool schemas, full results, and final messages', async () => {
 const output = assistant('analysis complete', { totalTokens: 9 }, { stopReason: 'stop' })
 output.content.unshift({ type: 'thinking', thinking: 'Check the actual files.' })
 const toolResult = { content: [{ type: 'text', text: 'full source contents' }], details: { file: '/tmp/source.ts', nested: { value: 42 } } }
 const h = fixture(async (prompt, session, emit) => {
  session.messages.push({ role: 'user', content: prompt })
  emit({ type: 'message_update', message: output })
  emit({ type: 'tool_execution_start', toolName: 'read', toolCallId: 'call-1', args: { path: '/tmp/source.ts' } })
  emit({ type: 'tool_execution_end', toolName: 'read', toolCallId: 'call-1', args: { path: '/tmp/source.ts' }, result: toolResult, isError: false })
  session.messages.push(output)
  emit({ type: 'message_end', message: output })
 })
 h.session.systemPrompt = 'Effective system prompt with tool guidance.'
 h.session.getActiveToolNames = () => ['read', WORKFLOW_SUBMIT_RESULT]
 h.session.getAllTools = () => [{ name: 'read', description: 'read source', parameters: { path: 'string' } }, { name: 'disabled', parameters: {} }, { name: WORKFLOW_SUBMIT_RESULT, parameters: { result: schema } }]
 await h.agent.turn('initial')
 await h.agent.turn('repair')
 const prompts = h.io.filter(line => line.kind === 'prompt')
 assert.deepEqual(prompts.map(line => line.turn), [1, 2])
 const first = JSON.parse(prompts[0].text), second = JSON.parse(prompts[1].text)
 assert.equal(first.systemPrompt, h.session.systemPrompt)
 assert.deepEqual(first.messages, [])
 assert.equal(first.prompt, 'initial')
 assert.deepEqual(first.tools.map(tool => tool.name), ['read', WORKFLOW_SUBMIT_RESULT])
 assert.deepEqual(first.tools[1].parameters.result, schema)
 assert.deepEqual(second.messages, [{ role: 'user', content: 'initial' }, output])
 assert.equal(second.prompt, 'repair')
 const tool = h.io.find(line => line.kind === 'tool_result')
 assert.equal(tool.name, 'read'); assert.equal(tool.subject, 'call-1')
 assert.deepEqual(JSON.parse(tool.text), { args: { path: '/tmp/source.ts' }, result: toolResult, isError: false })
 const messages = h.io.filter(line => line.name === 'assistant')
 assert.equal(messages.length, 2, 'only message_end writes assistant output, never streaming deltas')
 assert.deepEqual(JSON.parse(messages[0].text), output)
 assert.deepEqual(h.io.filter(line => line.kind === 'turn_end').map(line => [line.turn, line.subject, line.detail.usage.totalTokens]), [[1, 'completed', 9], [2, 'completed', 9]])
 await h.agent.close()
})

test('diagnostics retain provider failure, initialization failure, and cancellation outcomes', async () => {
 const failed = fixture(async (_prompt, _session, emit) => emit({ type: 'message_end', message: assistant('', undefined, { stopReason: 'error', errorMessage: 'context window exceeded' }) }))
 await failed.agent.turn('too much context')
 assert.equal(failed.io.at(-1).subject, 'failed')
 assert.equal(failed.io.at(-1).detail.error.message, 'context window exceeded')
 assert.equal(JSON.parse(failed.io.find(line => line.name === 'assistant').text).errorMessage, 'context window exceeded')
 await failed.agent.close()
 const cancelled = fixture(async () => { cancelled.controller.abort() })
 await cancelled.agent.turn('stop')
 assert.equal(cancelled.io.at(-1).subject, 'cancelled')
 assert.equal(cancelled.io.at(-1).detail.cancelled, true)
 await cancelled.agent.close()
 const io = [], agent = new WorkflowPiSession(start(), new AbortController().signal, { action() {}, usage() {}, io: line => io.push(line), settleTools: async () => {} }, [], async () => { throw Error('auth unavailable') })
 await assert.rejects(agent.turn('work'), /auth unavailable/)
 assert.equal(io[0].kind, 'turn_end'); assert.equal(io[0].turn, 1)
 assert.equal(io[0].detail.error, 'auth unavailable')
 await agent.close()
})

test('diagnostics redact relay credentials across prompts, nested results, assistant errors, and object keys', async () => {
 const apiKey = 'private-key-"with-escape\\and-newline\n', command = start(), io = []
 command.runtime.relay = { apiKey, headers: { authorization: apiKey } }
 command.runtime.authPath = '/not-a-diagnostic-auth-file'
 const fake = fakeSession(async (_text, _session, emit) => {
  emit({ type: 'tool_execution_start', toolName: apiKey, toolCallId: apiKey, args: { apiKey } })
  emit({ type: 'tool_execution_end', toolName: apiKey, toolCallId: apiKey, args: { apiKey }, result: { [apiKey]: apiKey, nested: [{ text: apiKey }] }, isError: true })
  emit({ type: 'message_end', message: assistant(apiKey, undefined, { stopReason: 'error', errorMessage: `echo ${apiKey}` }) })
 })
 fake.session.systemPrompt = `system ${apiKey}`
 fake.session.messages = [{ role: 'user', content: apiKey }]
 const agent = new WorkflowPiSession(command, new AbortController().signal, { action() {}, usage() {}, io: line => io.push(line), settleTools: async () => {} }, [], async () => fake.session)
 assert.equal((await agent.turn(apiKey)).error.message, 'echo [redacted]')
 assert.equal(io.length, 4)
 assert.equal(JSON.stringify(io).includes('private-key'), false)
 assert.equal(JSON.stringify(io).includes('/not-a-diagnostic-auth-file'), false)
 assert.equal(JSON.parse(io[0].text).systemPrompt, 'system [redacted]')
 assert.deepEqual(JSON.parse(io[1].text).result, { '[redacted]': '[redacted]', nested: [{ text: '[redacted]' }] })
 await agent.close()
})

test('diagnostic serialization and transport failures do not change a model outcome', async () => {
 const h = fixture(async (_text, session, emit) => {
  const circular = {}; circular.self = circular
  emit({ type: 'tool_execution_end', toolName: 'read', toolCallId: 'call', result: circular, isError: false })
  const message = assistant('done')
  session.messages.push(message); emit({ type: 'message_end', message })
 }, schema, { io() { throw Error('transport closed') } })
 const result = await h.agent.turn('work')
 assert.equal(result.text, 'done'); assert.equal(result.error, undefined)
 await h.agent.close()
})

test('repair turns reuse one Pi session and only a real submit tool call returns structured output', async () => {
 let calls = 0
 const h = fixture(async (_prompt, session, emit) => {
  session.messages.push(assistant(calls++ ? 'submitted' : '{"result":{"count":1}}', { totalTokens: calls * 3 }))
  emit({ type: 'tool_execution_start', toolName: 'read', args: { path: '/tmp/source.ts' } })
  if (calls === 2) {
   const submit = h.tools().find(tool => tool.name === WORKFLOW_SUBMIT_RESULT)
   assert.equal(submit.parameters.properties.result.properties.count.type, 'number')
   const result = await submit.execute('submit', { result: { count: 2 } })
   assert.equal(result.terminate, true)
  }
 })
 const first = await h.agent.turn('initial')
 assert.equal(first.submitted, undefined)
 assert.equal(first.usage.totalTokens, 3)
 const repaired = await h.agent.turn('use the result tool')
 assert.deepEqual(repaired.submitted, { tool: WORKFLOW_SUBMIT_RESULT, arguments: { result: { count: 2 } } })
 assert.equal(repaired.usage.totalTokens, 6)
 assert.equal(h.factoryCalls(), 1)
 assert.equal(h.operations.some(([name]) => name === 'dispose'), false)
 assert.deepEqual(h.actions[0], ['read · source.ts', 'read · source.ts'])
 assert.equal(h.usage.flat().every(message => !('content' in message)), true)
 await h.agent.close(); await h.agent.close()
 assert.deepEqual(h.operations.slice(-3), [['abort'], ['unsubscribe'], ['dispose']])
 assert.equal(h.operations.filter(([name]) => name === 'dispose').length, 1)
})

test('invalid result and model-authored stopped outcome never create a submission', async () => {
 const outcomeSchema = Type.Union([
  Type.Object({ status: Type.Literal('completed'), output: schema }),
  Type.Object({ status: Type.Literal('stopped'), error: Type.String() })
 ], { 'x-desktop-agent': { label: 'agent' } })
 const h = fixture(async () => {
  const submit = h.tools().find(tool => tool.name === WORKFLOW_SUBMIT_RESULT)
  await assert.rejects(submit.execute('wrong', { result: { status: 'completed', output: { count: 'bad' } } }), /output schema/)
  await assert.rejects(submit.execute('spoof', { result: { status: 'stopped', error: 'pretend user stopped' } }), /Only the workflow host/)
 }, outcomeSchema)
 assert.equal((await h.agent.turn('work')).submitted, undefined)
 await h.agent.close()
})

test('submission compatibility decodes once only when the original schema validates the decoded value', async () => {
 const h = fixture(async () => {})
 await h.agent.turn('work')
 const submit = h.tools().find(tool => tool.name === WORKFLOW_SUBMIT_RESULT)
 const raw = { result: JSON.stringify({ count: 2 }) }
 const prepared = submit.prepareArguments(raw)
 assert.deepEqual(prepared, { result: { count: 2 } })
 assert.equal(typeof raw.result, 'string', 'raw provider arguments remain available for diagnostics')
 for (const args of [null, [], { result: '{invalid' }, { result: '{"count":"2"}' }, { result: JSON.stringify(raw.result) }]) {
  assert.equal(submit.prepareArguments(args), args, 'malformed, double-encoded, and wrong-field-type values are never coerced')
 }
 await h.agent.close()
 const strings = fixture(async () => {}, Type.String())
 await strings.agent.turn('work')
 const stringSubmit = strings.tools().find(tool => tool.name === WORKFLOW_SUBMIT_RESULT)
 const stringResult = { result: '{"count":2}' }
 assert.equal(stringSubmit.prepareArguments(stringResult), stringResult, 'an output schema accepting strings retains literal JSON text')
 await strings.agent.close()
})

test('provider errors and context errors remain visible and cannot reuse previous turn text', async () => {
 let count = 0
 const h = fixture(async (_text, session, emit) => {
  if (++count === 1) session.messages.push(assistant('previous text'))
  else if (count === 2) emit({ type: 'message_end', message: assistant('', undefined, { stopReason: 'error', errorMessage: 'context window exceeded' }) })
  else throw new Error('provider disconnected')
 })
 await h.agent.turn('first')
 const context = await h.agent.turn('second')
 assert.equal(context.error.kind, 'context-window-exceeded')
 assert.equal(context.error.message, 'context window exceeded')
 assert.equal(context.text, '')
 const provider = await h.agent.turn('third')
 assert.deepEqual(provider.error, { kind: 'provider-error', message: 'provider disconnected' })
 assert.equal(provider.text, '')
 await h.agent.close()
})

test('a relay error cannot expose its runtime key through workflow results', async () => {
 const command = start(), controller = new AbortController()
 command.runtime.relay = { apiKey: 'fixture-private-runtime-key' }
 const fake = fakeSession(async () => { throw Error('Provider echoed fixture-private-runtime-key') })
 const agent = new WorkflowPiSession(command, controller.signal, { action() {}, usage() {}, settleTools: async () => {} }, [], async () => fake.session)
 assert.equal((await agent.turn('work')).error.message, 'Provider echoed [redacted]')
 await agent.close()
})

test('host cancellation waits for tool.result and emits only one cancellation', async () => {
 const events = [], signal = new AbortController()
 const bridge = new AgentHostTools({ sessionId: 'chat', runId: 'run', agentId: '1' }, 'attempt', event => events.push(event))
 const [tool] = bridge.tools([{ name: 'host', description: 'host tool', params: [{ name: 'value', type: 'string', required: true }] }])
 const work = tool.execute('call', { value: 'ok' }, signal.signal)
 const rejected = assert.rejects(work, /cancelled/)
 let settled = false
 const waiting = bridge.settled().then(() => { settled = true })
 signal.abort(); bridge.cancelAll(); await tick()
 assert.equal(settled, false)
 assert.equal(events.filter(event => event.type === 'tool.cancel').length, 1)
 bridge.accept({ type: 'tool.result', callId: events[0].request.callId, result: 'late success' })
 await rejected; await waiting
 assert.equal(settled, true)
 await assert.rejects(tool.execute('next', {}), /cancelled/)
})

test('close waits for abort, active turn, and host work before unsubscribing and disposal', async () => {
 const prompt = deferred(), abort = deferred(), tools = deferred()
 const h = fixture(async () => prompt.promise, schema, { settleTools: () => tools.promise })
 h.session.abort = async () => { h.operations.push(['abort']); await abort.promise }
 const turn = h.agent.turn('work'); await tick()
 h.controller.abort()
 let closed = false
 const closing = h.agent.close().then(() => { closed = true })
 await tick()
 assert.equal(closed, false)
 await assert.rejects(h.agent.turn('late'), /closing/)
 prompt.resolve(); abort.resolve(); await tick()
 assert.equal(h.operations.some(([name]) => name === 'dispose'), false)
 tools.resolve(); await closing
 assert.equal((await turn).cancelled, true)
 assert.deepEqual(h.operations.slice(-3), [['abort'], ['unsubscribe'], ['dispose']])
})

test('late session initialization is still disposed after cancellation', async () => {
 const ready = deferred(), controller = new AbortController(), fake = fakeSession()
 const agent = new WorkflowPiSession(start(), controller.signal, { action() {}, usage() {}, settleTools: async () => {} }, [], () => ready.promise)
 const turn = agent.turn('work'); const rejected = assert.rejects(turn)
 controller.abort(); const closing = agent.close()
 ready.resolve(fake.session); await closing; await rejected
 assert.equal(fake.operations.some(([name]) => name === 'prompt'), false)
 assert.deepEqual(fake.operations.slice(-3), [['abort'], ['unsubscribe'], ['dispose']])
})

test('cleanup failure cannot become success and still attempts unsubscribe and dispose', async () => {
 const h = fixture(async () => {})
 await h.agent.turn('work')
 h.session.abort = async () => { throw new Error('abort failed') }
 await assert.rejects(h.agent.close(), /cleanup was not confirmed: abort failed/)
 assert.deepEqual(h.operations.slice(-2), [['unsubscribe'], ['dispose']])
})
