import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const controllerSource = readFileSync(join(root, 'main/maestro/windows/main/maestroWindow.controller.ts'), 'utf8')
const browserViewSource = readFileSync(join(root, 'main/maestro/windows/main/maestroBrowserView.service.ts'), 'utf8')
const captureServiceSource = readFileSync(join(root, 'main/maestro/capture/capture.service.ts'), 'utf8')
const hostToolCatalog = readFileSync(join(root, 'main/maestro/agent/hostToolCatalog.ts'), 'utf8')
const debuggerCapture = readFileSync(join(root, 'main/maestro/capture/debuggerCapture.ts'), 'utf8')
const workbenchStore = readFileSync(join(root, 'renderer/maestro/workbench/src/workbench.store.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const boundedSource = (source, start, end, message) => {
  const startIndex = source.indexOf(start)
  const endIndex = startIndex < 0 ? -1 : source.indexOf(end, startIndex + start.length)
  assert(startIndex >= 0 && endIndex > startIndex, message)
  return source.slice(startIndex, endIndex)
}
const normalizeSpace = (source) => source.replace(/\s+/g, ' ').trim()
const assertExactControllerFacade = (start, end, statement, name) => {
  const method = boundedSource(
    controllerSource,
    start,
    end,
    `controller should keep a bounded ${name} facade`
  )
  const closeIndex = method.lastIndexOf('}')
  assert(closeIndex >= start.length, `controller ${name} facade should keep a method body`)
  assert(
    normalizeSpace(method.slice(start.length, closeIndex)) === normalizeSpace(statement),
    `controller ${name} facade should delegate exactly once`
  )
}

const buildViewSlotMatch = browserViewSource.match(
  /private buildViewSlot\(\): ViewSlot \{([\s\S]*?)\n  \}\n\n  private ownerOf/
)
assert(buildViewSlotMatch, 'browser view service should keep a bounded buildViewSlot implementation')
const buildViewSlotBody = buildViewSlotMatch?.[1] || ''
assert(
  /const capture = new DebuggerCapture\([\s\S]*\(event\) => \{[\s\S]*const owner = this\.ownerOf\(view\)[\s\S]*if \(owner\) this\._state\.onCapturedEvent\(event, owner\.id\)/.test(
    buildViewSlotBody
  ),
  'each DebuggerCapture event should forward through the browser-view state seam with its owning tab id'
)
assert(
  /onCapturedEvent\(e: TraceEvent, tabId: string\): void \{\s*this\.captureService\.onCapturedEvent\(e, tabId\)\s*\}/.test(
    controllerSource
  ),
  'controller should keep a one-line captured-event facade'
)
const capturedEventBody = boundedSource(
  captureServiceSource,
  '  onCapturedEvent(event: TraceEvent, tabId: string): void {',
  '  emitTrace(event: TraceEvent): void {',
  'CaptureService should keep a bounded onCapturedEvent implementation'
)
assert(
  capturedEventBody.includes('tabId !== this.captureTargetTabId') &&
    capturedEventBody.includes('!this.capturing') &&
    capturedEventBody.includes('this.emitTrace(event)'),
  'captured debugger events should be gated by capture target and active capture state before emit'
)
const emitBody = boundedSource(
  captureServiceSource,
  '  emitTrace(event: TraceEvent): void {',
  '  private shouldRecordTraceEvent(event: TraceEvent): boolean {',
  'CaptureService should keep a bounded emitTrace implementation'
)
assert(
  emitBody.includes("event.kind === 'info'") &&
    emitBody.includes('!this.capturing') &&
    emitBody.includes('!this.shouldRecordTraceEvent(event)'),
  'emit should drop non-capturing events before buffering/broadcasting'
)
assert(
  emitBody.includes('this.traceEvents.push(stored)') &&
    emitBody.includes("xpcMain.broadcast('coach/trace', event)") &&
    emitBody.includes("this.traceStream.write(JSON.stringify(stored) + '\\n')"),
  'trace memory, renderer broadcast, and JSONL writes should happen only after emit gating'
)
const snapshotBody = boundedSource(
  captureServiceSource,
  '  async captureSnapshot(): Promise<SnapshotResult> {',
  '  async syncCaptureRecords(params: CaptureRecordSyncRequest): Promise<CaptureRecordSyncResult> {',
  'CaptureService should keep a bounded captureSnapshot implementation'
)
assert(
  snapshotBody.includes(
    "if (!this.capturing) return { ok: false, nodeCount: 0, yaml: '', error: 'Capture is not running' }"
  ),
  'manual snapshots should be rejected when Capture is stopped'
)
const startBody = boundedSource(
  captureServiceSource,
  '  async startCapture(params?: { mode?: CaptureMode } & Partial<CaptureOptions>): Promise<CaptureState> {',
  '  async stopCapture(): Promise<CaptureState> {',
  'CaptureService should keep a bounded startCapture implementation'
)
assert(
  startBody.includes('this.capturing = true') &&
    startBody.includes('await target.capture.startRecording()') &&
    startBody.includes("xpcMain.broadcast('coach/capture-started'"),
  'recording bridge should start only inside explicit startCapture'
)
const stopBody = boundedSource(
  captureServiceSource,
  '  async stopCapture(): Promise<CaptureState> {',
  '  private async discardActiveCaptureForRestart(): Promise<void> {',
  'CaptureService should keep a bounded stopCapture implementation'
)
assert(
  stopBody.includes('this.capturing = false') &&
    stopBody.includes('await target?.capture?.stopRecording'),
  'stopCapture should turn off capture state and recording bridge'
)
for (const [start, end, statement, name] of [
  [
    '  async getCaptureOptions(): Promise<CaptureOptions> {',
    '  async setCaptureOptions(',
    'return await this.captureService.getCaptureOptions()',
    'getCaptureOptions'
  ],
  [
    '  async setCaptureOptions(params: Partial<CaptureOptions>): Promise<CaptureOptions> {',
    '  getCaptureState(',
    'return await this.captureService.setCaptureOptions(params)',
    'setCaptureOptions'
  ],
  [
    '  getCaptureState(): CaptureState {',
    '  async startCapture(',
    'return this.captureService.getCaptureState()',
    'getCaptureState'
  ],
  [
    '  private currentBrowserTarget(): OperationTab | undefined {',
    '  async switchCaptureTarget(',
    'return this.captureService.currentCaptureTarget()',
    'currentBrowserTarget'
  ],
  [
    '  async switchCaptureTarget(next: OperationTab): Promise<void> {',
    '  // Capture a simplified DOM',
    'await this.captureService.switchCaptureTarget(next)',
    'switchCaptureTarget'
  ],
  [
    '  async captureSnapshot(): Promise<SnapshotResult> {',
    '  async syncCaptureRecords(',
    'return await this.captureService.captureSnapshot()',
    'captureSnapshot'
  ],
  [
    '  async syncCaptureRecords(params: CaptureRecordSyncRequest): Promise<CaptureRecordSyncResult> {',
    '  async getCaptureRecords(',
    'return await this.captureService.syncCaptureRecords(params)',
    'syncCaptureRecords'
  ],
  [
    '  async getCaptureRecords(): Promise<CaptureRecordSnapshot> {',
    '  async clearCaptureRecordEdits(',
    'return await this.captureService.getCaptureRecords()',
    'getCaptureRecords'
  ],
  [
    '  async clearCaptureRecordEdits(): Promise<{ ok: boolean }> {',
    '  async exportRecording(',
    'return await this.captureService.clearCaptureRecordEdits()',
    'clearCaptureRecordEdits'
  ],
  [
    '  async exportRecording(params: { startedAt: number; records: IngestRecord[]; format?: CaptureExportFormat }): Promise<ExportRecordingResult> {',
    '  async replayBrowserRequest(',
    'return await this.captureService.exportRecording(params)',
    'exportRecording'
  ]
]) {
  assertExactControllerFacade(start, end, statement, name)
}
assert(hostToolCatalog.includes("name: 'start_recording'"), 'host tool catalog should list start_recording')
assert(hostToolCatalog.includes("name: 'stop_recording'"), 'host tool catalog should list stop_recording')
assert(controllerSource.includes("name: 'start_recording'"), 'Maestro agent should expose start_recording')
assert(controllerSource.includes("name: 'stop_recording'"), 'Maestro agent should expose stop_recording')
assert(
  /private async toolStartRecording\(modeArg: string\): Promise<string> \{\s*return await this\.captureService\.toolStartRecording\(modeArg\)\s*\}/.test(
    controllerSource
  ),
  'controller start_recording seam should delegate exactly once'
)
assert(
  /private async toolStopRecording\(\): Promise<string> \{\s*return await this\.captureService\.toolStopRecording\(\)\s*\}/.test(
    controllerSource
  ),
  'controller stop_recording seam should delegate exactly once'
)
assert(
  /new DebuggerCapture\([\s\S]*\(\) => this\._state\.capturing && this\.ownerOf\(view\)\?\.id === this\._state\.captureTargetTabId/.test(
    buildViewSlotBody
  ),
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
