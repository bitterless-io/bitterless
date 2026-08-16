#!/usr/bin/env node

import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const rootDir = resolve(import.meta.dirname, '../..')
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 5)) {
  throw new Error('SQLite migration audit requires Node.js 22.5 or newer for node:sqlite')
}
const bundleDir = mkdtempSync(join(tmpdir(), 'bitterless-sqlite-audit-bundle-'))
const bundlePath = join(bundleDir, 'auditRunner.cjs')

try {
  await build({
    entryPoints: [join(rootDir, 'scripts/sqlite-migrations/auditRunner.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    tsconfig: join(rootDir, 'tsconfig.node.json'),
    logLevel: 'silent',
  })
  const require = createRequire(import.meta.url)
  require(bundlePath)
} finally {
  rmSync(bundleDir, { recursive: true, force: true })
}
