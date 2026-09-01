#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..')
const EXTERNAL_DIR_NAME = 'external_tools'
const STAGE_RELATIVE_PATH = path.join('build', 'maestro-tools')
const MANIFEST_FILENAME = 'external-tools.manifest.json'
const MANIFEST_SCHEMA_VERSION = 1
const STORE_PLATFORMS = ['mac_arm', 'mac_intel', 'win']
const PACKAGE_TO_STORE = {
  mac_arm: 'mac_arm',
  mac_intel: 'mac_intel',
  win64: 'win'
}
const STORE_TO_PACKAGE = {
  mac_arm: 'mac_arm',
  mac_intel: 'mac_intel',
  win: 'win64'
}
const ANYDOC_PACKAGE_NAME = '@firecrawl/anydoc'
const ANYDOC_BUNDLE_FILES = ['anydoc.js', 'cli.js', 'index.js', 'package.json']
const BINARY_TOOL_NAMES = ['bun', 'rg', 'fd', 'ouch']

const INVENTORY = {
  bun: {
    versionKey: 'bun_version',
    version: '1.3.14',
    targets: {
      mac_arm: {
        archive: 'bun-darwin-aarch64.zip',
        archiveSha256: 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620',
        inner: 'bun-darwin-aarch64/bun',
        output: 'bun',
        sha256: 'e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233',
        url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-aarch64.zip'
      },
      mac_intel: {
        archive: 'bun-darwin-x64.zip',
        archiveSha256: '4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633',
        inner: 'bun-darwin-x64/bun',
        output: 'bun',
        sha256: 'ea2f223e94bb2f4bf3050895113c3cf346438f6fa0501c8532284e063f72f7a0',
        url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-x64.zip'
      },
      win: {
        archive: 'bun-windows-x64.zip',
        archiveSha256: '0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922',
        inner: 'bun-windows-x64/bun.exe',
        output: 'bun.exe',
        sha256: '0187f68d843f825a72ada4a7eca60db896ed753759a7f8252edcd31ac1bf1b9c',
        url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-windows-x64.zip'
      }
    }
  },
  rg: {
    versionKey: 'rg_version',
    version: '14.1.1',
    targets: {
      mac_arm: {
        archive: 'ripgrep-14.1.1-aarch64-apple-darwin.tar.gz',
        archiveSha256: '24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be',
        inner: 'ripgrep-14.1.1-aarch64-apple-darwin/rg',
        output: 'rg',
        sha256: '0e0cb83f5195f1f51bb8feef1fff5b0b171e82bd1db6bd35deee701a3e7102f8',
        url: 'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-aarch64-apple-darwin.tar.gz'
      },
      mac_intel: {
        archive: 'ripgrep-14.1.1-x86_64-apple-darwin.tar.gz',
        archiveSha256: 'fc87e78f7cb3fea12d69072e7ef3b21509754717b746368fd40d88963630e2b3',
        inner: 'ripgrep-14.1.1-x86_64-apple-darwin/rg',
        output: 'rg',
        sha256: '923dcc25cab57d33f4e7dd0476d4b74a554401a38817e246a8d6101dcd51c50f',
        url: 'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-apple-darwin.tar.gz'
      },
      win: {
        archive: 'ripgrep-14.1.1-x86_64-pc-windows-msvc.zip',
        archiveSha256: 'd0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1',
        inner: 'ripgrep-14.1.1-x86_64-pc-windows-msvc/rg.exe',
        output: 'rg.exe',
        sha256: 'f162b54de2adfc72d78adb1dbada2dedda111ae0a5e2f6e9500f4f909664c5d2',
        url: 'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-pc-windows-msvc.zip'
      }
    }
  },
  fd: {
    versionKey: 'fd_version',
    version: '10.5.0',
    targets: {
      mac_arm: {
        archive: 'fd-v10.5.0-aarch64-apple-darwin.tar.gz',
        archiveSha256: 'b67e1836c468e42e411984b56e52fa7abec08c2bd22c867398e7cc134aac5e12',
        inner: 'fd-v10.5.0-aarch64-apple-darwin/fd',
        output: 'fd',
        sha256: 'cf3bde435da174f41cf9589a2efeaf03804df7c250fc15e8b8a1e9bfc66ebc9a',
        url: 'https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-aarch64-apple-darwin.tar.gz'
      },
      mac_intel: {
        archive: 'fd-v10.5.0-x86_64-apple-darwin.tar.gz',
        archiveSha256: '7e31028c62c6955877735d0406807aa484c2a5e6f86235a59e26c29c301da590',
        inner: 'fd-v10.5.0-x86_64-apple-darwin/fd',
        output: 'fd',
        sha256: '7ca13c0959482c381a4de9b85fe8bef4233ab7e5232761e958ed0df3583baa89',
        url: 'https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-x86_64-apple-darwin.tar.gz'
      },
      win: {
        archive: 'fd-v10.5.0-x86_64-pc-windows-msvc.zip',
        archiveSha256: 'a227701b8551c35a9931d9f6da75503cf86d88e182d71fb849a70864c5d57cd7',
        inner: 'fd-v10.5.0-x86_64-pc-windows-msvc/fd.exe',
        output: 'fd.exe',
        sha256: 'd67d27a8e375ed7e9bca2b506a9dd5082bc24547aeba908b863f6f8b8ab0c3b9',
        url: 'https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-x86_64-pc-windows-msvc.zip'
      }
    }
  },
  ouch: {
    versionKey: 'ouch_version',
    version: '0.8.2',
    targets: {
      mac_arm: {
        archive: 'ouch-aarch64-apple-darwin.tar.gz',
        archiveSha256: '36d912a6739ccec6889b6e67cfe24d503e889b61c6da556b840a5e4e7e39a2e0',
        inner: 'ouch-aarch64-apple-darwin/ouch',
        output: 'ouch',
        sha256: 'b98e45e41dbbcfb6b0301b597c9fd8da4572e2e1813e18e4d578384fd386c1b0',
        url: 'https://github.com/ouch-org/ouch/releases/download/0.8.2/ouch-aarch64-apple-darwin.tar.gz'
      },
      mac_intel: {
        archive: 'ouch-x86_64-apple-darwin.tar.gz',
        archiveSha256: 'db1f4eef469f481d3f609c00bbd64d6b981b61b1945f8d64f92cd622df515eab',
        inner: 'ouch-x86_64-apple-darwin/ouch',
        output: 'ouch',
        sha256: '5ace4075984e1e68926a3f90ab25dd56093133e304c2804cdaf3ee28ddfa36d7',
        url: 'https://github.com/ouch-org/ouch/releases/download/0.8.2/ouch-x86_64-apple-darwin.tar.gz'
      },
      win: {
        archive: 'ouch-x86_64-pc-windows-msvc.zip',
        archiveSha256: '0a7d7570d272e7ef563a14fb8cbdddb55d2f532f35ce07544207d4c462dc00ab',
        inner: 'ouch-x86_64-pc-windows-msvc/ouch.exe',
        output: 'ouch.exe',
        sha256: '21d4c284813dfafb58a1fbdfb8f6c6d423fea37ee3b56b8a21a796fd95105b36',
        url: 'https://github.com/ouch-org/ouch/releases/download/0.8.2/ouch-x86_64-pc-windows-msvc.zip'
      }
    }
  },
  anydoc: {
    versionKey: 'anydoc_version',
    version: '0.2.4',
    packageArchive: {
      filename: 'anydoc-0.2.4.tgz',
      sha256: '625bf6cdc24cc91eee8fbfe084c1fa56c71b17f034341d4a23bc8df0fdee31bd',
      sha512: 'rfJxa5L+nhoqR5yodcRZoGDLaSfxMTpBuhVj1gSacfW4ZGjBt4cjfErXwaKjPYrpWRTPIBye2sh36UhqgOP1Og==',
      url: 'https://registry.npmjs.org/@firecrawl/anydoc/-/anydoc-0.2.4.tgz'
    },
    bundle: {
      'anydoc.js': {
        sha256: '0203401be69a3d64dc45e45c3d0c4340afd97a4417ae40f76c4393d033e97b59'
      },
      'cli.js': {
        sha256: 'cc50a40f8710fc365230fb56625340f012b9ddd02315078e2947199f70652bd5'
      },
      'index.js': {
        sha256: '8a9d648382a789edbddd9207d7a2d4002963a862e5818e8ce9e981c2e6df7cf2'
      },
      'package.json': {
        sha256: '00305842980d83a2e066eb08be59b72ee66fc2a4e7170df4130a996f93e8411d'
      }
    },
    targets: {
      mac_arm: {
        asset: 'anydoc.darwin-arm64.node',
        output: 'anydoc/anydoc.node',
        sha256: '97477757b633802facbb344125ffade35bb4dea547e1f7c01e29c9924451f0d5',
        url: 'https://github.com/firecrawl/anydoc/releases/download/v0.2.4/anydoc.darwin-arm64.node'
      },
      mac_intel: {
        asset: 'anydoc.darwin-x64.node',
        output: 'anydoc/anydoc.node',
        sha256: '5c211f9557e824dbf8d9e5ef8d8150813da910f4e9636e28ec82808fc583329b',
        url: 'https://github.com/firecrawl/anydoc/releases/download/v0.2.4/anydoc.darwin-x64.node'
      },
      win: {
        asset: 'anydoc.win32-x64-msvc.node',
        output: 'anydoc/anydoc.node',
        sha256: '2883dbec5426f5e438489fef6186e3ced2b6ee1cb5deeb6524342eaf57635d19',
        url: 'https://github.com/firecrawl/anydoc/releases/download/v0.2.4/anydoc.win32-x64-msvc.node'
      }
    }
  }
}

