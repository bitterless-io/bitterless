#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const STAGE_DIR = path.join(ROOT, 'build', 'maestro-tools')
const CACHE_DIR = path.join(ROOT, 'prebuilt')
const PLATFORMS = ['mac_arm', 'mac_intel', 'linux_arm', 'linux_x64', 'win64']
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.ouch_version

if (!VERSION) {
  throw new Error('package.json is missing "ouch_version"')
}

const TARGETS = {
  mac_arm: {
    asset: 'ouch-aarch64-apple-darwin.tar.gz',
    inner: 'ouch-aarch64-apple-darwin/ouch',
    out: 'ouch'
  },
  mac_intel: {
    asset: 'ouch-x86_64-apple-darwin.tar.gz',
    inner: 'ouch-x86_64-apple-darwin/ouch',
    out: 'ouch'
  },
  win64: {
    asset: 'ouch-x86_64-pc-windows-msvc.zip',
    inner: 'ouch-x86_64-pc-windows-msvc/ouch.exe',
    out: 'ouch.exe'
  }
}

const detectPlatform = () => {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac_arm' : 'mac_intel'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux_arm' : 'linux_x64'
  if (process.platform === 'win32') return 'win64'
  throw new Error(`unsupported packaging platform: ${process.platform}/${process.arch}`)
}

const parseArgs = () => {
  const out = { platform: detectPlatform(), force: false, help: false }
  for (const arg of process.argv.slice(2)) {
    if (arg === '--force') out.force = true
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

const extract = (archive, destination) => {
  if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') run('tar', ['xf', archive, '-C', destination])
    else run('unzip', ['-qo', archive, '-d', destination])
    return
  }
  run('tar', ['xzf', archive, '-C', destination])
}

const removeStagedArchiveRuntime = () => {
  for (const name of ['ouch', 'ouch.exe']) {
    fs.rmSync(path.join(STAGE_DIR, name), { force: true })
  }
}

const cacheBinary = (platform, force) => {
  const target = TARGETS[platform]
  const cachedDir = path.join(CACHE_DIR, `ouch-${VERSION}-${platform}`)
  const cached = path.join(cachedDir, target.out)
  if (fs.existsSync(cached) && !force) return { path: cached, fromCache: true }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-ouch-'))
  try {
    const archive = path.join(tempDir, target.asset)
    const url = `https://github.com/ouch-org/ouch/releases/download/${VERSION}/${target.asset}`
    console.log(`[prepare-maestro-archive] downloading ouch ${VERSION} (${platform})`)
    run('curl', ['-fsSL', '-o', archive, url])
    extract(archive, tempDir)

    const source = path.join(tempDir, target.inner)
    if (!fs.existsSync(source)) {
      throw new Error(`${target.inner} was not found inside ${target.asset}`)
    }
    fs.mkdirSync(cachedDir, { recursive: true })
    fs.copyFileSync(source, cached)
    if (platform !== 'win64') fs.chmodSync(cached, 0o755)
    return { path: cached, fromCache: false }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

const stage = (platform, force) => {
  fs.mkdirSync(STAGE_DIR, { recursive: true })
  removeStagedArchiveRuntime()

  const target = TARGETS[platform]
  if (!target) {
    console.log(
      `[prepare-maestro-archive] archive runtime unavailable on ${platform}: ` +
        'ouch has no configured Linux asset; stale ouch artifacts removed'
    )
    return
  }

  const cached = cacheBinary(platform, force)
  const destination = path.join(STAGE_DIR, target.out)
  fs.copyFileSync(cached.path, destination)
  if (platform !== 'win64') fs.chmodSync(destination, 0o755)
  console.log(
    `[prepare-maestro-archive] staged build/maestro-tools/${target.out} ` +
      `(${cached.fromCache ? 'cache hit' : 'downloaded'})`
  )
}

const main = () => {
  const args = parseArgs()
  if (args.help) {
    console.log(
      `node scripts/prepare-maestro-archive.cjs <${PLATFORMS.join('|')}> [--force]`
    )
    return
  }
  stage(args.platform, args.force)
}

try {
  main()
} catch (error) {
  console.error(`[prepare-maestro-archive] ${(error && error.message) || String(error)}`)
  process.exit(1)
}
