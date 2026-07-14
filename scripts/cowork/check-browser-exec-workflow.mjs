import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src', 'cowork')
const replayEngine = readFileSync(join(root, 'main/drive/replayEngine.ts'), 'utf8')
const cowork = readFileSync(join(root, 'main/windows/coworkWindow.helper.ts'), 'utf8')
const skillPrompt = readFileSync(join(root, 'main/agent/prompt/skillExecution.ts'), 'utf8')
const catalog = readFileSync(join(root, 'main/agent/hostToolCatalog.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

assert(replayEngine.includes("{ command: 'parallel'; id?: string; commands: BrowserCommand[] }"), 'BrowserCommand should model parallel command groups')
assert(replayEngine.includes('id?: string') && replayEngine.includes('export interface CommandResult'), 'browser_exec commands/results should support stable ids')
assert(replayEngine.includes('const normalizeCommandId = (value: unknown)') && replayEngine.includes('const id = normalizeCommandId'), 'in-page command runner should sanitize command ids')
assert(replayEngine.includes("id,\n            ok: true"), 'in-page command runner should echo command ids')
assert(replayEngine.includes("cmd.command === 'parallel'"), 'in-page command runner should understand parallel command groups')
assert(replayEngine.includes("command: `parallel.${item.command}`"), 'in-page parallel results should be labeled as parallel output')
assert(replayEngine.includes('nested.some(hasMutatingFetch)'), 'in-page parallel command groups should reject nested mutating fetches')
assert(cowork.includes('private parseBrowserCommand(entry: unknown): BrowserCommand | null'), 'browser_exec should parse structured command variants')
assert(cowork.includes('const id = normalizeBrowserCommandId(rec.id)') && cowork.includes('id: cmd.id'), 'main browser_exec path should sanitize and echo ids')
assert(cowork.includes("command === 'parallel' && Array.isArray(rec.commands)"), 'browser_exec should parse parallel groups')
assert(cowork.includes('private async executeBrowserCommand(cmd: BrowserCommand'), 'browser_exec should execute commands through a shared helper')
assert(cowork.includes('Promise.all(cmd.commands.map'), 'parallel command should run read-only subcommands concurrently')
assert(cowork.includes('parallel browser_exec only allows read-only fetches'), 'parallel command should reject mutating fetches')
assert(cowork.includes('cmd.commands.some(browserCommandHasMutatingFetch)'), 'parallel command should reject nested mutating fetches recursively')
assert(cowork.includes('function browserCommandHasMutatingFetch(cmd: BrowserCommand): boolean'), 'mutating fetch detection should be centralized')
assert(cowork.includes('command.endsWith(\'.fetch\')'), 'nested parallel fetches should count as API calls in replay summary')
assert(cowork.includes('Inspect a response, then decide the next call in the ReAct loop'), 'tool description should explain adaptive serial workflow')
assert(cowork.includes('each result echoes it back'), 'tool description should tell agents to use stable command ids')
assert(cowork.includes('Mutating fetches must stay sequential'), 'tool description should keep writes sequential')
assert(skillPrompt.includes('Give each browser_exec command a stable id'), 'skill execution prompt should ask agents to correlate API results by id')
assert(skillPrompt.includes('Use browser_exec.parallel for independent read-only lookups'), 'skill execution prompt should mention parallel option reads')
assert(catalog.includes('authenticated fetch/read_context/parallel reads'), 'host tool catalog should describe parallel reads')

console.log('[check-browser-exec-workflow] ok')

