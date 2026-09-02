import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cliRoot, projectRoot, readMaestro, assert } from './_harness.mjs'

const readProject = (file) => readFileSync(join(projectRoot, file), 'utf8')
const readCli = (file) => readFileSync(join(cliRoot, file), 'utf8')

const pkg = readProject('package.json')
const builder = readProject('electron-builder.yml')
const prepare = readProject('scripts/prepare-maestro-cli.cjs')
const publish = readProject('scripts/publish.js')
const hostHandler = readProject('src/main/xpc/maestroWindow.handler.ts')
const cliService = readMaestro('main/cli/micromeetCli.service.ts')
const cliPathService = readMaestro('main/cli/micromeetCliPath.service.ts')
const integrationRunner = readMaestro('main/integration/integrationRunner.service.ts')
const authBridge = readMaestro('main/auth/authBridge.ts')
const llmService = readMaestro('main/llm/maestroLlm.service.ts')
const feature = readProject('docs/features/maestro.md')
const cliPkg = readCli('package.json')
const cliPackage = readCli('scripts/package.cjs')
const cliConfig = readCli('src/config.ts')
const cliCommands = readCli('src/commands.ts')
const cliCredentialStore = readCli('src/credentialStore.ts')
const nsis = readProject('build/installer.nsh')

assert(pkg.includes('"prepare:maestro-cli": "node scripts/prepare-maestro-cli.cjs"'), 'package.json should expose Maestro CLI preparation')
for (const platform of ['mac_arm', 'mac_intel', 'linux_arm', 'linux_x64', 'win64']) {
  assert(pkg.includes(`node scripts/prepare-maestro-cli.cjs ${platform}`) || platform === 'linux_arm', `package scripts should prepare CLI for ${platform}`)
  assert(prepare.includes(`${platform}:`), `prepare script should define ${platform}`)
}
assert(pkg.includes('node scripts/prepare-maestro-cli.cjs linux_arm'), 'Linux arm64 package build should prepare the linux_arm CLI')
assert(prepare.includes("run('yarn', ['workspace', '@micromeet/cli', 'package', config.cliTarget]"), 'prepare script should package the local CLI through Yarn workspaces')
assert(prepare.includes('MICROMEET_CLI_DIR'), 'prepare script should support an explicit vendored CLI location')
assert(prepare.includes("packages', 'micromeet-cli'"), 'prepare script should default to the vendored CLI workspace')
assert(prepare.includes("build', 'maestro-tools'"), 'prepare script should stage into build/maestro-tools')
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
assert(builder.includes('from: build/maestro-tools') && builder.includes('to: maestro-tools'), 'packaging should copy the staged Maestro CLI')
assert(builder.includes('Contents/Resources/maestro-tools/micromeet'), 'mac signing should include the bundled CLI')
assert(publish.includes('const runBuild =') && publish.includes("run('yarn', [`${scriptPrefix}:${buildTarget}`])"), 'release publication should invoke the channel-specific build script that prepares the CLI')

assert(cliService.includes('process.resourcesPath') && cliPathService.includes("'maestro-tools'"), 'runtime should resolve the packaged CLI resource')
assert(cliPathService.includes("'.micromeet'") && cliPathService.includes("'bin'"), 'Stable runtime should retain the ~/.micromeet/bin shim')
assert(cliPathService.includes("'cowork', 'cli'") && cliPathService.includes("input.releaseChannel === 'preview'"), 'Preview runtime should resolve its CLI root below application userData')
assert(cliPathService.includes("'sys.json'") && cliPathService.includes('MICROMEET_SYS_CREDENTIAL_FILE'), 'Preview runtime should isolate the Sys credential alongside CRMS')
assert(cliPathService.includes('MICROMEET_CREDENTIAL_FILE') && cliPathService.includes('MICROMEET_CLI_PATH'), 'Preview runtime should pin generic credential and executable overrides locally')
assert(cliPathService.includes('!input.paths.previewIsolated && inheritedCliPath'), 'only Stable should honor an inherited CLI executable override')
assert(cliService.includes("app.getPath('userData')") && cliService.includes('import.meta.env.VITE_RELEASE_CHANNEL'), 'runtime should resolve CLI paths from the active application profile')
assert(cliService.includes('process.env.PATH'), 'runtime should prepend CLI directories to PATH')
assert(cliPathService.includes('MICROMEET_CRMS_CREDENTIAL_FILE') && cliPathService.includes('MICROMEET_SESSION_FILE'), 'runtime should resolve both CLI credential and legacy-session environment paths')
assert(integrationRunner.includes('...micromeetCliChildEnvironment()'), 'CLI children should receive both channel-resolved environment paths')
assert(cliService.includes("'aes-256-gcm'") && cliService.includes('randomBytes(32)'), 'runtime should encrypt CRMS credentials with a random local key')
assert(cliService.includes('mode: 0o600') && cliService.includes('chmodSync(paths.crmsCredentialFile, 0o600)'), 'credential file should be mode 0600')
assert(cliService.includes("auth_source: 'cowork'"), 'credential should identify Maestro as its source')
assert(cliService.includes('renameSync(tempFile, paths.crmsCredentialFile)'), 'credential replacement should be atomic')
assert(cliService.includes('rmSync(paths.legacySessionFile') && cliService.includes('rmSync(paths.crmsCredentialFile'), 'runtime should remove only channel-resolved legacy and logged-out credentials')

