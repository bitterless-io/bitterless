import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { createJiti } from 'jiti'
const jiti = createJiti(import.meta.url, { fsCache: false })
const { WorkflowPackageStorage } = await jiti.import('../../src/main/workflowLibrary/workflowPackageStorage.ts')
const { WorkflowLibraryService } = await jiti.import('../../src/main/workflowLibrary/workflowLibrary.service.ts')
const { createWorkflowLibraryRuntime } = await jiti.import('../../src/main/workflowLibrary/workflowLibraryRuntimeProvider.ts')
const { sharedWorkflowDemoFiles } = await jiti.import('../../src/shared/sharedWorkflowDemo.ts')
const { parseWorkflowManifest } = await jiti.import('../../src/shared/workflowPackage.ts')
const canonical = JSON.parse(readFileSync(new URL('../../examples/institution-workflow/workflow.json', import.meta.url), 'utf8'))
const archive = (manifest = canonical, extra = []) => {
  const zip = new AdmZip()
  zip.addFile('workflow.json', Buffer.from(JSON.stringify(manifest)))
  zip.addFile('workflow.ts', Buffer.from('throw new Error("PREVIEW_MUST_NOT_EXECUTE");'))
  for (const [name, bytes] of extra) zip.addFile(name, Buffer.from(bytes))
  return zip.toBuffer()
}
const metadata = (bytes, revision = 1, institution_id = 7) => ({ id: 1, institution_id, revision, name: 'Fixture workflow', description: 'Test fixture only', file_name: 'fixture.zip', size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex'), created_at: '', updated_at: '' })
const temporary = (t) => { const root = mkdtempSync(join(tmpdir(), 'bl-workflow-test-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root }

test('manifest validates graph identities, edges, kind, limits and paths', () => {
  assert.deepEqual(parseWorkflowManifest(canonical), canonical)
  for (const mutate of [m => m.graph.nodes.push(m.graph.nodes[0]), m => m.graph.edges.push({ from: 'missing', to: 'prepare' }), m => m.graph.nodes[0].kind = 'script', m => m.entry = '../workflow.ts', m => m.entry = 'C:/workflow.ts', m => m.entry = 'workflow.js', m => m.graph.nodes = new Array(201).fill(m.graph.nodes[0]), m => m.graph.edges = new Array(501).fill(m.graph.edges[0]), m => m.version = 2]) {
    const value = structuredClone(canonical); mutate(value); assert.throws(() => parseWorkflowManifest(value))
  }
})
test('preview stores JSON and TypeScript bytes without executing code; replacement preserves old files', t => {
  const storage = new WorkflowPackageStorage(temporary(t)), bytes = archive()
  const one = storage.install(metadata(bytes), bytes)
  assert.equal(one.manifest.engine, 'kimchi-0.0.9')
  assert.match(readFileSync(one.entry, 'utf8'), /PREVIEW_MUST_NOT_EXECUTE/)
  const two = storage.install(metadata(bytes, 2), bytes)
  assert.equal(storage.read(1).revision, 2); assert.notEqual(one.directory, two.directory); assert(existsSync(one.entry))
  storage.remove(1); assert.deepEqual(storage.list(), []); assert(existsSync(one.entry)); assert(existsSync(two.entry))
})
test('hash, size, invalid manifest and stale activation never replace a valid install', t => {
  const storage = new WorkflowPackageStorage(temporary(t)), bytes = archive()
  const initial = storage.install(metadata(bytes), bytes)
  assert.throws(() => storage.install({ ...metadata(bytes, 2), hash: '0'.repeat(64) }, bytes), /SHA/)
  assert.throws(() => storage.install({ ...metadata(bytes, 2), size: bytes.length + 1 }, bytes), /size/)
  const invalid = archive({ ...canonical, engine: 'unknown' })
  assert.throws(() => storage.install(metadata(invalid, 2), invalid), /Unsupported/)
  assert.throws(() => storage.install(metadata(bytes, 2), bytes, () => false), /changed/)
  assert.equal(storage.read(1).entry, initial.entry)
})
test('ZIP rejects case and duplicate collisions, file-parent collisions, special files and declared bombs', t => {
  const storage = new WorkflowPackageStorage(temporary(t))
  const invalids = [archive(canonical, [['WORKFLOW.ts', 'duplicate']]), archive(canonical, [['assets', 'file'], ['assets/file.txt', 'child']])]
  const duplicate = Buffer.from(invalids[0]); for (let i = duplicate.indexOf('WORKFLOW.ts'); i >= 0; i = duplicate.indexOf('WORKFLOW.ts', i + 1)) duplicate.write('workflow.ts', i)
  invalids.push(duplicate)
  const symlink = new AdmZip(archive()); symlink.getEntry('workflow.ts').attr = (0o120777 << 16) >>> 0; invalids.push(symlink.toBuffer())
  const bomb = new AdmZip(archive()); const bombEntry = bomb.getEntry('workflow.ts'); bombEntry.header.size = 101 * 1024 * 1024; invalids.push(bomb.toBuffer())
  for (const bytes of invalids) assert.throws(() => storage.install(metadata(bytes), bytes))
})

const fixture = t => {
  const root = temporary(t), bytes = archive()
  let session = { token: 'fixture-token', baseUrl: 'https://fixture.invalid' }
  let rows = [metadata(bytes)], memberships = [7, 8], mode = '', hold, downloadedHeaders, detailDelay
  const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
  const fetch = async (input, options = {}) => {
    const url = new URL(input), body = options.body ? JSON.parse(options.body) : {}
    if (url.hostname.endsWith('.aliyuncs.com')) {
      downloadedHeaders = options.headers
      if (hold) await hold
      if (mode === 'corrupt') return new Response(Buffer.from('corrupt'))
      return new Response(bytes)
    }
    assert.equal(options.headers['-x-bl-token'], session.token)
    if (mode === 'offline') throw new Error('Fixture offline')
    if (mode === 'revoked' && url.pathname.startsWith('/workflow')) return new Response('{}', { status: 403 })
    if (url.pathname === '/auth/me') return response({ id: 12, scope: 'customer', status: 'active' })
    if (url.pathname === '/institution/mine') return response({ list: memberships.map(id => ({ role: 'member', institution: { id, name: `Fixture institution ${id}` } })) })
    if (url.pathname === '/workflow/list') return response({ list: rows.map(row => ({ ...row, institution_id: body.institution_id })), total: rows.length })
    if (url.pathname === '/workflow/detail') { if (detailDelay) await detailDelay; return response({ ...rows.find(row => row.id === body.id), institution_id: body.institution_id }) }
    if (url.pathname === '/workflow/check-updates') return response({ list: body.installed.map(item => { const row = rows.find(row => row.id === item.id); return { id: item.id, status: !row ? 'removed' : item.revision === row.revision ? 'up_to_date' : 'updated', workflow: row ? { ...row, institution_id: body.institution_id } : null } }) })
    if (url.pathname === '/workflow/download-url') return response({ ...rows[0], download_url: 'https://fixture.oss-cn-shanghai.aliyuncs.com/archive.zip?signature=fixture' })
    throw new Error(`Unexpected path ${url.pathname}`)
  }
  const service = new WorkflowLibraryService({ session: () => session, root: () => root, fetch })
  t.after(() => service.dispose())
  return { service, root, bytes, set rows(value) { rows = value }, set mode(value) { mode = value }, set hold(value) { hold = value }, set detailDelay(value) { detailDelay = value }, set memberships(value) { memberships = value }, logout() { session = null; service.reset() }, get downloadedHeaders() { return downloadedHeaders } }
}
test('real service envelope -> install; download gets no customer credentials; failed poll preserves old revision', async t => {
  const f = fixture(t), state = await f.service.snapshot()
  assert.equal(state.status, 'ready'); assert.equal(state.institutionId, 7)
  const detail = await f.service.preview({ id: 1, context: state.context })
  assert.equal(detail.installedRevision, 1); assert.equal(f.downloadedHeaders, undefined)
  f.rows = [metadata(f.bytes, 2)]; f.mode = 'corrupt'
  const updated = await f.service.snapshot()
  assert.equal(updated.items.find(row => row.scope === 'institution').revision, 2); assert.equal(updated.items[0].installedRevision, 1); assert(updated.items.find(row => row.scope === 'institution').syncError)
  assert(existsSync(detail.entry))
  f.mode = ''; assert.equal((await f.service.snapshot()).items.find(row => row.scope === 'institution').installedRevision, 2)
  f.rows = []; assert.equal((await f.service.snapshot()).items.filter(row => row.scope === 'institution').length, 0); assert(existsSync(detail.entry))
})
test('same workflow ID installs under explicit separate institution parents', async t => {
  const f = fixture(t), state = await f.service.snapshot()
  const first = await f.service.preview({ id: 1, context: state.context })
  const secondState = await f.service.snapshot({ institutionId: 8 })
  const second = await f.service.preview({ id: 1, context: secondState.context })
  assert.match(first.entry, /\/7\/1-/); assert.match(second.entry, /\/8\/1-/); assert.notEqual(first.entry, second.entry)
  assert.equal(readdirSync(f.root).length, 2)
})
test('logout while archive in flight rejects activation and never exposes a stale preview', async t => {
  const f = fixture(t), state = await f.service.snapshot()
  let release; f.hold = new Promise(resolve => { release = resolve })
  const pending = f.service.preview({ id: 1, context: state.context })
  await new Promise(resolve => setTimeout(resolve, 20)); f.logout(); release()
  await assert.rejects(pending, /changed/)
  const now = await f.service.snapshot(); assert.equal(now.status, 'unauthenticated'); assert(now.items.every(row => row.scope === 'shared'))
  assert.deepEqual(readdirSync(f.root), ['shared'])
})
test('institution switch fences a pending detail reply; revocation clears visible items', async t => {
  const f = fixture(t), state = await f.service.snapshot()
  let release; f.detailDelay = new Promise(resolve => { release = resolve })
  const pending = f.service.preview({ id: 1, context: state.context })
  await new Promise(resolve => setTimeout(resolve, 10))
  const switched = f.service.snapshot({ institutionId: 8 }); release()
  await assert.rejects(pending, /changed/); assert.equal((await switched).institutionId, 8)
  f.mode = 'revoked'; const revoked = await f.service.snapshot(); assert.equal(revoked.status, 'no-institution'); assert(revoked.items.every(row => row.scope === 'shared'))
})
test('offline refresh preserves installed files with a visible error and retry recovers', async t => {
  const f = fixture(t), state = await f.service.snapshot(); const detail = await f.service.preview({ id: 1, context: state.context })
  f.mode = 'offline'; const failed = await f.service.snapshot(); assert.equal(failed.status, 'error'); assert.match(failed.error, /offline/); assert(existsSync(detail.entry))
  f.mode = ''; assert.equal((await f.service.snapshot()).status, 'ready')
})
test('shared canonical package remains byte-exact, available after logout, and explicit imports stay shared', async t => {
  for (const [name, bytes] of Object.entries(sharedWorkflowDemoFiles)) assert.equal(bytes, readFileSync(new URL(`../../examples/institution-workflow/${name}`, import.meta.url), 'utf8'))
  const f = fixture(t)
  f.logout()
  const snapshot = await f.service.snapshot()
  assert.equal(snapshot.status, 'unauthenticated')
  assert.equal(snapshot.items[0].ref, 'shared:1')
  const preview = await f.service.preview({ id: 1, scope: 'shared', context: snapshot.context })
  assert.match(preview.entry, /\/shared\/1-/)
  const imported = f.service.importShared(archive({ ...canonical, name: 'Explicit shared import' }))
  assert.equal(imported.workflow.scope, 'shared')
  assert((await f.service.snapshot()).items.some(row => row.ref === imported.workflow.ref))
})
test('runtime catalog disambiguates identical names and rejects stale institution paths and references', async t => {
  const f = fixture(t)
  f.rows = [{ ...metadata(f.bytes), name: canonical.name }]
  const provider = createWorkflowLibraryRuntime(f.service, () => f.root)
  const catalog = await provider.list()
  const shared = catalog.find(row => row.ref === 'shared:1')
  const institution = catalog.find(row => row.ref === 'institution:7:1')
  assert.equal(shared.displayName, institution.displayName)
  assert.equal(shared.scope, 'shared'); assert.equal(institution.institution_id, 7)
  const entry = await provider.resolve(institution.ref)
  await provider.assertPath(entry.path)
  await f.service.snapshot({ institutionId: 8 })
  await assert.rejects(provider.resolve(institution.ref), /not available/)
  await assert.rejects(provider.assertPath(entry.path), /current authorized institution/)
  f.logout()
  await assert.rejects(provider.assertPath(entry.path), /access is unavailable/)
  assert.equal((await provider.resolve(shared.ref)).kind, 'file')
  await provider.assertPath('/explicit/local/workflow.ts')
})
test('60-second polling is deduplicated and stops at disposal or logout', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let active = true, calls = 0
  const service = new WorkflowLibraryService({ session: () => active ? { token: 'fixture', baseUrl: 'https://fixture.invalid' } : null, root: () => temporary(t) })
  service.snapshot = async () => { calls++; return {} }
  service.start(); service.start()
  t.mock.timers.tick(59_999); assert.equal(calls, 0)
  t.mock.timers.tick(1); assert.equal(calls, 1)
  active = false; t.mock.timers.tick(60_000); assert.equal(calls, 1)
  service.dispose(); active = true; t.mock.timers.tick(60_000); assert.equal(calls, 1)
})
