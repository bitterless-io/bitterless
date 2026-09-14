import { BrowserWindow, WebContentsView, app, shell } from 'electron'
import { xpcMain } from 'electron-xpc/main'
import { MAESTRO_ONLY_PREVIEW_TAB_ID } from '@maestro-shared/compositeTab.identity'
import { join } from 'path'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { inject, injectable } from 'inversify'
import { WindowHelper } from '../window.helper'
import { DebuggerCapture } from '@maestro-main/capture/debuggerCapture'
import {
  CaptureService,
  type CaptureServiceState
} from '@maestro-main/capture/capture.service'
import type { CaptureRecordSource } from '@maestro-main/capture/captureRecordSource'
import { clipText } from '@maestro-main/capture/traceTimeline'
import {
  interceptionRuleSummary,
  type NetworkInterceptionRule
} from '@maestro-main/capture/networkInterception'
import type { PiToolSpec } from '@main/agent/BaseAgent'
import { buildFileTools } from '@main/agent/tools/fileTools'
import { buildArchiveTools } from '@main/agent/tools/archiveTools'
import { buildWebFetchTools } from '@main/agent/tools/webFetchTools'
import { buildWebSearchTools } from '@main/agent/tools/webSearchTools'
import { MaestroAgent } from '@main/agent/MaestroAgent'
import { DelegateAgent } from '@main/agent/DelegateAgent'
import {
  MaestroAgentService,
  type MaestroAgentServiceState
} from '@main/agent/maestroAgent.service'
import {
  broadcastCodexDebug
} from '@main/agent/runtime/agentBroadcast'
import { BookingDemoService } from '@maestro-main/demo/bookingDemo.service'
import { ReplayEngine } from '@maestro-main/drive/replayEngine'
import {
  RequestExecService,
  type RequestExecServiceState
} from '@maestro-main/drive/requestExec.service'
import { getLogPaths } from '@maestro-main/logging/log.setup'
import { CoachSettingsService } from '@maestro-main/settings/coachSettings.service'
import { SkillGeneratorService } from '@maestro-main/skills/skillGenerator.service'
import { SkillRegistryService } from '@maestro-main/skills/skillRegistry.service'
import { taskRegistry } from '@maestro-main/tasks/taskRegistry.service'
import { buildDrillTools } from '@maestro-main/sitemap/drillTools'
import { DrillHostService } from '@maestro-main/sitemap/drillHost.service'
import { DrillRunService } from '@maestro-main/sitemap/drillRun.service'
import { DrillToolsHost } from '@maestro-main/sitemap/drillTools.host'
import { buildUnknownConfirmPayload } from '@maestro-main/drive/confirmPayload'
import {
  SkillService,
  type SkillServiceState
} from '@maestro-main/skills/skill.service'
import { MaestroLlmService, type MaestroLlmServiceState } from '@maestro-main/llm/maestroLlm.service'
import {
  MaestroControlViewService,
  type MaestroControlViewServiceState
} from './maestroControlView.service'
import {
  MaestroWorkbenchViewService,
  type MaestroWorkbenchViewServiceState
} from './maestroWorkbenchView.service'
import {
  MaestroBrowserViewService,
  type MaestroBrowserViewServiceState,
  type OperationTab
} from './maestroBrowserView.service'
import {
  WorkspaceFileService,
  type WorkspaceFileServiceState
} from './workspaceFile.service'
import { iocHelper } from '@maestro-shared/iocHelper/ioc.helper'
import type { LlmStoredTarget } from '@maestro-main/llm/llmModels'
import {
  DEFAULT_COACH_START_URL,
  MAESTRO_FORCE_PINNED_HOME_QUERY,
  MAESTRO_FORCE_PINNED_HOME_QUERY_VALUE,
  MAESTRO_LOCAL_HOME_DISPLAY_URL,
  MAESTRO_HOME_READY_TOKEN_QUERY
} from '@maestro-shared/coach.api'
import type {
  CoachXpcContract,
  ContextExportRequest,
  ContextExportSummary,
  ContextGraphRequest,
  ContextGraphResult,
  SessionIoPathResult,
  AgentConversationContext,
  AgentActivityStep,
  AgentCompactReply,
  AgentCompactRequest,
  AgentFileArtifact,
  AgentMessageRequest,
  AgentReply,
  AgentTurnClaimRequest,
  AgentTurnClaimResult,
  AgentTurnRecoverySnapshot,
  AttachFileResult,
  CaptureExportFormat,
  CaptureOptions,
  BrowserRequestReplayRequest,
  BrowserRequestReplayResult,
  CaptureRecordSnapshot,
  CaptureRecordSyncRequest,
  CaptureRecordSyncResult,
  CoachSettings,
  CaptureState,
  DeleteSkillResult,
  ExportRecordingResult,
  FileStatusResult,
  HostApprovalEvent,
  HostApprovalExportResult,
  HostApprovalHistoryResult,
  HomeRendererReadyParams,
  HomeRendererReadyResult,
  HostToolCatalogResult,
  HostToolPolicyMode,
  HostToolPolicyResult,
  HostToolScope,
  InjectedButtonDomain,
  InjectedButtonRemoveResult,
  IngestRecord,
  LlmConfig,
  LlmEffort,
  LogInfo,
  PackageInfo,
  ReplayResult,
  SkillCreateResult,
  SkillDetail,
  SkillExportResult,
  SkillImportResult,
  SkillSummary,
  SnapshotResult,
  ActiveTabContent,
  TabInfo,
  ViewRect,
  WorkspaceRef,
  WorkspaceRefResult
} from '@maestro-shared/coach.api'
import type { SavedTab } from '@maestro-shared/tabs.api'
import type { CaptureMode, TraceEvent } from '@maestro-shared/trace.types'
import type { SkillRecipe } from '@maestro-main/skills/skillRecipe.types'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import type {
  MaestroOpenBootTrace,
  MaestroOpenStage
} from '@maestro-main/diagnostics/maestroOpenDiagnostics.service'
import {
  fileThumbnail,
  type ThumbnailResult
} from '@maestro-main/files/thumbnail.service'

// Initial geometry used for the very first frame, before the home renderer reports
// the real placeholder rects (see setViewBounds). The 36px tab strip plus the compact
// 42px address row total 78px; renderer measurements remain authoritative thereafter.
const TOOLBAR_H = 78
const SIDEBAR_W = 480

