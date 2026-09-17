import * as nativePi from '@earendil-works/pi-coding-agent'
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
const root = resolve('.')
const result = await build({ entryPoints: [join(root, 'src/main/maestro/skills/skillCloud.service.ts')], tsconfig: join(root, 'tsconfig.node.json'), bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external: ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'] })
const module = { exports: {} }
runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: name => ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'].includes(name) ? nativePi : createRequire(join(root, 'package.json'))(name), process, Buffer, console, setInterval, clearInterval, AbortController, AbortSignal, URL, fetch })
const { SkillCloudService } = module.exports
const fixture = t => {
  const base = mkdtempSync(join(tmpdir(), 'bl-cloud-skills-')); let session = { baseUrl: 'https://service.invalid', token: 'fixture' }, context = { accountScope: 'account', institutionId: '7', generation: 1 }
  let version = 'old', removed = false, corrupt = false, denied = false, downloads = 0, gate
  const zip = () => { const archive = new AdmZip(); archive.addFile('sample/SKILL.md', Buffer.from('---\nname: Sample\ndescription: Fixture\n---\n' + version)); archive.getEntry('sample/SKILL.md').header.time = new Date('2020-01-01T00:00:00Z'); return archive.toBuffer() }
  const metadata = scope => { const bytes = zip(), hash = createHash('sha256').update(bytes).digest('hex'); return { id: 1, name: 'Sample', version: '1.0.0', scope, institution_id: scope === 'GLOBAL' ? null : 7, size: bytes.length, hash, content_revision: 'sha256:' + hash } }
  const service = new SkillCloudService({ root: () => base, session: () => session, institution: () => context, authorize: async () => {}, changed() {}, fetch: async (url, options) => {
    if (String(url).includes('.aliyuncs.com')) { downloads++; if(gate) await gate; return new Response(corrupt ? Buffer.from('bad') : zip()) }
    if (denied) return new Response('{}', { status: 403 })
    const body = JSON.parse(options.body)
    if (String(url).endsWith('/catalog')) return Response.json({ list: removed ? [] : [metadata(body.scope)], total: removed ? 0 : 1, page: 1 })
    if (String(url).endsWith('/download-url')) return Response.json({ ...metadata(body.scope), download_url: 'https://fixture.oss.aliyuncs.com/sample.zip' })
    throw new Error('Unexpected request')
  } })
  service.resetAuthorization = () => { context = null }
  t.after(() => { service.dispose(); rmSync(base, { recursive: true, force: true }) })
  const ledger = path => JSON.parse(readFileSync(join(base, path, 'cloud/installed.json'), 'utf8')).skills
  return { service, base, ledger, get downloads() { return downloads }, set version(value) { version=value }, set removed(value) {removed=value}, set corrupt(value) {corrupt=value}, set denied(value) {denied=value}, set gate(value) {gate=value}, logout() { session=null; context=null; service.reset() } }
}
test('private ZIP integrity, same version new bytes, stable metadata and package withdrawal', async t => {
  const f = fixture(t); await f.service.refresh(); assert.equal(f.service.status,'ready'); assert.equal(f.downloads,2)
  const first = Object.values(f.ledger('account/7'))[0]; assert.ok(existsSync(join(f.base,'account/7/cloud',first.dir,'SKILL.md')))
  await f.service.refresh(); assert.equal(f.downloads,2)
  f.version='new'; await f.service.refresh(); const next=Object.values(f.ledger('account/7'))[0]; assert.equal(next.version,first.version); assert.notEqual(next.content_revision,first.content_revision); assert.notEqual(next.dir,first.dir)
  assert.ok(existsSync(join(f.base,'account/7/cloud',first.dir,'SKILL.md')), 'running immutable version survives')
  f.removed=true; await f.service.refresh(); assert.equal(Object.keys(f.ledger('account/7')).length,0)
})
test('checksum failure retains verified installed package', async t => {
  const f=fixture(t); await f.service.refresh(); const old=Object.values(f.ledger('shared'))[0]; f.version='new'; f.corrupt=true; await f.service.refresh()
  assert.equal(f.service.status,'error'); assert.equal(Object.values(f.ledger('shared'))[0].content_revision,old.content_revision)
})
test('logout fences late archive activation, keeps prior global package', async t => {
  const f=fixture(t); await f.service.refresh(); const old=Object.values(f.ledger('shared'))[0]; f.version='new'
  let release; f.gate=new Promise(resolve=>{release=resolve}); const work=f.service.refresh()
  for(let i=0;i<20 && f.downloads<3;i++) await new Promise(resolve=>setTimeout(resolve,10))
  f.logout(); release(); await work; assert.equal(Object.values(f.ledger('shared'))[0].content_revision,old.content_revision)
})
test('authorization denial invalidates institution and archive writes', async t => {
  const f=fixture(t); await f.service.refresh(); const count=f.downloads; f.denied=true; await f.service.refresh(); assert.equal(f.service.status,'unauthorized'); assert.equal(f.downloads,count)
})

test('cloud resource revision changes only when the installed package ledger changes', async t => {
  const f = fixture(t)
  await f.service.refresh()
  const installed = f.service.revision
  assert.ok(installed > 0)
  await f.service.refresh()
  assert.equal(f.service.revision, installed)
  f.version = 'updated content'
  await f.service.refresh()
  assert.ok(f.service.revision > installed)
  const updated = f.service.revision
  f.removed = true
  await f.service.refresh()
  assert.ok(f.service.revision > updated)
})
