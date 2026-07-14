import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, assertCoworkAliasBoundary, assertNoStandaloneEntry, projectRoot } from './_harness.mjs'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const checks = readdirSync(scriptsDirectory)
  .filter((name) => name.startsWith('check-') && name.endsWith('.mjs') && name !== 'check-cowork.mjs')
  .sort()

assert(checks.length === 36, `expected 36 Cowork parity checks, found ${checks.length}`)
assertCoworkAliasBoundary()
assertNoStandaloneEntry()

for (const script of checks) {
  console.log(`\n[check-cowork] node scripts/cowork/${script}`)
  const result = spawnSync(process.execPath, [join(scriptsDirectory, script)], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

console.log('\n[check-cowork] ok')
