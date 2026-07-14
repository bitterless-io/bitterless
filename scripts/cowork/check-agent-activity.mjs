import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src', 'cowork')
const require = createRequire(import.meta.url)
const baseAgent = readFileSync(join(root, 'main/agent/BaseAgent.ts'), 'utf8')
const piRuntimeAdapter = readFileSync(join(root, 'main/agent/runtime/piRuntimeAdapter.ts'), 'utf8')
const coworkWindow = readFileSync(join(root, 'main/windows/coworkWindow.helper.ts'), 'utf8')
const messageItem = readFileSync(join(root, 'renderer/control/src/MessageItem.vue'), 'utf8')
const controlApp = readFileSync(join(root, 'renderer/control/src/ControlApp.vue'), 'utf8')
const coachApi = readFileSync(join(root, 'shared/coach.api.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const loadAgentActivityInternals = () => {
  const source = `${baseAgent}\nexport const __checkAgentActivity = { activityForTool, activityEndpoint }\n`
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: 'BaseAgent.ts'
  }).outputText
  const mod = { exports: {} }
  const wrapped = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) {\n${output}\n})`,
    { filename: 'BaseAgent.ts' }
  )
  wrapped(
    mod.exports,
    (specifier) => {
      if (specifier === './runtime/coachRuntimeAdapter') return { CoachRuntimeAdapter: class CoachRuntimeAdapter {} }
      return require(specifier)
    },
    mod,
    'BaseAgent.ts',
    root
  )
  return mod.exports.__checkAgentActivity
}

assert(piRuntimeAdapter.includes("type === 'tool_execution_start'"), 'pi runtime should normalize tool start events')
assert(piRuntimeAdapter.includes("type === 'tool_execution_end'"), 'pi runtime should normalize tool end events')
assert(piRuntimeAdapter.includes("inner.type === 'thinking_start'"), 'pi runtime should normalize thinking start')
assert(piRuntimeAdapter.includes("inner.type === 'thinking_delta'"), 'pi runtime should normalize thinking deltas')
assert(piRuntimeAdapter.includes("inner.type === 'thinking_end'"), 'pi runtime should normalize thinking end')

assert(baseAgent.includes('onThinking?: (state: Omit<AgentThinkingState'), 'BaseAgent should expose live thinking state separately from activity')
assert(baseAgent.includes('this.opts.onThinking?.({ active, ts: Date.now() })'), 'BaseAgent should emit live thinking state changes')
assert(!baseAgent.includes("this.activity('think', 'thinking...')"), 'BaseAgent should not emit fake thinking activity rows')
assert(baseAgent.includes('const activity = activityForTool(event.toolName, event.args)'), 'BaseAgent should classify tool activity on tool start')
assert(baseAgent.includes("if (toolName === 'browser_exec') return browserExecActivity(args)"), 'browser_exec should have custom activity classification')
assert(baseAgent.includes('return { phase: activityPhaseForTool(toolName), label: toolName }'), 'tool activity should show the raw tool name (no "call " prefix, no semantic verb remap)')
assert(baseAgent.includes("'api-read'") && baseAgent.includes("'api-call'"), 'browser_exec fetches should distinguish API read/call phases')
assert(baseAgent.includes("['GET', 'HEAD', 'OPTIONS'].includes(method)") && baseAgent.includes('fetches.every'), 'read API classification should require only safe read methods')
assert(baseAgent.includes("command === 'parallel' && Array.isArray(record.commands)") && baseAgent.includes('record.commands.flatMap(readOne)'), 'browser_exec activity should classify fetches inside parallel groups')
assert(baseAgent.includes('activityEndpoint(first.url || \'\')'), 'API activity label should sanitize endpoint URLs')
assert(baseAgent.includes("query = keys.map((key) => `${encodeURIComponent(key)}=<${activityVarName(key) || 'value'}>`).join('&')"), 'API activity should hide query values')
assert(baseAgent.includes("return ':id'"), 'API activity should hide long id-like path segments')

assert(coworkWindow.includes("this.broadcastActivity('tool', `call generate_skill"), 'Generate should surface as an internal tool call')
assert(coworkWindow.includes("this.broadcastActivity('tool', `call ingest_recording"), 'Ingest should surface as an internal tool call')
assert(coworkWindow.includes("this.broadcastActivity('tool', `call create_or_update_skill"), 'Trainer skill generation should surface as an internal tool call')
assert(coworkWindow.includes("xpcMain.broadcast('coach/agent-activity'"), 'main should broadcast agent activity to renderer')
assert(coworkWindow.includes("xpcMain.broadcast('coach/agent-thinking'"), 'main should broadcast live thinking state to renderer')

