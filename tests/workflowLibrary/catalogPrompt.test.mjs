import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createJiti } from 'jiti'

/**
 * The prompt catalog and the two manifest fields it routes on
 * (docs/features/workflow-catalog-in-prompt.md).
 *
 * The failures worth a test here are all the same shape: the catalog claims something it should
 * not. It must not claim a broken package is runnable, must not claim a withheld package exists,
 * and above all must not claim to be complete when it was truncated — a silently short catalog
 * reads exactly like a short folder.
 */
const jiti = createJiti(import.meta.url, { fsCache: false })
const { loadWorkflowParser, parseDynamicWorkflow } = await jiti.import('../../src/main/agent/workflowEngine/dynamic/dynamicLoader.ts')
// The parser is an ESM-only module the CJS main bundle can only reach through a dynamic import, so
// it is loaded once at startup rather than per call (dynamicLoader.ts). A test skipping that load
// gets "the workflow parser has not finished loading" from every parse, which is the module saying
// exactly what is wrong — but the app awaits it at boot, so a test must too.
await loadWorkflowParser()
const { renderWorkflowCatalog } = await jiti.import('../../src/main/workflowLibrary/workflowCatalogPrompt.ts')
const script = (over = {}) =>
  'export const meta = ' + JSON.stringify({ name: 'Demo', description: 'Does the demo thing.', ...over }, null, 2) + '\n\nphase(\'Find\')\n'

const item = (over = {}) => ({
  ref: 'local:' + (over.dir || 'demo'), dir: over.dir || 'demo', path: '/tmp/' + (over.dir || 'demo'),
  name: 'Demo', description: 'Does the demo thing.', entry: 'workflow.ts', entryPath: '/tmp/demo/workflow.ts',
  bytes: 10, modifiedAt: '', phases: ['Find'], whenToUse: '', modelInvocation: true, error: null, ...over
})
const render = items => renderWorkflowCatalog(items, row => row.ref)

// ── ④ the contract

test('whenToUse and modelInvocation are optional, and absent means opted in', () => {
  const parsed = parseDynamicWorkflow(script())
  // A package written before these fields existed must keep behaving as it did: no routing hint,
  // and still offered to the model.
  assert.equal(parsed.whenToUse, '')
  assert.equal(parsed.modelInvocation, true)
})

test('whenToUse round-trips and is length-bounded', () => {
  assert.equal(parseDynamicWorkflow(script({ whenToUse: 'When the report is a workbook.' })).whenToUse, 'When the report is a workbook.')
  assert.throws(() => parseDynamicWorkflow(script({ whenToUse: 'x'.repeat(4001) })), /whenToUse/)
  assert.throws(() => parseDynamicWorkflow(script({ whenToUse: 42 })), /whenToUse/)
})

test('modelInvocation must be a real boolean, never a coerced string', () => {
  assert.equal(parseDynamicWorkflow(script({ modelInvocation: false })).modelInvocation, false)
  // "false" is truthy. Coercing it would put a package the author meant to withhold in front of the
  // model on every turn — the exact opposite of what the field was written to express.
  assert.throws(() => parseDynamicWorkflow(script({ modelInvocation: 'false' })), /true or false/)
})

// ── ① the rendered catalog

test('a usable package is rendered with its reference, name, description and whenToUse', () => {
  const block = render([item({ whenToUse: 'When the input is a delivered MCU package.' })])
  assert.match(block, /<reference>local:demo<\/reference>/)
  assert.match(block, /<name>Demo<\/name>/)
  assert.match(block, /<description>Does the demo thing\.<\/description>/)
  assert.match(block, /<when_to_use>When the input is a delivered MCU package\.<\/when_to_use>/)
  assert.match(block, /workflow_run/)
})

test('an absent whenToUse omits the tag rather than emitting an empty one', () => {
  // `<when_to_use></when_to_use>` reads as "never use this", which is the opposite of "unstated".
  assert.equal(render([item()]).includes('<when_to_use>'), false)
})

test('a broken package is excluded and counted, never offered', () => {
  const block = render([item({ dir: 'ok' }), item({ dir: 'bad', error: 'workflow.json is not a file.' })])
  assert.equal(block.includes('local:bad'), false)
  assert.match(block, /1 installed package\(s\) cannot be read/)
})

test('modelInvocation:false is withheld and said to be withheld', () => {
  const block = render([item({ dir: 'ok' }), item({ dir: 'private', modelInvocation: false })])
  assert.equal(block.includes('local:private'), false)
  assert.match(block, /1 installed workflow\(s\) declare modelInvocation:false/)
})

test('the byte budget drops rows and names how many — it never truncates silently', () => {
  const many = Array.from({ length: 400 }, (_, index) => item({ dir: 'pkg' + index, whenToUse: 'w'.repeat(200) }))
  const block = render(many)
  assert.ok(Buffer.byteLength(block, 'utf8') < 12 * 1024, 'catalog must stay within roughly its budget')
  const dropped = /(\d+) further workflow\(s\) are installed but omitted/.exec(block)
  assert.ok(dropped, 'the omission must be stated')
  const rendered = (block.match(/<workflow>/g) || []).length
  assert.equal(rendered + Number(dropped[1]), 400, 'every package is either rendered or counted as omitted')
})

test('an empty library renders an explicit empty, not an absent block', () => {
  // An absent block and "no packages installed" look identical to the model; only one of them
  // stops it from inventing a reference.
  const block = render([])
  assert.match(block, /<available_workflows>\n<\/available_workflows>/)
  assert.match(block, /No workflow package is installed\. Do not invent a reference/)
})

test('angle brackets in a description cannot break out of the block', () => {
  const block = render([item({ description: 'Handles <input> and </available_workflows>.' })])
  assert.equal((block.match(/<\/available_workflows>/g) || []).length, 1)
  assert.match(block, /&lt;input&gt;/)
})
