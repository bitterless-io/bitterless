/* eslint-disable @typescript-eslint/explicit-function-return-type, no-regex-spaces */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const browserViewSource = readFileSync(join(root, 'main/maestro/windows/main/maestroBrowserView.service.ts'), 'utf8')
const controlViewSource = readFileSync(join(root, 'main/maestro/windows/main/maestroControlView.service.ts'), 'utf8')
const workbenchViewSource = readFileSync(join(root, 'main/maestro/windows/main/maestroWorkbenchView.service.ts'), 'utf8')
const windowHelperSource = readFileSync(join(root, 'main/maestro/windows/window.helper.ts'), 'utf8')
const agentServiceSource = readFileSync(join(root, 'main/maestro/agent/maestroAgent.service.ts'), 'utf8')
const agentBroadcastSource = readFileSync(join(root, 'main/maestro/agent/runtime/agentBroadcast.ts'), 'utf8')
const skillServiceSource = readFileSync(join(root, 'main/maestro/skills/skill.service.ts'), 'utf8')
const controlApp = readFileSync(join(root, 'renderer/maestro/control/src/ControlApp.vue'), 'utf8')
const coachApi = readFileSync(join(root, 'shared/maestro/coach.api.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const loadDevToolsGate = (source, functionName) => {
  const match = source.match(
    new RegExp(`export const ${functionName} = \\(\\): boolean => \\{([\\s\\S]*?)\\n\\}`)
  )
  assert(match, `${functionName} should remain an exported, bounded policy function`)
  const body = (match?.[1] || '')
    .replaceAll('import.meta.env.VITE_MODE', 'viteMode')
    .replaceAll('process.env', 'environment')
    .replaceAll('is.dev', 'development')
  const evaluate = new Function('viteMode', 'environment', 'development', body)
  return ({ viteMode, environment = {}, development = false }) =>
    Boolean(evaluate(viteMode, environment, development))
}

const devToolsGates = {
  window: loadDevToolsGate(windowHelperSource, 'shouldOpenDevTools'),
  control: loadDevToolsGate(controlViewSource, 'shouldOpenControlDevTools'),
  workbench: loadDevToolsGate(workbenchViewSource, 'shouldOpenWorkbenchDevTools'),
  operation: loadDevToolsGate(browserViewSource, 'shouldOpenOperationDevTools'),
  pinnedHome: loadDevToolsGate(browserViewSource, 'shouldOpenPinnedHomeDevTools')
}

for (const [name, source] of Object.entries({
  window: windowHelperSource,
  control: controlViewSource,
  workbench: workbenchViewSource,
  operation: browserViewSource
})) {
  assert(
    source.includes("import.meta.env.VITE_MODE !== 'debug'"),
    `${name} devtools must reject non-debug compiled modes`
  )
  assert(
    source.includes("process.env.BITTERLESS_E2E === '1'"),
    `${name} devtools must stay suppressed during E2E`
  )
}
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
  /if \(!shouldOpenOperationDevTools\(\)\) return[\s\S]*wc\.openDevTools\(\{\s*mode: 'detach',\s*activate: false\s*\}\)/.test(
    operationDevToolsMatch?.[1] || ''
  ),
  'operation devtools should check the compiled-mode policy before opening'
)

const hostileReleaseEnvironment = {
  COACH_OPEN_DEVTOOLS: '1',
  COACH_DEVTOOLS: '1',
  COACH_WORKBENCH_DEVTOOLS: '1'
}
for (const profile of [
  { name: 'release_dev', viteEnv: 'dev' },
  { name: 'release_prod', viteEnv: 'prod' }
]) {
  for (const [gateName, gate] of Object.entries(devToolsGates)) {
    assert(
      !gate({
        viteMode: 'release',
        development: true,
        environment: { ...hostileReleaseEnvironment, VITE_ENV: profile.viteEnv }
      }),
      `${profile.name} must ignore hostile ${gateName} DevTools flags`
    )
  }
}

