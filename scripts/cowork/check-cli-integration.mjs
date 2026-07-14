import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cliRoot, projectRoot, coworkRoot, assert } from './_harness.mjs'

const readProject = (file) => readFileSync(join(projectRoot, file), 'utf8')
const readCowork = (file) => readFileSync(join(coworkRoot, file), 'utf8')
const readCli = (file) => readFileSync(join(cliRoot, file), 'utf8')

const pkg = readProject('package.json')
const builder = readProject('electron-builder.yml')
const prepare = readProject('scripts/prepare-cowork-cli.cjs')
const publish = readProject('scripts/publish.js')
const hostHandler = readProject('src/main/xpc/coworkWindow.handler.ts')
const cliService = readCowork('main/cli/micromeetCli.service.ts')
const authBridge = readCowork('main/auth/authBridge.ts')
const llmService = readCowork('main/llm/coworkLlm.service.ts')
const feature = readProject('docs/features/cowork-subapp.md')
const cliPkg = readCli('package.json')
const cliPackage = readCli('scripts/package.cjs')
const nsis = readProject('build/installer.nsh')

assert(pkg.includes('"prepare:cowork-cli": "node scripts/prepare-cowork-cli.cjs"'), 'package.json should expose Cowork CLI preparation')
for (const platform of ['mac_arm', 'mac_intel', 'linux_arm', 'linux_x64', 'win64']) {
  assert(pkg.includes(`node scripts/prepare-cowork-cli.cjs ${platform}`) || platform === 'linux_arm', `package scripts should prepare CLI for ${platform}`)
  assert(prepare.includes(`${platform}:`), `prepare script should define ${platform}`)
}
assert(pkg.includes('node scripts/prepare-cowork-cli.cjs linux_arm'), 'Linux arm64 package build should prepare the linux_arm CLI')
assert(prepare.includes("run('yarn', ['workspace', '@micromeet/cli', 'package', config.cliTarget]"), 'prepare script should package the local CLI through Yarn workspaces')
assert(prepare.includes('MICROMEET_CLI_DIR'), 'prepare script should support an explicit vendored CLI location')
assert(prepare.includes("packages', 'micromeet-cli'"), 'prepare script should default to the vendored CLI workspace')
assert(prepare.includes("build', 'cowork-tools'"), 'prepare script should stage into build/cowork-tools')
for (const binary of ['micromeet-macos-arm64', 'micromeet-macos-x64', 'micromeet-linux-arm64', 'micromeet-linux-x64', 'micromeet-win-x64.exe']) {
  assert(prepare.includes(binary), `prepare script should stage ${binary}`)
}

assert(cliPkg.includes('"package": "yarn build && node scripts/package.cjs"'), 'CLI package should build before native packaging')
assert(cliPkg.includes('"bun"'), 'CLI package should use Bun for standalone executables')
for (const target of ['bun-darwin-arm64', 'bun-darwin-x64', 'bun-linux-arm64', 'bun-linux-x64', 'bun-windows-x64']) {
  assert(cliPackage.includes(target), `CLI package script should support ${target}`)
}
assert(cliPackage.includes("['build', '--compile', '--minify'"), 'CLI package script should use bun build --compile')

assert(builder.includes('extraResources:'), 'electron-builder should declare extraResources')
assert(builder.includes('from: build/cowork-tools') && builder.includes('to: cowork-tools'), 'packaging should copy the staged Cowork CLI')
assert(builder.includes('Contents/Resources/cowork-tools/micromeet'), 'mac signing should include the bundled CLI')
assert(publish.includes("run('node', ['scripts/prepare-cowork-cli.cjs', options.platform])"), 'release builds should prepare the CLI before packaging')

assert(cliService.includes('process.resourcesPath') && cliService.includes("'cowork-tools'"), 'runtime should resolve the packaged CLI resource')
assert(cliService.includes("'.micromeet'") && cliService.includes("'bin'"), 'runtime should create the ~/.micromeet/bin shim')
assert(cliService.includes('process.env.PATH'), 'runtime should prepend CLI directories to PATH')
assert(cliService.includes('MICROMEET_CRMS_CREDENTIAL_FILE'), 'runtime should publish the CRMS credential file')
assert(cliService.includes("'aes-256-gcm'") && cliService.includes('randomBytes(32)'), 'runtime should encrypt CRMS credentials with a random local key')
assert(cliService.includes('mode: 0o600') && cliService.includes('chmodSync(CRMS_CREDENTIAL_FILE, 0o600)'), 'credential file should be mode 0600')
assert(cliService.includes("auth_source: 'cowork'"), 'credential should identify Cowork as its source')
assert(cliService.includes('renameSync(tempFile, CRMS_CREDENTIAL_FILE)'), 'credential replacement should be atomic')
assert(cliService.includes('rmSync(LEGACY_SESSION_FILE') && cliService.includes('rmSync(CRMS_CREDENTIAL_FILE'), 'runtime should remove plaintext legacy and logged-out credentials')

assert(hostHandler.includes('ensureMicromeetCliIntegration()'), 'embedded startup should initialize CLI PATH and shim')
assert(hostHandler.includes("createXpcMainEmitter<SessionApi>('CoworkSessionDao')"), 'embedded startup should read the isolated Cowork session')
assert(hostHandler.includes('writeMicromeetCliCredential(session)'), 'embedded startup should sync an existing credential')
assert(authBridge.includes('writeMicromeetCliCredential(this.current)'), 'auth bridge login should sync the credential')
assert(authBridge.includes('writeMicromeetCliCredential(null)'), 'auth bridge logout should clear the credential')
assert(llmService.includes('writeMicromeetCliCredential(null)'), 'AI-CRMS logout should clear the CLI credential')
assert(feature.includes('Bundled Micromeet CLI invocation and credential synchronization'), 'feature contract should preserve the bundled CLI')
assert(!nsis.includes('micromeet'), 'NSIS should not carry duplicate Micromeet PATH logic')

console.log('[check-cli-integration] ok')
