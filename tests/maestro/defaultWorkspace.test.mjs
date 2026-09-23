/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// Ral 2026-09-18:「bl 默认 workspace 路径是 ~/.bitterless/default_workspace；路径可能已经存在，
// ensure 就行不用重复创建」+「onlypreview 和 chat 默认都不选中 default_workspace」.
//
// The path used to carry the runtime profile id. It is now ONE well-known directory, which is the
// whole point — a well-known location that drifts loses whatever the user left there last time.
const root = resolve(import.meta.dirname, '../..')
const home = mkdtempSync(join(tmpdir(), 'bl-default-workspace-'))
const compiled = await build({
  entryPoints: [join(root, 'src/main/maestro/files/defaultWorkspace.ts')],
  tsconfig: join(root, 'tsconfig.node.json'), bundle: true, write: false, platform: 'node', format: 'cjs',
  packages: 'external', external: ['electron', '@main/environment/runtimeProfile.runtime']
})
const module = { exports: {} }
const nodeRequire = createRequire(join(root, 'package.json'))
// The profile's `appName` IS the userData directory name, so it is also what names the workspace
// root. Held in a mutable stub because the module reads it per call, not at load.
const profile = { appName: 'Bitterless' }
runInNewContext(compiled.outputFiles[0].text, {
  module, exports: module.exports,
  require: (name) => {
    if (name === 'electron') return { app: { getPath: () => home } }
    if (name === '@main/environment/runtimeProfile.runtime') return { getRuntimeProfile: () => profile }
    return nodeRequire(name)
  },
  process, Buffer, console
})
const { defaultWorkspaceRoot, ensureDefaultWorkspace } = module.exports

test.after(() => rmSync(home, { recursive: true, force: true }))

test('the workspace directory carries the edition, the same way userData does', (t) => {
  t.after(() => { profile.appName = 'Bitterless' })
  // Every shipping profile, from runtimeProfile.service.ts. Production takes the bare name;
  // every other edition is suffixed, so Preview can never write into Production's files.
  for (const [appName, dir] of [
    ['Bitterless', '.bitterless'],
    ['Bitterless_PREVIEW', '.bitterless_preview'],
    ['Bitterless_DEBUG_PROD', '.bitterless_debug_prod'],
    ['Bitterless_DEBUG_DEV', '.bitterless_debug_dev'],
    ['Bitterless_DEV', '.bitterless_dev']
  ]) {
    profile.appName = appName
    assert.equal(defaultWorkspaceRoot(), join(home, dir, 'work'), `${appName} → ${dir}`)
  }
})

test('ensure is idempotent — an existing directory is reused, not recreated', () => {
  const first = ensureDefaultWorkspace()
  assert.ok(existsSync(first))
  const born = statSync(first).birthtimeMs
  assert.equal(ensureDefaultWorkspace(), first)
  assert.equal(statSync(first).birthtimeMs, born, 'a second ensure must not replace the directory')
})

test('the default workspace is a cwd fallback, never a selected workspace', () => {
  // 「onlypreview 和 chat 默认都不选中 default_workspace」。默认根只能出现在**主进程**的
  // cwd / 文件根回退里;渲染层一旦引用它,隐式回退就变成了一次「选择」,界面会显示成用户选了它。
  let hits = ''
  try {
    hits = execFileSync('grep', ['-rl', '-e', 'defaultWorkspaceRoot', '-e', 'ensureDefaultWorkspace', 'src/renderer'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch (error) {
    if (error.status !== 1) throw error // grep exits 1 on no match — that is the passing case
  }
  assert.equal(hits, '', `the renderer must not reach the default workspace: ${hits}`)
})
