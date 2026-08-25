import { dialog } from 'electron'
import type { BrowserWindow, OpenDialogOptions } from 'electron'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from 'fs'
import { join } from 'path'
import { injectable } from 'inversify'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import { buildPersistedRawCaptureRecords } from './captureRecordPersistence'
import { buildHar } from './har.builder'
import { buildCaptureAnalysisTools } from './captureTools'
import {
  buildActionApiLinks,
  buildTimelineIndex,
  captureTimelineHints,
  clipText,
  coerceToolBoolean,
  normalizeApiWindowLimit,
  normalizeApiWindowMs,
  normalizeTimelineAround,
  normalizeTimelineKind,
  normalizeTimelineLimit,
  summarizeTimelineDetailRecord,
  summarizeTimelineRecord,
  timelineKindMatches,
  timelineRequestId,
  timelineSearchMatchesRecord
} from './traceTimeline'
import {
  type CaptureRecordSource,
  type PersistedCaptureRecordOptions,
  normalizePersistedCaptureRecordOptions
} from './captureRecordSource'
import type { PiToolSpec } from '@maestro-main/agent/BaseAgent'
import type { OperationTab } from '@maestro-main/windows/main/maestroBrowserView.service'
import type {
  AgentActivityStep,
  CaptureExportFormat,
  CaptureOptions,
  CaptureRecordSnapshot,
  CaptureRecordSyncRequest,
  CaptureRecordSyncResult,
  CaptureState,
  CodexDebugEvent,
  ExportRecordingResult,
  IngestRecord,
  SnapshotResult
} from '@maestro-shared/coach.api'
import type { CaptureRule } from '@maestro-shared/captureFilter.api'
import type { CaptureMode, TraceEvent } from '@maestro-shared/trace.types'
import type { ConfigApi } from '@maestro-shared/config.api'

const MAX_MEMORY_EVENTS = 1200
const CAPTURE_RECORD_CONFIG_DOMAIN = 'capture-records'
const CAPTURE_RECORD_CONFIG_KEY = 'latest'
const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')

const defaultCaptureOptions = (): CaptureOptions => ({
  recordActions: true,
  recordNetwork: true,
  networkWhitelistEnabled: false,
  networkWhitelist: [],
  networkBlacklist: []
})

const captureRuleMatches = (rule: CaptureRule, url: string, host: string): boolean => {
  const value = rule.value.trim().toLowerCase()
  if (!value) return false
  if (rule.rule === 'domain-suffix') return !!host && (host === value || host.endsWith('.' + value))
  if (rule.rule === 'url-prefix') return url.toLowerCase().startsWith(value)
  return false
}

const normalizeCaptureRules = (rules: CaptureRule[]): CaptureRule[] => {
  const out: CaptureRule[] = []
  for (const rule of rules) {
    const value = rule.value.trim()
    if (!value) continue
    out.push({
      type: rule.type === 'whitelist' ? 'whitelist' : 'blacklist',
      rule: rule.rule === 'url-prefix' ? 'url-prefix' : 'domain-suffix',
      value
    })
  }
  return out
}

const captureFileName = (startedAt: number, format: CaptureExportFormat = 'json'): string => {
  const d = new Date(Number.isFinite(startedAt) && startedAt > 0 ? startedAt : Date.now())
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `capture-${stamp}.${format}`
}

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const normalizeCaptureToolMode = (value: string): CaptureMode | undefined => {
  const mode = value.trim().toLowerCase()
  if (mode === 'ui' || mode === 'api') return mode
  return undefined
}

export interface CaptureServiceState {
  browserWindow: BrowserWindow | null
  currentUrl: string
  getOperationTabs(): OperationTab[]
  getActiveOperationTabId(): string | null
  debugCodex(event: CodexDebugEvent): void
  broadcastActivity(phase: AgentActivityStep['phase'], label: string, ok?: boolean): void
}

@injectable()
export class CaptureService extends CommonService<CaptureServiceState> {
  capturing = false
  captureMode: CaptureMode = 'ui'
  captureTargetTabId: string | null = null
  traceFile: string | null = null
  captureStartedAt = 0

  private captureOptions: CaptureOptions = defaultCaptureOptions()
  private traceStream: WriteStream | null = null
  private traceEvents: TraceEvent[] = []
  private editedCaptureRecords: {
    records: IngestRecord[]
    workflow?: string
    startedAt?: number
    updatedAt: number
  } | null = null
  private captureRecordLoadPromise: Promise<void> | null = null