for (const profile of ['debug_dev', 'debug_prod']) {
  assert(
    devToolsGates.window({
      viteMode: 'debug',
      environment: { COACH_OPEN_DEVTOOLS: '1' }
    }),
    `${profile} should allow the window DevTools opt-in`
  )
  assert(
    devToolsGates.control({
      viteMode: 'debug',
      environment: { COACH_DEVTOOLS: '1' }
    }),
    `${profile} should allow the control DevTools opt-in`
  )
  for (const flag of [
    'COACH_WORKBENCH_DEVTOOLS',
    'COACH_DEVTOOLS',
    'COACH_OPEN_DEVTOOLS'
  ]) {
    assert(
      devToolsGates.workbench({
        viteMode: 'debug',
        environment: { [flag]: '1' }
      }),
      `${profile} should allow the workbench ${flag} opt-in`
    )
  }
  assert(
    devToolsGates.operation({
      viteMode: 'debug',
      environment: { COACH_DEVTOOLS: '1' }
    }),
    `${profile} should allow the operation DevTools opt-in`
  )
  assert(
    devToolsGates.pinnedHome({ viteMode: 'debug' }),
    `${profile} should automatically allow fixed Home DevTools`
  )
}

for (const [gateName, gate] of Object.entries(devToolsGates)) {
  assert(
    !gate({
      viteMode: 'debug',
      development: true,
      environment: { ...hostileReleaseEnvironment, BITTERLESS_E2E: '1' }
    }),
    `E2E must suppress ${gateName} DevTools in debug builds`
  )
}
assert(
  browserViewSource.includes('new DebuggerCapture(') && browserViewSource.includes('tab.capture.resume()'),
  'capture-owned debugger behavior must remain independent from DevTools UI policy'
)
const pinnedHomeDevToolsMatch = browserViewSource.match(
  /private openPinnedHomeDevTools\(tab: OperationTab \| undefined, view: WebContentsView \| null\): void \{([\s\S]*?)\n  \}\n\n  private isAllowedPinnedHomeNavigation/
)
assert(pinnedHomeDevToolsMatch, 'browser view service should keep a bounded fixed Home DevTools opener')
const pinnedHomeDevToolsBody = pinnedHomeDevToolsMatch?.[1] || ''
assert(
  pinnedHomeDevToolsBody.includes('if (!shouldOpenPinnedHomeDevTools()) return'),
  'fixed Home opener should enforce its compiled-mode policy'
)
assert(
  /!tab \|\| !view \|\| !this\.isPinnedHomeTab\(tab\) \|\| !this\.isLiveTabView\(tab, view\)/.test(
    pinnedHomeDevToolsBody
  ),
  'fixed Home opener should reject missing, non-Home, destroyed, or stale views'
)
assert(
  pinnedHomeDevToolsBody.includes('if (wc.isDevToolsOpened()) return'),
  'fixed Home opener should not duplicate an existing DevTools window'
)
assert(
  /wc\.openDevTools\(\{\s*mode: 'detach',\s*activate: false\s*\}\)/.test(pinnedHomeDevToolsBody),
  'fixed Home DevTools should open detached without stealing focus'
)
assert(
  pinnedHomeDevToolsBody.includes("this._state.emitTrace({ kind: 'error', msg: 'Home devtools: '"),
  'fixed Home DevTools failures should use the Maestro trace surface'
)
const finishLoadMatch = browserViewSource.match(
  /wc\.on\('did-finish-load', \(\) => \{([\s\S]*?)\n    \}\)/
)
assert(finishLoadMatch, 'browser view service should keep a did-finish-load listener')
assert(
  (finishLoadMatch?.[1] || '').includes('if (this.isPinnedHomeTab(tab)) this.openPinnedHomeDevTools(tab, view)'),
  'each fixed Home load should run the idempotent DevTools opener'
)
const activateTabMatch = browserViewSource.match(
  /async activateTab\(params: \{ id: string \}\): Promise<void> \{([\s\S]*?)\n  \}\n\n  async reorderTabs/
)
assert(activateTabMatch, 'browser view service should keep a bounded activateTab flow')
const activateTabBody = activateTabMatch?.[1] || ''
assert(
  (activateTabBody.match(/if \(this\.isPinnedHomeTab\(tab\)\) this\.openPinnedHomeDevTools\(tab, tab\.view\)/g) || [])
    .length === 2,
  'fixed Home re-selection and activation should both run the idempotent DevTools opener'
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
