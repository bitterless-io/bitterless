#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const WORKSPACE_DIR = path.resolve(__dirname, '..')
const CLI_DIR = path.resolve(
  process.env.MICROMEET_CLI_DIR || path.join(WORKSPACE_DIR, 'packages', 'micromeet-cli')
)
const STAGE_DIR = path.join(WORKSPACE_DIR, 'build', 'cowork-tools')

const PLATFORMS = {
  mac_arm: { cliTarget: 'mac_arm', source: 'micromeet-macos-arm64', staged: 'micromeet' },
  mac_intel: { cliTarget: 'mac_intel', source: 'micromeet-macos-x64', staged: 'micromeet' },
  linux_arm: { cliTarget: 'linux_arm', source: 'micromeet-linux-arm64', staged: 'micromeet' },
  linux_x64: { cliTarget: 'linux_x64', source: 'micromeet-linux-x64', staged: 'micromeet' },
  win64: { cliTarget: 'win64', source: 'micromeet-win-x64.exe', staged: 'micromeet.exe' }
}

const detectPlatform = () => {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac_arm' : 'mac_intel'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux_arm' : 'linux_x64'
  if (process.platform === 'win32') return 'win64'
  throw new Error(`unsupported packaging platform: ${process.platform}/${process.arch}`)
}

const parseArgs = () => {
  const out = { platform: detectPlatform(), skipBuild: false, help: false }
  for (const arg of process.argv.slice(2)) {
    if (arg === '--skip-build') out.skipBuild = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (!arg.startsWith('-')) out.platform = arg
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!PLATFORMS[out.platform] && !out.help) {
    throw new Error(`platform must be one of: ${Object.keys(PLATFORMS).join(', ')}`)
  }
  return out
}

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})`)
}

const copyCli = (platform) => {
  const config = PLATFORMS[platform]
  const sourcePath = path.join(CLI_DIR, 'release', config.source)
  const stagedPath = path.join(STAGE_DIR, config.staged)
  if (!fs.existsSync(sourcePath)) throw new Error(`missing CLI artifact: ${sourcePath}`)

  fs.rmSync(STAGE_DIR, { recursive: true, force: true })
  fs.mkdirSync(STAGE_DIR, { recursive: true })
  fs.copyFileSync(sourcePath, stagedPath)
  if (platform !== 'win64') fs.chmodSync(stagedPath, 0o755)
  fs.writeFileSync(
    path.join(STAGE_DIR, 'manifest.json'),
    `${JSON.stringify({ platform, staged: config.staged, cliTarget: config.cliTarget }, null, 2)}\n`,
    'utf8'
  )
}

const main = () => {
  const args = parseArgs()
  if (args.help) {
    console.log(`node scripts/prepare-cowork-cli.cjs <${Object.keys(PLATFORMS).join('|')}> [--skip-build]`)
    return
  }
  if (!fs.existsSync(path.join(CLI_DIR, 'package.json'))) {
    throw new Error(`@micromeet/cli workspace not found: ${CLI_DIR}`)
  }
  const config = PLATFORMS[args.platform]
  if (!args.skipBuild) {
    run('yarn', ['workspace', '@micromeet/cli', 'package', config.cliTarget], WORKSPACE_DIR)
  }
  copyCli(args.platform)
}

try {
  main()
} catch (err) {
  console.error(`[prepare-cowork-cli] ${(err && err.message) || String(err)}`)
  process.exit(1)
}