const toPosix = (value) => value.split(path.sep).join('/')
const hashFile = (filePath, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(fs.readFileSync(filePath)).digest(encoding)

const readJson = (filePath, label) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${(error && error.message) || String(error)}`)
  }
}

const assertExactKeys = (value, expectedKeys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.join('\n') !== expected.join('\n')) {
    throw new Error(`${label} keys must be exactly: ${expected.join(', ')}`)
  }
}

const assertRegularFile = (filePath, label) => {
  let stats
  try {
    stats = fs.lstatSync(filePath)
  } catch {
    throw new Error(`${label} is missing`)
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular file (symlinks are forbidden)`)
  }
  return stats
}

const assertDigest = (filePath, expected, algorithm = 'sha256', encoding = 'hex', label = filePath) => {
  const actual = hashFile(filePath, algorithm, encoding)
  if (actual !== expected) {
    throw new Error(`${label} ${algorithm} mismatch: expected ${expected}, received ${actual}`)
  }
}

const versionsForManifest = (inventory = INVENTORY) => {
  const versions = {}
  for (const name of [...BINARY_TOOL_NAMES, 'anydoc']) versions[name] = inventory[name].version
  return versions
}

const validatePackagePins = (root = DEFAULT_ROOT, inventory = INVENTORY) => {
  const pkg = readJson(path.join(root, 'package.json'), 'package.json')
  for (const name of [...BINARY_TOOL_NAMES, 'anydoc']) {
    const tool = inventory[name]
    if (pkg[tool.versionKey] !== tool.version) {
      throw new Error(
        `package.json ${tool.versionKey} must be ${tool.version}; received ${String(pkg[tool.versionKey])}`
      )
    }
  }
  return pkg
}

