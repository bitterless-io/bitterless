import * as nativePi from '@earendil-works/pi-coding-agent'
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// Ral, 2026-09-22: 「cowork 聊天不依赖于技能同步成功，没同步应该也能跑」. Paired with micromeet-cowork,
// where this was reported against production; chat is common functionality, so the same rule holds here.
//
// `ensureCatalog()` used to throw `The institution Skills catalog is not ready: …` whenever the first
// cloud sync had errored, and all three of its callers are on the chat path (maestroAgent.service.ts) —
// so one bad round trip killed every message. A round trip proves FRESHNESS. Authorization is proven by
// the 401/403 path, which sets `unauthorized` and calls `resetAuthorization` to drop the institution
// from the host fence — that is what actually removes institution skills, and it must keep working.
// See docs/issues/skill-cloud-sync-failure-blocks-chat.md.
const root = resolve('.')
const compiled = await build({
  entryPoints: [join(root, 'src/main/maestro/skills/skillCloud.service.ts')], tsconfig: join(root, 'tsconfig.node.json'),
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  external: ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills']
})
const module = { exports: {} }
runInNewContext(compiled.outputFiles[0].text, {
  module, exports: module.exports,
  require: name => ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'].includes(name) ? nativePi : createRequire(join(root, 'package.json'))(name),
  process, Buffer, console, setInterval, clearInterval, AbortController, AbortSignal, URL, fetch
})
const { SkillCloudService } = module.exports

const fixture = (t, answer) => {
  const base = mkdtempSync(join(tmpdir(), 'bl-cloud-degrade-'))
  let institution = { accountScope: 'account', institutionId: '7', generation: 1 }
  let calls = 0
  const service = new SkillCloudService({
    root: () => base,
    session: () => ({ baseUrl: 'https://service.invalid', token: 'fixture' }),
    institution: () => institution,
    authorize: async () => {},
    changed() {},
    fetch: async () => { calls++; return answer() }
  })
  service.resetAuthorization = () => { institution = null }
  t.after(() => { service.dispose(); rmSync(base, { recursive: true, force: true }) })
  return { service, get calls() { return calls }, get institution() { return institution } }
}

test('a cloud catalog that fails leaves the turn runnable', async t => {
  const f = fixture(t, () => { throw Object.assign(new Error('fetch failed'), { cause: new Error('ENOTFOUND') }) })
  await f.service.ensureCatalog()
  assert.equal(f.service.status, 'error', 'the failure is recorded — Workbench reads it off the snapshot as cloudStatus/cloudError')
  assert.ok(f.institution, 'a transport failure is not a revocation; the institution stays authorized')
  await f.service.ensureCatalog() // A second turn, i.e. the user simply sends another message.
})

test('a server that answers 500 does not fail the message either', async t => {
  const f = fixture(t, () => new Response('{}', { status: 500 }))
  await f.service.ensureCatalog()
  assert.equal(f.service.status, 'error')
})

test('a failing server is not re-asked once per message', async t => {
  const f = fixture(t, () => { throw new Error('fetch failed') })
  await f.service.ensureCatalog()
  const afterFirst = f.calls
  assert.ok(afterFirst > 0, 'it still tries — degrading is the fallback, not the first move')
  await f.service.ensureCatalog()
  assert.equal(f.calls, afterFirst, 'the second send reuses what is on disk; the 60 s timer owns recovery')
})

test('an authoritative denial still drops the institution', async t => {
  const f = fixture(t, () => new Response('{}', { status: 403 }))
  await f.service.ensureCatalog()
  assert.equal(f.service.status, 'unauthorized')
  assert.equal(f.institution, null, 'this is the fence that removes institution skills — degrading must not weaken it')
})
