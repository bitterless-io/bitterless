#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

const nodeCommand = (...args) => ({ command: process.execPath, args })

const commandsForHost = (platform, arch) => {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    const target = arch === 'arm64' ? 'mac_arm' : 'mac_intel'
    return [
      nodeCommand('scripts/maestro/externalTools.cjs', 'stage', target),
      nodeCommand('scripts/maestro/externalTools.cjs', 'verify-stage', target)
    ]
  }
  if (platform === 'win32' && arch === 'x64') {
    return [
      nodeCommand('scripts/maestro/externalTools.cjs', 'stage', 'win64'),
      nodeCommand('scripts/maestro/externalTools.cjs', 'verify-stage', 'win64')
    ]
  }
  if (platform === 'linux' && (arch === 'arm64' || arch === 'x64')) {
    const target = arch === 'arm64' ? 'linux_arm' : 'linux_x64'
    return [
      nodeCommand('scripts/prepare-maestro-anydoc.cjs', target),
      nodeCommand('scripts/prepare-maestro-archive.cjs', target),
      nodeCommand('scripts/prepare-maestro-anydoc.cjs', target, '--verify')
    ]
  }
  throw new Error(`unsupported unpack host: ${platform}/${arch}`)
}

const runCommands = (commands, root = ROOT) => {
  for (const { command, args } of commands) {
    execFileSync(command, args, { cwd: root, stdio: 'inherit' })
  }
}

const main = () => runCommands(commandsForHost(process.platform, process.arch))

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[prepare-maestro-package-tools] ${(error && error.message) || String(error)}`)
    process.exitCode = 1
  }
}

module.exports = { commandsForHost, runCommands }
