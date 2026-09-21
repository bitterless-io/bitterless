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
const loadHelper = (home, userData, appName) => {
  const file = fileURLToPath(new URL('../../src/shared/pathHelper/main/homeData.ts', import.meta.url))
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'electron') return { app: { getPath: key => (key === 'home' ? home : userData), getAppPath: () => userData }, shell: {} }
    if (name === '@main/environment/runtimeProfile.runtime') return { getRuntimeProfile: () => ({ appName }) }
    if (name === 'electron-xpc/main') return { XpcMainHandler: class {} }
    if (name === 'fs-extra') return {}
    if (name === 'path' || name.startsWith('node:')) return require(name === 'path' ? 'node:path' : name)
    throw Error('Unexpected helper dependency: ' + name)
  }, module, module.exports)
  return module.exports
}

const load = (home, userData, appName = 'Bitterless_PREVIEW') => {
  const file = fileURLToPath(new URL('../../src/main/paths/appData.ts', import.meta.url))
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'electron') return { app: { getPath: key => (key === 'home' ? home : userData) } }
    if (name === '@main/environment/runtimeProfile.runtime') return { getRuntimeProfile: () => ({ appName }) }
    // The home root now comes from the path helper (Ral 2026-09-20: 「~ 下的 data 目录应该通过
    // pathhelper 通用的方式获取」), loaded here against the same stubs — the contract under test is
    // still "which directories, where", not Electron.
    if (name === '@shared/pathHelper/main/homeData') return loadHelper(home, userData, appName)
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

test('home 根目录的推导只有一份 —— 在 pathHelper 里,不在 appData 里', () => {
  // Ral 2026-09-20:「~ 下的 data 目录应该通过 pathhelper 通用的方式获取」。
  // 缺口是:`userData` 走 pathHelper,而 `~/.bitterless…` 由 appData.ts 自己算 ——
  // 于是「这个 app 把用户数据放哪」取决于你问哪个模块。两份推导迟早会分叉。
  const helper = readFileSync(fileURLToPath(new URL('../../src/shared/pathHelper/main/homeData.ts', import.meta.url)), 'utf8')
  const appData = readFileSync(fileURLToPath(new URL('../../src/main/paths/appData.ts', import.meta.url)), 'utf8')

  assert.match(helper, /export const homeDataRoot/, '根目录由 pathHelper 给出')
  assert.match(helper, /getRuntimeProfile\(\)\.appName\.toLowerCase\(\)/, '推导本体在 pathHelper 里')

  // appData 只管「底下有哪些目录」和 boot 时 ensure,不再自己拼根目录。
  assert.match(appData, /homeDataRoot\(\)/, 'appData 必须向 pathHelper 要根目录')
  assert.doesNotMatch(appData, /app\.getPath\('home'\)/, 'appData 里不许再有第二份推导')
})