const normalizePackageTarget = (target) => {
  if (!PACKAGE_TO_STORE[target]) {
    throw new Error(`platform must be one of: ${Object.keys(PACKAGE_TO_STORE).join(', ')}`)
  }
  return { packageTarget: target, storePlatform: PACKAGE_TO_STORE[target] }
}

const detectPackageTarget = () => {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac_arm' : 'mac_intel'
  if (process.platform === 'win32' && process.arch === 'x64') return 'win64'
  throw new Error(
    `external tools are supported only on macOS arm64/x64 and Windows x64; received ${process.platform}/${process.arch}`
  )
}

const payloadSpecsForPlatform = (storePlatform, inventory = INVENTORY) => {
  if (!STORE_PLATFORMS.includes(storePlatform)) {
    throw new Error(`external-tools directory must be one of: ${STORE_PLATFORMS.join(', ')}`)
  }
  const specs = BINARY_TOOL_NAMES.map((tool) => {
    const target = inventory[tool].targets[storePlatform]
    return { executable: true, path: target.output, sha256: target.sha256, tool }
  })
  for (const name of ANYDOC_BUNDLE_FILES) {
    specs.push({
      executable: false,
      path: `anydoc/${name}`,
      sha256: inventory.anydoc.bundle[name].sha256,
      tool: 'anydoc'
    })
  }
  const native = inventory.anydoc.targets[storePlatform]
  specs.push({ executable: false, path: native.output, sha256: native.sha256, tool: 'anydoc' })
  return specs.sort((left, right) => left.path.localeCompare(right.path))
}