assert(messageItem.includes("'api-read': { tag: 'read api'"), 'MessageItem should label read API activity')
assert(messageItem.includes("'api-call': { tag: 'call api'"), 'MessageItem should label mutating API activity')
assert(messageItem.includes('name="messageItem__activity"'), 'MessageItem should render activity at top of the bubble')
assert(messageItem.includes('activityFeed.value.slice(-12)'), 'MessageItem should keep activity compact')
assert(messageItem.includes('hiddenActivityCount'), 'MessageItem should summarize older activity steps')
assert(messageItem.includes("if (item.phase === 'think') continue"), 'MessageItem should keep thinking out of top activity rows')
assert(messageItem.includes('name="messageItem__waiting"'), 'MessageItem should show a small waiting loader before first text')
assert(messageItem.includes('name="messageItem__thinking"'), 'MessageItem should render live thinking at the bottom of the bubble')
assert(messageItem.includes('messageItemThinkingShimmer'), 'MessageItem thinking indicator should shimmer')
assert(controlApp.includes("xpcRenderer.subscribe('coach/agent-activity'"), 'ControlApp should subscribe to activity broadcasts')
assert(controlApp.includes("xpcRenderer.subscribe('coach/agent-thinking'"), 'ControlApp should subscribe to thinking broadcasts')
assert(coachApi.includes("'api-read' | 'api-call'"), 'shared API should type API read/call activity phases')
assert(coachApi.includes('AgentThinkingState'), 'shared API should type live thinking state')

const { activityForTool, activityEndpoint } = loadAgentActivityInternals()
const readOnly = activityForTool('browser_exec', {
  commands_json: JSON.stringify([
    {
      command: 'parallel',
      commands: [
        { command: 'fetch', method: 'GET', url: '/api/departments?date=2026-07-01&patientName=Jane' },
        {
          command: 'parallel',
          commands: [{ command: 'fetch', method: 'HEAD', url: '/api/pricing-list?itemCode=CT26' }]
        }
      ]
    }
  ])
})
assert(readOnly.phase === 'api-read', 'read-only browser_exec parallel groups should display as read api')
assert(readOnly.label === 'GET /api/departments?date=<date>&patientName=<patient_name> +1', 'read API activity should hide query values and count extra fetches')

const mutating = activityForTool('browser_exec', {
  commands_json: JSON.stringify([
    {
      command: 'parallel',
      commands: [{ command: 'fetch', method: 'POST', url: '/api/bookings/3201234567890001?token=secret', body: { ok: true } }]
    }
  ])
})
assert(mutating.phase === 'api-call', 'mutating browser_exec fetches should display as call api')
assert(mutating.label === 'POST /api/bookings/:id?token=<token>', 'call API activity should hide long id path segments and query values')

const contextOnly = activityForTool('browser_exec', {
  commands_json: JSON.stringify([{ command: 'read_context', keys: ['token'] }])
})
assert(contextOnly.phase === 'tool' && contextOnly.label === 'read browser context', 'read_context-only browser_exec should stay low-priority browser context activity')

assert(activityForTool('page_snapshot', {}).phase === 'tool', 'page_snapshot should classify as a tool call (tool:page_snapshot)')
assert(activityForTool('page_snapshot', {}).label === 'page_snapshot', 'tool activity label should be the raw tool name (no "call " prefix)')
assert(activityForTool('ui_act', {}).phase === 'tool', 'ui_act should classify as a tool call')
assert(activityForTool('run_skill_script', {}).phase === 'skill', 'skill-execution tools should classify as skill')
assert(activityEndpoint('/api/patients/1234567890/detail?phone=081234567890') === '/api/patients/:id/detail?phone=<phone>', 'activityEndpoint should hide ids and query values directly')

console.log('[check-agent-activity] ok')