  async getCaptureOptions(): Promise<CaptureOptions> {
    return this.cloneCaptureOptions()
  }

  async setCaptureOptions(params: Partial<CaptureOptions>): Promise<CaptureOptions> {
    this.captureOptions = {
      ...this.captureOptions,
      recordActions: typeof params.recordActions === 'boolean' ? params.recordActions : this.captureOptions.recordActions,
      recordNetwork: typeof params.recordNetwork === 'boolean' ? params.recordNetwork : this.captureOptions.recordNetwork,
      networkWhitelistEnabled:
        typeof params.networkWhitelistEnabled === 'boolean' ? params.networkWhitelistEnabled : this.captureOptions.networkWhitelistEnabled,
      networkWhitelist: params.networkWhitelist ? normalizeCaptureRules(params.networkWhitelist) : this.captureOptions.networkWhitelist,
      networkBlacklist: params.networkBlacklist ? normalizeCaptureRules(params.networkBlacklist) : this.captureOptions.networkBlacklist
    }
    const options = this.cloneCaptureOptions()
    xpcMain.broadcast('coach/capture-options', options)
    return options
  }

  getCaptureState(): CaptureState {
    return {
      capturing: this.capturing,
      mode: this.captureMode,
      file: this.traceFile,
      startedAt: this.capturing ? this.captureStartedAt : 0
    }
  }

  private cloneCaptureOptions(): CaptureOptions {
    return {
      ...this.captureOptions,
      networkWhitelist: this.captureOptions.networkWhitelist.map((rule) => ({ ...rule })),
      networkBlacklist: this.captureOptions.networkBlacklist.map((rule) => ({ ...rule }))
    }
  }

  async startCapture(params?: { mode?: CaptureMode } & Partial<CaptureOptions>): Promise<CaptureState> {
    if (params?.mode) this.captureMode = params.mode
    if (params) await this.setCaptureOptions(params)
    const active = this._state.getOperationTabs().find((tab) => tab.id === this._state.getActiveOperationTabId())
    if (active && active.kind !== 'browser') {
      this.emitTrace({ kind: 'info', msg: `capture unavailable on ${active.kind} tab`, ts: Date.now() })
      return this.getCaptureState()
    }
    if (this.capturing) await this.discardActiveCaptureForRestart()
    const target = this.currentCaptureTarget()
    if (!target?.capture) return this.getCaptureState()

    const dir = join(maestroDataRoot(), 'traces')
    mkdirSync(dir, { recursive: true })
    this.traceFile = join(dir, `trace-${Date.now()}.jsonl`)
    this.traceStream = createWriteStream(this.traceFile, { flags: 'a' })
    this.capturing = true
    this.captureStartedAt = Date.now()
    this.captureTargetTabId = target.id
    this.traceEvents = []
    await this.clearCaptureRecordEdits()
    await target.capture.startRecording()
    xpcMain.broadcast('coach/capture-started', {
      file: this.traceFile,
      mode: this.captureMode,
      ts: this.captureStartedAt
    })
    this.emitTrace({ kind: 'info', msg: `capture (${this.captureMode}) -> ${this.traceFile}`, ts: Date.now() })
    return this.getCaptureState()
  }

  async stopCapture(): Promise<CaptureState> {
    const stoppedStartedAt = this.captureStartedAt
    this.capturing = false
    this.captureStartedAt = 0
    const target = this.captureTargetTab()
    await target?.capture?.stopRecording()
    this.captureTargetTabId = null
    if (this.traceStream) {
      this.traceStream.end()
      this.traceStream = null
    }
    await this.persistRawCaptureRecordsIfNeeded(stoppedStartedAt)
    this.emitTrace({ kind: 'info', msg: 'capture stopped', ts: Date.now() })
    xpcMain.broadcast('coach/capture-stopped', { ts: Date.now() })
    return this.getCaptureState()
  }

  private async discardActiveCaptureForRestart(): Promise<void> {
    const target = this.captureTargetTab()
    await target?.capture?.stopRecording().catch((err) => {
      this.emitTrace({ kind: 'error', msg: 'capture restart cleanup: ' + (err as Error).message, ts: Date.now() })
    })
    if (this.traceStream) {
      this.traceStream.end()
      this.traceStream = null
    }
    this.capturing = false
    this.captureStartedAt = 0
    this.captureTargetTabId = null
    this.traceFile = null
    this.traceEvents = []
  }

