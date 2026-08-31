#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const STAGE_DIR = path.join(ROOT, 'build', 'maestro-tools', 'anydoc')
const CACHE_DIR = path.join(ROOT, 'prebuilt')
const PLATFORMS = ['mac_arm', 'mac_intel', 'linux_arm', 'linux_x64', 'win64']
const PACKAGE_NAME = '@firecrawl/anydoc'
const STAGED_FILES = ['anydoc.js', 'anydoc.node', 'cli.js', 'index.js', 'package.json']
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.anydoc_version

if (!VERSION) {
  throw new Error('package.json is missing "anydoc_version"')
}

const TARGETS = {
  mac_arm: {
    asset: 'anydoc.darwin-arm64.node',
    sha256: '97477757b633802facbb344125ffade35bb4dea547e1f7c01e29c9924451f0d5'
  },
  mac_intel: {
    asset: 'anydoc.darwin-x64.node',
    sha256: '5c211f9557e824dbf8d9e5ef8d8150813da910f4e9636e28ec82808fc583329b'
  },
  win64: {
    asset: 'anydoc.win32-x64-msvc.node',
    sha256: '2883dbec5426f5e438489fef6186e3ced2b6ee1cb5deeb6524342eaf57635d19'
  },
  linux_arm: {
    asset: 'anydoc.linux-arm64-gnu.node',
    sha256: '0f94ccdedfb50e3313a842f501b2355d99f320888410cc51681f589d1f3e6210'
  },
  linux_x64: {
    asset: 'anydoc.linux-x64-gnu.node',
    sha256: '1c7927a844f33adac68279e8116585002fd125195f10330f9024e62f2c90b643'
  }
}

const detectPlatform = () => {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac_arm' : 'mac_intel'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux_arm' : 'linux_x64'
  if (process.platform === 'win32') return 'win64'
  throw new Error(`unsupported packaging platform: ${process.platform}/${process.arch}`)
}

const parseArgs = () => {
  const out = { platform: detectPlatform(), force: false, verify: false, help: false }
  for (const arg of process.argv.slice(2)) {
    if (arg === '--force') out.force = true
    else if (arg === '--verify') out.verify = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (!arg.startsWith('-')) out.platform = arg
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!PLATFORMS.includes(out.platform) && !out.help) {
    throw new Error(`platform must be one of: ${PLATFORMS.join(', ')}`)
  }
  return out
}

const run = (command, args) =>
  execFileSync(command, args, {
    stdio: 'pipe'
  })

const download = (url, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.download-${process.pid}`
  fs.rmSync(temporary, { force: true })
  try {
    run('curl', ['-fsSL', '--retry', '3', '-o', temporary, url])
    fs.renameSync(temporary, destination)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

const fileSha256 = (filePath) =>
  createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')

const verifyNative = (filePath, target) => {
  const actual = fileSha256(filePath)
  if (actual !== target.sha256) {
    throw new Error(
      `checksum mismatch for ${target.asset}: expected ${target.sha256}, received ${actual}`
    )
  }
}

const cacheRoot = () => path.join(CACHE_DIR, `anydoc-${VERSION}`)

const cachePackageTarball = (force) => {
  const tarball = path.join(cacheRoot(), `anydoc-${VERSION}.tgz`)
  if (force) fs.rmSync(tarball, { force: true })
  if (!fs.existsSync(tarball)) {
    const url = `https://registry.npmjs.org/@firecrawl/anydoc/-/anydoc-${VERSION}.tgz`
    console.log(`[prepare-maestro-anydoc] downloading ${PACKAGE_NAME} ${VERSION}`)
    download(url, tarball)
  }
  return tarball
}

const cacheNative = (platform, force) => {
  const target = TARGETS[platform]
  const cached = path.join(cacheRoot(), target.asset)
  if (force) fs.rmSync(cached, { force: true })
  if (!fs.existsSync(cached)) {
    const url = `https://github.com/firecrawl/anydoc/releases/download/v${VERSION}/${target.asset}`
    console.log(`[prepare-maestro-anydoc] downloading ${target.asset}`)
    download(url, cached)
  }
  verifyNative(cached, target)
  return cached
}

const extractPackageBundle = (tarball, destination) => {
  run('tar', ['xzf', tarball, '-C', destination])
  const packageRoot = path.join(destination, 'package')
  const metadataPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(metadataPath)) {
    throw new Error('package.json was not found in the anydoc npm tarball')
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  if (metadata.name !== PACKAGE_NAME || metadata.version !== VERSION) {
    throw new Error(
      `unexpected npm package metadata: ${String(metadata.name)}@${String(metadata.version)}`
    )
  }

  const bundle = {
    'cli.js': path.join(packageRoot, 'cli.js'),
    'anydoc.js': path.join(packageRoot, 'anydoc.js'),
    'index.js': path.join(packageRoot, 'index.js'),
    'package.json': metadataPath
  }
  for (const [name, source] of Object.entries(bundle)) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`${name} was not found in the anydoc npm tarball`)
    }
  }
  return bundle
}

const stage = (platform, force) => {
  fs.rmSync(STAGE_DIR, { recursive: true, force: true })
  fs.mkdirSync(STAGE_DIR, { recursive: true })

  const tarball = cachePackageTarball(force)
  const target = TARGETS[platform]
  const native = cacheNative(platform, force)
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-anydoc-'))
  try {
    const bundle = extractPackageBundle(tarball, temporary)
    for (const [name, source] of Object.entries(bundle)) {
      fs.copyFileSync(source, path.join(STAGE_DIR, name))
    }
    const stagedNative = path.join(STAGE_DIR, 'anydoc.node')
    fs.copyFileSync(native, stagedNative)
    verifyNative(stagedNative, target)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }

  console.log(
    `[prepare-maestro-anydoc] staged ${PACKAGE_NAME}@${VERSION} for ${platform} ` +
      'in build/maestro-tools/anydoc'
  )
}

const verifyStage = (platform) => {
  if (!fs.existsSync(STAGE_DIR)) {
    throw new Error('build/maestro-tools/anydoc is missing')
  }
  const actualFiles = fs.readdirSync(STAGE_DIR).sort()
  if (actualFiles.join('\n') !== STAGED_FILES.join('\n')) {
    throw new Error(
      `unexpected staged files: ${actualFiles.length ? actualFiles.join(', ') : '(empty)'}`
    )
  }
  for (const name of STAGED_FILES) {
    const staged = path.join(STAGE_DIR, name)
    if (!fs.statSync(staged).isFile()) throw new Error(`staged ${name} is not a file`)
  }

  const metadata = JSON.parse(fs.readFileSync(path.join(STAGE_DIR, 'package.json'), 'utf8'))
  if (metadata.name !== PACKAGE_NAME || metadata.version !== VERSION) {
    throw new Error(
      `unexpected staged package metadata: ${String(metadata.name)}@${String(metadata.version)}`
    )
  }
  verifyNative(path.join(STAGE_DIR, 'anydoc.node'), TARGETS[platform])
  console.log(`[prepare-maestro-anydoc] verify ok (${platform})`)
}

const main = () => {
  const args = parseArgs()
  if (args.help) {
    console.log(
      `node scripts/prepare-maestro-anydoc.cjs <${PLATFORMS.join('|')}> [--force|--verify]`
    )
    return
  }
  if (args.verify) {
    verifyStage(args.platform)
    return
  }
  stage(args.platform, args.force)
}

try {
  main()
} catch (error) {
  console.error(`[prepare-maestro-anydoc] ${(error && error.message) || String(error)}`)
  process.exit(1)
}