const ensureStart = cliService.indexOf('export const ensureMicromeetCliIntegration')
const ensureEnd = cliService.indexOf('export const writeMicromeetCliCredential')
const ensureBlock = cliService.slice(ensureStart, ensureEnd)
assert(ensureStart >= 0 && ensureEnd > ensureStart, 'CLI initialization source should be discoverable')
assert(ensureBlock.indexOf('runWithMicromeetCliEnvironment') < ensureBlock.indexOf('ensurePrivateDir'), 'CLI environment isolation should precede fallible filesystem work')
assert(!ensureBlock.includes('catch ('), 'CLI initialization errors should propagate to the runtime caller')
assert(ensureBlock.includes('paths.previewIsolated') && ensureBlock.includes('Preview bundled CLI not found'), 'Preview should fail closed when its bundled CLI is missing')

const initializeStart = hostHandler.indexOf('private initializeRuntime(): void')
const initializeEnd = hostHandler.indexOf('private async boot()', initializeStart)
const initializeBlock = hostHandler.slice(initializeStart, initializeEnd)
assert(initializeBlock.indexOf('ensureMicromeetCliIntegration()') < initializeBlock.indexOf('initMaestroXpc()'), 'retryable CLI initialization should run before one-time XPC registration')
assert(initializeBlock.indexOf('runtimeInitialized = true') > initializeBlock.indexOf('activateShortcuts('), 'runtime should be marked initialized only after every initialization step succeeds')

assert(cliConfig.indexOf("realmEnvironment(realm, 'CREDENTIAL_FILE')") < cliConfig.indexOf('process.env.MICROMEET_CREDENTIAL_FILE'), 'realm-specific credential paths should precede the generic CLI fallback')
assert(cliConfig.includes("argv.positionals[0] === 'sys' ? 'sys' : 'crms'"), 'CLI should select the Sys realm for sys commands')
assert(cliCommands.includes('saveCredential(ctx.config.credentialFile') && cliCommands.includes('removeCredential(ctx.config.credentialFile)'), 'CLI login/logout should mutate only the resolved realm credential path')
assert(cliCredentialStore.includes("join(dirname(credentialFile), '.credential-key-v2')"), 'both realm credentials should resolve their key beside the credential file')

assert(hostHandler.includes('ensureMicromeetCliIntegration()'), 'embedded startup should initialize CLI PATH and shim')
assert(hostHandler.includes("createXpcMainEmitter<SessionApi>('MaestroSessionDao')"), 'embedded startup should read the isolated Maestro session')
assert(hostHandler.includes('writeMicromeetCliCredential(session)'), 'embedded startup should sync an existing credential')
assert(authBridge.includes('writeMicromeetCliCredential(this.current)'), 'auth bridge login should sync the credential')
assert(authBridge.includes('writeMicromeetCliCredential(null)'), 'auth bridge logout should clear the credential')
assert(llmService.includes('writeMicromeetCliCredential(null)'), 'AI-CRMS logout should clear the CLI credential')
assert(feature.includes('Bundled Micromeet CLI invocation and credential synchronization'), 'feature contract should preserve the bundled CLI')
assert(!nsis.includes('micromeet'), 'NSIS should not carry duplicate Micromeet PATH logic')

console.log('[check-cli-integration] ok')
