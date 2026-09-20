import test from 'node:test'
import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
const src = fileURLToPath(new URL('../../src/', import.meta.url))
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@shared': src + 'shared', '@main': src + 'main' } })
const { WorkflowLibraryService } = await jiti.import('../../src/main/workflowLibrary/workflowLibrary.service.ts')
const { importWorkflowPackage } = await jiti.import('../../src/main/workflowLibrary/workflowPackageImport.ts')
const { createWorkflowLibraryRuntime } = await jiti.import('../../src/main/workflowLibrary/workflowLibraryRuntimeProvider.ts')
const { safePackagePath } = await jiti.import('../../src/shared/workflowPackage.ts')
const { loadWorkflowParser, parseDynamicWorkflow, DYNAMIC_ENTRY } = await jiti.import('../../src/main/agent/workflowEngine/dynamic/dynamicLoader.ts')
// The parser is an ESM-only module the CJS main bundle can only reach through a dynamic import, so
// it is loaded once at startup rather than per call (dynamicLoader.ts). A test skipping that load
// gets "the workflow parser has not finished loading" from every parse, which is the module saying
// exactly what is wrong — but the app awaits it at boot, so a test must too.
await loadWorkflowParser()

const META = { name: 'Text essentials', description: 'A demo.', whenToUse: 'When testing.', phases: [{ title: 'Prepare' }, { title: 'Report', detail: 'render' }] }
const script = (meta = {}) =>
  `export const meta = ${JSON.stringify({ ...META, ...meta }, null, 2)}\n\nphase('Prepare')\nconst a = await agent('hi', { label: 'A' })\nreturn { a }\n`