const listTree = (root) => {
  const files = []
  const directories = []
  const walk = (current, relativeBase) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = relativeBase ? path.join(relativeBase, entry.name) : entry.name
      const absolute = path.join(current, entry.name)
      const stats = fs.lstatSync(absolute)
      if (stats.isSymbolicLink()) {
        throw new Error(`${toPosix(relative)} must be a real file or directory (symlinks are forbidden)`)
      }
      if (stats.isDirectory()) {
        directories.push(`${toPosix(relative)}/`)
        walk(absolute, relative)
      } else if (stats.isFile()) {
        files.push(toPosix(relative))
      } else {
        throw new Error(`${toPosix(relative)} has an unsupported filesystem type`)
      }
    }
  }
  assertRegularDirectory(root, 'external-tools directory')
  walk(root, '')
  return { directories: directories.sort(), files: files.sort() }
}

const assertRegularDirectory = (directory, label) => {
  let stats
  try {
    stats = fs.lstatSync(directory)
  } catch {
    throw new Error(`${label} is missing`)
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a real directory (symlinks are forbidden)`)
  }
}

const assertExactTree = (directory, payloadSpecs, extraFiles) => {
  const expectedFiles = [MANIFEST_FILENAME, ...extraFiles, ...payloadSpecs.map((spec) => spec.path)].sort()
  const expectedDirectories = ['anydoc/']
  const actual = listTree(directory)
  if (actual.files.join('\n') !== expectedFiles.join('\n')) {
    throw new Error(
      `unexpected files in ${directory}: expected ${expectedFiles.join(', ')}, received ${actual.files.join(', ') || '(empty)'}`
    )
  }
  if (actual.directories.join('\n') !== expectedDirectories.join('\n')) {
    throw new Error(
      `unexpected directories in ${directory}: expected ${expectedDirectories.join(', ')}, received ${actual.directories.join(', ') || '(empty)'}`
    )
  }
}

const createManifest = (directory, storePlatform, inventory = INVENTORY) => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  platform: storePlatform,
  packageTarget: STORE_TO_PACKAGE[storePlatform],
  versions: versionsForManifest(inventory),
  files: payloadSpecsForPlatform(storePlatform, inventory).map((spec) => {
    const filePath = path.join(directory, ...spec.path.split('/'))
    const stats = assertRegularFile(filePath, spec.path)
    return {
      path: spec.path,
      sizeBytes: stats.size,
      sha256: hashFile(filePath)
    }
  })
})

const validateManifestAndPayload = (
  directory,
  storePlatform,
  { extraFiles = [], inventory = INVENTORY } = {}
) => {
  const payloadSpecs = payloadSpecsForPlatform(storePlatform, inventory)
  assertExactTree(directory, payloadSpecs, extraFiles)
  const manifestPath = path.join(directory, MANIFEST_FILENAME)
  assertRegularFile(manifestPath, MANIFEST_FILENAME)
  const manifest = readJson(manifestPath, MANIFEST_FILENAME)
  assertExactKeys(
    manifest,
    ['schemaVersion', 'platform', 'packageTarget', 'versions', 'files'],
    MANIFEST_FILENAME
  )
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`${MANIFEST_FILENAME} schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`)
  }
  if (manifest.platform !== storePlatform || manifest.packageTarget !== STORE_TO_PACKAGE[storePlatform]) {
    throw new Error(`${MANIFEST_FILENAME} platform metadata does not match ${storePlatform}`)
  }
  assertExactKeys(manifest.versions, Object.keys(versionsForManifest(inventory)), 'manifest versions')
  const expectedVersions = versionsForManifest(inventory)
  for (const [name, version] of Object.entries(expectedVersions)) {
    if (manifest.versions[name] !== version) {
      throw new Error(`${MANIFEST_FILENAME} ${name} version must be ${version}`)
    }
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== payloadSpecs.length) {
    throw new Error(`${MANIFEST_FILENAME} files must describe the exact payload allowlist`)
  }
  const records = new Map()
  for (const record of manifest.files) {
    assertExactKeys(record, ['path', 'sizeBytes', 'sha256'], 'manifest file record')
    if (records.has(record.path)) throw new Error(`${MANIFEST_FILENAME} contains duplicate ${record.path}`)
    records.set(record.path, record)
  }
  for (const spec of payloadSpecs) {
    const record = records.get(spec.path)
    if (!record) throw new Error(`${MANIFEST_FILENAME} is missing ${spec.path}`)
    if (record.sha256 !== spec.sha256) {
      throw new Error(`${spec.path} manifest hash does not match its pinned release hash`)
    }
    if (!Number.isSafeInteger(record.sizeBytes) || record.sizeBytes <= 0) {
      throw new Error(`${spec.path} manifest size must be a positive integer`)
    }
    const filePath = path.join(directory, ...spec.path.split('/'))
    const stats = assertRegularFile(filePath, spec.path)
    if (stats.size !== record.sizeBytes) {
      throw new Error(`${spec.path} size mismatch: expected ${record.sizeBytes}, received ${stats.size}`)
    }
    assertDigest(filePath, spec.sha256, 'sha256', 'hex', spec.path)
  }
  const metadata = readJson(path.join(directory, 'anydoc', 'package.json'), 'AnyDoc package.json')
  if (metadata.name !== ANYDOC_PACKAGE_NAME || metadata.version !== inventory.anydoc.version) {
    throw new Error(
      `unexpected AnyDoc metadata: ${String(metadata.name)}@${String(metadata.version)}`
    )
  }
  return manifest
}

const validateExternalStore = (root, storePlatform, inventory = INVENTORY) => {
  validatePackagePins(root, inventory)
  const directory = path.join(root, EXTERNAL_DIR_NAME, storePlatform)
  try {
    validateManifestAndPayload(directory, storePlatform, { extraFiles: ['.gitkeep'], inventory })
  } catch (error) {
    throw new Error(
      `${storePlatform} external tools are not initialized or are invalid: ${(error && error.message) || String(error)}. ` +
        'Run `yarn external-tools:init` before packaging.'
    )
  }
  return directory
}

const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    stdio: 'pipe'
  })

const download = (url, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const partial = `${destination}.download-${process.pid}`
  fs.rmSync(partial, { force: true })
  try {
    run('curl', ['-fL', '--retry', '3', '--connect-timeout', '30', '-o', partial, url])
    fs.renameSync(partial, destination)
  } finally {
    fs.rmSync(partial, { force: true })
  }
}

const extractArchive = (archive, destination) => {
  if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') run('tar', ['xf', archive, '-C', destination])
    else run('unzip', ['-qo', archive, '-d', destination])
    return
  }
  run('tar', ['xzf', archive, '-C', destination])
}

const copyGitkeep = (sourcePlatformDirectory, destination) => {
  const source = path.join(sourcePlatformDirectory, '.gitkeep')
  if (fs.existsSync(source)) {
    const stats = fs.lstatSync(source)
    if (stats.isFile() && !stats.isSymbolicLink()) {
      fs.copyFileSync(source, destination)
      return
    }
  }
  fs.writeFileSync(destination, '', 'utf8')
}

const initializeBinaryTool = (toolName, storePlatform, directory, temporaryDownloads, inventory) => {
  const tool = inventory[toolName]
  const target = tool.targets[storePlatform]
  const archive = path.join(temporaryDownloads, `${toolName}-${target.archive}`)
  console.log(`[external-tools] downloading ${toolName} ${tool.version} (${storePlatform})`)
  download(target.url, archive)
  assertDigest(archive, target.archiveSha256, 'sha256', 'hex', target.archive)
  const extractDirectory = path.join(temporaryDownloads, `${toolName}-extract`)
  fs.mkdirSync(extractDirectory, { recursive: true })
  extractArchive(archive, extractDirectory)
  const source = path.join(extractDirectory, ...target.inner.split('/'))
  assertRegularFile(source, `${target.inner} inside ${target.archive}`)
  assertDigest(source, target.sha256, 'sha256', 'hex', `${toolName} release binary`)
  const destination = path.join(directory, ...target.output.split('/'))
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
  if (storePlatform !== 'win') fs.chmodSync(destination, 0o755)
}

const initializeAnydoc = (storePlatform, directory, temporaryDownloads, inventory) => {
  const anydoc = inventory.anydoc
  const packageArchive = path.join(temporaryDownloads, anydoc.packageArchive.filename)
  console.log(`[external-tools] downloading ${ANYDOC_PACKAGE_NAME} ${anydoc.version} (${storePlatform})`)
  download(anydoc.packageArchive.url, packageArchive)
  assertDigest(
    packageArchive,
    anydoc.packageArchive.sha256,
    'sha256',
    'hex',
    anydoc.packageArchive.filename
  )
  assertDigest(
    packageArchive,
    anydoc.packageArchive.sha512,
    'sha512',
    'base64',
    anydoc.packageArchive.filename
  )
  const packageDirectory = path.join(temporaryDownloads, 'anydoc-package')
  fs.mkdirSync(packageDirectory, { recursive: true })
  extractArchive(packageArchive, packageDirectory)
  const extractedPackage = path.join(packageDirectory, 'package')
  const anydocDirectory = path.join(directory, 'anydoc')
  fs.mkdirSync(anydocDirectory, { recursive: true })
  for (const name of ANYDOC_BUNDLE_FILES) {
    const source = path.join(extractedPackage, name)
    assertRegularFile(source, `${name} inside ${anydoc.packageArchive.filename}`)
    assertDigest(source, anydoc.bundle[name].sha256, 'sha256', 'hex', `AnyDoc ${name}`)
    fs.copyFileSync(source, path.join(anydocDirectory, name))
  }
  const metadata = readJson(path.join(anydocDirectory, 'package.json'), 'AnyDoc package.json')
  if (metadata.name !== ANYDOC_PACKAGE_NAME || metadata.version !== anydoc.version) {
    throw new Error(`unexpected AnyDoc metadata: ${String(metadata.name)}@${String(metadata.version)}`)
  }
  const native = anydoc.targets[storePlatform]
  const downloadedNative = path.join(temporaryDownloads, native.asset)
  console.log(`[external-tools] downloading ${native.asset}`)
  download(native.url, downloadedNative)
  assertRegularFile(downloadedNative, native.asset)
  assertDigest(downloadedNative, native.sha256, 'sha256', 'hex', native.asset)
  fs.copyFileSync(downloadedNative, path.join(directory, ...native.output.split('/')))
}

const replacePlatformDirectory = (
  temporaryDirectory,
  destination,
  { rename = fs.renameSync, remove = fs.rmSync } = {}
) => {
  const backup = `${destination}.backup-${process.pid}-${Date.now()}`
  let movedExisting = false
  let installedReplacement = false
  try {
    if (fs.existsSync(destination)) {
      rename(destination, backup)
      movedExisting = true
    }
    rename(temporaryDirectory, destination)
    installedReplacement = true
    if (movedExisting) remove(backup, { recursive: true, force: true })
  } catch (error) {
    if (!installedReplacement && !fs.existsSync(destination) && movedExisting && fs.existsSync(backup)) {
      rename(backup, destination)
    }
    throw error
  } finally {
    if (installedReplacement && fs.existsSync(backup)) {
      remove(backup, { recursive: true, force: true })
    }
    if (fs.existsSync(temporaryDirectory)) {
      remove(temporaryDirectory, { recursive: true, force: true })
    }
  }
}

const initializePlatform = (
  root,
  storePlatform,
  force = false,
  inventory = INVENTORY,
  {
    initializeBinary = initializeBinaryTool,
    initializeDocumentTool = initializeAnydoc,
    replaceDirectory = replacePlatformDirectory
  } = {}
) => {
  const externalRoot = path.join(root, EXTERNAL_DIR_NAME)
  const destination = path.join(externalRoot, storePlatform)
  if (!force) {
    try {
      validateExternalStore(root, storePlatform, inventory)
      console.log(`[external-tools] ${storePlatform} already initialized and verified`)
      return false
    } catch (error) {
      console.log(`[external-tools] rebuilding ${storePlatform}: ${(error && error.message) || String(error)}`)
    }
  }
  fs.mkdirSync(externalRoot, { recursive: true })
  const temporaryDirectory = fs.mkdtempSync(path.join(externalRoot, `.${storePlatform}.init-`))
  const temporaryDownloads = fs.mkdtempSync(path.join(os.tmpdir(), `maestro-tools-${storePlatform}-`))
  try {
    copyGitkeep(destination, path.join(temporaryDirectory, '.gitkeep'))
    for (const toolName of BINARY_TOOL_NAMES) {
      initializeBinary(toolName, storePlatform, temporaryDirectory, temporaryDownloads, inventory)
    }
    initializeDocumentTool(storePlatform, temporaryDirectory, temporaryDownloads, inventory)
    const manifest = createManifest(temporaryDirectory, storePlatform, inventory)
    fs.writeFileSync(
      path.join(temporaryDirectory, MANIFEST_FILENAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    )
    validateManifestAndPayload(temporaryDirectory, storePlatform, {
      extraFiles: ['.gitkeep'],
      inventory
    })
    replaceDirectory(temporaryDirectory, destination)
    console.log(`[external-tools] initialized ${storePlatform}`)
    return true
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    fs.rmSync(temporaryDownloads, { recursive: true, force: true })
  }
}

const initializeAll = (root = DEFAULT_ROOT, force = false, inventory = INVENTORY) => {
  validatePackagePins(root, inventory)
  for (const storePlatform of STORE_PLATFORMS) {
    initializePlatform(root, storePlatform, force, inventory)
  }
  console.log('[external-tools] all platforms are initialized and verified')
}

const cliFilenameForTarget = (packageTarget) => (packageTarget === 'win64' ? 'micromeet.exe' : 'micromeet')

const validateCliStage = (stageDirectory, packageTarget) => {
  const cliFilename = cliFilenameForTarget(packageTarget)
  assertRegularFile(path.join(stageDirectory, cliFilename), `staged ${cliFilename}`)
  const manifestPath = path.join(stageDirectory, 'manifest.json')
  assertRegularFile(manifestPath, 'staged Micromeet CLI manifest.json')
  const manifest = readJson(manifestPath, 'staged Micromeet CLI manifest.json')
  if (manifest.platform !== packageTarget || manifest.staged !== cliFilename) {
    throw new Error(
      `staged Micromeet CLI does not match ${packageTarget}; run prepare-maestro-cli.cjs ${packageTarget} first`
    )
  }
  return cliFilename
}

const externalRootArtifactNames = (inventory = INVENTORY) => {
  const names = new Set([MANIFEST_FILENAME, 'anydoc'])
  for (const toolName of BINARY_TOOL_NAMES) {
    for (const target of Object.values(inventory[toolName].targets)) names.add(target.output)
  }
  return [...names]
}

const removeStaleExternalArtifacts = (stageDirectory, inventory = INVENTORY) => {
  for (const name of externalRootArtifactNames(inventory)) {
    fs.rmSync(path.join(stageDirectory, name), { recursive: true, force: true })
  }
}

const copyPayload = (sourceDirectory, stageDirectory, storePlatform, inventory = INVENTORY) => {
  for (const spec of payloadSpecsForPlatform(storePlatform, inventory)) {
    const source = path.join(sourceDirectory, ...spec.path.split('/'))
    const destination = path.join(stageDirectory, ...spec.path.split('/'))
    assertRegularFile(source, spec.path)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
    if (spec.executable && storePlatform !== 'win') fs.chmodSync(destination, 0o755)
  }
  fs.copyFileSync(
    path.join(sourceDirectory, MANIFEST_FILENAME),
    path.join(stageDirectory, MANIFEST_FILENAME)
  )
}

const verifyStagedExternalTools = (
  root = DEFAULT_ROOT,
  packageTarget = detectPackageTarget(),
  inventory = INVENTORY
) => {
  validatePackagePins(root, inventory)
  const normalized = normalizePackageTarget(packageTarget)
  const stageDirectory = path.join(root, STAGE_RELATIVE_PATH)
  const cliFilename = validateCliStage(stageDirectory, normalized.packageTarget)
  validateManifestAndPayload(stageDirectory, normalized.storePlatform, {
    extraFiles: ['manifest.json', cliFilename],
    inventory
  })
  console.log(`[external-tools] staged tools verified for ${normalized.packageTarget}`)
  return stageDirectory
}

const stageExternalTools = (
  root = DEFAULT_ROOT,
  packageTarget = detectPackageTarget(),
  inventory = INVENTORY
) => {
  validatePackagePins(root, inventory)
  const normalized = normalizePackageTarget(packageTarget)
  const sourceDirectory = validateExternalStore(root, normalized.storePlatform, inventory)
  const stageDirectory = path.join(root, STAGE_RELATIVE_PATH)
  validateCliStage(stageDirectory, normalized.packageTarget)
  removeStaleExternalArtifacts(stageDirectory, inventory)
  copyPayload(sourceDirectory, stageDirectory, normalized.storePlatform, inventory)
  verifyStagedExternalTools(root, normalized.packageTarget, inventory)
  console.log(
    `[external-tools] staged external_tools/${normalized.storePlatform} in build/maestro-tools`
  )
  return stageDirectory
}

const parseArgs = (argv = process.argv.slice(2)) => {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    return { command: 'help' }
  }
  if (command === 'init') {
    const unknown = rest.filter((arg) => arg !== '--force')
    if (unknown.length) throw new Error(`unknown init argument: ${unknown[0]}`)
    return { command, force: rest.includes('--force') }
  }
  if (command === 'stage' || command === 'verify-stage') {
    if (rest.length > 1) throw new Error(`usage: ${command} [mac_arm|mac_intel|win64]`)
    const packageTarget = rest[0] || detectPackageTarget()
    normalizePackageTarget(packageTarget)
    return { command, packageTarget }
  }
  throw new Error(`unknown command: ${command}`)
}

const printHelp = () => {
  console.log(
    'Maestro external tools\n\n' +
      '  yarn external-tools:init [--force]          initialize mac_arm, mac_intel, and win\n' +
      '  node scripts/maestro/externalTools.cjs stage [mac_arm|mac_intel|win64]\n' +
      '  node scripts/maestro/externalTools.cjs verify-stage [mac_arm|mac_intel|win64]'
  )
}

const main = () => {
  const args = parseArgs()
  if (args.command === 'help') return printHelp()
  if (args.command === 'init') return initializeAll(DEFAULT_ROOT, args.force)
  if (args.command === 'stage') return stageExternalTools(DEFAULT_ROOT, args.packageTarget)
  return verifyStagedExternalTools(DEFAULT_ROOT, args.packageTarget)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[external-tools] ${(error && error.message) || String(error)}`)
    process.exitCode = 1
  }
}

module.exports = {
  ANYDOC_BUNDLE_FILES,
  BINARY_TOOL_NAMES,
  INVENTORY,
  MANIFEST_FILENAME,
  STORE_PLATFORMS,
  createManifest,
  initializeAll,
  initializePlatform,
  normalizePackageTarget,
  payloadSpecsForPlatform,
  replacePlatformDirectory,
  stageExternalTools,
  validateExternalStore,
  validateManifestAndPayload,
  validatePackagePins,
  verifyStagedExternalTools
}
