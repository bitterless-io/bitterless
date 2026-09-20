import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)

/**
 * `appData.ts` reaches Electron for the home path and the runtime profile, so it is loaded against
 * stubs rather than through jiti — the point of the test is the directory contract, not Electron.
 */
const load = (home, userData, appName = 'Bitterless_PREVIEW') => {
  const file = fileURLToPath(new URL('../../src/main/paths/appData.ts', import.meta.url))
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'electron') return { app: { getPath: key => (key === 'home' ? home : userData) } }
    if (name === '@main/environment/runtimeProfile.runtime') return { getRuntimeProfile: () => ({ appName }) }
    if (name.startsWith('node:')) return require(name)
    throw Error('Unexpected fixture dependency: ' + name)
  }, module, module.exports)
  return module.exports
}
const temporary = t => { const dir = mkdtempSync(join(tmpdir(), 'bl-appdata-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir }

test('the root carries the environment, and every registered directory exists after one boot call', t => {
  const home = temporary(t), userData = temporary(t)
  const { appDataRoot, appDataDir, APP_DATA_DIRS, ensureAppData } = load(home, userData)
  assert.equal(appDataRoot(), join(home, '.bitterless_preview'))
  assert.equal(ensureAppData(), join(home, '.bitterless_preview'))
  // The list IS the ensure list: a directory cannot be registered without also being created, which
  // is what stops "I opened the folder and skills wasn't there".
  for (const name of Object.keys(APP_DATA_DIRS)) assert(existsSync(appDataDir(name)), `${name} must exist after boot`)
  assert.deepEqual(readdirSync(join(home, '.bitterless_preview')).sort(), Object.values(APP_DATA_DIRS).sort())
  // Idempotent: a second boot neither throws nor changes anything.
  ensureAppData()
  assert.deepEqual(readdirSync(join(home, '.bitterless_preview')).sort(), Object.values(APP_DATA_DIRS).sort())
})

test('each profile gets its own root, so two editions cannot share one data directory', t => {
  const home = temporary(t), userData = temporary(t)
  const roots = ['Bitterless', 'Bitterless_PREVIEW', 'Bitterless_DEBUG_PROD', 'Bitterless_DEBUG_DEV', 'Bitterless_DEV']
    .map(appName => load(home, userData, appName).appDataRoot())
  assert.deepEqual(roots, ['.bitterless', '.bitterless_preview', '.bitterless_debug_prod', '.bitterless_debug_dev', '.bitterless_dev'].map(name => join(home, name)))
  assert.equal(new Set(roots).size, roots.length)
})

test('global skills are adopted from their pre-unification location, once, and never overwritten', t => {
  const home = temporary(t), userData = temporary(t)
  const legacy = join(userData, 'cowork', 'skills')
  mkdirSync(legacy, { recursive: true })
  writeFileSync(join(legacy, 'marker.md'), 'owner skill')
  const { appDataDir, ensureAppData } = load(home, userData)
  ensureAppData()
  assert.equal(readFileSync(join(appDataDir('skills'), 'marker.md'), 'utf8'), 'owner skill')
  assert(!existsSync(legacy), 'the old directory is moved, not copied — one location afterwards')

  // A second legacy directory appearing later must not replace what the owner now has.
  mkdirSync(legacy, { recursive: true })
  writeFileSync(join(legacy, 'marker.md'), 'stale')
  ensureAppData()
  assert.equal(readFileSync(join(appDataDir('skills'), 'marker.md'), 'utf8'), 'owner skill')
  assert(existsSync(legacy), 'the stale copy is left alone rather than silently discarded')
})

test('a failed adoption leaves the data in place instead of crashing the boot', t => {
  const home = temporary(t), userData = temporary(t)
  const { ensureAppData } = load(home, userData)
  // A legacy path that is a file, not a directory: the rename cannot succeed.
  mkdirSync(join(userData, 'cowork'), { recursive: true })
  writeFileSync(join(userData, 'cowork', 'skills'), 'not a directory')
  assert.doesNotThrow(() => ensureAppData())
  assert.equal(readFileSync(join(userData, 'cowork', 'skills'), 'utf8'), 'not a directory')
})
