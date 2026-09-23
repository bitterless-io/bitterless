import * as nativePi from '@earendil-works/pi-coding-agent'
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// Ral, 2026-09-17: 「bl 无机构的话也别阻塞 正常的功能」.
//
// bitterless already degrades correctly when an institution cannot be authorized — this file pins that
// behaviour so it survives the Pi-native loader swap
// (docs/plan/tasks/skills-pi-native-loading-001.md), which rewrites exactly this area. The paired
// micromeet-cowork did NOT degrade: one uncaught `await skillScopeContext.authorize()` in
// ensureScopedSkillCatalogReady took down every chat turn with "Sign in and select an institution in
// CRMS." even though Global and Workspace skills sit on local disk needing no network. See
// micromeet-cowork/docs/issues/no-authorized-institution-blocks-chat-and-skills.md; per the paired
// development rule that defect is fixed there and merely verified here.
//
// The two chat-path call sites that make bitterless safe are
// `src/main/agent/maestroAgent.service.ts:1912` (message receipt) and `:1929` (the per-request skill
// catalog provider), both `await skillScopeContext.authorize().catch(() => null)`. The third guard —
// the one with real logic and therefore worth a behavioural test — is SkillCloudService.ensureCatalog,
// whose throw is gated on an institution actually being authorized.
const root = resolve('.')
const result = await build({ entryPoints: [join(root, 'src/main/maestro/skills/skillCloud.service.ts')], tsconfig: join(root, 'tsconfig.node.json'), bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external: ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'] })
const module = { exports: {} }
runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: name => ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'].includes(name) ? nativePi : createRequire(join(root, 'package.json'))(name), process, Buffer, console, setInterval, clearInterval, AbortController, AbortSignal, URL, fetch })
const { SkillCloudService } = module.exports

const service = (t, { session, institution, authorize }) => {
  const base = mkdtempSync(join(tmpdir(), 'bl-institution-auth-'))
  const instance = new SkillCloudService({
    root: () => base, session: () => session, institution: () => institution, authorize, changed() {},
    fetch: async () => { throw new Error('No cloud request may be reached in this test') }
  })
  t.after(() => { instance.dispose(); rmSync(base, { recursive: true, force: true }) })
  return instance
}
const signedIn = { baseUrl: 'https://service.invalid', token: 'fixture' }
const rejects = async () => { throw new Error('Institution authorization is unavailable.') }

test('no institution: a failing institution authorization does not block the chat turn', async t => {
  // This is the gate chat send and every model request await (maestroAgent.service.ts:1913 / :1930).
  // With no authorized institution it must resolve, whatever the institution backend is doing.
  const cloud = service(t, { session: signedIn, institution: null, authorize: rejects })
  await cloud.ensureCatalog()
  assert.equal(cloud.status, 'error', 'the failure is still recorded for diagnostics')
  assert.match(cloud.error, /authorization is unavailable/i, 'and the real reason is kept, not replaced by a generic one')
})

test('no institution and no session: the catalog gate resolves without reaching the network', async t => {
  const cloud = service(t, { session: null, institution: null, authorize: async () => { throw new Error('authorize must not be reached with no session') } })
  await cloud.ensureCatalog()
  assert.equal(cloud.status, 'unauthenticated')
})

test('an authorized institution whose catalog is incomplete still answers the turn', async t => {
  // This test used to assert the opposite, citing the completeness guarantee of
  // docs/features/skills-three-sources.md #3. That reading was wrong, and it cost production Cowork
  // every chat message: #3 is about not silently truncating a list, and #4 says outright
  // 「全局、工作区和聊天不等待机构网络请求」. An authorized institution with a stale catalog keeps
  // whatever is on disk; what actually removes its skills is the 401/403 fence, covered in
  // cloudSyncFailure.test.mjs. Ral 2026-09-22; docs/issues/skill-cloud-sync-failure-blocks-chat.md.
  const cloud = service(t, { session: signedIn, institution: { accountScope: 'account', institutionId: '7', generation: 1 }, authorize: rejects })
  await cloud.ensureCatalog()
  assert.equal(cloud.status, 'error', 'reported, not thrown')
})
