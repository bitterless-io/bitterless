import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The main process is a CJS bundle. It may not statically import an ESM-only package.
 *
 * An ESM-only dependency — one whose `exports` map offers `import` and no `require` — becomes
 * `require("pkg")` in `out/main/app.main.js` when electron-vite externalizes it, and the app dies at
 * load with ERR_PACKAGE_PATH_NOT_EXPORTED. Before any window opens, with no stack pointing at the
 * import that caused it.
 *
 * Nothing else catches this. `typecheck` resolves the types and is satisfied; the unit tests run
 * under Node ESM where the import is legal; the engine worker is built as ESM so the same import is
 * correct THERE. It only appears when the packaged main bundle is loaded by Electron — which is to
 * say, when the owner runs the app. That is exactly the kind of failure worth a cheap guard.
 *
 * The fix, when this fails: reach the module through `await import('pkg')` instead. electron-vite
 * preserves a dynamic import verbatim in the CJS output, which is how `maestroLlm.service.ts` / `coworkLlm.service.ts` already
 * uses the Pi SDK. If it has to stay synchronous, load it once at startup and cache it — see
 * `loadWorkflowParser` in `dynamic/dynamicLoader.ts`.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const ENTRY = join(root, 'src/main/app.main.ts')
const ALIASES = { '@main': join(root, 'src/main'), '@shared': join(root, 'src/shared'), '@preload': join(root, 'src/preload') }
const EXTENSIONS = ['.ts', '.mts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js']

/** `import … from 'x'`, `export … from 'x'`, and `import 'x'` — static VALUE forms only. */
const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g
// `import type` is EXCLUDED: TypeScript erases it, so it never reaches the bundle and is not a
// defect — `codexRuntime.service.ts` importing a type from the ESM-only `@earendil-works/pi-ai` is
// correct and must not be reported. A type-only import of a VALUE, written without `type`, is a
// real find: the emitted require is what breaks, whether or not the symbol is used at runtime.
// Inline `import { type A, b }` still counts, because `b` is a value.

const resolveFile = (specifier, from) => {
  const alias = Object.keys(ALIASES).find(key => specifier === key || specifier.startsWith(key + '/'))
  const base = alias
    ? join(ALIASES[alias], specifier.slice(alias.length))
    : specifier.startsWith('.') ? resolve(dirname(from), specifier) : null
  if (!base) return null
  for (const extension of ['', ...EXTENSIONS]) {
    const candidate = base + extension
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Every source file the main bundle actually pulls in, starting from its entry. */
const mainGraph = () => {
  const seen = new Set(), queue = [ENTRY]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    // A `*.worker.ts` is a SEPARATE esbuild bundle in ESM format (electron.vite.config.ts), so an
    // ESM-only import inside one is correct and must not be reported here.
    if (/\.worker\.ts$/.test(file)) continue
    const source = readFileSync(file, 'utf8')
    for (const [, specifier] of source.matchAll(STATIC_IMPORT)) {
      const next = resolveFile(specifier, file)
      if (next) queue.push(next)
    }
  }
  return seen
}

/** A dependency is ESM-only when its exports map resolves `import` but not `require`. */
const isEsmOnly = name => {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'))
    const root_ = manifest.exports?.['.']
    if (!root_ || typeof root_ === 'string') return false
    return Boolean(root_.import) && !root_.require && !root_.default
  } catch { return false }
}

test('the CJS main bundle never statically imports an ESM-only package', () => {
  const files = mainGraph()
  assert.ok(files.size > 50, `the import graph should be substantial, found ${files.size} — the resolver is probably broken`)
  const offenders = []
  const verdicts = new Map()
  for (const file of files) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      if (specifier.startsWith('.') || specifier.startsWith('@main') || specifier.startsWith('@shared') || specifier.startsWith('@preload') || specifier.startsWith('node:')) continue
      // `@scope/name` keeps two segments; a deep subpath is checked as its package.
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      if (!verdicts.has(name)) verdicts.set(name, isEsmOnly(name))
      if (verdicts.get(name)) offenders.push(`${file.slice(root.length)} → ${specifier}`)
    }
  }
  assert.deepEqual(offenders, [], `ESM-only package(s) statically imported by the CJS main bundle:\n  ${offenders.join('\n  ')}\nUse \`await import()\` instead — see this file's header.`)
})
