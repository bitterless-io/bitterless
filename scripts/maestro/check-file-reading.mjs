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
const externalTools = read('scripts/maestro/externalTools.cjs')
const packageToolsDispatcher = read('scripts/prepare-maestro-package-tools.cjs')
const builderTemplate = read('electron-builder.tmp.yml')
const messageItem = read('src/renderer/maestro/control/src/MessageItem.vue')
const archiveService = read('src/main/maestro/files/archive.service.ts')
const workspaceArchive = read('src/main/maestro/files/workspaceArchive.service.ts')

// Document parsing is a build-time-staged CLI contract. This source check deliberately does not
// import Main's Electron-dependent service or require a staged native binary in an ordinary Node
// process; packaging performs the executable/checksum verification.
assert(pkg.anydoc_version === '0.2.4', 'anydoc CLI must stay pinned to 0.2.4')
assert(pkg.bun_version === '1.3.14', 'Bun must stay pinned to 1.3.14')
assert(pkg.rg_version === '14.1.1', 'ripgrep must stay pinned to 14.1.1')
assert(pkg.fd_version === '10.5.0', 'fd must stay pinned to 10.5.0')
assert(pkg.ouch_version === '0.8.2', 'Ouch must stay pinned to 0.8.2')
assert(!pkg.dependencies?.['@firecrawl/anydoc'], 'anydoc must not be an application dependency')
assert(!pkg.dependencies?.['@firecrawl/anydoc-wasm'], 'anydoc WASM must not be an application dependency')
assert(
  externalTools.includes("const ANYDOC_BUNDLE_FILES = ['anydoc.js', 'cli.js', 'index.js', 'package.json']") &&
    externalTools.includes("output: 'anydoc/anydoc.node'"),
  'the external-tools inventory should contain exactly the five-file AnyDoc CLI/native bundle'
)
assert(
  externalTools.includes("sha512: 'rfJxa5L+") &&
    externalTools.includes("'sha512'") &&
    externalTools.includes("'base64'"),
  'AnyDoc npm tarball should be SHA-512 pinned and checked before extraction'
)
assert(
  externalTools.includes('const sourceDirectory = validateExternalStore(') &&
    externalTools.includes('verifyStagedExternalTools(root, normalized.packageTarget, inventory)'),
  'packaging should validate the initialized payload and the final offline stage'
)
assert(
  pkg.scripts?.['_package:mac_arm']?.includes('externalTools.cjs stage mac_arm') &&
    pkg.scripts?.['_package:mac_arm']?.includes('externalTools.cjs verify-stage mac_arm') &&
    pkg.scripts?.['_package:win']?.includes('externalTools.cjs verify-stage win64') &&
    pkg.scripts?.['_package:unpack']?.includes('prepare-maestro-package-tools.cjs'),
  'supported packaging should stage and verify initialized external tools offline'
)
assert(
  packageToolsDispatcher.includes("platform === 'darwin'") &&
    packageToolsDispatcher.includes("platform === 'win32'") &&
    packageToolsDispatcher.includes("platform === 'linux'") &&
    packageToolsDispatcher.includes("'scripts/prepare-maestro-anydoc.cjs', target, '--verify'") &&
    packageToolsDispatcher.includes("'scripts/maestro/externalTools.cjs', 'verify-stage', target"),
  'generic unpack should dispatch macOS/Windows to external tools and preserve the Linux preparation path'
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
