import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, assertMaestroAliasBoundary, assertNoStandaloneEntry, projectRoot } from './_harness.mjs'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const checks = readdirSync(scriptsDirectory)
  .filter((name) => name.startsWith('check-') && name.endsWith('.mjs') && name !== 'check-maestro.mjs')
  .sort()

assert(checks.length === 38, `expected 38 Maestro parity checks, found ${checks.length}`)
assertMaestroAliasBoundary()
assertNoStandaloneEntry()

for (const script of checks) {
  console.log(`\n[check-maestro] node scripts/maestro/${script}`)
  const result = spawnSync(process.execPath, [join(scriptsDirectory, script)], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

console.log('\n[check-maestro] ok')