  private async persistRawCaptureRecordsIfNeeded(startedAt: number): Promise<void> {
    if (this.editedCaptureRecords || !this.traceEvents.length) return
    const persisted = buildPersistedRawCaptureRecords(this.traceEvents, startedAt)
    if (!persisted) return
    this.editedCaptureRecords = persisted
    await this.persistCaptureRecordEdits().catch((err) => {
      this._state.debugCodex({
        scope: 'agent',
        phase: 'capture-record-persist',
        level: 'warn',
        message: 'Failed to persist latest raw capture records.',
        detail: { error: err instanceof Error ? err.message : String(err) },
        ts: Date.now()
      })
    })
    this._state.debugCodex({
      scope: 'agent',
      phase: 'capture-record-persist',
      level: 'debug',
      message: 'Persisted latest raw capture records.',
      detail: { count: persisted.records.length },
      ts: Date.now()
    })
  }

  private isCapturableTab(tab: OperationTab | undefined): tab is OperationTab {
    return !!tab && tab.kind === 'browser' && tab.debuggerEnabled && !!tab.capture && !!tab.view && !tab.view.webContents.isDestroyed()
  }

  private captureTargetTab(): OperationTab | undefined {
    return this._state.getOperationTabs().find((tab) => tab.id === this.captureTargetTabId)
  }

  currentCaptureTarget(): OperationTab | undefined {
    const tabs = this._state.getOperationTabs()
    const active = tabs.find((tab) => tab.id === this._state.getActiveOperationTabId())
    if (active && active.kind !== 'browser') return undefined
    if (active && !active.debuggerEnabled) return undefined
    if (this.isCapturableTab(active)) return active
    const existing = this.captureTargetTab()
    if (this.isCapturableTab(existing)) return existing
    return tabs
      .filter((tab) => this.isCapturableTab(tab))
      .sort((a, b) => b.lastActive - a.lastActive)[0]
  }

  async switchCaptureTarget(next: OperationTab): Promise<void> {
    if (!this.capturing) return
    if (next.kind !== 'browser') {
      await this.stopCapture()
      return
    }
    if (!this.isCapturableTab(next) || this.captureTargetTabId === next.id) return
    const prev = this.captureTargetTab()
    if (prev && prev.id !== next.id) await prev.capture?.stopRecording()
    this.captureTargetTabId = next.id
    await next.capture?.startRecording()
  }

  async captureSnapshot(): Promise<SnapshotResult> {
    if (!this.capturing) return { ok: false, nodeCount: 0, yaml: '', error: 'Capture is not running' }
    if (this.captureMode === 'api' || !this.captureOptions.recordActions) {
      return { ok: false, nodeCount: 0, yaml: '', error: 'Action capture is off' }
    }
    const target = this.currentCaptureTarget()
    if (!target?.capture) return { ok: false, nodeCount: 0, yaml: '', error: 'capture not ready' }
    const result = await target.capture.snapshot({ shot: true })
    if (result.ok) {
      this.emitTrace({
        kind: 'snapshot',
        url: target.url || this._state.currentUrl,
        title: result.title,
        nodeCount: result.nodeCount,
        yaml: result.yaml,
        shot: result.shot,
        ts: Date.now()
      })
    } else {
      this.emitTrace({ kind: 'error', msg: 'snapshot: ' + (result.error || 'failed'), ts: Date.now() })
    }
    return { ok: result.ok, nodeCount: result.nodeCount, yaml: result.yaml, error: result.error }
  }

