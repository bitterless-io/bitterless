import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cliRoot } from './_harness.mjs'

const readCli = (file) => readFileSync(join(cliRoot, file), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const commands = readCli('src/commands.ts')
const config = readCli('src/config.ts')
const crypto = readCli('src/credentialCrypto.ts')
const manual = readCli('MANUAL.md')
const help = readCli('src/manual.ts')
const cli = readCli('src/cli.ts')

for (const needle of [
  "'/share/auth/password-login'",
  "'/share/auth/set-password'",
  "'/sys/auth/login'",
  "'/sys/me'",
  "'/medical/patient/list'",
  "'/medical/corporate/list'",
  "'/medical/corporate/create'",
  "'/medical/project/list'",
  "'/medical/project/create'",
  "'/mcu/setting/field-config'",
  "'/mcu/setting/data-map/list'",
  "'/mcu/setting/data-map/upsert'",
  "'/mcu/setting/file/mapping/confirm'",
  "'/mcu/record/create'",
  "'/mcu/record/patient-info/update'",
  "'/mcu/record/diagnostic-data/update'",
  "'/mcu/record/conclusion/update'",
  "'/mcu/record/validate'",
  "'/mcu/conclusion/generate'",
  "'/mcu/report/generate'",
  "'/mcu/queue/tick'",
  "'/admin/migration/provision'",
  "'/admin/migration/account'",
  'MICROMEET_MIGRATION_TOKEN'
]) {
  assert(commands.includes(needle), `CLI commands should include ${needle}`)
}

for (const snippet of [
  'micromeet crms login',
  'micromeet sys login',
  'micromeet crms corporates projects create',
  'micromeet crms mapping data-map list',
  'micromeet crms mcu record diagnostic-data update',
  'micromeet crms migration account',
  'dry-run by default',
  'MICROMEET_MIGRATION_TOKEN'
]) {
  assert(manual.includes(snippet), `CLI manual should document ${snippet}`)
}

for (const snippet of ['crms', 'sys', 'patients    list', 'corporates  list', 'migration   provision']) {
  assert(help.includes(snippet), `CLI short help/modules should mention ${snippet}`)
}

for (const snippet of ['helpForCommand', 'normalizeHelpPath', 'micromeet help <command-path>']) {
  assert(help.includes(snippet), `CLI help registry should include ${snippet}`)
}
for (const snippet of ['requestedHelpPath', 'Unknown help topic']) {
  assert(cli.includes(snippet), `CLI entrypoint should include ${snippet}`)
}

for (const snippet of ['MICROMEET_${realm.toUpperCase()}_${suffix}', 'defaultCredentialFile']) {
  assert(config.includes(snippet), `CLI config should include ${snippet}`)
}
for (const snippet of ['aes-256-gcm', 'local-file-v2', 'KEY_BYTES = 32', 'randomBytes(12)']) {
  assert(crypto.includes(snippet), `CLI credential crypto should include ${snippet}`)
}

console.log('[check-cli-domain-commands] ok')
