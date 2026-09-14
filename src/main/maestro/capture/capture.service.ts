import { dirname } from 'node:path'
import { dialog } from 'electron'
import type { BrowserWindow, OpenDialogOptions, WebContents } from 'electron'
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
import type { PiToolSpec } from '@main/agent/BaseAgent'
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
  SnapshotResult, CaptureStartedBy } from '@maestro-shared/coach.api'
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
  private drillTabIds: Set<string> | null = null
  private drillScopeRevision = 0

  isCaptureTab(tabId: string): boolean {
    return this.capturing && (this.drillTabIds ? this.drillTabIds.has(tabId) : this.captureTargetTabId === tabId)
  }

  async setDrillCaptureTabs(ids: string[] | null): Promise<void> {
    const revision = ++this.drillScopeRevision
    const previous = this.drillTabIds
    this.drillTabIds = ids === null ? null : new Set(ids)
    if (!this.capturing) return
    if (ids === null && this.captureStartedBy === 'agent') { await this.stopCapture(); return }
    const next = this.drillTabIds ?? new Set(this.captureTargetTabId ? [this.captureTargetTabId] : [])
    for (const tab of this._state.getOperationTabs()) {
      if (previous?.has(tab.id) && !next.has(tab.id)) await tab.capture?.stopRecording()
      if (revision !== this.drillScopeRevision || !this.capturing) return
      if (next.has(tab.id) && !previous?.has(tab.id) && tab.id !== this.captureTargetTabId && this.isCapturableTab(tab)) {
        await tab.capture.prepareNavigation()
        if (revision !== this.drillScopeRevision || !this.capturing || !this.drillTabIds?.has(tab.id)) return
        await tab.capture.startRecording()
      }
    }
  }
  private captureTargetRequest = 0
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

  /**
   * 这份录制是**谁开的**（本次从 cowork 移植）。
   *
   * **默认 `'operator'` 是刻意的保守方向。** 两种漏法的代价不对称:
   * 漏盖章 ⇒ 录制多活一会儿(多花磁盘,`stop_recording` / Capture 按钮随时能停);
   * 错停 ⇒ **掐掉人正在录的演示,那是不可恢复的**。所以宁可漏停,不可错停。
   */
  private captureStartedBy: CaptureStartedBy = 'operator'

  /** 只在录着的时候有意义 —— 没在录时读到的必须是保守值,而不是上一次的残留。 */
  get captureProvenance(): CaptureStartedBy | null {
    return this.capturing ? this.captureStartedBy : null
  }

  /** 「录制期间自动取消文件选择框」的电平。默认关 —— agent 流程自己开、自己关。 */
  private autoDismissFileDialogs = false

  /**
   * 把当前录制**电平**播给所有渲染层。
   *
   * 红点只吃 `capture-started` / `capture-stopped` 两个**沿**,漏一个就永久错。
   * 这个方法给"最需要灯是对的那一刻"一个显式的对表点 —— 播完之后灯还不亮,
   * 就一定是录制真的没在跑,而不是投递问题:**它把一个查不清的现象变成一条可证伪的断言**。
   */
  announceCaptureState(): void {
    xpcMain.broadcast('coach/capture-state', this.getCaptureState())
  }

  /**
   * 只收掉**agent 自己开起来的**那份录制;人开的不动。
   *
   * 「录制的生命周期归人」那条规矩(Ral 2026-08-16)保留 —— 它保护的是人开的录制。
   * 而 agent 流程(钻探第一步的 `start_recording`)开起来的那份不是人开的:
   * 从人的视角他从没打开录制,只是启停了一次流程,灯却留在那亮着。
   */
  async stopCaptureIfAgentStarted(reason: string): Promise<boolean> {
    if (!this.capturing || this.captureStartedBy !== 'agent') return false
    console.log(`[capture] stopping the agent-started recording — ${reason}`)
    await this.stopCapture()
    return true
  }

  /**
   * 开/关「自动取消文件选择框」。
   *
   * **只在录着的时候真的开拦截**(`on && this.capturing`)—— 一直开着的话人平时用浏览器
   * 也再传不了文件,那是把一个 agent 的需要变成整个应用的残疾。
   */
  async setAutoDismissFileDialogs(on: boolean): Promise<void> {
    if (this.autoDismissFileDialogs === on) return
    this.autoDismissFileDialogs = on
    const target = this.currentCaptureTarget()
    await target?.capture?.setFileChooserIntercept(on && this.capturing).catch(() => undefined)
    this.announceCaptureState()
  }

  getCaptureState(): CaptureState {
    return {
      capturing: this.capturing,
      mode: this.captureMode,
      file: this.traceFile,
      startedAt: this.capturing ? this.captureStartedAt : 0,
      autoDismissFileDialogs: this.autoDismissFileDialogs
    }
  }

  private cloneCaptureOptions(): CaptureOptions {
    return {
      ...this.captureOptions,
      networkWhitelist: this.captureOptions.networkWhitelist.map((rule) => ({ ...rule })),
      networkBlacklist: this.captureOptions.networkBlacklist.map((rule) => ({ ...rule }))
    }
  }

  /**
   * @param opts.startedBy 这份录制是谁开的。默认 `'operator'` —— 见 `captureStartedBy` 的说明。
   */
  async startCapture(
    params?: { mode?: CaptureMode } & Partial<CaptureOptions>,
    opts?: { startedBy?: CaptureStartedBy; tabId?: string }
  ): Promise<CaptureState> {
    const target = opts?.tabId ? this._state.getOperationTabs().find((tab) => tab.id === opts.tabId) : this.currentCaptureTarget()
    if (!this.isCapturableTab(target) || (this.drillTabIds && !this.drillTabIds.has(target.id))) return this.getCaptureState()
    if (params?.mode) this.captureMode = params.mode
    if (params) await this.setCaptureOptions(params)
    /**
     * **这一段里只要有过人开的录制,来源就钉死 `'operator'`。**
     *
     * 场景是"人先开录演示 → 让 agent 干活 → 停 agent" —— 那份录制是人的。若这里让 agent 的
     * `startedBy` 盖上去,人的录制就被**洗成** agent 的,下一次 `stopCaptureIfAgentStarted`
     * 照样把它掐掉,而那恰恰是引入来源字段要保护的场景。宁可漏停,不可错停。
     */
    const replacingOperatorCapture = this.capturing && this.captureStartedBy === 'operator'
    const effectiveStartedBy: CaptureStartedBy = replacingOperatorCapture
      ? 'operator'
      : opts?.startedBy || 'operator'
    if (this.capturing) await this.discardActiveCaptureForRestart()
    if (!this._state.getOperationTabs().includes(target) || !this.isCapturableTab(target)) return this.getCaptureState()

    const dir = join(maestroDataRoot(), 'traces')
    mkdirSync(dir, { recursive: true })
    this.traceFile = join(dir, `trace-${Date.now()}.jsonl`)
    this.traceStream = createWriteStream(this.traceFile, { flags: 'a' })
    this.capturing = true
    /**
     * **来源与"占住 session"同一处落地。**
     *
     * 不能盖在 `startCapture` 入口:那里会被上面那些早退闸放过去 —— 一次什么都没做的
     * agent start(闸早退)照样会把**人正在开**的那份录制改标成 `'agent'`,
     * 于是下一次停止把人的演示掐掉。这是 cowork 侧 2026-09-09 被红队抓出来的方向。
     */
    this.captureStartedBy = effectiveStartedBy
    this.captureStartedAt = Date.now()
    this.captureTargetTabId = target.id
    // 录制真的起来了 → 若"自动取消文件框"是开着的,把拦截跟着装上(它只在录制期间生效)。
    if (this.autoDismissFileDialogs) {
      await target.capture.setFileChooserIntercept(true).catch(() => undefined)
    }
    this.traceEvents = []
    await this.clearCaptureRecordEdits()
    await target.capture.startRecording()
    for (const id of this.drillTabIds ?? []) {
      if (id !== target.id) await this._state.getOperationTabs().find((tab) => tab.id === id)?.capture?.startRecording()
    }
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
    // **复位成保守值。** 不复位的话,下一份人开的录制会继承上一份 agent 的章,
    // 于是 `stopCaptureIfAgentStarted` 会去停一份人正在录的演示 —— 那是不可恢复的。
    this.captureStartedBy = 'operator'
    this.captureStartedAt = 0
    const target = this.captureTargetTab()
    const recordingIds = new Set([...(this.drillTabIds ?? []), ...(target ? [target.id] : [])])
    await Promise.all([...recordingIds].map((id) => this._state.getOperationTabs().find((tab) => tab.id === id)?.capture?.stopRecording()))
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
    if (this.drillTabIds) {
      const target = this.captureTargetTab()
      return target && this.drillTabIds.has(target.id) && this.isCapturableTab(target) ? target : undefined
    }
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
    if (this.drillTabIds && !this.drillTabIds.has(next.id)) return
    const request = ++this.captureTargetRequest
    if (!this.capturing) return
    if (next.kind !== 'browser') {
      await this.stopCapture()
      return
    }
    if (!this.isCapturableTab(next) || this.captureTargetTabId === next.id) return
    const view = next.view
    const prev = this.captureTargetTab()
    if (!this.drillTabIds && prev && prev.id !== next.id) await prev.capture?.stopRecording()
    await next.documentReady
    await next.capture?.prepareNavigation()
    if (request !== this.captureTargetRequest || !this.capturing || next.view !== view || next.closeReady ||
      !this._state.getOperationTabs().includes(next) || !this.isCapturableTab(next)) return
    this.captureTargetTabId = next.id
    await next.capture?.startRecording()
  }

  /**
   * 给 agent 的页面快照 —— **绕开录制闸**(drill-001;cowork 侧同因同法)。
   *
   * `captureSnapshot()` 在 `captureMode === 'api'` 或关了 `recordActions` 时会返回
   * `'Action capture is off'`,而**探站就跑在 API 模式下** —— 钻探拿它当主输入的话一步都走不了。
   * 所以这里是它的兄弟:不要求 `capturing`、不写 trace 的 `shot`,只取 a11y 树。
   *
   * 目标解析走 `currentCaptureTarget()`(激活 → 既有录制目标 → 任一可录 tab),
   * 与录制目标同一个口径 —— 钻探自己那只 tab 由 `webContentsForTab()` 单独取,不经这条。
   */
  async pageSnapshotForAgent(tabId?: string): Promise<{ yaml: string; nodeCount: number; walkControls?: string[] } | null> {
    const target = tabId ? this._state.getOperationTabs().find((tab) => tab.id === tabId) : this.currentCaptureTarget()
    if (!this.isCapturableTab(target) || (this.drillTabIds && !this.drillTabIds.has(target.id))) return null
    const result = await target.capture.snapshot({ shot: false })
    if (!result.ok) return null
    this.emitTrace({
      kind: 'snapshot',
      url: target.url || this._state.currentUrl,
      title: result.title,
      nodeCount: result.nodeCount,
      yaml: result.yaml,
      ts: Date.now()
    })
    // **不带 `walkControls`** —— bl 的 walker 不产出它(cowork 的 `snapshot()` 返回类型里有,
    // bl 这份没有)。它在 dep 里本来就是可选字段,cowork 只拿它做漏斗分母的对账,
    // 而那个口径它自己标着"先量三个口径再换源",是临时的。少了它丢的是一个诊断量,不是能力。
    return { yaml: result.yaml, nodeCount: result.nodeCount }
  }

  /**
   * 按 tab id 取它自己的 live webContents —— **不经过"激活"**(drill-001)。
   *
   * 钻探的全部 I/O 必须锚在**它自己那个 tab** 上,而不是"激活 tab 的镜像"。cowork 那侧
   * 一开始就是后者,代价是每个动作前把激活 tab 钉回去(人因此看不了别的 tab),
   * 2026-09-09 的 `conn-009` 才解耦。bl 这次直接落在解耦形态上,不重演那个 bug。
   */
  webContentsForTab(tabId: string): WebContents | null {
    if (!tabId) return null
    const tab = this._state.getOperationTabs().find((item) => item.id === tabId)
    if (!this.isCapturableTab(tab)) return null
    const wc = tab.view?.webContents
    return wc && !wc.isDestroyed() ? wc : null
  }

  /**
   * 把录制目标移到某个 tab —— 按 id,不经过激活(drill-001)。
   *
   * 为什么必须有:录制目标原来只跟着激活走。钻探不激活自己那只 tab 的话,录制目标会留在
   * **人正在看的那个 tab** 上 —— 边钻边摄读的窗口就录成了别人的流量,摄出来的接口文档是错的,
   * 而过程一声不响。这是 cowork 侧被守卫抓出来的那一处,不能在 bl 重犯。
   *
   * 不录制时是空操作 —— `switchCaptureTarget` 自己第一句就检查 `capturing`。
   */
  async retargetCaptureToTab(tabId: string): Promise<void> {
    if (!tabId) return
    const next = this._state.getOperationTabs().find((item) => item.id === tabId)
    if (!next) return
    await this.switchCaptureTarget(next)
  }

  /** 当前录制会话的目录 —— 钻探把它写进 run 文件(`captureSessionDir` dep)。 */
  captureSessionDir(): string | null {
    return this.traceFile ? dirname(this.traceFile) : null
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
    if (!this.isCaptureTab(tabId)) return
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

  async toolStartRecording(modeArg: string, tabId?: string): Promise<string> {
    const mode = normalizeCaptureToolMode(modeArg)
    const state = await this.startCapture(mode ? { mode } : undefined, { startedBy: 'agent', tabId })
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
    this.drillTabIds = null
    this.drillScopeRevision += 1
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
