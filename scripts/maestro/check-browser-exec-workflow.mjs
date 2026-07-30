import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const replayEngine = readFileSync(join(root, 'main/maestro/drive/replayEngine.ts'), 'utf8')
const maestro = readFileSync(join(root, 'main/maestro/windows/main/maestroWindow.controller.ts'), 'utf8')
const requestExec = readFileSync(join(root, 'main/maestro/drive/requestExec.service.ts'), 'utf8')
const requestHelper = readFileSync(join(root, 'main/maestro/drive/requestExec.helper.ts'), 'utf8')
const skillPrompt = readFileSync(join(root, 'main/maestro/agent/prompt/skillExecution.ts'), 'utf8')
const catalog = readFileSync(join(root, 'main/maestro/agent/hostToolCatalog.ts'), 'utf8')

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
assert(requestHelper.includes('export const parseBrowserCommand'), 'browser_exec should parse structured command variants')
assert(requestHelper.includes('const id = normalizeBrowserCommandId(record.id)') && requestExec.includes('id: command.id'), 'main browser_exec path should sanitize and echo ids')
assert(requestHelper.includes("command === 'parallel' && Array.isArray(record.commands)"), 'browser_exec should parse parallel groups')
assert(requestExec.includes('private async executeBrowserCommand('), 'browser_exec should execute commands through a shared helper')
assert(requestExec.includes('Promise.all(') && requestExec.includes('this.executeBrowserCommand(item, domainAuth)'), 'parallel command should run read-only subcommands concurrently')
assert(requestExec.includes('parallel browser_exec only allows read-only fetches'), 'parallel command should reject mutating fetches')
assert(requestExec.includes('command.commands.some(browserCommandHasMutatingFetch)'), 'parallel command should reject nested mutating fetches recursively')
assert(requestHelper.includes('export const browserCommandHasMutatingFetch'), 'mutating fetch detection should be centralized')
assert(requestHelper.includes("command.endsWith('.fetch')"), 'nested parallel fetches should count as API calls in replay summary')
assert(maestro.includes('Inspect a response, then decide the next call in the ReAct loop'), 'tool description should explain adaptive serial workflow')
assert(maestro.includes('each result echoes it back'), 'tool description should tell agents to use stable command ids')
assert(maestro.includes('Mutating fetches must stay sequential'), 'tool description should keep writes sequential')
assert(maestro.includes('return await this.requestExec.toolBrowserExec(commandsJson)') && !maestro.includes('private parseBrowserCommand('), 'Maestro controller should delegate browser_exec to RequestExecService')
assert(skillPrompt.includes('Give each browser_exec command a stable id'), 'skill execution prompt should ask agents to correlate API results by id')
assert(skillPrompt.includes('Use browser_exec.parallel for independent read-only lookups'), 'skill execution prompt should mention parallel option reads')
assert(catalog.includes('authenticated fetch/read_context/parallel reads'), 'host tool catalog should describe parallel reads')

console.log('[check-browser-exec-workflow] ok')