@injectable()
class MaestroWindowController
  extends WindowHelper
  implements
    MaestroLlmServiceState,
    MaestroBrowserViewServiceState,
    MaestroControlViewServiceState,
    MaestroWorkbenchViewServiceState,
    WorkspaceFileServiceState,
    CaptureServiceState,
    SkillServiceState,
    RequestExecServiceState,
    MaestroAgentServiceState
{
  protected preloadFile = 'maestroCoach.js'
  protected rendererPath = 'maestro/home/index.html'
  protected windowOptions = { title: 'Maestro', width: 1360, height: 900 }
  protected showOnReady = false
  // The main app window — base WindowHelper remembers its size/position/display.
  protected windowStateKey = 'maestro' as const

  constructor(
    @inject(Symbol.for(MaestroLlmService.name))
    public readonly llmService: MaestroLlmService,
    @inject(Symbol.for(MaestroBrowserViewService.name))
    public readonly browserView: MaestroBrowserViewService,
    @inject(Symbol.for(MaestroControlViewService.name))
    public readonly controlView: MaestroControlViewService,
    @inject(Symbol.for(MaestroWorkbenchViewService.name))
    public readonly workbenchView: MaestroWorkbenchViewService,
    @inject(Symbol.for(WorkspaceFileService.name))
    public readonly workspaceFile: WorkspaceFileService,
    @inject(Symbol.for(CaptureService.name))
    public readonly captureService: CaptureService,
    @inject(Symbol.for(SkillService.name))
    public readonly skillService: SkillService,
    @inject(Symbol.for(RequestExecService.name))
    public readonly requestExec: RequestExecService,
    @inject(Symbol.for(MaestroAgentService.name))
    public readonly agentService: MaestroAgentService
  ) {
    super()
    this.llmService.setState(this)
    this.browserView.setState(this)
    this.controlView.setState(this)
    this.workbenchView.setState(this)
    this.workspaceFile.setState(this)
    this.captureService.setState(this)
    this.skillService.setState(this)
    this.requestExec.setState(this)
    this.agentService.setState(this)
  }

  operationView: WebContentsView | null = null
  capture: DebuggerCapture | null = null
  replayEngine: ReplayEngine | null = null
  // operationView/capture/replayEngine above always point at the ACTIVE tab.
  opBounds: ViewRect | null = null
  private controlBounds: ViewRect | null = null
  currentUrl = DEFAULT_COACH_START_URL
  private initialReady: Promise<void> = Promise.resolve()
  private backgroundReady: Promise<void> = Promise.resolve()
  private homeRendererReady: Promise<void> = Promise.resolve()
  private resolveHomeRendererReady: (() => void) | null = null
  private homeRendererReadyToken: string | null = null
  private skillRegistry: SkillRegistryService | null = null
  private skillGenerator: SkillGeneratorService | null = null
  private llmApplied = false
  private settings: CoachSettingsService | null = null
  private demo: BookingDemoService | null = null
  // Auth teardown may destroy this controller before the replacement Maestro is created. Keep a
  // versioned, one-shot intent outside all window-scoped reset paths so a failed replacement boot
  // retries on pinned Home instead of reviving a stale startup/last-active browser tab.
  private forcePinnedHomeIntentVersion = 0
  private activeBootForcePinnedHomeIntentVersion = 0
  private openBootDiagnostics: MaestroOpenBootTrace | null = null

  get tabs(): OperationTab[] {
    return this.browserView.tabs
  }

  /**
   * **D3 —— 当前 tab 激活的内容**(表 3)。同步转发,分型逻辑归 `browserView`(逐 kind 的语义只有它知道)。
   *
   * 刻意不走 `getTabs()`:那个是 `async` 签名,塞进同步的提示词拼装要白加一层 `await`。
   */
  describeActiveTabContent(): ActiveTabContent | null {
    return this.browserView.describeActiveContent()
  }

  get activeTabId(): string | null {
    return this.browserView.activeTabId
  }

  get browserInterceptionRules(): NetworkInterceptionRule[] {
    return this.requestExec.browserInterceptionRules
  }

  get capturing(): boolean {
    return this.captureService.capturing
  }

  get captureTargetTabId(): string | null {
    return this.captureService.captureTargetTabId
  }

  get lastAgentRun(): { skill?: SkillSummary; skills?: SkillSummary[]; replay?: ReplayResult } {
    return this.agentService.lastAgentRun
  }

  set lastAgentRun(value: { skill?: SkillSummary; skills?: SkillSummary[]; replay?: ReplayResult }) {
    this.agentService.lastAgentRun = value
  }

  get tabsOpenedThisTurn(): TabInfo[] {
    return this.agentService.tabsOpenedThisTurn
  }

  set tabsOpenedThisTurn(value: TabInfo[]) {
    this.agentService.tabsOpenedThisTurn = value
  }

  getOperationTabs(): OperationTab[] {
    return this.tabs
  }

  getActiveOperationTabId(): string | null {
    return this.activeTabId
  }

  private resetWindowScopedViews(): void {
    this.captureService.reset()
    this.browserView.reset()
    this.controlView.reset()
    this.workbenchView.reset()
    this.operationView = null
    this.capture = null
    this.replayEngine = null
    this.opBounds = null
    this.controlBounds = null
    this.tabsOpenedThisTurn = []
  }

  private createHomeRendererReadyFence(forcePinnedHome: boolean): Promise<void> {
    const token = randomUUID()
    this.homeRendererReadyToken = token
    this.rendererQuery = {
      [MAESTRO_HOME_READY_TOKEN_QUERY]: token,
      ...(forcePinnedHome
        ? { [MAESTRO_FORCE_PINNED_HOME_QUERY]: MAESTRO_FORCE_PINNED_HOME_QUERY_VALUE }
        : {})
    }
    this.homeRendererReady = new Promise<void>((resolve) => {
      this.resolveHomeRendererReady = resolve
    })
    return this.homeRendererReady
  }

  private invalidateHomeRendererReadyFence(): void {
    this.homeRendererReadyToken = null
    this.resolveHomeRendererReady = null
    this.rendererQuery = undefined
    this.homeRendererReady = Promise.resolve()
  }

  markHomeRendererReady(params: HomeRendererReadyParams): HomeRendererReadyResult {
    const window = this.browserWindow
    if (
      !window ||
      window.isDestroyed() ||
      !this.homeRendererReadyToken ||
      params.token !== this.homeRendererReadyToken
    ) {
      return { accepted: false }
    }
    this.resolveHomeRendererReady?.()
    this.resolveHomeRendererReady = null
    return { accepted: true }
  }

  async prepareForAuthShutdown(): Promise<void> {
    this.forcePinnedHomeIntentVersion += 1
    const pinnedHome = this.tabs.find((tab) => tab.kind === 'home' && tab.pinned)
    try {
      if (pinnedHome && this.activeTabId !== pinnedHome.id) {
        await this.browserView.activateTab({ id: pinnedHome.id })
      }
    } catch (err) {
      this.emit({ kind: 'error', msg: 'auth home activation: ' + (err as Error).message, ts: Date.now() })
    }
    // Workbench overlays the operation area. Hide it only after Home is active so teardown never
    // reveals the previous browser tab between the Account action and window destruction.
    try {
      this.workbenchView.closeTab()
    } catch (err) {
      this.emit({ kind: 'error', msg: 'auth workbench hide: ' + (err as Error).message, ts: Date.now() })
    }
  }

  markBootSuccessful(): void {
    const intentVersion = this.activeBootForcePinnedHomeIntentVersion
    if (intentVersion > 0 && this.forcePinnedHomeIntentVersion === intentVersion) {
      this.forcePinnedHomeIntentVersion = 0
    }
    this.activeBootForcePinnedHomeIntentVersion = 0
  }

  setOpenBootDiagnostics(diagnostics: MaestroOpenBootTrace): void {
    this.openBootDiagnostics = diagnostics
  }

  clearOpenBootDiagnostics(diagnostics: MaestroOpenBootTrace): void {
    if (this.openBootDiagnostics === diagnostics) this.openBootDiagnostics = null
  }

  private traceOpenStage(
    promise: Promise<void>,
    diagnostics: MaestroOpenBootTrace | null,
    stage: MaestroOpenStage,
    startedAt: number | undefined
  ): Promise<void> {
    if (!diagnostics || startedAt === undefined) return promise
    return promise.then(() => {
      diagnostics.completeStage(stage, startedAt)
    })
  }

  create(): BrowserWindow {
    const diagnostics = this.openBootDiagnostics
    const forcePinnedHomeIntentVersion = this.forcePinnedHomeIntentVersion
    const forcePinnedHome = forcePinnedHomeIntentVersion > 0
    this.activeBootForcePinnedHomeIntentVersion = forcePinnedHomeIntentVersion
    this.agentService.activate()
    this.ensureServices()
    void this.agentService.loadHostToolPolicies()
    void this.agentService.loadHostApprovalHistory()
    this.currentUrl = MAESTRO_LOCAL_HOME_DISPLAY_URL

    this.resetWindowScopedViews()
    const homeMountedStartedAt = diagnostics?.mark()
    const homeMountedReady = this.createHomeRendererReadyFence(forcePinnedHome)
    const shellStartedAt = diagnostics?.mark()
    const win = super.create()
    const shellReady = this.traceOpenStage(
      this.rendererReady,
      diagnostics,
      'shell',
      shellStartedAt
    )
    const mountedReady = this.traceOpenStage(
      homeMountedReady,
      diagnostics,
      'home-mount',
      homeMountedStartedAt
    )

    // First tab = bundled Bitterless Home (leftmost, non-closable, fixed title/favicon). It owns a
    // dedicated XPC-only preload and never participates in debugger/capture/replay.
    const operationView = this.browserView.createPinnedHomeTab()
    const homeReady = Promise.all([shellReady, mountedReady])
      .then(() => undefined)
      .catch((err) => {
        this.emit({ kind: 'error', msg: 'home load: ' + (err as Error).message, ts: Date.now() })
        throw err
      })
    const controlStartedAt = diagnostics?.mark()
    const controlReady = this.traceOpenStage(
      this.controlView.create(),
      diagnostics,
      'control',
      controlStartedAt
    )

    this.layout()
    win.on('resize', () => this.layout())

    const pinnedHomeStartedAt = diagnostics?.mark()
    const operationReady = this.traceOpenStage(
      this.browserView.loadPinnedHomeTab(),
      diagnostics,
      'home-tab',
      pinnedHomeStartedAt
    )
      .catch((err) => {
        this.emit({ kind: 'error', msg: 'bundled Home load: ' + (err as Error).message, ts: Date.now() })
        throw err
      })
      .finally(() => {
        if (this.operationView === operationView && !operationView.webContents.isDestroyed()) {
          operationView.setVisible(true)
        }
      })
      .then(() => {
        const startupTabStartedAt = diagnostics?.mark()
        return this.traceOpenStage(
          this.browserView.openStartupTabIfNeeded({ skipForThisBoot: forcePinnedHome }),
          diagnostics,
          'startup-tab',
          startupTabStartedAt
        )
      })
    const workbenchReady = homeReady.then(() => {
      const workbenchStartedAt = diagnostics?.mark()
      return this.traceOpenStage(
        this.workbenchView.create(),
        diagnostics,
        'workbench',
        workbenchStartedAt
      )
    })
    const spareReady = homeReady.then(() => this.browserView.prewarmSpare())

    // The BrowserWindow Shell plus its Home host is the first-visible contract. Pinned Home,
    // Control, hidden Workbench, startup navigation, and spare-view prewarming are useful
    // background work, but none may hold the native window hidden or fail the usable primary.
    this.initialReady = homeReady
    const allReadyStartedAt = diagnostics?.mark()
    this.backgroundReady = this.traceOpenStage(
      Promise.allSettled([controlReady, workbenchReady, operationReady, spareReady])
        .then((results) => {
          if (results.some((result) => result.status === 'rejected')) {
            throw new Error('[maestro] background window startup failed')
          }
        }),
      diagnostics,
      'all-ready',
      allReadyStartedAt
    )
    // The Open handler observes the same promise after first-visible. Attach a rejection handler
    // now so a very fast optional failure cannot become an unhandled rejection before show().
    void this.backgroundReady.catch(() => undefined)
    return win
  }

  async whenReady(): Promise<void> {
    await this.initialReady
  }

  async whenBackgroundReady(): Promise<void> {
    await this.backgroundReady
  }

  async getSettings(): Promise<CoachSettings> {
    return this.ensureServices().settings.read()
  }

  async saveSettings(params: Partial<CoachSettings>): Promise<CoachSettings> {
    const next = this.ensureServices().settings.save(params)
    return next
  }

  hasCustomStartUrl(): boolean {
    return this.ensureServices().settings.hasCustomStartUrl()
  }

  async getWorkbenchTab(): ReturnType<CoachXpcContract['getWorkbenchTab']> {
    return this.workbenchView.getState()
  }

  setOperationContentCovered(covered: boolean): void {
    this.browserView.setContentCovered(covered)
  }

  async openWorkbenchTab(): ReturnType<CoachXpcContract['openWorkbenchTab']> {
    return this.workbenchView.openTab()
  }

  async backgroundWorkbenchTab(): ReturnType<CoachXpcContract['backgroundWorkbenchTab']> {
    return this.workbenchView.backgroundTab()
  }

  async closeWorkbenchTab(): ReturnType<CoachXpcContract['closeWorkbenchTab']> {
    return this.workbenchView.closeTab()
  }

  async navigate(params: { url: string }): Promise<void> {
    await this.browserView.navigate(params)
  }

  async reload(): Promise<void> {
    await this.browserView.reload()
  }

  async goBack(): Promise<void> {
    await this.browserView.goBack()
  }

  async goForward(): Promise<void> {
    await this.browserView.goForward()
  }

  async setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]> {
    return await this.browserView.setTabDebugger(params)
  }

  async openDemo(): Promise<{ url: string }> {
    const url = await this.ensureServices().demo.start()
    // Hand off to the home renderer (it owns the tab strip): it opens a NEW tab via the same
    // instant idle-pool path as the + button, then navigates it to the demo URL. Routing the
    // new tab through the renderer keeps demo on the proven new-tab flow.
    xpcMain.broadcast('coach/open-tab', url)
    return { url }
  }

  // App identity for Workbench ▸ About. Reads the REAL bundled package.json — mirrors
  // The host package helper returns the asar root when packaged and the
  // project root in dev, and electron-builder always ships package.json (with our custom
  // version_code + productName) into the dmg, so the same read works in both.
  async getPackageInfo(): Promise<PackageInfo> {
    let raw: Record<string, unknown> = {}
    try {
      raw = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as Record<string, unknown>
    } catch (err) {
      this.emit({ kind: 'error', msg: 'read package.json: ' + (err as Error).message, ts: Date.now() })
    }
    const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
    return {
      name: str(raw.name),
      productName: str(raw.productName, str(raw.name)),
      version: str(raw.version, app.getVersion()),
      versionCode: String(raw.version_code ?? raw.versionCode ?? '0'),
      description: str(raw.description)
    }
  }

  // Workbench ▸ Log uses the host-approved Electron log directory. Maestro does not install
  // a second logger or replace the host's console/transports.
  async getLogInfo(): Promise<LogInfo> {
    return getLogPaths()
  }

  // Reveal the log directory in Finder/Explorer — same shell dir-open shape as openSkillDirectory.
  async openLogDirectory(): Promise<{ ok: boolean; path?: string; error?: string }> {
    const dir = getLogPaths().dir
    const error = await shell.openPath(dir)
    return error ? { ok: false, path: dir, error } : { ok: true, path: dir }
  }

  async getHostToolCatalog(params?: { scope?: HostToolScope; category?: string; query?: string }): Promise<HostToolCatalogResult> {
    return await this.agentService.getHostToolCatalog(params)
  }

  async setHostToolPolicy(params: { toolName: string; mode: HostToolPolicyMode }): Promise<HostToolPolicyResult> {
    return await this.agentService.setHostToolPolicy(params)
  }

  async getHostApprovalEvents(): Promise<HostApprovalHistoryResult> {
    return await this.agentService.getHostApprovalEvents()
  }

  async exportHostApprovalEvents(): Promise<HostApprovalExportResult> {
    return await this.agentService.exportHostApprovalEvents()
  }

  async clearHostApprovalEvents(): Promise<HostApprovalHistoryResult> {
    return await this.agentService.clearHostApprovalEvents()
  }

  async listInjectedButtons(): Promise<InjectedButtonDomain[]> {
    return await this.browserView.listInjectedButtons()
  }

  async removeInjectedButtonDomain(params: { domain: string }): Promise<InjectedButtonRemoveResult> {
    return await this.browserView.removeInjectedButtonDomain(params)
  }

  async getCaptureOptions(): Promise<CaptureOptions> {
    return await this.captureService.getCaptureOptions()
  }

  async setCaptureOptions(params: Partial<CaptureOptions>): Promise<CaptureOptions> {
    return await this.captureService.setCaptureOptions(params)
  }

  getCaptureState(): CaptureState {
    return this.captureService.getCaptureState()
  }

  async startCapture(params?: { mode?: CaptureMode } & Partial<CaptureOptions>): Promise<CaptureState> {
    return await this.captureService.startCapture(params)
  }

  async stopCapture(): Promise<CaptureState> {
    return await this.captureService.stopCapture()
  }

  private currentBrowserTarget(): OperationTab | undefined {
    return this.captureService.currentCaptureTarget()
  }

  async switchCaptureTarget(next: OperationTab): Promise<void> {
    await this.captureService.switchCaptureTarget(next)
  }

  // Capture a simplified DOM "element" tree of the live page as a YAML structure
  // and record it into the current trace (UI-mode recordings only).
  async captureSnapshot(): Promise<SnapshotResult> {
    return await this.captureService.captureSnapshot()
  }

  async syncCaptureRecords(params: CaptureRecordSyncRequest): Promise<CaptureRecordSyncResult> {
    return await this.captureService.syncCaptureRecords(params)
  }

  async getCaptureRecords(): Promise<CaptureRecordSnapshot> {
    return await this.captureService.getCaptureRecords()
  }

  async clearCaptureRecordEdits(): Promise<{ ok: boolean }> {
    return await this.captureService.clearCaptureRecordEdits()
  }

  async exportRecording(params: { startedAt: number; records: IngestRecord[]; format?: CaptureExportFormat }): Promise<ExportRecordingResult> {
    return await this.captureService.exportRecording(params)
  }

  async replayBrowserRequest(params: BrowserRequestReplayRequest): Promise<BrowserRequestReplayResult> {
    return await this.requestExec.replayBrowserRequest(params)
  }

  private async toolStartRecording(modeArg: string): Promise<string> {
    return await this.captureService.toolStartRecording(modeArg)
  }

  private async toolStopRecording(): Promise<string> {
    return await this.captureService.toolStopRecording()
  }

  async ensurePersistedCaptureRecordsLoaded(): Promise<void> {
    await this.captureService.ensurePersistedCaptureRecordsLoaded()
  }

  captureRecordsForAgent(): CaptureRecordSource {
    return this.captureService.captureRecordsForAgent()
  }

  async listSkills(): Promise<SkillSummary[]> {
    return await this.skillService.listSkills()
  }

  async deleteSkill(params: { skillId: string }): Promise<DeleteSkillResult> {
    return await this.skillService.deleteSkill(params)
  }

  async summarizeSkill(params: { workflow?: string; records: IngestRecord[] }): Promise<SkillCreateResult> {
    return await this.skillService.summarizeSkill(params)
  }

  async ingestRecordingToSkills(): Promise<string> {
    return await this.skillService.ingestRecordingToSkills()
  }

  private toolCaptureTimeline(args: Record<string, unknown>): string {
    return this.captureService.toolCaptureTimeline(args)
  }

  private toolCaptureSearch(args: Record<string, unknown>): string {
    return this.captureService.toolCaptureSearch(args)
  }

  private toolCaptureEventDetail(args: Record<string, unknown>): string {
    return this.captureService.toolCaptureEventDetail(args)
  }

  async getSkillDetail(params: { skillId: string }): Promise<SkillDetail | null> {
    return await this.skillService.getSkillDetail(params)
  }

  async openSkillDirectory(params: { skillId: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await this.skillService.openSkillDirectory(params)
  }

  async exportSkillPackage(params: { skillId: string }): Promise<SkillExportResult> {
    return await this.skillService.exportSkillPackage(params)
  }

  async importSkillPackage(): Promise<SkillImportResult> {
    return await this.skillService.importSkillPackage()
  }

  async openDomainDirectory(params: { domain: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await this.skillService.openDomainDirectory(params)
  }

  // Register attached files (by ABSOLUTE PATH) into the session's read_file allowlist.
  // The files stay where they are on disk — we stat/validate and remember the paths, so
  // NO bytes ever cross IPC and read_file can't reach anything the user didn't attach.
  async attachFiles(params: { sessionId?: string; paths: string[] }): Promise<AttachFileResult[]> {
    return await this.agentService.attachFiles(params)
  }

  async attachClipboardImage(params?: { sessionId?: string }): Promise<AttachFileResult> {
    return await this.agentService.attachClipboardImage(params)
  }

  async chooseWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    return await this.workspaceFile.chooseWorkspaceDirectory(params)
  }

  async setWorkspaceDirectory(params: { sessionId?: string; path?: string }): Promise<WorkspaceRefResult> {
    return await this.workspaceFile.setWorkspaceDirectory(params)
  }

  async getWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    return await this.workspaceFile.getWorkspaceDirectory(params)
  }

  async getFileStatuses(params: { paths: string[] }): Promise<FileStatusResult[]> {
    return await this.workspaceFile.getFileStatuses(params)
  }

  async openFile(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await this.workspaceFile.openFile(params)
  }

  async showFileInFolder(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await this.workspaceFile.showFileInFolder(params)
  }

  async fileThumbnail(params: { path: string }): Promise<ThumbnailResult> {
    return await fileThumbnail(params.path)
  }

  syncWorkspaceFromContext(sessionKey: string, workspace?: WorkspaceRef): void {
    this.workspaceFile.syncWorkspaceFromContext(sessionKey, workspace)
  }

  recordAgentArtifact(file: AgentFileArtifact): void {
    this.agentService.recordAgentArtifact(file)
  }

  private async toolReadFile(
    sessionKey: string,
    pathArg: string,
    options: { offset?: number; limit?: number }
  ): Promise<string> {
    return await this.workspaceFile.toolReadFile(sessionKey, pathArg, options)
  }

  private async toolListWorkspaceFiles(
    sessionKey: string,
    pathArg?: string,
    maxEntriesArg?: number
  ): Promise<string> {
    return await this.workspaceFile.toolListWorkspaceFiles(sessionKey, pathArg, maxEntriesArg)
  }

  private async toolSearchWorkspaceFiles(
    sessionKey: string,
    queryArg: string,
    pathArg?: string,
    maxResultsArg?: number
  ): Promise<string> {
    return await this.workspaceFile.toolSearchWorkspaceFiles(
      sessionKey,
      queryArg,
      pathArg,
      maxResultsArg
    )
  }

  private toolWriteWorkspaceFile(sessionKey: string, pathArg: string, contentArg: string): string {
    return this.workspaceFile.toolWriteWorkspaceFile(sessionKey, pathArg, contentArg)
  }

  private async toolCreateArtifact(sessionKey: string, artifactJson: string): Promise<string> {
    return await this.workspaceFile.toolCreateArtifact(sessionKey, artifactJson)
  }

  private async toolWorkspaceContext(sessionKey: string, actionArg: string): Promise<string> {
    return await this.workspaceFile.toolWorkspaceContext(sessionKey, actionArg)
  }

  async trainSkill(params: { skillId: string; guidance: string }): Promise<SkillCreateResult> {
    return await this.skillService.trainSkill(params)
  }

  async replaySkill(params: { skillId: string; variables: Record<string, string> }): Promise<ReplayResult> {
    return await this.skillService.replaySkill(params)
  }

  claimAgentTurn(params: AgentTurnClaimRequest): AgentTurnClaimResult {
    return this.agentService.claimAgentTurn(params)
  }

  getActiveAgentTurn(): AgentTurnRecoverySnapshot {
    return this.agentService.getActiveAgentTurn()
  }

  ackAgentTurnFinished(params: { sessionId: string; turnId: string }): void {
    this.agentService.ackAgentTurnFinished(params)
  }

  async sendAgentMessage(params: AgentMessageRequest): Promise<AgentReply> {
    const reply = await this.agentService.sendAgentMessage(params)
    /**
     * **钻探的续跑挂在这里。** 钻探开着就用合成 turn 一轮一轮推下去,没开就原样返回 ——
     * 整段逻辑在 `DrillToolsHost.continueAfterTurn`(与 cowork 同一位置、同一形状)。
     *
     * 为什么必须在**这一层**而不是渲染端:一个普通回合在模型停止调工具的那一刻就结束了,
     * 而"继续钻探"是**宿主驱动**的 —— 渲染端只知道"这一轮回来了",不知道站点还剩多少地点没开。
     * 少了这一挂,agent 讲一句"已进入 X"就停在那里(Ral 2026-09-10 报的正是这个形状)。
     *
     * 只对**根**消息续跑:steering 是并进一个还在跑的回合,续跑的前提("上一个回合已结束")不成立
     * —— `continueAfterTurn` 自己第一句也会用 `reply.mergedIntoTurn` 再挡一次。
     */
    if (params.intent !== 'root') return reply
    return await this.drillTools().continueAfterTurn(
      { message: params.message, sessionId: params.sessionId, context: params.context },
      reply
    )
  }

  async copyNextTurnContext(params: ContextExportRequest): Promise<ContextExportSummary> {
    return await this.agentService.copyNextTurnContext(params)
  }

  async readContextGraph(params: ContextGraphRequest): Promise<ContextGraphResult> {
    return await this.agentService.readContextGraph(params)
  }

  async copySessionIoPath(params: { sessionId: string }): Promise<SessionIoPathResult> {
    return await this.agentService.copySessionIoPath(params)
  }

  async compactConversation(params: AgentCompactRequest): Promise<AgentCompactReply> {
    return await this.agentService.compactConversation(params)
  }

  // Delegate chat: the agent acts AS the user toward the user's CUSTOMER (the message sender).
  // Same tools/flow as Maestro (handleAgentTurn) but its OWN session + customer-facing persona.
  async delegateMessage(params: { message: string; sessionId?: string }): Promise<AgentReply> {
    return await this.agentService.delegateMessage(params)
  }

  async resetDelegateConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    return await this.agentService.resetDelegateConversation(params)
  }

  // Stop a chat channel's in-flight turn (the Stop button): aborts the live pi session so the
  // pending turn resolves with any partial output, then BaseAgent drops that session so aborted
  // output is not carried into later model context. No-op when idle / not yet created.
  async abortAgent(params: { sessionId: string; turnId: string }): Promise<void> {
    await this.agentService.abortAgent(params)
  }

  async abortDelegate(params?: { sessionId?: string }): Promise<void> {
    await this.agentService.abortDelegate(params)
  }

  agentSessionKey(sessionId?: string): string {
    return this.agentService.agentSessionKey(sessionId)
  }

  // Apply the LLM backend to every pi instance (each drops its session so the
  // next turn rebuilds against the new provider/model/effort).
  applyLlmTarget(provider: string, model: string, effort: LlmEffort = 'low'): void {
    this.agentService.applyLlmTarget(provider, model, effort)
  }


  getLlmRuntimeTarget(): LlmStoredTarget {
    return this.agentService.getLlmRuntimeTarget()
  }

  hasActiveAgentTurn(): boolean {
    return this.agentService.hasActiveAgentTurn()
  }

  resetLlmTurnState(): void {
    this.agentService.resetTurnState()
  }

  resetLlmAgentSessions(): void {
    this.agentService.resetAgentSessions()
  }

  readMaestroSettings(): CoachSettings {
    return this.ensureServices().settings.read()
  }

  saveMaestroSettings(patch: Partial<CoachSettings>): CoachSettings {
    return this.ensureServices().settings.save(patch)
  }

  emitTrace(e: TraceEvent): void {
    this.emit(e)
  }

  async getLlmConfig(): Promise<LlmConfig> {
    return await this.llmService.getLlmConfig()
  }

  async setLlmConfig(params: { provider: string; model: string; effort?: LlmEffort }): Promise<LlmConfig> {
    return await this.llmService.setLlmConfig(params)
  }

  async setLlmCompression(params: { provider: string; model: string; compressionRemainingPercent: number }): Promise<LlmConfig> {
    return await this.llmService.setLlmCompression(params)
  }

  async loginLlm(params: { provider?: string; method?: string }): Promise<LlmConfig> {
    return await this.llmService.loginLlm(params)
  }

  async loginCodex(params: { method?: string }): Promise<LlmConfig> {
    return await this.llmService.loginCodex(params)
  }

  async logoutLlm(params?: { provider?: string }): Promise<LlmConfig> {
    return await this.llmService.logoutLlm(params)
  }

  async logoutCodex(): Promise<LlmConfig> {
    return await this.llmService.logoutCodex()
  }

  buildCaptureAnalysisTools(): PiToolSpec[] {
    return this.captureService.buildCaptureAnalysisTools()
  }

  // The runtime agent's tools. The tool LIST is static (so the session never goes
  // stale); each executor looks the recipe up fresh per call, so skills ingested
  // mid-session are immediately usable.
  /**
   * 钻探的三件套 —— 惰性建、只建一次。
   *
   * `DrillRunService`(谁在钻/哪一次/能不能开) · `DrillHostService`(17 个 dep 的接法) ·
   * `DrillToolsHost`(三个工具的执行体 + 续跑循环)。分成三个而不是一个大类,是因为它们的
   * 变更理由不同:状态机跟着不变量走、适配器跟着宿主 API 走、执行体跟着工具契约走。
   */
  private drillTrio: { run: DrillRunService; host: DrillHostService; tools: DrillToolsHost } | null = null

  private drillTools(): DrillToolsHost {
    if (this.drillTrio) return this.drillTrio.tools
    const capture = this.captureService
    const host = new DrillHostService({
      currentUrl: () => this.currentUrl,
      getOperationTabs: () => this.getOperationTabs().map((tab) => ({ id: tab.id, url: tab.url })),
      getActiveOperationTabId: () => this.getActiveOperationTabId(),
      webContentsForTab: (tabId) => capture.webContentsForTab(tabId),
      retargetCaptureToTab: (tabId) => capture.retargetCaptureToTab(tabId),
      pageSnapshotForAgent: () => capture.pageSnapshotForAgent(),
      captureSessionDir: () => capture.captureSessionDir(),
      recordingStartedAt: async () => (await capture.getCaptureRecords().catch(() => null))?.startedAt,
      activateTab: async (tabId) => void (await this.activateTab({ id: tabId }).catch(() => undefined)),
      closeTab: async (tabId) => void (await this.closeTab({ id: tabId }).catch(() => undefined)),
      // 边钻边摄接 bl 自己的技能摄取(它没有 apidoc 那条路,见 drill-001 #2.5)。
      ingestWindow: async () => ({ text: await this.ingestRecordingToSkills() }),
      broadcastActivity: (phase, label, ok) => this.broadcastActivity(phase, label, ok),
      debugCodex: (event) => this.debugCodex(event),
      noteDuringDrill: (text) =>
        xpcMain.broadcast('coach/drill-note', { text, sessionId: this.drillTrio?.run.ownerSessionId, ts: Date.now() })
    })
    const run = new DrillRunService({
      debugCodex: (event) => this.debugCodex(event),
      setAutoDismissFileDialogs: (on) => capture.setAutoDismissFileDialogs(on),
      stopCaptureIfAgentStarted: (reason) => capture.stopCaptureIfAgentStarted(reason),
      exploreSession: () => host.exploreSessionOrNull()
    })
    const tools = new DrillToolsHost(
      {
        currentUrl: () => this.currentUrl,
        /**
         * bl 的 `OperationTab` **没有 `miniappId`** —— 它没有 cowork 那套 mini-app tab。
         * 所以这道拒只按 `kind` 判:bl 自己的可录判据本来就是 `kind === 'browser'`,
         * 非 browser 的面(onlypreview 之类的复合 tab)同样不是可探索的站点。
         */
        activeTabKind: () => {
          const active = this.getOperationTabs().find((tab) => tab.id === this.getActiveOperationTabId())
          return active ? { kind: active.kind === 'browser' ? 'browser' : 'miniapp' } : null
        },
        setAutoDismissFileDialogs: (on) => capture.setAutoDismissFileDialogs(on),
        announceCaptureState: () => capture.announceCaptureState(),
        debugCodex: (event) => this.debugCodex(event),
        /**
         * 合成一条 turn 发回给 agent —— 续跑循环靠它。
         *
         * **bl 与 cowork 在这里是架构差异**:cowork 的 `sendAgentMessage({message, sessionId?})`
         * 没有回合概念;bl 后来加了回合认领闸,`sendAgentMessage` 要求 `turnId`,
         * 而 `activeTurnFor()` 找不到就返回 `turn-not-active`。所以这里必须**先认领再发**,
         * 与渲染端 `turn.service.send()` 做的是同一件事。
         *
         * 认领不到(别处正忙)就把它当一次失败返回 —— 续跑循环读 `!reply.ok` 会停,
         * 那正确:此刻不该硬塞一轮进去。
         */
        sendAgentMessage: async (params) => {
          const sessionId = params.sessionId || ''
          if (!sessionId) return { ok: false, text: 'no session', ts: Date.now(), error: 'no-session' }
          const turnId = `drill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          const claim = this.claimAgentTurn({
            sessionId,
            turnId,
            rootText: params.message,
            startedAt: Date.now()
          })
          if (!claim.ok) {
            return { ok: false, text: 'turn busy', ts: Date.now(), error: claim.reason || 'busy' }
          }
          return await this.agentService.sendAgentMessage({
            sessionId,
            turnId,
            intent: 'root',
            message: params.message
          })
        },
        persistAgentRun: async () => ({ ok: true })
      },
      host,
      run
    )
    this.drillTrio = { run, host, tools }
    return tools
  }

  buildPiTools(opts: { ingest?: boolean; sessionKey?: string } = {}): PiToolSpec[] {
    const sessionKey = opts.sessionKey || 'default'
    return this.agentService.wrapHostTools('cowork', [
      this.agentService.buildHostToolCatalogTool('cowork'),
      ...buildFileTools(this.workspaceFile, sessionKey),
      ...buildArchiveTools(this.workspaceFile, sessionKey),
      // 联网三级(见 docs/features/agent-web-tools.md):web_search 找 URL(走 bitterless-private
      // core,凭登录态)→ web_fetch 免费读正文 → deep_fetch 开一个**受控 tab**让 JavaScript
      // 真的渲染再读,所以客户端渲染的站点(SPA / 需要登录的页面)只有它读得到。
      ...buildWebSearchTools(),
      ...buildWebFetchTools({ open: (url) => this.browserView.openControlledBlankTab(url) }),
      /**
       * 钻探三件（`drill-001` 收尾）。**这是「钻探能不能用」的最后一根线** ——
       * 在此之前 agent 收到「开始钻探」只能用通用工具即兴走两步就停
       * （Ral 2026-09-10 报的那个形状；日志里 `explore_session` 是 0 命中）。
       */
      ...buildDrillTools(this.drillTools(), sessionKey),
      {
        name: 'inject_button',
        description:
          'Configure and inject the floating Micromeet skill button into the ACTIVE customer page. ' +
          'Use when the user asks to add/inject a button, shortcut, or floating launcher on the current website. ' +
          'The host stores rows in SQLite inject_btns for the active domain and injects a blue draggable "micromeet" button. ' +
          'skills_json must be a JSON array of {"skillTitle":"...","skillDescription":"..."} rows. ' +
          'Clicking a row later sends a Maestro message with that title/description so the normal agent loop can execute it.',
        params: [
          { name: 'skills_json', required: true, description: 'JSON array of skill trigger rows: [{"skillTitle":"Sync latest 1000 MCU records","skillDescription":"..."}].' },
          { name: 'domain', required: false, description: 'Optional hostname or URL. Defaults to the active page hostname.' }
        ],
        execute: async (args) => this.toolInjectButton(String(args.skills_json ?? ''), args.domain ? String(args.domain) : '')
      },
      {
        name: 'remove_injected_button',
        description:
          'Remove the floating Micromeet skill button for a website. ' +
          'Use when the user asks to remove/cancel/uninject/disable the micromeet button. ' +
          'It deletes stored inject_btns rows for the target domain and removes the injected DOM button from currently open same-domain tabs. ' +
          'It does not clear browser cookies, login state, or customer data. Domain is optional and defaults to the active page hostname.',
        params: [
          { name: 'domain', required: false, description: 'Optional hostname or URL. Defaults to the active page hostname.' }
        ],
        execute: async (args) => this.toolRemoveInjectedButton(args.domain ? String(args.domain) : '')
      },
      {
        name: 'get_skill_contract',
        description:
          "Load a skill's contract: required inputs, field_rules, the recorded UI flow (ui_flow — drive via page_snapshot + ui_act), and the recorded api (option_reads + write_templates + a value-free auth hint). PREFER the api path when a write_template exists (reuses the page's live session); otherwise drive the UI. Call this before executing a skill.",
        params: [{ name: 'skill_id', required: true, description: 'Skill id from the catalog in the prompt.' }],
        execute: async (args) => this.toolSkillContract(String(args.skill_id ?? ''))
      },
      {
        name: 'browser_exec',
        description:
          'Run JSON commands IN the embedded page (same origin, cookies incl. httpOnly reused automatically). ' +
          'commands_json is an array, executed in order; give each command an optional stable `id` and each result echoes it back. Inspect a response, then decide the next call in the ReAct loop. Commands:\n' +
          '- {"command":"fetch","id":"create_booking","url":"/api/...","method":"POST","query":{},"body":{...},"auth":[{"header":"Authorization","candidate_keys":["access_token"],"prefix":"Bearer "}]} → calls an API; the JSON response is returned in `data`. Cookies ride along automatically, and the domain auth profile plus any value-free auth hints resolve token headers LIVE from the page. Direct Authorization/Cookie/token-like values in `headers` are ignored; use `auth`/`header_policy` instead. Use recorded option/read endpoints to ground real ids/codes before a write.\n' +
          '- {"command":"parallel","commands":[...]} → run read-only fetch/read_context commands concurrently for independent lookup/list endpoints. Mutating fetches must stay sequential.\n' +
          '- {"command":"read_context","keys":["token"]} → value-free storage/cookie/meta summary for debugging auth only; token values are not returned.',
        params: [{ name: 'commands_json', required: true, description: 'JSON array of browser commands to run in order.' }],
        execute: async (args) => this.toolBrowserExec(String(args.commands_json ?? ''))
      },
      {
        name: 'browser_intercept',
        description:
          'Temporarily block, mock, or rewrite matching in-flight browser requests/responses through CDP Fetch. Use only for explicit debugging/testing on the live page. ' +
          'Commands: {"command":"list"}, {"command":"clear"}, {"command":"remove","id":"..."}, or ' +
          '{"command":"add","action":"block|mock_response|rewrite_request|rewrite_response","url_contains":"/api/...","method":"GET","once":true,...}. ' +
          'Rules are in-memory, default once=true, and add commands require operator approval.',
        params: [{ name: 'commands_json', required: true, description: 'JSON object or array of interception commands.' }],
        execute: async (args) => this.toolBrowserIntercept(String(args.commands_json ?? ''))
      },
      {
        name: 'run_skill_script',
        description:
          "Execute a skill's automation script against the LIVE page (Playwright-style). The script uses " +
          'page.click/fill/select/check/submit/waitFor(sel)/read(sel)/exists(sel) — clicks are REAL trusted ' +
          'CDP clicks — and api.fetch({method,path,body,query}) — an in-page authenticated fetch that reuses the ' +
          "live login (cookies + token resolved live). Pass the skill's input slots in variables_json (the {{var}}s). " +
          'Use this when get_skill_contract shows the skill has a script; it adapts to live page data and merges multi-step UI + API in one run.',
        params: [
          { name: 'skill_id', required: true, description: 'Skill id from the catalog.' },
          { name: 'variables_json', required: true, description: 'JSON object of input values keyed by input name (the {{var}} slots).' }
        ],
        execute: async (args) => this.toolRunSkillScript(String(args.skill_id ?? ''), String(args.variables_json ?? ''))
      },
      {
        name: 'replay_skill_ui',
        description:
          'One-shot replay of ALL recorded UI steps at once, with NO observation between them. DISCOURAGED — a skill is a workflow guide, not a blind script. Prefer the guided page_snapshot + ui_act loop, which observes the live page between steps and adapts. Use this only for a trivial, known-stable single-screen flow. variables_json is a JSON object keyed by input name, e.g. {"patient_name":"..."}.',
        params: [
          { name: 'skill_id', required: true, description: 'Skill id from the catalog.' },
          { name: 'variables_json', required: true, description: 'JSON object of input values keyed by input name.' }
        ],
        execute: async (args) => this.toolReplayUi(String(args.skill_id ?? ''), String(args.variables_json ?? ''))
      },
      {
        name: 'page_snapshot',
        description:
          'OBSERVE a page as a Playwright-style accessibility YAML tree: each element is "- role \\"name\\" [props] [ref=eN]" ' +
          '(props like [level=1], [checked], [selected], [disabled], [value="…"]). Native <select> controls render option children, including [selected] and [value="…"] when label and value differ. The [ref=eN] is the handle you pass to ui_act. ' +
          'Call this to SEE the page before choosing a UI action, and AGAIN after acting to confirm the effect and decide the next step. ' +
          'Pass tab_id to observe a SPECIFIC tab (e.g. a result/confirmation tab that just opened) WITHOUT switching the active tab; omit it for the active tab. ' +
          'This is the observe step of the observe→act→observe loop.',
        params: [
          { name: 'tab_id', required: false, description: 'Tab to observe (default: active). From a "new tab" note or list_tabs.' }
        ],
        execute: async (args) => this.toolPageSnapshot(args.tab_id ? String(args.tab_id) : undefined)
      },
      {
        name: 'list_tabs',
        description:
          'List open browser tabs as [{id,title,url,active}]. Use to find a tab that opened as a RESULT of an action (e.g. a success/confirmation page that the app opened in a new tab).',
        params: [],
        execute: async () => JSON.stringify(await this.getTabs())
      },
      {
        name: 'activate_tab',
        description:
          'Switch the active tab so later page_snapshot/ui_act (without tab_id) target it. To only LOOK at a result tab, prefer page_snapshot {"tab_id":...} instead of switching.',
        params: [{ name: 'tab_id', required: true, description: 'Tab id to activate (from list_tabs or a "new tab" note).' }],
        execute: async (args) => {
          await this.activateTab({ id: String(args.tab_id ?? '') })
          return JSON.stringify(await this.getTabs())
        }
      },
      {
        name: 'ui_act',
        description:
          'ACT on the live page with UI actions YOU choose from the latest page_snapshot. actions_json is a JSON array, run in order, each: ' +
          '{"action":"click"|"fill"|"select"|"check"|"submit","ref":"<eN from the snapshot>","value":"<for fill/select>","checked":true|false}. ' +
          'For select, pass the option [value="…"] when present, otherwise the visible option text; if the ref points directly to an option, value can be omitted. Native selects match both value and text; custom comboboxes try to open and click the matching visible option. ' +
          'Use the [ref=eN] of the element from the latest snapshot (a raw "selector":"<css>" also works). ' +
          'Execution STOPS at the first failing action so you can page_snapshot again and re-decide. Never guess a ref — use only refs the latest snapshot returned.',
        params: [{ name: 'actions_json', required: true, description: 'JSON array of UI actions to perform in order.' }],
        execute: async (args) => this.toolUiAct(String(args.actions_json ?? ''))
      },
      // Maestro-only (gated by opts.ingest): turn the current capture into one or more skills.
      ...(opts.ingest
        ? [
            ...this.buildCaptureAnalysisTools(),
            {
              name: 'start_recording',
              description:
                'Start recording the ACTIVE browser tab for UI/API capture. Use when the user asks you to begin recording/capture before they demonstrate a workflow. ' +
                'If a recording is already active, starting again restarts into a fresh trace and clears the previous active capture evidence. mode is optional: "ui" records UI + network, "api" records API-focused capture.',
              params: [{ name: 'mode', required: false, description: 'Optional capture mode: ui or api. Defaults to the current mode.' }],
              execute: async (args) => this.toolStartRecording(args.mode ? String(args.mode) : '')
            } as PiToolSpec,
            {
              name: 'stop_recording',
              description:
                'Stop the current recording. Use when the user asks you to end/stop recording/capture after a workflow demonstration. ' +
                'This stops the recording bridge, persists latest evidence, and updates the Workbench/Home recording state.',
              params: [],
              execute: async () => this.toolStopRecording()
            } as PiToolSpec,
            {
              name: 'ingest_recording',
              description:
                'Turn the CURRENT capture into reusable skill(s). Splits the workflow into one or MORE skills — a UI flow, an API write, a lookup each — and saves them. Use after a workflow has been captured on this page. Returns the generated skills (name + description) to show the user.',
              params: [],
              execute: async () => this.ingestRecordingToSkills()
            } as PiToolSpec
          ]
        : [])
    ])
  }

  async pushHostApprovalEvent(event: Omit<HostApprovalEvent, 'id' | 'requestedAt'>): Promise<string> {
    return await this.agentService.pushHostApprovalEvent(event)
  }

  async resolveHostApprovalEvent(id: string, status: HostApprovalEvent['status']): Promise<void> {
    await this.agentService.resolveHostApprovalEvent(id, status)
  }

  // Broadcast a live agent step so the Agent chat can render the observe→act loop.
  broadcastActivity(phase: AgentActivityStep['phase'], label: string, ok = true): void {
    this.agentService.broadcastActiveAgentActivity(phase, label, ok)
  }

  broadcastApiActivity(
    method: string | undefined,
    url: string,
    ok: boolean,
    auth?: { header: string; source: string; key?: string; applied: boolean }[]
  ): void {
    this.requestExec.broadcastApiActivity(method, url, ok, auth)
  }

  private async toolBrowserIntercept(commandsJson: string): Promise<string> {
    return await this.requestExec.toolBrowserIntercept(commandsJson)
  }

  async confirmBrowserInterceptionRule(rule: NetworkInterceptionRule): Promise<boolean> {
    const summary = interceptionRuleSummary(rule)
    const eventId = await this.pushHostApprovalEvent({
      kind: 'tool',
      status: 'pending',
      label: 'browser_intercept',
      detail: summary,
      scope: 'cowork',
      toolName: 'browser_intercept',
      reason: 'network interception modifies live browser traffic'
    })
    this.broadcastActivity('tool', `awaiting approval: ${summary}`)
    const detail = clipText(
      JSON.stringify(
        {
          action: rule.action,
          method: rule.method || '*',
          url_contains: rule.urlContains,
          once: rule.once,
          status: rule.status,
          rewrites: {
            url: Boolean(rule.rewriteUrl),
            method: rule.rewriteMethod,
            responseBody: rule.body != null,
            responseHeaders: rule.headers ? Object.keys(rule.headers) : [],
            requestHeaders: rule.rewriteHeaders ? Object.keys(rule.rewriteHeaders) : []
          },
          note: rule.note || ''
        },
        null,
        2
      ),
      4_000
    )
    const allowed = await taskRegistry.askOperator({
      name: 'interception-approval',
      title: `Allow interception rule ${summary}?`,
      detail,
      confirmLabel: 'Allow rule',
      cancelLabel: 'Deny',
      payload: buildUnknownConfirmPayload({
        summary: `browser_intercept · ${summary}`,
        intent: rule.note || undefined,
        body: {
          action: rule.action,
          method: rule.method || '*',
          url_contains: rule.urlContains,
          once: rule.once,
          status: rule.status,
          rewrite_url: Boolean(rule.rewriteUrl),
          rewrite_method: rule.rewriteMethod,
          rewrite_response_body: rule.body != null
        }
      })
    })
    await this.resolveHostApprovalEvent(eventId, allowed ? 'approved' : 'denied')
    this.broadcastActivity('tool', `${allowed ? 'approved' : 'denied'}: ${summary}`, allowed)
    return allowed
  }

  private async applyBrowserInterceptionRules(): Promise<void> {
    await this.requestExec.applyBrowserInterceptionRules()
  }

  private async toolPageSnapshot(tabId?: string): Promise<string> {
    return await this.requestExec.toolPageSnapshot(tabId)
  }

  private async toolUiAct(actionsJson: string): Promise<string> {
    return await this.requestExec.toolUiAct(actionsJson)
  }

  private toolSkillContract(skillId: string): string {
    return this.requestExec.toolSkillContract(skillId)
  }

  private async toolBrowserExec(commandsJson: string): Promise<string> {
    return await this.requestExec.toolBrowserExec(commandsJson)
  }

  private async toolInjectButton(skillsJson: string, domainArg: string): Promise<string> {
    return await this.browserView.toolInjectButton(skillsJson, domainArg)
  }

  private async toolRemoveInjectedButton(domainArg: string): Promise<string> {
    return await this.browserView.toolRemoveInjectedButton(domainArg)
  }

  private async toolRunSkillScript(skillId: string, variablesJson: string): Promise<string> {
    return await this.requestExec.toolRunSkillScript(skillId, variablesJson)
  }

  private async toolReplayUi(skillId: string, variablesJson: string): Promise<string> {
    return await this.requestExec.toolReplayUi(skillId, variablesJson)
  }

  onCapturedEvent(e: TraceEvent, tabId: string): void {
    this.captureService.onCapturedEvent(e, tabId)
  }

  private emit(e: TraceEvent): void {
    this.captureService.emitTrace(e)
  }

  layout(): void {
    if (!this.browserWindow) return
    // Deferred views and native resize reuse the last complete renderer measurement. The next
    // Shell report supplies updated dimensions; the first-frame fallback must not reopen Chat.
    //
    // 摆位与渲染层上报那条路共用 `applyContentBounds`,所以这里直接复用缓存矩形,不回灌
    // `setViewBounds`(那会把同一份矩形再走一遍入口,白跑一次分发)。
    if (this.opBounds && this.controlBounds) {
      this.applyContentBounds(this.opBounds, this.controlBounds)
      return
    }
    const [w, h] = this.browserWindow.getContentSize()
    const viewH = Math.max(0, h - TOOLBAR_H)
    const webW = Math.max(0, w - SIDEBAR_W)
    const content = { x: 0, y: TOOLBAR_H, width: webW, height: viewH }
    this.browserView.layout(content)
    this.workbenchView.layout(content)
    this.controlView.layout({ x: webW, y: TOOLBAR_H, width: SIDEBAR_W, height: viewH })
    this.browserView.refreshCompositeTabs()
  }

  /**
   * Position the native views over the rects the home renderer measured from its
   * operation/control placeholders (Layout.vue). Authoritative once the renderer
   * has mounted; layout() reuses this pair until the renderer reports another measurement.
   */
  setViewBounds(params: { operation: ViewRect; control: ViewRect }): void {
    // Retain both rects so late-created views and activated tabs use the same measured layout.
    this.controlBounds = params.control
    this.opBounds = params.operation
    this.applyContentBounds(params.operation, params.control)
  }

  /** 两条布局路径共用的摆位分发。 */
  private applyContentBounds(content: ViewRect, control: ViewRect): void {
    this.browserView.setBounds(content)
    this.workbenchView.setBounds(content)
    this.controlView.setBounds(control)
    // A composite mini-app tab is positioned by its own mount, not by a `WebContentsView` bounds
    // applier, so it has to be told separately or it keeps a stale rect through every resize.
    this.browserView.refreshCompositeTabs()
  }

  private getActiveTab(): OperationTab | undefined {
    return this.browserView.getActiveTab()
  }

  async warmAndLoad(tab: OperationTab): Promise<void> {
    await this.browserView.warmAndLoad(tab)
  }

  drainNewTabsNote(): string {
    return this.browserView.drainNewTabsNote()
  }

  async restoreTabs(params: { tabs: SavedTab[] }): Promise<void> {
    await this.browserView.restoreTabs(params)
  }

  async showTabMenu(params: { id: string }): Promise<void> {
    await this.browserView.showTabMenu(params)
  }

  async showNewTabMenu(params: { x: number; y: number }): Promise<void> {
    // Deliberately does NOT touch the Workbench: this is armed by HOVER, and hovering a button must
    // not change what is on screen. Each menu row backgrounds it when it is actually picked.
    await this.browserView.showNewTabMenu(params)
  }

  async newTab(): Promise<void> {
    this.workbenchView.backgroundTab()
    await this.browserView.newTab()
  }

  async closeActiveTab(): Promise<void> {
    if (this.workbenchView.isVisible()) {
      await this.closeWorkbenchTab()
      return
    }
    await this.browserView.closeActiveTab()
  }

  async openTab(params: { url: string }): Promise<void> {
    await this.browserView.openTab(params)
  }

  async openCompositeTab(params: { id: string }): Promise<void> {
    await this.browserView.openCompositeTab(params)
  }

  /** 工作区芯片:开 OnlyPreview 的 tab 并把这个目录设为项目根(mini-016 / Ral 2026-09-07)。 */
  async openWorkspaceInPreview(params: { path: string }): Promise<{ ok: boolean; error?: string }> {
    return await this.browserView.openCompositeTabTarget({
      id: MAESTRO_ONLY_PREVIEW_TAB_ID,
      path: params?.path || ''
    })
  }

  async activateTab(params: { id: string }): Promise<void> {
    await this.browserView.activateTab(params)
  }

  async reorderTabs(params: { ids: string[] }): Promise<void> {
    await this.browserView.reorderTabs(params)
  }

  async closeTab(params: { id: string }): Promise<void> {
    await this.browserView.closeTab(params)
  }

  async getTabs(): Promise<TabInfo[]> {
    return await this.browserView.getTabs()
  }

  existingSkillRegistry(): SkillRegistryService | null {
    return this.skillRegistry
  }

  ensureServices(): {
    registry: SkillRegistryService
    generator: SkillGeneratorService
    pi: MaestroAgent
    piDelegate: DelegateAgent
    settings: CoachSettingsService
    demo: BookingDemoService
  } {
    if (!this.settings) this.settings = new CoachSettingsService(maestroDataRoot())
    if (!this.demo) this.demo = new BookingDemoService(maestroDataRoot())
    if (!this.skillRegistry) {
      this.skillRegistry = new SkillRegistryService(maestroDataRoot())
      this.skillRegistry.ensureRuntimeStorage()
    }
    const { pi, piDelegate, piGen } = this.agentService.ensureAgents()
    if (!this.skillGenerator) {
      this.skillGenerator = new SkillGeneratorService(
        this.skillRegistry,
        piGen,
        broadcastCodexDebug
      )
    }
    if (!this.llmApplied) {
      const saved = this.settings.read()
      this.applyLlmTarget(saved.llmProvider, saved.llmModel, saved.llmEffort)
      this.llmApplied = true
    }
    return {
      registry: this.skillRegistry,
      generator: this.skillGenerator,
      pi,
      piDelegate,
      settings: this.settings,
      demo: this.demo
    }
  }

  async shutdown(): Promise<void> {
    await this.agentService.shutdown()

    this.demo?.stop()
    await this.captureService.shutdown()
    this.resetWindowScopedViews()
    this.invalidateHomeRendererReadyFence()
    super.destroy()

    this.initialReady = Promise.resolve()
    this.backgroundReady = Promise.resolve()
    this.activeBootForcePinnedHomeIntentVersion = 0
    this.workspaceFile.reset()
    this.skillGenerator = null
    this.llmApplied = false
  }

  async replayRecipe(recipe: SkillRecipe, variables: Record<string, string>): Promise<ReplayResult> {
    return await this.requestExec.replayRecipe(recipe, variables)
  }

  debugCodex = broadcastCodexDebug
}

export const maestroWindowHelper = iocHelper.bind({
  controller: MaestroWindowController,
  services: [
    MaestroLlmService,
    MaestroBrowserViewService,
    MaestroControlViewService,
    MaestroWorkbenchViewService,
    WorkspaceFileService,
    CaptureService,
    SkillService,
    RequestExecService,
    MaestroAgentService
  ]
}) as MaestroWindowController
