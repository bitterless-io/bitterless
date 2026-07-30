import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const controllerSource = readFileSync(join(root, 'main/maestro/windows/main/maestroWindow.controller.ts'), 'utf8')
const browserViewSource = readFileSync(join(root, 'main/maestro/windows/main/maestroBrowserView.service.ts'), 'utf8')
const controlViewSource = readFileSync(join(root, 'main/maestro/windows/main/maestroControlView.service.ts'), 'utf8')
const workbenchViewSource = readFileSync(join(root, 'main/maestro/windows/main/maestroWorkbenchView.service.ts'), 'utf8')
const agentServiceSource = readFileSync(join(root, 'main/maestro/agent/maestroAgent.service.ts'), 'utf8')
const agentBroadcastSource = readFileSync(join(root, 'main/maestro/agent/runtime/agentBroadcast.ts'), 'utf8')
const skillServiceSource = readFileSync(join(root, 'main/maestro/skills/skill.service.ts'), 'utf8')
const controlApp = readFileSync(join(root, 'renderer/maestro/control/src/ControlApp.vue'), 'utf8')
const coachApi = readFileSync(join(root, 'shared/maestro/coach.api.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const controllerCreateMatch = controllerSource.match(
  /create\(\): BrowserWindow \{([\s\S]*?)\n  \}\n\n  async whenReady/
)
assert(controllerCreateMatch, 'controller should keep a bounded create flow')
assert(
  (controllerCreateMatch?.[1] || '').includes('this.browserView.openOperationDevTools()'),
  'controller startup should invoke the extracted operation-page devtools flow'
)

assert(workbenchViewSource.includes('const shouldOpenWorkbenchDevTools = (): boolean'), 'workbench devtools gate should exist')
assert(workbenchViewSource.includes("process.env.COACH_WORKBENCH_DEVTOOLS === '1'"), 'workbench-specific devtools env should be supported')
assert(workbenchViewSource.includes("process.env.COACH_DEVTOOLS === '1'"), 'global coach devtools env should be supported')
assert(workbenchViewSource.includes("process.env.COACH_OPEN_DEVTOOLS === '1'"), 'legacy/global open devtools env should be supported')
assert(
  /view\.webContents\.openDevTools\(\{\s*mode: 'detach',\s*activate: false\s*\}\)/.test(controlViewSource),
  'control panel devtools should open detached without stealing focus'
)
assert(
  /view\.webContents\.openDevTools\(\{\s*mode: 'detach',\s*activate: false\s*\}\)/.test(workbenchViewSource),
  'workbench devtools should open detached without stealing focus'
)
const workbenchCreateMatch = workbenchViewSource.match(
  /create\(\): Promise<void> \{([\s\S]*?)\n  \}\n\n  getVisible/
)
assert(workbenchCreateMatch, 'workbench service should keep a bounded create flow')
assert(
  /if \(shouldOpenWorkbenchDevTools\(\)\) \{[\s\S]*view\.webContents\.openDevTools\(\{\s*mode: 'detach',\s*activate: false\s*\}\)/.test(
    workbenchCreateMatch?.[1] || ''
  ),
  'workbench create should check shouldOpenWorkbenchDevTools before opening detached devtools'
)
assert(
  /wc\.openDevTools\(\{\s*mode: 'detach',\s*activate: false\s*\}\)/.test(browserViewSource),
  'operation page devtools should open detached when explicitly enabled'
)
const operationDevToolsMatch = browserViewSource.match(
  /openOperationDevTools\(\): void \{([\s\S]*?)\n  \}\n\n  async listInjectedButtons/
)
assert(operationDevToolsMatch, 'browser view service should keep a bounded operation devtools facade')
assert(
  /if \(process\.env\.COACH_DEVTOOLS !== '1'\) return[\s\S]*wc\.openDevTools\(\{\s*mode: 'detach',\s*activate: false\s*\}\)/.test(
    operationDevToolsMatch?.[1] || ''
  ),
  'operation devtools should check the explicit COACH_DEVTOOLS gate before opening'
)
const ensureAgentsMatch = agentServiceSource.match(
  /ensureAgents\(\): MaestroAgentInstances \{([\s\S]*?)\n  \}\n\n  applyLlmTarget/
)
assert(ensureAgentsMatch, 'AgentService should keep a bounded ensureAgents flow')
assert(
  /new BaseAgent\(\{[\s\S]*?scope: 'summarize',[\s\S]*?onDebug: broadcastCodexDebug/.test(
    ensureAgentsMatch?.[1] || ''
  ),
  'skill generation/summarize agent should have a debug scope'
)
const debugBroadcastMatch = agentBroadcastSource.match(
  /export const broadcastCodexDebug = \(event: CodexDebugEvent\): void => \{([\s\S]*?)\n\}\n\n\/\*\* Streamed/
)
assert(debugBroadcastMatch, 'agent runtime should keep a bounded debug broadcaster')
const debugBroadcastBody = debugBroadcastMatch?.[1] || ''
assert(debugBroadcastBody.includes('const prefix = `[coach:${event.scope}:${event.phase}${duration'), 'debug log prefix should include scope, phase, and duration')
assert(debugBroadcastBody.includes("console.error(prefix, event.message, detail)"), 'debug errors should print to main-process console')
assert(debugBroadcastBody.includes("console.warn(prefix, event.message, detail)"), 'debug warnings should print to main-process console')
assert(debugBroadcastBody.includes("console.log(prefix, event.message, detail)"), 'debug info should print to main-process console')
assert(debugBroadcastBody.includes("xpcMain.broadcast('coach/codex-log', event)"), 'debug events should be broadcast to renderers')
const summarizeSkillMatch = skillServiceSource.match(
  /async summarizeSkill\([\s\S]*?\): Promise<SkillCreateResult> \{([\s\S]*?)\n  \}\n\n  \//
)
assert(summarizeSkillMatch, 'SkillService should keep a bounded summarizeSkill flow')
assert(
  (summarizeSkillMatch?.[1] || '').includes('appendActivityDuration('),
  'skill generation activity should include elapsed time'
)
assert(controlApp.includes("xpcRenderer.subscribe('coach/codex-log'"), 'control renderer should subscribe to codex logs')
assert(controlApp.includes("xpcRenderer.subscribe('coach/agent-activity'"), 'control renderer should subscribe to agent activity')
assert(controlApp.includes("xpcRenderer.subscribe('coach/agent-stream'"), 'control renderer should subscribe to streaming deltas')
assert(coachApi.includes('CodexDebugEvent'), 'shared contract should type codex debug events')

console.log('[check-devtools-debug] ok')
