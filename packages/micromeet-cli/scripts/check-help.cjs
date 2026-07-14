const { spawnSync } = require('child_process')
const { join } = require('path')
const packageJson = require('../package.json')

const cli = join(__dirname, '..', 'dist', 'cli.js')

const run = (args) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MICROMEET_CRMS_CREDENTIAL_FILE: '/this/path/must/not/be/read-for-help',
      MICROMEET_SYS_CREDENTIAL_FILE: '/this/path/must/not-be-read-for-help'
    }
  })
  if (result.status !== 0) {
    throw new Error(`micromeet ${args.join(' ')} failed (${String(result.status)}): ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

const assertIncludes = (output, expected, label) => {
  if (!output.includes(expected)) throw new Error(`${label} should include ${expected}`)
}

const rootHelp = run(['help'])
assertIncludes(rootHelp, 'micromeet help <command-path>', 'root help')
if (run(['--version']) !== packageJson.version) {
  throw new Error('micromeet --version should match package.json')
}

const leadingGroup = run(['help', 'crms', 'mcu'])
const trailingGroup = run(['crms', 'mcu', 'help'])
const optionGroup = run(['crms', 'mcu', '--help'])
if (leadingGroup !== trailingGroup || leadingGroup !== optionGroup) {
  throw new Error('leading, trailing, and --help group forms should return identical output')
}
assertIncludes(leadingGroup, 'record detail | create', 'MCU group help')
assertIncludes(run(['crms', 'auth', 'set-password', '--help']), 'hidden prompt when omitted', 'CRMS activation help')

const leadingLeaf = run(['help', 'crms', 'mcu', 'records'])
const trailingLeaf = run(['crms', 'mcu', 'records', 'help'])
const optionLeaf = run(['crms', 'mcu', 'records', '--help'])
if (leadingLeaf !== trailingLeaf || leadingLeaf !== optionLeaf) {
  throw new Error('leading, trailing, and --help leaf forms should return identical output')
}
assertIncludes(leadingLeaf, '--page-size <n>', 'MCU records help')

const aliasLeaf = run(['mcu', 'records', '--help'])
if (aliasLeaf !== optionLeaf) throw new Error('top-level CRMS alias help should resolve to canonical CRMS help')

assertIncludes(run(['crms', 'corporates', 'projects', 'create', '--help']), '--corporate-id <id>', 'deep CRMS help')
assertIncludes(run(['sys', 'auth', 'status', '--help']), 'Verify the token with /sys/me.', 'Sys help')
assertIncludes(run(['manual']), '# micromeet CLI Manual', 'manual output')

console.log('[check-help] ok')
