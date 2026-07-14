import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src', 'cowork')
const coworkWindow = readFileSync(join(root, 'main/windows/coworkWindow.helper.ts'), 'utf8')
const hostToolCatalog = readFileSync(join(root, 'main/agent/hostToolCatalog.ts'), 'utf8')
const debuggerCapture = readFileSync(join(root, 'main/capture/debuggerCapture.ts'), 'utf8')
const workbenchStore = readFileSync(join(root, 'renderer/workbench/src/workbench.store.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

assert(
  /private onCapturedEvent\(e: TraceEvent, tabId: string\): void \{[\s\S]*if \(tabId !== this\.captureTargetTabId\) return[\s\S]*if \(!this\.capturing\) return[\s\S]*this\.emit\(e\)/.test(coworkWindow),
  'captured debugger events should be gated by capture target and active capture state before emit'
)
assert(
  /private emit\(e: TraceEvent\): void \{[\s\S]*if \(e\.kind === 'info'\) return[\s\S]*if \(!this\.capturing\) return[\s\S]*if \(!this\.shouldRecordTraceEvent\(e\)\) return/.test(coworkWindow),
  'emit should drop non-capturing events before buffering/broadcasting'
)
assert(
  /this\.traceEvents\.push\(stored\)[\s\S]*xpcMain\.broadcast\('coach\/trace', e\)[\s\S]*this\.traceStream\.write\(JSON\.stringify\(stored\) \+ '\\n'\)/.test(coworkWindow),
  'trace memory, renderer broadcast, and JSONL writes should happen only after emit gating'
)
assert(
  /async captureSnapshot\(\): Promise<SnapshotResult> \{[\s\S]*if \(!this\.capturing\) return \{ ok: false, nodeCount: 0, yaml: '', error: 'Capture is not running' \}/.test(coworkWindow),
  'manual snapshots should be rejected when Capture is stopped'
)
assert(
  /async startCapture\(params[\s\S]*this\.capturing = true[\s\S]*await target\.capture\.startRecording\(\)[\s\S]*xpcMain\.broadcast\('coach\/capture-started'/.test(coworkWindow),
  'recording bridge should start only inside explicit startCapture'
)
assert(
  /async stopCapture\(\): Promise<CaptureState> \{[\s\S]*this\.capturing = false[\s\S]*await target\?\.capture\?\.stopRecording/.test(coworkWindow),
  'stopCapture should turn off capture state and recording bridge'
)
assert(hostToolCatalog.includes("name: 'start_recording'"), 'host tool catalog should list start_recording')
assert(hostToolCatalog.includes("name: 'stop_recording'"), 'host tool catalog should list stop_recording')
assert(coworkWindow.includes("name: 'start_recording'"), 'Cowork agent should expose start_recording')
assert(coworkWindow.includes("name: 'stop_recording'"), 'Cowork agent should expose stop_recording')
assert(
  /private async toolStartRecording\(modeArg: string\): Promise<string> \{[\s\S]*await this\.startCapture\(mode \? \{ mode \} : undefined\)/.test(coworkWindow),
  'start_recording tool should call startCapture'
)
assert(
  /private async toolStopRecording\(\): Promise<string> \{[\s\S]*await this\.stopCapture\(\)/.test(coworkWindow),
  'stop_recording tool should call stopCapture'
)
assert(
  /new DebuggerCapture\([\s\S]*\(\) => this\.capturing && this\.ownerOf\(view\)\?\.id === this\.captureTargetTabId/.test(coworkWindow),
  'thumbnail screenshots should also be gated to the active capture target'
)
assert(
  debuggerCapture.includes('async startRecording(): Promise<void>') &&
    debuggerCapture.includes('Runtime.addBinding') &&
    debuggerCapture.includes('Page.addScriptToEvaluateOnNewDocument'),
  'UI recording bridge should be installed only by startRecording'
)
assert(
  /async stopRecording\(opts: \{ keepRuntime\?: boolean \} = \{\}\): Promise<void> \{[\s\S]*this\.recording = false[\s\S]*Page\.removeScriptToEvaluateOnNewDocument/.test(debuggerCapture),
  'UI recording bridge should be removed by stopRecording'
)
assert(
  debuggerCapture.includes('Network.enable') &&
    debuggerCapture.includes('The Runtime event stream + the __coachRecord recording bridge are intentionally NOT enabled'),
  'network debugger may attach for live browser support while UI recording bridge remains lazy'
)

const resetMatch = workbenchStore.match(/private resetRecordingForCaptureStart\(startedAt: number\): void \{([\s\S]*?)\n  \}/)
assert(resetMatch, 'Workbench store should reset recording UI on capture start')
const resetBody = resetMatch?.[1] || ''
for (const snippet of [
  'this.rows = []',
  "this.selectedNetworkRequestId = ''",
  "this.workflowDesc = ''",
  "this.recordSearch = ''",
  'this.activeFilters = []',
  'this.previewVisible = false',
  'this.ingesting = false',
  'this.recordingStartedAt = startedAt',
  'this.capturing = true',
  "this.setPane('recording')",
  'coach.clearCaptureRecordEdits()'
]) {
  assert(resetBody.includes(snippet), `capture start should reset recording UI state: ${snippet}`)
}
for (const forbidden of ['recordActions', 'recordNetwork', 'captureConfig.replaceAll', 'networkWhitelist', 'networkBlacklist']) {
  assert(!resetBody.includes(forbidden), `capture start reset should preserve capture options/filter configuration: ${forbidden}`)
}
assert(
  workbenchStore.includes("xpcRenderer.subscribe('coach/capture-started'") &&
    workbenchStore.includes('this.resetRecordingForCaptureStart(typeof params?.ts === \'number\' ? params.ts : Date.now())'),
  'capture-started broadcast should drive Workbench reset'
)

console.log('[check-capture-gating] ok')