  async syncCaptureRecords(params: CaptureRecordSyncRequest): Promise<CaptureRecordSyncResult> {
    const records = Array.isArray(params.records) ? params.records.filter((record) => record?.event) : []
    const updatedAt = Date.now()
    const startedAt = Number.isFinite(params.startedAt) && Number(params.startedAt) > 0 ? Number(params.startedAt) : undefined
    const workflow = params.workflow?.trim() || undefined
    this.editedCaptureRecords = {
      records: JSON.parse(JSON.stringify(records)) as IngestRecord[],
      workflow,
      startedAt,
      updatedAt
    }
    await this.persistCaptureRecordEdits().catch((err) => {
      this._state.debugCodex({
        scope: 'agent',
        phase: 'capture-record-persist',
        level: 'warn',
        message: 'Failed to persist renderer-edited capture records.',
        detail: { error: err instanceof Error ? err.message : String(err) },
        ts: Date.now()
      })
    })
    this._state.debugCodex({
      scope: 'agent',
      phase: 'capture-record-sync',
      level: 'debug',
      message: 'Synced renderer-edited capture records.',
      detail: { count: records.length, flagged: records.filter((record) => record.flagged).length },
      ts: updatedAt
    })
    return { ok: true, count: records.length, updatedAt }
  }

  async getCaptureRecords(): Promise<CaptureRecordSnapshot> {
    await this.ensurePersistedCaptureRecordsLoaded()
    const capture = this.captureRecordsForAgent()
    return {
      ok: true,
      source: capture.records.length ? capture.source : this.editedCaptureRecords ? 'edited' : 'none',
      startedAt: capture.source === 'edited' ? this.editedCaptureRecords?.startedAt : this.captureStartedAt || undefined,
      workflow: capture.workflow,
      updatedAt: capture.updatedAt,
      records: JSON.parse(JSON.stringify(capture.records)) as IngestRecord[]
    }
  }

  async clearCaptureRecordEdits(): Promise<{ ok: boolean }> {
    this.editedCaptureRecords = null
    this.captureRecordLoadPromise = null
    await configStore.remove({ domain: CAPTURE_RECORD_CONFIG_DOMAIN, key: CAPTURE_RECORD_CONFIG_KEY }).catch(() => undefined)
    return { ok: true }
  }

