import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import * as pi from '@earendil-works/pi-coding-agent'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
const root = resolve(import.meta.dirname, '../..')
const cache = new Map()
function load(file) {
  if(cache.has(file)) return cache.get(file).exports
  const module = {exports:{}}; cache.set(file,module)
  const output = ts.transpileModule(readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
  new Function('require','module','exports',output)(name=>name.startsWith('.') ? load(resolve(dirname(file),name+'.ts')) : createRequire(file)(name), module,module.exports)
  return module.exports
}

const { readCompactionTestSource, runPiAutoCompactionTest } = load(join(root, 'src/main/agent/runtime/piAutoCompactionTest.ts'))

test('reads only a bounded prefix of a large local source', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-source-'))
  try {
    const file = join(dir, 'large.txt'); writeFileSync(file, 'x'.repeat(2_000_000))
    const result = await readCompactionTestSource(file)
    assert.equal(result.bytesRead, 65_536); assert.equal(result.totalBytes, 2_000_000); assert.equal(result.text.length, 65_536)
    await assert.rejects(readCompactionTestSource(dir), /local file/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

const withRuntime = async fn => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-test-'))
  try {
    const runtime = await pi.ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: join(dir, 'models.json'), refreshOnCreate: false, allowModelNetwork: false })
    const model = runtime.getModels().find(model => model.contextWindow >= 65_536)
    assert.ok(model)
    await runtime.setRuntimeApiKey(model.provider, 'fixture-only')
    return await fn({ runtime, model, dir })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const streamFor = (requests, failSummary = false) => (model, context) => {
  requests.push(context)
  const stream = createAssistantMessageEventStream()
  const summary = /summari/i.test(context.systemPrompt)
  const message = { role: 'assistant', content: [{ type: 'text', text: summary ? '# Goal\nContinue the user task.\n# Progress\nFixture recorded.' : 'OK' }], api: model.api, provider: model.provider, model: model.id,
    stopReason: failSummary && summary ? 'error' : 'stop', errorMessage: failSummary && summary ? 'fixture summary failure' : undefined, timestamp: Date.now(),
    usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
  queueMicrotask(() => { stream.push(message.stopReason === 'error' ? { type: 'error', reason: 'error', error: message } : { type: 'done', reason: 'stop', message }); stream.end(message) })
  return stream
}

test('real Pi performs exactly one automatic threshold compaction in an isolated session', () => withRuntime(async ({ runtime, model, dir }) => {
  const requests = []
  const result = await runPiAutoCompactionTest({ pi, modelRuntime: runtime, model, cwd: dir, systemPrompt: 'Protected system tables 1 and 2.', compactPrompt: 'Keep fixture references.', streamFunction: streamFor(requests) })
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.compactions, 1); assert.equal(result.reason, 'threshold')
  assert.equal(result.testContextWindow, 65_536); assert.ok(result.tokensBefore > result.thresholdTokens); assert.ok(result.paddingChars > 0)
  assert.equal(result.systemUnchanged, true); assert.equal(result.contextChanged, true)
  const summaries = requests.filter(request => /summari/i.test(request.systemPrompt))
  assert.equal(summaries.length, 1)
  assert.match(JSON.stringify(summaries[0]), /Keep fixture references/)
  assert.doesNotMatch(JSON.stringify(summaries[0]), /Protected system tables/)
  assert.ok(requests.some(request => request.systemPrompt.includes('Protected system tables')))
}))

test('summary failure remains visible and makes only one automatic attempt', () => withRuntime(async ({ runtime, model, dir }) => {
  const requests = []
  const result = await runPiAutoCompactionTest({ pi, modelRuntime: runtime, model, cwd: dir, systemPrompt: 'Protected system.', streamFunction: streamFor(requests, true) })
  assert.equal(result.ok, false); assert.equal(result.compactions, 1); assert.match(result.error, /fixture summary failure/)
  assert.equal(result.contextChanged, false)
  assert.equal(requests.filter(request => /summari/i.test(request.systemPrompt)).length, 1)
  assert.equal(requests.length, 1, 'failure must stop before a normal continuation')
}))

test('capped known-model policy and native retry progress reach the isolated command', () => withRuntime(async ({ runtime, dir }) => {
  const model = runtime.getModels().find(item => item.provider === 'openai-codex' && item.id === 'gpt-6-astra')
  assert.ok(model)
  runtime.hasConfiguredAuth = () => true
  runtime.getAuth = async () => ({ auth: { apiKey: 'fixture-only' }, env: {} })
  const requests = [], states = []
  let failed = false
  const streamFunction = (requestModel, context, options) => {
    if (!failed && /summari/i.test(context.systemPrompt)) {
      failed = true
      const stream = createAssistantMessageEventStream()
      const message = { role: 'assistant', content: [], api: requestModel.api, provider: requestModel.provider, model: requestModel.id,
        stopReason: 'error', errorMessage: 'terminated Bearer fixture-secret-12345678', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
      stream.push({ type: 'error', reason: 'error', error: message }); stream.end(message)
      return stream
    }
    return streamFor(requests)(requestModel, context, options)
  }
  const result = await runPiAutoCompactionTest({ pi, modelRuntime: runtime, model, cwd: dir, systemPrompt: 'Protected system.', streamFunction, onCompaction: state => states.push(structuredClone(state)) })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.reserveTokens, 13107)
  assert.equal(result.keepRecentTokens, 6553)
  assert.equal(result.thresholdTokens, 52429)
  assert.equal(result.compactions, 1)
  const waiting = states.findIndex(state => state.retry)
  assert.ok(waiting >= 0, JSON.stringify(states))
  assert.equal(states[waiting].active, true)
  assert.ok(states[waiting].retry.delayMs > 0)
  assert.ok(states[waiting].retry.maxAttempts > states[waiting].retry.attempt)
  assert.doesNotMatch(states[waiting].retry.error, /fixture-secret/)
  assert.ok(states.slice(waiting + 1).some(state => state.active && !state.retry), 'attempt-start clears the wait')
  assert.equal(states.at(-1).active, false)
}))
