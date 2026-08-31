import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(projectRoot, path), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const pkg = JSON.parse(read('package.json'))
const fileReader = read('src/main/maestro/files/fileReader.service.ts')
const anydocService = read('src/main/maestro/files/anydoc.service.ts')
const prepareAnydoc = read('scripts/prepare-maestro-anydoc.cjs')
const builderTemplate = read('electron-builder.tmp.yml')
const messageItem = read('src/renderer/maestro/control/src/MessageItem.vue')
const archiveService = read('src/main/maestro/files/archive.service.ts')
const workspaceArchive = read('src/main/maestro/files/workspaceArchive.service.ts')

// Document parsing is a build-time-staged CLI contract. This source check deliberately does not
// import Main's Electron-dependent service or require a staged native binary in an ordinary Node
// process; packaging performs the executable/checksum verification.
assert(pkg.anydoc_version === '0.2.4', 'anydoc CLI must stay pinned to 0.2.4')
assert(!pkg.dependencies?.['@firecrawl/anydoc'], 'anydoc must not be an application dependency')
assert(!pkg.dependencies?.['@firecrawl/anydoc-wasm'], 'anydoc WASM must not be an application dependency')
assert(
  prepareAnydoc.includes("const STAGED_FILES = ['anydoc.js', 'anydoc.node', 'cli.js', 'index.js', 'package.json']"),
  'anydoc staging should contain exactly the five-file CLI/native bundle'
)
assert(
  prepareAnydoc.includes('PACKAGE_TARBALL_SHA512') &&
    prepareAnydoc.includes("createHash('sha512')") &&
    prepareAnydoc.includes('verifyPackageTarball(tarball)'),
  'anydoc npm tarball should be integrity-pinned and checked before extraction'
)
assert(
  (prepareAnydoc.match(/sha256: '[a-f0-9]{64}'/g) || []).length === 5 &&
    prepareAnydoc.includes('verifyNative(stagedNative, target)') &&
    prepareAnydoc.includes("verifyNative(path.join(STAGE_DIR, 'anydoc.node'), TARGETS[platform])"),
  'all supported anydoc native binaries and the staged binary should be checksum-verified'
)
assert(
  pkg.scripts?.['_package:mac_arm']?.includes('prepare-maestro-anydoc.cjs mac_arm') &&
    pkg.scripts?.['_package:mac_arm']?.includes('prepare-maestro-anydoc.cjs mac_arm --verify') &&
    pkg.scripts?.['_package:win']?.includes('prepare-maestro-anydoc.cjs win64 --verify'),
  'packaging should stage and verify anydoc for its target platform'
)
assert(
  builderTemplate.includes('- from: build/maestro-tools') &&
    builderTemplate.includes('Contents/Resources/maestro-tools/anydoc/anydoc.node'),
  'packaging should copy the CLI bundle and sign its native binary on macOS'
)

assert(
  anydocService.includes('spawn(process.execPath, [cliPath, path]') &&
    anydocService.includes("ELECTRON_RUN_AS_NODE: '1'") &&
    anydocService.includes('NAPI_RS_NATIVE_LIBRARY_PATH: nativePath'),
  'document conversion should spawn the staged CLI with Electron-as-Node and its pinned native binding'
)
assert(
  anydocService.includes("child.stdout?.on('data'") &&
    anydocService.includes("child.stderr?.on('data'") &&
    anydocService.includes('const TIMEOUT_MS = 30_000') &&
    anydocService.includes('const MAX_STDERR_CHARS = 8_000'),
  'anydoc child output should be continuously drained, bounded, and time-limited'
)
for (const exitCode of [0, 1, 2, 3]) {
  assert(
    anydocService.includes(`exitCode === ${exitCode}`),
    `anydoc service should handle CLI exit code ${exitCode}`
  )
}
assert(
  !/UtilityProcess|@firecrawl\/anydoc-wasm|https?:\/\/|\bfetch\s*\(|\bcurl\b/.test(anydocService),
  'the runtime anydoc service must not use WASM, UtilityProcess, or network downloads'
)

assert(
  fileReader.includes('await anydocToMarkdown(absPath, { maxChars: MAX_OUTPUT_CHARS })'),
  'supported documents should be converted through the staged anydoc CLI'
)
assert(
  fileReader.includes(".map((line, index) => `${String(start + index).padStart(width, ' ')}\\t${line}`)") &&
    fileReader.includes('pass offset/limit for more'),
  'plain text should remain line-numbered and pageable'
)
assert(
  fileReader.includes('if (isArchivePath(absPath))') && fileReader.includes('Use list_archive'),
  'archives should be routed to archive tools rather than document conversion'
)
assert(
  messageItem.includes("if (parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost')") &&
    messageItem.includes('path = `//${parsed.hostname}${path}`') &&
    messageItem.includes('/^\\/[A-Za-z]:[\\\\/]/.test(path)') &&
    messageItem.includes('path = path.slice(1)'),
  'local Markdown links should preserve UNC paths and normalize file:///C:/ to a Windows drive path'
)
assert(
  archiveService.includes('https://github.com/ouch-org/ouch/blob/0.8.2/CHANGELOG.md') &&
    archiveService.includes('env.OUCH_PASSWORD = options.password') &&
    archiveService.includes('if (timedOut)') &&
    archiveService.includes("child.kill('SIGKILL')") &&
    !archiveService.includes("'-p'") &&
    !archiveService.includes('"-p"'),
  'archive passwords should use the pinned ouch environment contract and never enter argv'
)
assert(
  workspaceArchive.includes("mkdtempSync(join(realWorkspaceRoot, '.maestro-extract-'))") &&
    workspaceArchive.includes('assertSafeExtractedTree(stageRoot, expectedRealStageRoot)') &&
    workspaceArchive.includes('stats.isSymbolicLink()') &&
    workspaceArchive.includes('stats.nlink !== 1') &&
    workspaceArchive.includes('renameSync(stageRoot, installedDestination)') &&
    workspaceArchive.includes("rmSync(stageRoot, { recursive: true, force: true })"),
  'archive extraction should stage, audit links/realpaths, atomically install, and always clean up'
)

console.log('[check-file-reading] ok')
