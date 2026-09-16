const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/main/agent/steering', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }; new Function('require', 'module', 'exports', code)(require, module, module.exports); return module.exports
}
const { BackgroundContextInbox } = load('backgroundContextInbox.ts')
const { TurnSteeringInbox } = load('turnSteeringInbox.ts')
const surface = () => { const entries = []; return { entries: () => entries, appendCustomMessage(customType, content) { entries.push({ type: 'custom_message', customType, content }); return String(entries.length) } } }
const tick = () => new Promise(resolve => setImmediate(resolve))
test('idle/reload completion stays in context once and does not start a model', () => {
  const notes = new BackgroundContextInbox(), context = surface()
  notes.retain('run-1', 'completed')
  notes.flush(context); notes.retain('run-1', 'completed'); notes.flush(context)
  assert.equal(context.entries().length, 1)
  const reload = new BackgroundContextInbox(); reload.retain('run-1', 'completed'); reload.flush(context)
  assert.equal(context.entries().length, 1)
  reload.reset(); reload.flush(surface())
})
test('live completion steers once and an acknowledged message is not appended again', async () => {
  const notes = new BackgroundContextInbox(), inbox = new TurnSteeringInbox(), context = surface(), calls = []
  inbox.start({ enqueueSteering: async message => { calls.push(message); return true }, takePendingSteering: () => [] })
  notes.retain('run-1', 'done', inbox); notes.retain('run-1', 'done', inbox)
  notes.flush(context)
  await tick(); assert.equal(calls.length, 1)
  inbox.consume('run-1'); await tick(); notes.flush(context)
  assert.equal(context.entries().length, 0)
})
test('completion during preparation or settled gap survives cancellation and is flushed before next model', async () => {
  const notes = new BackgroundContextInbox(), inbox = new TurnSteeringInbox(), context = surface()
  notes.retain('run-1', 'failed', inbox)
  notes.flush(context); assert.equal(context.entries().length, 0)
  inbox.cancel('preparation failed'); await tick()
  notes.flush(context); assert.equal(context.entries()[0].content, 'failed')
  notes.retain('run-2', 'stopped', inbox); notes.flush(context)
  assert.equal(context.entries().length, 2)
})
test('reset preserves evidence and old delivery cannot mark a new context delivered', async () => {
  const notes = new BackgroundContextInbox(), inbox = new TurnSteeringInbox()
  notes.retain('run-1', 'done', inbox); notes.reset(); inbox.consume('run-1'); await tick()
  const context = surface(); notes.flush(context); assert.equal(context.entries().length, 1)
  const other = new BackgroundContextInbox(); const foreign = surface(); other.flush(foreign); assert.equal(foreign.entries().length, 0)
})