  async exportRecording(params: {
    startedAt: number
    records: IngestRecord[]
    format?: CaptureExportFormat
  }): Promise<ExportRecordingResult> {
    const format = params.format === 'har' ? 'har' : 'json'
    const parent = this._state.browserWindow && !this._state.browserWindow.isDestroyed() ? this._state.browserWindow : undefined
    const options: OpenDialogOptions = {
      title: 'Choose capture export directory',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    const file = join(result.filePaths[0], captureFileName(params.startedAt, format))
    try {
      const payload =
        format === 'har'
          ? buildHar(params)
          : { version: 1, startedAt: params.startedAt || Date.now(), exportedAt: Date.now(), records: params.records }
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
      return { ok: true, path: file, format }
    } catch (err) {
      return { ok: false, path: file, format, error: (err as Error).message }
    }
  }

  private async persistCaptureRecordEdits(): Promise<void> {
    const edited = this.editedCaptureRecords
    if (!edited) return
    await configStore.upsert({
      domain: CAPTURE_RECORD_CONFIG_DOMAIN,
      key: CAPTURE_RECORD_CONFIG_KEY,
      options: {
        startedAt: edited.startedAt,
        workflow: edited.workflow,
        updatedAt: edited.updatedAt,
        records: edited.records
      } satisfies PersistedCaptureRecordOptions
    })
  }

  async ensurePersistedCaptureRecordsLoaded(): Promise<void> {
    if (this.editedCaptureRecords || this.capturing || this.traceEvents.length) return
    if (!this.captureRecordLoadPromise) this.captureRecordLoadPromise = this.loadPersistedCaptureRecords()
    await this.captureRecordLoadPromise
  }

  private async loadPersistedCaptureRecords(): Promise<void> {
    if (this.editedCaptureRecords || this.capturing || this.traceEvents.length) return
    const entry = await configStore
      .get({ domain: CAPTURE_RECORD_CONFIG_DOMAIN, key: CAPTURE_RECORD_CONFIG_KEY })
      .catch(() => null)
    const saved = normalizePersistedCaptureRecordOptions(entry?.options)
    if (!saved) return
    this.editedCaptureRecords = saved
    this._state.debugCodex({
      scope: 'agent',
      phase: 'capture-record-load',
      level: 'debug',
      message: 'Loaded persisted edited capture records.',
      detail: { count: saved.records.length, flagged: saved.records.filter((record) => record.flagged).length },
      ts: Date.now()
    })
  }

  captureRecordsForAgent(): CaptureRecordSource {
    if (this.editedCaptureRecords) {
      return {
        source: 'edited',
        records: this.editedCaptureRecords.records,
        workflow: this.editedCaptureRecords.workflow,
        updatedAt: this.editedCaptureRecords.updatedAt
      }
    }
    return { source: 'raw', records: this.traceEvents.map((event) => ({ event })) }
  }

  onCapturedEvent(event: TraceEvent, tabId: string): void {
    if (tabId !== this.captureTargetTabId || !this.capturing) return
    this.emitTrace(event)
  }

  emitTrace(event: TraceEvent): void {
    if (event.kind === 'info' || !this.capturing || !this.shouldRecordTraceEvent(event)) return
    const stored =
      (event.kind === 'action' || event.kind === 'snapshot') && event.shot
        ? { ...event, shot: undefined }
        : event
    this.traceEvents.push(stored)
    if (this.traceEvents.length > MAX_MEMORY_EVENTS) this.traceEvents.shift()
    xpcMain.broadcast('coach/trace', event)
    if (this.capturing && this.traceStream) this.traceStream.write(JSON.stringify(stored) + '\n')
  }

  private shouldRecordTraceEvent(event: TraceEvent): boolean {
    if (event.kind === 'error') return true
    if (event.kind === 'action' || event.kind === 'snapshot') {
      return this.captureMode !== 'api' && this.captureOptions.recordActions
    }
    if (event.kind === 'net.request' || event.kind === 'net.response') return this.networkCapturePasses(event.url)
    return true
  }

  private networkCapturePasses(url: string): boolean {
    if (!this.captureOptions.recordNetwork) return false
    if (!url) return true
    const host = hostnameOf(url)
    if (
      this.captureOptions.networkWhitelistEnabled &&
      !this.captureOptions.networkWhitelist.some((rule) => captureRuleMatches(rule, url, host))
    ) {
      return false
    }
    return !this.captureOptions.networkBlacklist.some((rule) => captureRuleMatches(rule, url, host))
  }

  async toolStartRecording(modeArg: string): Promise<string> {
    const mode = normalizeCaptureToolMode(modeArg)
    const state = await this.startCapture(mode ? { mode } : undefined)
    const ok = Boolean(state.capturing)
    this._state.broadcastActivity('tool', `start_recording${state.mode ? ` (${state.mode})` : ''}`, ok)
    return JSON.stringify(
      { ok, capturing: state.capturing, mode: state.mode, file: state.file || '', startedAt: state.startedAt || 0 },
      null,
      2
    )
  }

  async toolStopRecording(): Promise<string> {
    const wasCapturing = this.capturing
    const state = await this.stopCapture()
    this._state.broadcastActivity('tool', 'stop_recording', wasCapturing)
    return JSON.stringify(
      {
        ok: wasCapturing,
        capturing: state.capturing,
        mode: state.mode,
        file: state.file || '',
        stoppedAt: Date.now(),
        note: wasCapturing ? 'recording stopped' : 'recording was already stopped'
      },
      null,
      2
    )
  }

  toolCaptureTimeline(args: Record<string, unknown>): string {
    const kind = normalizeTimelineKind(args.kind)
    const limit = normalizeTimelineLimit(args.limit)
    const includeBodies = coerceToolBoolean(args.include_bodies)
    const includeHeaders = coerceToolBoolean(args.include_headers)
    const capture = this.captureRecordsForAgent()
    const events = capture.records.map((record) => record.event)
    const indexed = capture.records.map((record, index) => ({ record, event: record.event, index: index + 1 }))
    const timelineIndex = buildTimelineIndex(events)
    const apiWindowMs = normalizeApiWindowMs(args.api_window_ms)
    const apiWindowLimit = normalizeApiWindowLimit(args.api_window_limit)
    const actionApiLinks = buildActionApiLinks(capture.records, timelineIndex, {
      windowMs: apiWindowMs,
      limit: apiWindowLimit
    })
    const filtered = indexed.filter(({ event }) => timelineKindMatches(event, kind))
    const selected = filtered.slice(-limit)
    const payload = {
      ok: true,
      capturing: this.capturing,
      source: capture.source,
      mode: this.captureMode,
      currentUrl: this._state.currentUrl,
      traceFile: this.traceFile,
      filter: {
        kind,
        limit,
        include_bodies: includeBodies,
        include_headers: includeHeaders,
        api_window_ms: apiWindowMs,
        api_window_limit: apiWindowLimit
      },
      total: capture.records.length,
      matched: filtered.length,
      returned: selected.length,
      events: selected.map(({ record, event, index }) =>
        summarizeTimelineRecord(
          record,
          index,
          includeBodies,
          includeHeaders,
          event.kind === 'net.response' ? timelineIndex.requestById.get(event.requestId) : undefined,
          actionApiLinks.get(index)
        )
      ),
      hints: captureTimelineHints({
        capturing: this.capturing,
        total: capture.records.length,
        returned: selected.length,
        apiWindowMs,
        includeBodies,
        includeHeaders
      })
    }
    this._state.broadcastActivity('tool', `read capture_timeline (${selected.length}/${filtered.length} ${kind})`)
    return clipText(JSON.stringify(payload, null, 2), 32_000)
  }

  toolCaptureSearch(args: Record<string, unknown>): string {
    const query = String(args.query || '').trim()
    if (!query) return 'ERROR: query is required.'
    const kind = normalizeTimelineKind(args.kind)
    const limit = normalizeTimelineLimit(args.limit)
    const includeBodies = coerceToolBoolean(args.include_bodies)
    const includeHeaders = coerceToolBoolean(args.include_headers)
    const capture = this.captureRecordsForAgent()
    const timelineIndex = buildTimelineIndex(capture.records.map((record) => record.event))
    const apiWindowMs = normalizeApiWindowMs(args.api_window_ms)
    const apiWindowLimit = normalizeApiWindowLimit(args.api_window_limit)
    const actionApiLinks = buildActionApiLinks(capture.records, timelineIndex, {
      windowMs: apiWindowMs,
      limit: apiWindowLimit
    })
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const matched = capture.records
      .map((record, index) => ({ record, event: record.event, index: index + 1 }))
      .filter(({ record, event }) => timelineKindMatches(event, kind) && timelineSearchMatchesRecord(record, tokens))
    const selected = matched.slice(0, limit)
    const payload = {
      ok: true,
      source: capture.source,
      query,
      filter: {
        kind,
        limit,
        include_bodies: includeBodies,
        include_headers: includeHeaders,
        api_window_ms: apiWindowMs,
        api_window_limit: apiWindowLimit
      },
      total: capture.records.length,
      matched: matched.length,
      returned: selected.length,
      events: selected.map(({ record, event, index }) =>
        summarizeTimelineRecord(
          record,
          index,
          includeBodies,
          includeHeaders,
          event.kind === 'net.response' ? timelineIndex.requestById.get(event.requestId) : undefined,
          actionApiLinks.get(index)
        )
      ),
      hints: [
        'Use capture_event_detail with event_index or request_id when one hit looks relevant.',
        apiWindowMs ? 'UI action hits may include apiAfterAction: likely business API requests triggered after that action.' : '',
        ...(includeBodies ? [] : ['Payloads are hidden in search results; request detail with include_bodies=true only when needed.'])
      ].filter(Boolean)
    }
    this._state.broadcastActivity('tool', `search capture (${selected.length}/${matched.length})`)
    return clipText(JSON.stringify(payload, null, 2), 32_000)
  }

  toolCaptureEventDetail(args: Record<string, unknown>): string {
    const includeBodies = coerceToolBoolean(args.include_bodies)
    const includeHeaders = coerceToolBoolean(args.include_headers)
    const around = normalizeTimelineAround(args.around)
    const apiWindowMs = normalizeApiWindowMs(args.api_window_ms)
    const apiWindowLimit = normalizeApiWindowLimit(args.api_window_limit)
    const requestedIndex = Number(args.event_index)
    const requestedRequestId = String(args.request_id || '').trim()
    const capture = this.captureRecordsForAgent()
    const records = capture.records
    const timelineIndex = buildTimelineIndex(records.map((record) => record.event))
    const actionApiLinks = buildActionApiLinks(records, timelineIndex, {
      windowMs: apiWindowMs,
      limit: apiWindowLimit
    })
    const selectedIndexes = new Set<number>()
    const matchedIndexes = new Set<number>()
    const selectedRequestIds = new Set<string>()
    const forcedRelation = new Map<number, string>()

    if (requestedRequestId) {
      selectedRequestIds.add(requestedRequestId)
      const requestIndex = timelineIndex.requestIndexById.get(requestedRequestId)
      if (requestIndex) {
        selectedIndexes.add(requestIndex)
        matchedIndexes.add(requestIndex)
      }
      for (const responseIndex of timelineIndex.responseIndexesById.get(requestedRequestId) || []) {
        selectedIndexes.add(responseIndex)
        matchedIndexes.add(responseIndex)
      }
      if (!matchedIndexes.size) {
        return `ERROR: request_id "${requestedRequestId}" was not found in the current capture memory.`
      }
    } else if (Number.isFinite(requestedIndex) && requestedIndex >= 1 && requestedIndex <= records.length) {
      const index = Math.floor(requestedIndex)
      const event = records[index - 1].event
      selectedIndexes.add(index)
      matchedIndexes.add(index)
      const requestId = timelineRequestId(event)
      if (requestId) {
        selectedRequestIds.add(requestId)
        const requestIndex = timelineIndex.requestIndexById.get(requestId)
        if (requestIndex) selectedIndexes.add(requestIndex)
        for (const responseIndex of timelineIndex.responseIndexesById.get(requestId) || []) selectedIndexes.add(responseIndex)
      }
      if (event.kind === 'action') {
        for (const link of actionApiLinks.get(index) || []) {
          selectedRequestIds.add(link.requestId)
          selectedIndexes.add(link.requestIndex)
          forcedRelation.set(link.requestIndex, 'api_after_action')
          if (link.responseIndex) {
            selectedIndexes.add(link.responseIndex)
            forcedRelation.set(link.responseIndex, 'api_after_action')
          }
        }
      }
    } else {
      return 'ERROR: provide event_index (1-based index from capture_timeline/capture_search) or request_id.'
    }

    for (const index of Array.from(matchedIndexes)) {
      const start = Math.max(1, index - around)
      const end = Math.min(records.length, index + around)
      for (let i = start; i <= end; i += 1) selectedIndexes.add(i)
    }

    const events = Array.from(selectedIndexes)
      .sort((a, b) => a - b)
      .map((index) => {
        const record = records[index - 1]
        const requestId = timelineRequestId(record.event)
        const relation = matchedIndexes.has(index)
          ? 'match'
          : forcedRelation.get(index) || (requestId && selectedRequestIds.has(requestId) ? 'same_request' : 'context')
        return {
          relation,
          ...summarizeTimelineDetailRecord(
            record,
            index,
            includeBodies,
            includeHeaders,
            timelineIndex,
            actionApiLinks.get(index)
          )
        }
      })
    const payload = {
      ok: true,
      source: capture.source,
      requested: {
        event_index: Number.isFinite(requestedIndex) ? Math.floor(requestedIndex) : undefined,
        request_id: requestedRequestId || undefined,
        around,
        include_bodies: includeBodies,
        include_headers: includeHeaders,
        api_window_ms: apiWindowMs,
        api_window_limit: apiWindowLimit
      },
      total: records.length,
      returned: events.length,
      events,
      hints: [
        apiWindowMs ? 'When the matched event is a UI action, relation=api_after_action marks likely business API calls that followed it.' : '',
        includeBodies
          ? 'Bodies are captured previews, not guaranteed full payloads for very large/binary/evicted responses.'
          : 'Payloads are hidden; call again with include_bodies=true only when needed.',
        includeHeaders
          ? 'Auth/cookie-like header values remain redacted.'
          : 'Header values are hidden; call again with include_headers=true only when header shape matters.'
      ].filter(Boolean)
    }
    this._state.broadcastActivity('tool', `read capture_detail (${events.length} events)`)
    return clipText(JSON.stringify(payload, null, 2), 48_000)
  }

  buildCaptureAnalysisTools(): PiToolSpec[] {
    return buildCaptureAnalysisTools({
      timeline: (args) => this.toolCaptureTimeline(args),
      search: (args) => this.toolCaptureSearch(args),
      eventDetail: (args) => this.toolCaptureEventDetail(args)
    })
  }

  async shutdown(): Promise<void> {
    if (this.capturing) await this.stopCapture().catch(() => undefined)
    this.reset()
  }

  reset(): void {
    if (this.traceStream) this.traceStream.end()
    this.traceStream = null
    this.capturing = false
    this.captureStartedAt = 0
    this.captureTargetTabId = null
    this.traceFile = null
    this.traceEvents = []
    this.editedCaptureRecords = null
    this.captureRecordLoadPromise = null
  }
}
