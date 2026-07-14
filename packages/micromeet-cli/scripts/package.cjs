const { chmodSync, mkdirSync } = require('fs')
const { join } = require('path')
const { spawnSync } = require('child_process')

const root = join(__dirname, '..')
const entry = join(root, 'src', 'cli.ts')
const releaseDir = join(root, 'release')

const targetMap = {
  mac_arm: { target: 'bun-darwin-arm64', output: 'micromeet-macos-arm64' },
  mac_intel: { target: 'bun-darwin-x64', output: 'micromeet-macos-x64' },
  linux_arm: { target: 'bun-linux-arm64', output: 'micromeet-linux-arm64' },
  linux_x64: { target: 'bun-linux-x64', output: 'micromeet-linux-x64' },
  win64: { target: 'bun-windows-x64', output: 'micromeet-win-x64.exe' },
  'bun-darwin-arm64': { target: 'bun-darwin-arm64', output: 'micromeet-macos-arm64' },
  'bun-darwin-x64': { target: 'bun-darwin-x64', output: 'micromeet-macos-x64' },
  'bun-linux-arm64': { target: 'bun-linux-arm64', output: 'micromeet-linux-arm64' },
  'bun-linux-x64': { target: 'bun-linux-x64', output: 'micromeet-linux-x64' },
  'bun-windows-x64': { target: 'bun-windows-x64', output: 'micromeet-win-x64.exe' }
}

const defaultTargets = ['mac_arm', 'mac_intel', 'linux_arm', 'linux_x64', 'win64']
const requestedTargets = process.argv.slice(2)
const targets = requestedTargets.length ? requestedTargets : defaultTargets

const runBunBuild = (target) => {
  const config = targetMap[target]
  if (!config) {
    console.error(`Unknown target: ${target}`)
    console.error(`Known targets: ${Object.keys(targetMap).join(', ')}`)
    process.exit(1)
  }

  mkdirSync(releaseDir, { recursive: true })
  const outfile = join(releaseDir, config.output)
  const args = ['build', '--compile', '--minify', `--target=${config.target}`, entry, `--outfile=${outfile}`]
  const res = spawnSync('bun', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (res.error) {
    console.error(`Failed to run bun: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) process.exit(res.status || 1)
  if (config.target !== 'bun-windows-x64') chmodSync(outfile, 0o755)
}

for (const target of targets) runBunBuild(target)
