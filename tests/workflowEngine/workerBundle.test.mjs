import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The engine worker is a SEPARATE esbuild bundle, and `packages: 'external'` leaves every bare
 * specifier alone — including `@shared` / `@main`, which are not packages at all.
 *
 * When the workflow entry-name contract moved into `@shared/workflowPackage` (2026-09-21), the
 * worker shipped an `import … from '@shared/workflowPackage'` that Node cannot resolve. The
 * utilityProcess then died the instant it loaded, and every run reported
 * "Workflow process exited unexpectedly" — with no stack, no file and no mention of an import.
 * Nothing else catches it: typecheck resolves the alias, the unit tests import the SOURCE, and the
 * main bundle (a different build, with its own alias config) is fine.
 */
test('worker 的 esbuild 构建必须解析我们自己的别名', () => {
  const config = readFileSync(join(root, 'electron.vite.config.ts'), 'utf8')
  const plugin = config.slice(config.indexOf('workflow:utility-workers'))
  const call = plugin.slice(0, plugin.indexOf('\n}'))
  assert.match(call, /packages: 'external'/, '前提没变:非相对路径默认全部外部化')
  assert.match(call, /alias: \{[^}]*'@shared': resolve\('src\/shared'\)/s, '@shared 必须被解析,否则 worker 加载即死')
  assert.match(call, /'@main': resolve\('src\/main'\)/s, '@main 同理')
})

test('构建出来的 worker 里不能留下解析不了的裸导入', () => {
  const dir = join(root, 'out/main')
  if (!existsSync(dir)) return  // 没构建就不判 —— 这条在 CI 的 build 之后才有意义
  const workers = readdirSync(dir).filter(name => name.endsWith('.worker.mjs'))
  assert.ok(workers.length, 'out/main 下应当有 worker 产物')
  for (const name of workers) {
    const code = readFileSync(join(dir, name), 'utf8')
    const bad = [...code.matchAll(/from\s*["'](@(?:shared|main|renderer)\/[^"']+)["']/g)].map(m => m[1])
    assert.deepEqual(bad, [], `${name} 里这些别名没被解析,进程会在加载时直接退出:\n  ${bad.join('\n  ')}`)
  }
})