const temporary = t => { const root = mkdtempSync(join(tmpdir(), 'cowork-workflow-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root }
const pack = (root, dir, { source = script(), entry = DYNAMIC_ENTRY, files = {} } = {}) => {
  const path = join(root, dir)
  mkdirSync(path, { recursive: true })
  if (source !== null) writeFileSync(join(path, entry), source)
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(path, name, '..'), { recursive: true })
    writeFileSync(join(path, name), content)
  }
  return path
}
const service = root => new WorkflowLibraryService({ root: () => root })

test('meta is read from the script itself — there is no second document to drift from it', () => {
  const meta = parseDynamicWorkflow(script())
  assert.equal(meta.name, 'Text essentials')
  assert.deepEqual(meta.phases, [{ title: 'Prepare' }, { title: 'Report', detail: 'render' }])
  // Host-only keys the engine does not know survive the parse; that is what lets the manifest go.
  assert.equal(meta.whenToUse, 'When testing.')
  // Absent means opted in: a package written before the field existed must keep behaving as it did.
  assert.equal(meta.modelInvocation, true)
  assert.equal(parseDynamicWorkflow(script({ modelInvocation: false })).modelInvocation, false)
})

test('meta is validated, and a coerced boolean is refused rather than read as opted-in', () => {
  assert.throws(() => parseDynamicWorkflow('const x = 1'), /meta/)
  assert.throws(() => parseDynamicWorkflow(script({ name: '' })), /name/)
  assert.throws(() => parseDynamicWorkflow(script({ phases: [{ title: '' }] })), /phase title/)
  assert.throws(() => parseDynamicWorkflow(script({ phases: 'Find' })), /phases must be an array/)
  // "false" is truthy. Treating it as opted-in would put a withheld package in front of the model.
  assert.throws(() => parseDynamicWorkflow(script({ modelInvocation: 'false' })), /true or false/)
})

test('a package directory is listed from its script, and listing never executes it', t => {
  const root = temporary(t)
  pack(root, 'text-essentials', { source: script() + '\nthrow new Error("LISTING_MUST_NOT_EXECUTE")\n' })
  const library = service(root)
  t.after(() => library.dispose())
  const [item] = library.snapshot().items
  assert.equal(item.ref, 'local:text-essentials')
  assert.equal(item.error, null)
  assert.equal(item.name, META.name)
  assert.deepEqual(item.phases, ['Prepare', 'Report'])
  assert.equal(item.entry, DYNAMIC_ENTRY)
  assert.deepEqual(library.detail(item.ref).meta.phases, META.phases)
  assert.match(library.source(item.ref).text, /LISTING_MUST_NOT_EXECUTE/)
})

test('a broken package is listed with its reason instead of disappearing', t => {
  const root = temporary(t)
  pack(root, 'no-script', { source: null })
  pack(root, 'no-meta', { source: 'const x = 1\n' })
  pack(root, 'bad-meta', { source: script({ name: '' }) })
  pack(root, 'empty-script', { source: '' })
  mkdirSync(join(root, 'bad name!'), { recursive: true })
  const library = service(root)
  t.after(() => library.dispose())
  const items = library.snapshot().items
  assert.deepEqual(items.map(row => row.dir).sort(), ['bad name!', 'bad-meta', 'empty-script', 'no-meta', 'no-script'])
  for (const row of items) assert(row.error, `${row.dir} must report why it could not be read`)
  assert.match(items.find(row => row.dir === 'no-script').error, /No workflow script here/)
  assert.match(items.find(row => row.dir === 'empty-script').error, /is empty/)
  assert.match(items.find(row => row.dir === 'bad name!').error, /Rename this folder/)
  // A broken package keeps what could be read — the folder name stands in for the title.
  assert.equal(items.find(row => row.dir === 'no-meta').name, 'no-meta')
})

test('a package authored as .js is accepted — an extension alone is not a reason to refuse it', t => {
  const root = temporary(t)
  pack(root, 'as-js', { entry: 'workflow.js' })
  const library = service(root)
  t.after(() => library.dispose())
  const [item] = library.snapshot().items
  assert.equal(item.error, null)
  assert.equal(item.entry, 'workflow.js')
})

test('the scan is capped and reports what it dropped rather than truncating silently', t => {
  const root = temporary(t)
  for (let index = 0; index < 202; index++) pack(root, `package-${String(index).padStart(3, '0')}`)
  const library = service(root)
  t.after(() => library.dispose())
  const snapshot = library.snapshot()
  assert.equal(snapshot.items.length, 200)
  assert.equal(snapshot.dropped, 2)
})

test('the runtime lists only readable, model-invocable packages and resolves a ref at run time', async t => {
  const root = temporary(t)
  pack(root, 'text-essentials')
  pack(root, 'broken', { source: null })
  pack(root, 'withheld', { source: script({ modelInvocation: false }) })
  const library = service(root)
  t.after(() => library.dispose())
  const runtime = createWorkflowLibraryRuntime(library)
  const listed = await runtime.list()
  assert.deepEqual(listed.map(row => row.reference), ['local:text-essentials'], 'broken and withheld are both absent')
  assert.deepEqual(await runtime.resolve('local:text-essentials'), { kind: 'file', path: join(root, 'text-essentials', DYNAMIC_ENTRY) })
  await assert.rejects(runtime.resolve('local:broken'))
})

test('the run gate accepts only a scanned package entry inside the root', t => {
  const root = temporary(t)
  const outside = temporary(t)
  writeFileSync(join(outside, 'elsewhere.mjs'), 'export const meta = {}\n')
  pack(root, 'text-essentials', { files: { 'reference/cleanup.mjs': 'export const meta = {}\n' } })
  symlinkSync(join(outside, 'elsewhere.mjs'), join(root, 'text-essentials', 'linked.mjs'))
  const library = service(root)
  t.after(() => library.dispose())
  library.assertPath(join(root, 'text-essentials', DYNAMIC_ENTRY))
  library.assertPath(join(outside, 'elsewhere.mjs'))
  assert.throws(() => library.assertPath(join(root, 'text-essentials', 'reference/cleanup.mjs')), /entry/)
  library.assertPath(join(root, 'text-essentials', 'linked.mjs'))
})

test('a rescan reflects an edit on disk — the folder is the truth, not a cached copy', t => {
  const root = temporary(t)
  pack(root, 'text-essentials')
  const library = service(root)
  t.after(() => library.dispose())
  assert.equal(library.snapshot().items[0].name, META.name)
  writeFileSync(join(root, 'text-essentials', DYNAMIC_ENTRY), script({ name: 'Renamed in place' }))
  assert.equal(library.snapshot().items[0].name, 'Renamed in place')
  rmSync(join(root, 'text-essentials'), { recursive: true, force: true })
  assert.deepEqual(library.snapshot().items, [])
})

test('ZIP import validates the script before anything is written, and never overwrites', t => {
  const root = temporary(t)
  const zip = new AdmZip()
  zip.addFile(DYNAMIC_ENTRY, Buffer.from(script()))
  const bytes = zip.toBuffer()
  const first = importWorkflowPackage(root, bytes)
  const second = importWorkflowPackage(root, bytes)
  assert.notEqual(first, second)
  assert(existsSync(join(root, first, DYNAMIC_ENTRY)) && existsSync(join(root, second, DYNAMIC_ENTRY)))

  // An archive that would land as a broken package is refused at import, not after it is on disk.
  const bad = new AdmZip()
  bad.addFile(DYNAMIC_ENTRY, Buffer.from('const x = 1\n'))
  assert.throws(() => importWorkflowPackage(root, bad.toBuffer()), /meta/)
  const bare = new AdmZip()
  bare.addFile('readme.md', Buffer.from('hi'))
  assert.throws(() => importWorkflowPackage(root, bare.toBuffer()), new RegExp(DYNAMIC_ENTRY))
  assert.equal(readdirSync(root).filter(name => !name.startsWith('.')).length, 2, 'neither refusal left anything behind')

  for (const name of ['../escape.mjs', '/etc/passwd', 'a/../../b.mjs', 'con.mjs'])
    assert.throws(() => safePackagePath(name), /Unsafe workflow archive path/, name)
})
