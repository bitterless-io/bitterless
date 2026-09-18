/* eslint-disable @typescript-eslint/explicit-function-return-type */
import * as nativePi from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

// Ral, 2026-09-18:「参考 cowork 和 pi 的实现对齐，run skill 不仅是 bun 也要有 bash 或是 pi 的方式兜底」.
//
// Bitterless staged `bun` and `skill_creator` already scaffolded `scripts/run.mjs`, but nothing on
// this side could execute it — the file was dead weight while micromeet-cowork ran the identical
// package. This pins the runner that closes that gap, and the rule that decides the interpreter:
// Bun first (it is the runtime we ship, so no developer environment is required), Pi's own shell
// resolution as the fallback for a `.sh`/`.ps1` helper.
const root = resolve(import.meta.dirname, '../..')
const compiled = await build({
  entryPoints: [join(root, 'src/main/maestro/skills/skillScriptRunner.service.ts')],
  tsconfig: join(root, 'tsconfig.node.json'), bundle: true, write: false, platform: 'node', format: 'cjs',
  packages: 'external', external: ['virtual:bitterless-pi-skills']
})
const module = { exports: {} }
const nodeRequire = createRequire(join(root, 'package.json'))
runInNewContext(compiled.outputFiles[0].text, {
  module, exports: module.exports,
  require: name => (name === 'virtual:bitterless-pi-skills' ? nativePi : nodeRequire(name)),
  process, Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval
})
const { runSkillScript } = module.exports

// The same Bun the app stages. Absent in a checkout that never ran the runtime staging, in which
// case the JavaScript case is skipped rather than pretended.
const BUN = join(root, 'build/maestro-tools', process.platform === 'win32' ? 'bun.exe' : 'bun')
const stage = t => {
  const base = mkdtempSync(join(tmpdir(), 'bl-skill-script-'))
  const pkg = join(base, 'demo-skill')
  mkdirSync(pkg, { recursive: true })
  t.after(() => rmSync(base, { recursive: true, force: true }))
  return { base, pkg }
}
const put = (pkg, name, body, mode = 0o755) => {
  const file = join(pkg, name)
  writeFileSync(file, body)
  chmodSync(file, mode)
  return file
}
const run = (file, s, extra = {}) => runSkillScript({ scriptPath: file, packageRoot: s.pkg, bunPath: existsSync(BUN) ? BUN : null, args: ['alpha'], timeoutMs: 20_000, ...extra })

test('a shell helper runs through Pi\'s shell resolution and receives its arguments', async t => {
  const s = stage(t)
  const result = await run(put(s.pkg, 'run.sh', '#!/usr/bin/env bash\necho "shell-ran:$1"\n'), s)
  assert.equal(result.ok, true, `shell script must run: ${result.error || ''}`)
  assert.match(String(result.stdout ?? ''), /shell-ran:alpha/)
})

test('a shell helper does not depend on Bun being staged', async t => {
  const s = stage(t)
  const result = await run(put(s.pkg, 'run.sh', '#!/usr/bin/env bash\necho no-bun-needed\n'), s, { bunPath: null })
  assert.equal(result.ok, true, `the shell fallback must not require Bun: ${result.error || ''}`)
  assert.match(String(result.stdout ?? ''), /no-bun-needed/)
})

test('a JavaScript helper runs on the bundled Bun and is handed its stdin', { skip: existsSync(BUN) ? false : 'bundled Bun is not staged in this checkout' }, async t => {
  const s = stage(t)
  const file = put(s.pkg, 'run.mjs', 'const chunks=[];for await (const c of process.stdin) chunks.push(c);\nprocess.stdout.write("js-ran:"+process.argv[2]+":"+JSON.parse(Buffer.concat(chunks).toString()||"{}").who)\n')
  const result = await run(file, s, { input: { who: 'ral' } })
  assert.equal(result.ok, true, `bun script must run: ${result.error || ''}`)
  assert.match(String(result.stdout ?? ''), /js-ran:alpha:ral/)
})

test('a JavaScript helper without Bun fails by naming the missing runtime', async t => {
  const s = stage(t)
  const result = await run(put(s.pkg, 'run.mjs', 'process.stdout.write("x")\n'), s, { bunPath: null })
  assert.equal(result.ok, false)
  assert.match(String(result.error), /bundled Bun is unavailable/)
})

test('an unsupported extension is refused by name, not handed to the wrong interpreter', async t => {
  const s = stage(t)
  const result = await run(put(s.pkg, 'run.py', 'print("nope")\n'), s)
  assert.equal(result.ok, false)
  assert.match(String(result.error), /\.mjs, \.js, \.ts, \.sh, \.bash or \.ps1/)
})

test('a script outside its package is refused whatever the interpreter', async t => {
  const s = stage(t)
  const outside = mkdtempSync(join(tmpdir(), 'bl-skill-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  const file = join(outside, 'run.sh')
  writeFileSync(file, '#!/usr/bin/env bash\necho escaped\n')
  chmodSync(file, 0o755)
  const result = await run(file, s)
  assert.equal(result.ok, false, 'confinement must not weaken because the interpreter changed')
  assert.match(String(result.error), /inside its skill package/)
})

test('a failing script reports its exit code instead of looking successful', async t => {
  const s = stage(t)
  const result = await run(put(s.pkg, 'run.sh', '#!/usr/bin/env bash\necho to-stderr >&2\nexit 3\n'), s)
  assert.equal(result.ok, false)
  assert.equal(result.exitCode, 3)
  assert.match(String(result.stderr ?? ''), /to-stderr/)
})
