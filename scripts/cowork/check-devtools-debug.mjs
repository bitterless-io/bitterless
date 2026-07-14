import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src', 'cowork')
const coworkWindow = readFileSync(join(root, 'main/windows/coworkWindow.helper.ts'), 'utf8')
const controlApp = readFileSync(join(root, 'renderer/control/src/ControlApp.vue'), 'utf8')
const coachApi = readFileSync(join(root, 'shared/coach.api.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

assert(coworkWindow.includes('const shouldOpenWorkbenchDevTools = (): boolean'), 'workbench devtools gate should exist')
assert(coworkWindow.includes("process.env.COACH_WORKBENCH_DEVTOOLS === '1'"), 'workbench-specific devtools env should be supported')
assert(coworkWindow.includes("process.env.COACH_DEVTOOLS === '1'"), 'global coach devtools env should be supported')
assert(coworkWindow.includes("process.env.COACH_OPEN_DEVTOOLS === '1'"), 'legacy/global open devtools env should be supported')
assert(
  /controlView\.webContents\.openDevTools\(\{\s*mode: 'detach',\s*activate: false\s*\}\)/.test(coworkWindow),
  'control panel devtools should open detached without stealing focus'
)
assert(
  /view\.webContents\.openDevTools\(\{\s*mode: 'detach',\s*activate: false\s*\}\)/.test(coworkWindow),
  'workbench devtools should open detached without stealing focus'
)
assert(
  /wc\.openDevTools\(\{\s*mode: 'detach',\s*activate: false\s*\}\)/.test(coworkWindow),
  'operation page devtools should open detached when explicitly enabled'
)
assert(coworkWindow.includes("scope: 'summarize'"), 'skill generation/summarize agent should have a debug scope')
assert(coworkWindow.includes('const prefix = `[coach:${event.scope}:${event.phase}${duration'), 'debug log prefix should include scope, phase, and duration')
assert(coworkWindow.includes("console.error(prefix, event.message, detail)"), 'debug errors should print to main-process console')
assert(coworkWindow.includes("console.warn(prefix, event.message, detail)"), 'debug warnings should print to main-process console')
assert(coworkWindow.includes("console.log(prefix, event.message, detail)"), 'debug info should print to main-process console')
assert(coworkWindow.includes("xpcMain.broadcast('coach/codex-log', event)"), 'debug events should be broadcast to renderers')
assert(coworkWindow.includes('appendActivityDuration('), 'internal tool activity should include elapsed time where available')
assert(controlApp.includes("xpcRenderer.subscribe('coach/codex-log'"), 'control renderer should subscribe to codex logs')
assert(controlApp.includes("xpcRenderer.subscribe('coach/agent-activity'"), 'control renderer should subscribe to agent activity')
assert(controlApp.includes("xpcRenderer.subscribe('coach/agent-stream'"), 'control renderer should subscribe to streaming deltas')
assert(coachApi.includes('CodexDebugEvent'), 'shared contract should type codex debug events')

console.log('[check-devtools-debug] ok')

