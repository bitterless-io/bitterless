import { BrowserWindow, WebContentsView, app, shell } from 'electron'
import { xpcMain } from 'electron-xpc/main'
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
import type { PiToolSpec } from '@maestro-main/agent/BaseAgent'
import { buildFileTools } from '@maestro-main/agent/tools/fileTools'
import { buildArchiveTools } from '@maestro-main/agent/tools/archiveTools'
import { MaestroAgent } from '@maestro-main/agent/MaestroAgent'
import { CoachAgent } from '@maestro-main/agent/CoachAgent'
import { DelegateAgent } from '@maestro-main/agent/DelegateAgent'
import {
  MaestroAgentService,
  type MaestroAgentServiceState
} from '@maestro-main/agent/maestroAgent.service'
import {
  broadcastCodexDebug
} from '@maestro-main/agent/runtime/agentBroadcast'
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
import { integrationScheduler, type IntegrationSchedulerEvent } from '@maestro-main/integration/integrationScheduler.service'
import {
  IntegrationService,
  type IntegrationServiceState
} from '@maestro-main/integration/integration.service'
import {
  normalizeRecordedSiteHost,
  recordedSiteHostMatches
} from '@maestro-main/integration/recordedSite/rowMapping'
import { iocHelper } from '@maestro-shared/iocHelper/ioc.helper'
import type { LlmStoredTarget } from '@maestro-main/llm/llmModels'
import {
  DEFAULT_COACH_START_URL,
  MAESTRO_LOCAL_HOME_DISPLAY_URL,
  MAESTRO_HOME_READY_TOKEN_QUERY
} from '@maestro-shared/coach.api'
import type {
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
  AudioScribeRequest,
  AudioScribeResult,
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
  IntegrationMigrationRunRequest,
  IntegrationMigrationTargetRequest,
  IntegrationMappingDeleteRequest,
  IntegrationMappingListRequest,
  IntegrationMappingListResult,
  IntegrationMappingUpsertRequest,
  IntegrationMappingWriteResult,
  IntegrationRecordedSiteApplyRequest,
  IntegrationRecordedSiteSyncRequest,
  IntegrationReportReadinessRequest,
  IntegrationTarget,
  IntegrationTargetCreateResult,
  IntegrationTargetDeleteResult,
  IntegrationTargetRunResult,
  IntegrationTargetScheduleRequest,
  IntegrationTargetScheduleResult,
  IntegrationTargetSummary,
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
  TabInfo,
  ViewRect,
  WorkspaceRef,
  WorkspaceRefResult
} from '@maestro-shared/coach.api'
import type { SavedTab } from '@maestro-shared/tabs.api'
import type { CaptureMode, TraceEvent } from '@maestro-shared/trace.types'
import type { SkillRecipe } from '@maestro-main/skills/skillRecipe.types'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
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
    IntegrationServiceState,
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
    @inject(Symbol.for(IntegrationService.name))
    public readonly integrationService: IntegrationService,
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
    this.integrationService.setState(this)
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
  currentUrl = DEFAULT_COACH_START_URL
  private initialReady: Promise<void> = Promise.resolve()
  private homeRendererReady: Promise<void> = Promise.resolve()
  private resolveHomeRendererReady: (() => void) | null = null
  private homeRendererReadyToken: string | null = null
  private skillRegistry: SkillRegistryService | null = null
  private skillGenerator: SkillGeneratorService | null = null
  private llmApplied = false
  private settings: CoachSettingsService | null = null
  private demo: BookingDemoService | null = null

  get tabs(): OperationTab[] {
    return this.browserView.tabs
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

  get lastTrainerRun(): { skill?: SkillSummary } {
    return this.agentService.lastTrainerRun
  }

  set lastTrainerRun(value: { skill?: SkillSummary }) {
    this.agentService.lastTrainerRun = value
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
    this.tabsOpenedThisTurn = []
  }

  private createHomeRendererReadyFence(): Promise<void> {
    const token = randomUUID()
    this.homeRendererReadyToken = token
    this.rendererQuery = { [MAESTRO_HOME_READY_TOKEN_QUERY]: token }
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

  create(): BrowserWindow {
    this.agentService.activate()
    this.ensureServices()
    void this.agentService.loadHostToolPolicies()
    void this.agentService.loadHostApprovalHistory()
    integrationScheduler.start({
      emit: (event) => this.handleIntegrationSchedulerEvent(event),
      runRecordedSiteDryRun: (target) => this.runIntegrationRecordedSiteDryRun({ targetId: target.id })
    })
    this.currentUrl = MAESTRO_LOCAL_HOME_DISPLAY_URL

    this.resetWindowScopedViews()
    const homeMountedReady = this.createHomeRendererReadyFence()
    const win = super.create()

    // First tab = bundled Bitterless Home (leftmost, non-closable, fixed title/favicon). It owns a
    // dedicated XPC-only preload and never participates in debugger/capture/replay.
    const operationView = this.browserView.createPinnedHomeTab()
    const homeReady = Promise.all([this.rendererReady, homeMountedReady])
      .then(() => undefined)
      .catch((err) => {
        this.emit({ kind: 'error', msg: 'home load: ' + (err as Error).message, ts: Date.now() })
        throw err
      })
    const workbenchReady = this.workbenchView.create()
    // Stay hidden until the local entry has painted. The white Layout placeholder covers the
    // operation area during this short load and prevents a pre-paint flash.

    const controlReady = this.controlView.create()

    this.layout()
    win.on('resize', () => this.layout())

    this.initialReady = this.browserView
      .loadPinnedHomeTab()
      .catch((err) => {
        this.emit({ kind: 'error', msg: 'bundled Home load: ' + (err as Error).message, ts: Date.now() })
        throw err
      })
      .finally(() => {
        if (this.operationView === operationView && !operationView.webContents.isDestroyed()) {
          operationView.setVisible(true)
        }
      })
      .then(() => this.browserView.openStartupTabIfNeeded())
    const operationReady = this.initialReady
    this.initialReady = Promise.all([homeReady, controlReady, workbenchReady, operationReady]).then(() => undefined)
    // Pre-warm one spare view so warming a tab (new open / switching to a cold tab) is instant.
    void this.browserView.prewarmSpare()
    return win
  }

  async whenReady(): Promise<void> {
    await this.initialReady
  }

  async getSettings(): Promise<CoachSettings> {
    return this.ensureServices().settings.read()
  }

  async saveSettings(params: Partial<CoachSettings>): Promise<CoachSettings> {
    return this.ensureServices().settings.save(params)
  }

  hasCustomStartUrl(): boolean {
    return this.ensureServices().settings.hasCustomStartUrl()
  }

  async getWorkbenchVisible(): Promise<{ visible: boolean }> {
    return this.workbenchView.getVisible()
  }

  async setWorkbenchVisible(params: { visible: boolean }): Promise<{ visible: boolean }> {
    return this.workbenchView.setVisible(params)
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

  async listIntegrationTargets(): Promise<IntegrationTargetSummary[]> {
    return await this.integrationService.listIntegrationTargets()
  }

  async getIntegrationTarget(params: { targetId: string }): Promise<IntegrationTarget | null> {
    return await this.integrationService.getIntegrationTarget(params)
  }

  async createIntegrationTargetFromCapture(params?: { name?: string; domain?: string }): Promise<IntegrationTargetCreateResult> {
    return await this.integrationService.createIntegrationTargetFromCapture(params)
  }

  async createAiCrmsMigrationTarget(params: IntegrationMigrationTargetRequest): Promise<IntegrationTargetCreateResult> {
    return await this.integrationService.createAiCrmsMigrationTarget(params)
  }

  async deleteIntegrationTarget(params: { targetId: string }): Promise<IntegrationTargetDeleteResult> {
    return await this.integrationService.deleteIntegrationTarget(params)
  }

  async runIntegrationTargetDryRun(params: { targetId: string }): Promise<IntegrationTargetRunResult> {
    return await this.integrationService.runIntegrationTargetDryRun(params)
  }

  async runIntegrationRecordedSiteDryRun(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {
    return await this.integrationService.runIntegrationRecordedSiteDryRun(params)
  }

  async runIntegrationRecordedSitePlan(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {
    return await this.integrationService.runIntegrationRecordedSitePlan(params)
  }

  async runIntegrationRecordedSiteApply(params: IntegrationRecordedSiteApplyRequest): Promise<IntegrationTargetRunResult> {
    return await this.integrationService.runIntegrationRecordedSiteApply(params)
  }

  async findRecordedSiteTab(target: IntegrationTarget): Promise<OperationTab | undefined> {
    const expected = normalizeRecordedSiteHost(target.source.domain || target.source.startUrl)
    const current = this.getActiveTab()
    const active = current?.kind === 'browser' ? current : undefined
    const activeHost = normalizeRecordedSiteHost(active?.view?.webContents.getURL() || active?.url || this.currentUrl)
    let tab = active && recordedSiteHostMatches(activeHost, expected) ? active : undefined
    if (!tab) {
      tab = this.tabs.find((item) => {
        if (item.kind !== 'browser') return false
        const wc = item.view?.webContents
        const host = normalizeRecordedSiteHost(wc && !wc.isDestroyed() ? wc.getURL() : item.url)
        return recordedSiteHostMatches(host, expected)
      })
    }
    if (!tab) return undefined
    if (!tab.view || tab.view.webContents.isDestroyed()) await this.warmAndLoad(tab)
    await tab.capture?.attach()
    return tab.replay ? tab : undefined
  }

  async runIntegrationMigration(params: IntegrationMigrationRunRequest): Promise<IntegrationTargetRunResult> {
    return await this.integrationService.runIntegrationMigration(params)
  }

  async runIntegrationReportReadiness(params: IntegrationReportReadinessRequest): Promise<IntegrationTargetRunResult> {
    return await this.integrationService.runIntegrationReportReadiness(params)
  }

  async setIntegrationTargetSchedule(params: IntegrationTargetScheduleRequest): Promise<IntegrationTargetScheduleResult> {
    return await this.integrationService.setIntegrationTargetSchedule(params)
  }

  async listIntegrationMappings(params: IntegrationMappingListRequest): Promise<IntegrationMappingListResult> {
    return await this.integrationService.listIntegrationMappings(params)
  }

  async upsertIntegrationMapping(params: IntegrationMappingUpsertRequest): Promise<IntegrationMappingWriteResult> {
    return await this.integrationService.upsertIntegrationMapping(params)
  }

  async deleteIntegrationMapping(params: IntegrationMappingDeleteRequest): Promise<IntegrationMappingWriteResult> {
    return await this.integrationService.deleteIntegrationMapping(params)
  }

  private handleIntegrationSchedulerEvent(event: IntegrationSchedulerEvent): void {
    this.integrationService.handleIntegrationSchedulerEvent(event)
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

  private async toolListIntegrationTargets(targetId?: string): Promise<string> {
    return await this.integrationService.toolListIntegrationTargets(targetId)
  }

  private async toolCreateIntegrationTargetFromCapture(name?: string, domain?: string): Promise<string> {
    return await this.integrationService.toolCreateIntegrationTargetFromCapture(name, domain)
  }

  private async toolCreateAiCrmsMigrationTarget(paramsJson: string): Promise<string> {
    return await this.integrationService.toolCreateAiCrmsMigrationTarget(paramsJson)
  }

  private async toolRunIntegrationDryRun(targetId: string): Promise<string> {
    return await this.integrationService.toolRunIntegrationDryRun(targetId)
  }

  private async toolRunRecordedSiteSyncDryRun(paramsJson: string): Promise<string> {
    return await this.integrationService.toolRunRecordedSiteSyncDryRun(paramsJson)
  }

  private async toolRunRecordedSiteSyncPlan(paramsJson: string): Promise<string> {
    return await this.integrationService.toolRunRecordedSiteSyncPlan(paramsJson)
  }

  private async toolRunRecordedSiteSyncApply(paramsJson: string): Promise<string> {
    return await this.integrationService.toolRunRecordedSiteSyncApply(paramsJson)
  }

  private async toolRunIntegrationMigration(paramsJson: string): Promise<string> {
    return await this.integrationService.toolRunIntegrationMigration(paramsJson)
  }

  private async toolRunIntegrationReportReadiness(paramsJson: string): Promise<string> {
    return await this.integrationService.toolRunIntegrationReportReadiness(paramsJson)
  }

  private async toolSetIntegrationSchedule(paramsJson: string): Promise<string> {
    return await this.integrationService.toolSetIntegrationSchedule(paramsJson)
  }

  private async toolListIntegrationMappings(paramsJson: string): Promise<string> {
    return await this.integrationService.toolListIntegrationMappings(paramsJson)
  }

  private async toolUpsertIntegrationMapping(paramsJson: string): Promise<string> {
    return await this.integrationService.toolUpsertIntegrationMapping(paramsJson)
  }

  private async toolDeleteIntegrationMapping(paramsJson: string): Promise<string> {
    return await this.integrationService.toolDeleteIntegrationMapping(paramsJson)
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

  async scribeAudio(params: AudioScribeRequest): Promise<AudioScribeResult> {
    return await this.agentService.scribeAudio(params)
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

  trainerToolDetail(skillId: string): string {
    return this.skillService.trainerToolDetail(skillId)
  }

  async trainerToolCreate(guidance: string): Promise<string> {
    return await this.skillService.trainerToolCreate(guidance)
  }

  async trainerToolOptimize(skillId: string, guidance: string): Promise<string> {
    return await this.skillService.trainerToolOptimize(skillId, guidance)
  }

  trainerToolDelete(skillId: string): string {
    return this.skillService.trainerToolDelete(skillId)
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
    return await this.agentService.sendAgentMessage(params)
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

  async abortTrainer(params?: { sessionId?: string }): Promise<void> {
    await this.agentService.abortTrainer(params)
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

  async openAiCrmsLoginTab(): Promise<void> {
    await this.browserView.openAiCrmsLoginTab()
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

  // Skill TRAINER chat: a pi agent whose tools do skill CRUD (create / update /
  // optimize / delete) — it never invokes skills, and same-name skills are
  // versioned (old archived) rather than duplicated. Its session is separate from
  // the invocation agent's, so the two conversations never mix.
  async trainerMessage(params: { message: string; sessionId?: string; files?: { name: string; content: string }[] }): Promise<AgentReply> {
    return await this.agentService.trainerMessage(params)
  }

  async resetTrainerConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    return await this.agentService.resetTrainerConversation(params)
  }

  buildCaptureAnalysisTools(): PiToolSpec[] {
    return this.captureService.buildCaptureAnalysisTools()
  }

  // The runtime agent's tools. The tool LIST is static (so the session never goes
  // stale); each executor looks the recipe up fresh per call, so skills ingested
  // mid-session are immediately usable.
  buildPiTools(opts: { ingest?: boolean; sessionKey?: string } = {}): PiToolSpec[] {
    const sessionKey = opts.sessionKey || 'default'
    return this.agentService.wrapHostTools('cowork', [
      this.agentService.buildHostToolCatalogTool('cowork'),
      ...buildFileTools(this.workspaceFile, sessionKey),
      ...buildArchiveTools(this.workspaceFile, sessionKey),
      {
        name: 'list_integration_targets',
        description:
          'List saved Integration Targets, or read one target by target_id. Integration Targets are durable sync contracts compiled from captured website APIs or migration flows. Use before planning scheduled sync or AI-CRMS data synchronization.',
        params: [{ name: 'target_id', required: false, description: 'Optional integration target id to read in full.' }],
        execute: async (args) => this.toolListIntegrationTargets(args.target_id ? String(args.target_id) : '')
      },
      {
        name: 'create_integration_target_from_capture',
        description:
          'Create a durable Integration Target from the CURRENT capture evidence. It extracts API-like endpoint contracts from recorded network requests, stores them locally, and keeps scheduling disabled by default. Use after the user records one customer website API surface and asks to make it a sync target.',
        params: [
          { name: 'name', required: false, description: 'Optional target name. Default uses the current domain.' },
          { name: 'domain', required: false, description: 'Optional source hostname/URL. Default uses the active page or captured endpoints.' }
        ],
        execute: async (args) =>
          this.toolCreateIntegrationTargetFromCapture(args.name ? String(args.name) : '', args.domain ? String(args.domain) : '')
      },
      {
        name: 'create_ai_crms_migration_target',
        description:
          'Create an Integration Target for old-MCU to new-MCU AI-CRMS backend migration. ' +
          'This stores source/target account refs and domain labels only; it does not store MICROMEET_MIGRATION_TOKEN. ' +
          'Use when the user wants to migrate old MCU patient, corporate/client, record, report, or data-mapping data into new MCU.',
        params: [
          {
            name: 'params_json',
            required: true,
            description:
              'JSON object: {"name":"optional","source":"old admin email or tenant id","target":"new admin email or tenant id","domains":["patient","mcu_record","mcu_field_map"]}. Omit domains for the default old-MCU migration domain set.'
          }
        ],
        execute: async (args) => this.toolCreateAiCrmsMigrationTarget(String(args.params_json ?? '{}'))
      },
      {
        name: 'run_integration_dry_run',
        description:
          'Run a non-network dry-run validation of a saved Integration Target contract. This does not call customer APIs or AI-CRMS; it checks endpoint roles, entity mapping, and readiness before a future apply/schedule runner.',
        params: [{ name: 'target_id', required: true, description: 'Integration target id from list_integration_targets.' }],
        execute: async (args) => this.toolRunIntegrationDryRun(String(args.target_id ?? ''))
      },
      {
        name: 'run_recorded_site_sync_dry_run',
        description:
          'Run a read-only sync dry-run for a recorded-site Integration Target. It calls captured GET/list APIs through the currently open logged-in browser tab for that source domain, then compares source rows with the saved source-to-AI-CRMS id map. It does not call AI-CRMS writes and does not persist source payloads.',
        params: [
          {
            name: 'params_json',
            required: true,
            description:
              'JSON object: {"target_id":"...","endpoint_ids":["optional"],"max_endpoints":5,"max_rows_per_endpoint":50}. Open the source website and log in before running.'
          }
        ],
        execute: async (args) => this.toolRunRecordedSiteSyncDryRun(String(args.params_json ?? '{}'))
      },
      {
        name: 'plan_recorded_site_sync',
        description:
          'Build a read-only sync plan for a recorded-site Integration Target. It calls captured GET/list APIs through the live logged-in browser tab, enriches rows through captured same-entity GET detail templates when available, classifies rows as create/update/conflict/noop against source mappings, and reports missing required fields. It does not call AI-CRMS writes and does not persist source payloads.',
        params: [
          {
            name: 'params_json',
            required: true,
            description:
              'JSON object: {"target_id":"...","endpoint_ids":["optional"],"max_endpoints":5,"max_rows_per_endpoint":50}. Run this before any future apply flow.'
          }
        ],
        execute: async (args) => this.toolRunRecordedSiteSyncPlan(String(args.params_json ?? '{}'))
      },
      {
        name: 'apply_recorded_site_sync',
        description:
          'Apply a recorded-site sync into AI-CRMS for patient, corporate, project, data_mapping, and mcu_record rows. It reads captured GET/list APIs through the live logged-in source tab, enriches rows through captured same-entity GET detail templates when available, then writes via the bundled micromeet CLI and updates source mappings. Requires params_json {"apply":true}; not available for schedules. MCU record create is supported; linked record updates can write patient-info, diagnostic-data, and conclusion sections when allow_updates=true.',
        params: [
          {
            name: 'params_json',
            required: true,
            description:
              'JSON object: {"target_id":"...","apply":true,"entities":["patient","corporate","project","data_mapping","mcu_record"],"max_writes":10,"allow_updates":false,"endpoint_ids":["optional"]}. Run plan_recorded_site_sync first.'
          }
        ],
        execute: async (args) => this.toolRunRecordedSiteSyncApply(String(args.params_json ?? '{}'))
      },
      {
        name: 'run_integration_migration',
        description:
          'Run an AI-CRMS backend migration target through the bundled micromeet CLI. Default is backend dry-run; only params_json {"apply":true} writes migrated rows. Requires MICROMEET_MIGRATION_TOKEN in the process environment.',
        params: [
          {
            name: 'params_json',
            required: true,
            description:
              'JSON object: {"target_id":"...","apply":false,"domains":["patient","mcu_record","mcu_field_map"],"timeout_ms":300000}. Omit domains to use the saved target domains.'
          }
        ],
        execute: async (args) => this.toolRunIntegrationMigration(String(args.params_json ?? '{}'))
      },
      {
        name: 'run_integration_report_readiness',
        description:
          'Check whether AI-CRMS / new MCU records are ready for report generation by calling the bundled micromeet CLI. ' +
          'Default is read-only: it lists MCU records and summarizes validation/conclusion/report status. ' +
          'Only when params_json has {"generate":true} will it enqueue validate/conclusion/report/queue commands; add {"send":true} only when the user explicitly asks to send reports.',
        params: [
          {
            name: 'params_json',
            required: true,
            description:
              'JSON object: {"target_id":"...","mcu_record_ids":["id1"],"keyword":"optional","corporate_id":"optional","project_id":"optional","page_size":20,"generate":false,"send":false}.'
          }
        ],
        execute: async (args) => this.toolRunIntegrationReportReadiness(String(args.params_json ?? '{}'))
      },
      {
        name: 'set_integration_schedule',
        description:
          'Enable or disable a saved Integration Target schedule. Scheduled runs are safe-only: recorded-site targets run read-only source dry-run, migration targets run backend dry-run, and report-readiness targets run read-only checks. This tool never enables apply=true production writes.',
        params: [
          {
            name: 'params_json',
            required: true,
            description:
              'JSON object: {"target_id":"...","enabled":true,"interval_minutes":60,"run_kind":"safe-default"}. run_kind may be safe-default, recorded-site-dry-run, migration-dry-run, or report-readiness.'
          }
        ],
        execute: async (args) => this.toolSetIntegrationSchedule(String(args.params_json ?? '{}'))
      },
      {
        name: 'list_integration_mappings',
        description:
          'List source-to-AI-CRMS id mappings for an Integration Target. Use before applying patient/project/corporate sync so the agent can avoid duplicate creates and detect conflicts.',
        params: [
          {
            name: 'params_json',
            required: true,
            description:
              'JSON object: {"target_id":"...","entity":"patient|corporate|project|data_mapping|mcu_record|mcu_report","limit":100}. entity is optional.'
          }
        ],
        execute: async (args) => this.toolListIntegrationMappings(String(args.params_json ?? '{}'))
      },
      {
        name: 'upsert_integration_mapping',
        description:
          'Create or update one source-to-AI-CRMS id mapping after a dry-run or successful sync step. Store only stable ids/checksums and optional short labels; avoid storing full PII payloads.',
        params: [
          {
            name: 'params_json',
            required: true,
            description:
              'JSON object: {"target_id":"...","entity":"patient","source_key":"source-id","ai_crms_id":"target-id","status":"linked|pending|conflict|ignored","source_hash":"optional","source_label":"optional","ai_crms_label":"optional","metadata":{}}.'
          }
        ],
        execute: async (args) => this.toolUpsertIntegrationMapping(String(args.params_json ?? '{}'))
      },
      {
        name: 'delete_integration_mapping',
        description:
          'Delete one source-to-AI-CRMS id mapping for a target/entity/source_key. Use only to correct a bad mapping before rerunning sync.',
        params: [
          {
            name: 'params_json',
            required: true,
            description: 'JSON object: {"target_id":"...","entity":"patient|corporate|project|data_mapping|mcu_record|mcu_report","source_key":"source-id"}.'
          }
        ],
        execute: async (args) => this.toolDeleteIntegrationMapping(String(args.params_json ?? '{}'))
      },
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
    const [w, h] = this.browserWindow.getContentSize()
    const viewH = Math.max(0, h - TOOLBAR_H)
    const webW = Math.max(0, w - SIDEBAR_W)
    this.browserView.layout({ x: 0, y: TOOLBAR_H, width: webW, height: viewH })
    this.workbenchView.layout({ x: 0, y: TOOLBAR_H, width: webW, height: viewH })
    this.controlView.layout({ x: webW, y: TOOLBAR_H, width: SIDEBAR_W, height: viewH })
  }

  /**
   * Position the native views over the rects the home renderer measured from its
   * operation/control placeholders (Layout.vue). Authoritative once the renderer
   * has mounted; layout() above only covers the first frame + window resize.
   */
  setViewBounds(params: { operation: ViewRect; control: ViewRect }): void {
    // Remember the operation rect so a tab activated later (or a new tab) lands in
    // exactly the same spot without waiting for the next renderer report.
    this.opBounds = params.operation
    this.browserView.setBounds(params.operation)
    this.workbenchView.setBounds(params.operation)
    this.controlView.setBounds(params.control)
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

  async newTab(): Promise<void> {
    await this.browserView.newTab()
  }

  async closeActiveTab(): Promise<void> {
    if (this.workbenchView.isVisible()) {
      await this.setWorkbenchVisible({ visible: false })
      return
    }
    await this.browserView.closeActiveTab()
  }

  async openTab(params: { url: string }): Promise<void> {
    await this.browserView.openTab(params)
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

  ensureServices(): {
    registry: SkillRegistryService
    generator: SkillGeneratorService
    pi: MaestroAgent
    piTrainer: CoachAgent
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
    const { pi, piTrainer, piDelegate, piGen } = this.agentService.ensureAgents()
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
      piTrainer,
      piDelegate,
      settings: this.settings,
      demo: this.demo
    }
  }

  async shutdown(): Promise<void> {
    await integrationScheduler.stop()
    await this.agentService.shutdown()

    this.demo?.stop()
    await this.browserView.quiesceAuthBridge()
    await this.captureService.shutdown()
    this.resetWindowScopedViews()
    this.invalidateHomeRendererReadyFence()
    super.destroy()

    this.initialReady = Promise.resolve()
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
    IntegrationService,
    CaptureService,
    SkillService,
    RequestExecService,
    MaestroAgentService
  ]
}) as MaestroWindowController
