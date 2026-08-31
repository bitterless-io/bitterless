import { XpcMainHandler } from 'electron-xpc/main'
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller'
import { updateService } from '@maestro-main/update/update.service'
import { taskRegistry } from '@maestro-main/tasks/taskRegistry.service'
import type { MaestroTask } from '@maestro-shared/task.api'
import type {
  AgentConversationContext,
  AgentCompactReply,
  AgentCompactRequest,
  AgentReply,
  AudioScribeRequest,
  AudioScribeResult,
  AttachFileResult,
  CaptureExportFormat,
  CaptureOptions,
  CaptureRecordSnapshot,
  CaptureRecordSyncRequest,
  CaptureRecordSyncResult,
  CaptureState,
  BrowserRequestReplayRequest,
  BrowserRequestReplayResult,
  CoachSettings,
  CoachXpcContract,
  DeleteSkillResult,
  ExportRecordingResult,
  FileStatusResult,
  HostApprovalExportResult,
  HostToolCatalogResult,
  HostApprovalHistoryResult,
  HomeRendererReadyParams,
  HomeRendererReadyResult,
  HostToolPolicyMode,
  HostToolPolicyResult,
  HostToolScope,
  InjectedButtonDomain,
  InjectedButtonRemoveResult,
  IntegrationMappingDeleteRequest,
  IntegrationMappingListRequest,
  IntegrationMappingListResult,
  IntegrationMappingUpsertRequest,
  IntegrationMappingWriteResult,
  IntegrationMigrationRunRequest,
  IntegrationMigrationTargetRequest,
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
  IngestRecord,
  LlmConfig,
  LlmEffort,
  LlmLoginMethod,
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
  UpdateCheckResult,
  UpdateInfo,
  ViewRect,
  WorkspaceRefResult
} from '@maestro-shared/coach.api'
import type { SavedTab } from '@maestro-shared/tabs.api'
import type { CaptureMode } from '@maestro-shared/trace.types'

export class CoachXpcHandler extends XpcMainHandler implements CoachXpcContract {
  async homeRendererReady(params: HomeRendererReadyParams): Promise<HomeRendererReadyResult> {
    return maestroWindowHelper.markHomeRendererReady(params)
  }

  async getSettings(): Promise<CoachSettings> {
    return await maestroWindowHelper.getSettings()
  }

  async saveSettings(params: Partial<CoachSettings>): Promise<CoachSettings> {
    return await maestroWindowHelper.saveSettings(params)
  }

  async navigate(params: { url: string }): Promise<void> {
    await maestroWindowHelper.navigate(params)
  }

  async reload(): Promise<void> {
    await maestroWindowHelper.reload()
  }

  async goBack(): Promise<void> {
    await maestroWindowHelper.goBack()
  }

  async goForward(): Promise<void> {
    await maestroWindowHelper.goForward()
  }

  async setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]> {
    return await maestroWindowHelper.setTabDebugger(params)
  }

  async newTab(): Promise<void> {
    await maestroWindowHelper.newTab()
  }

  async openTab(params: { url: string }): Promise<void> {
    await maestroWindowHelper.openTab(params)
  }

  async showTabMenu(params: { id: string }): Promise<void> {
    await maestroWindowHelper.showTabMenu(params)
  }

  async openDemo(): Promise<{ url: string }> {
    return await maestroWindowHelper.openDemo()
  }

  async getWorkbenchVisible(): Promise<{ visible: boolean }> {
    return await maestroWindowHelper.getWorkbenchVisible()
  }

  async setWorkbenchVisible(params: { visible: boolean }): Promise<{ visible: boolean }> {
    return await maestroWindowHelper.setWorkbenchVisible(params)
  }

  async getPackageInfo(): Promise<PackageInfo> {
    return await maestroWindowHelper.getPackageInfo()
  }

  async getLogInfo(): Promise<LogInfo> {
    return await maestroWindowHelper.getLogInfo()
  }

  async openLogDirectory(): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await maestroWindowHelper.openLogDirectory()
  }

  async getHostToolCatalog(params?: { scope?: HostToolScope; category?: string; query?: string }): Promise<HostToolCatalogResult> {
    return await maestroWindowHelper.getHostToolCatalog(params)
  }

  async setHostToolPolicy(params: { toolName: string; mode: HostToolPolicyMode }): Promise<HostToolPolicyResult> {
    return await maestroWindowHelper.setHostToolPolicy(params)
  }

  async getHostApprovalEvents(): Promise<HostApprovalHistoryResult> {
    return await maestroWindowHelper.getHostApprovalEvents()
  }

  async exportHostApprovalEvents(): Promise<HostApprovalExportResult> {
    return await maestroWindowHelper.exportHostApprovalEvents()
  }

  async clearHostApprovalEvents(): Promise<HostApprovalHistoryResult> {
    return await maestroWindowHelper.clearHostApprovalEvents()
  }

  async listIntegrationTargets(): Promise<IntegrationTargetSummary[]> {
    return await maestroWindowHelper.listIntegrationTargets()
  }

  async getIntegrationTarget(params: { targetId: string }): Promise<IntegrationTarget | null> {
    return await maestroWindowHelper.getIntegrationTarget(params)
  }

  async createIntegrationTargetFromCapture(params?: { name?: string; domain?: string }): Promise<IntegrationTargetCreateResult> {
    return await maestroWindowHelper.createIntegrationTargetFromCapture(params)
  }

  async createAiCrmsMigrationTarget(params: IntegrationMigrationTargetRequest): Promise<IntegrationTargetCreateResult> {
    return await maestroWindowHelper.createAiCrmsMigrationTarget(params)
  }

  async deleteIntegrationTarget(params: { targetId: string }): Promise<IntegrationTargetDeleteResult> {
    return await maestroWindowHelper.deleteIntegrationTarget(params)
  }

  async runIntegrationTargetDryRun(params: { targetId: string }): Promise<IntegrationTargetRunResult> {
    return await maestroWindowHelper.runIntegrationTargetDryRun(params)
  }

  async runIntegrationRecordedSiteDryRun(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {
    return await maestroWindowHelper.runIntegrationRecordedSiteDryRun(params)
  }

  async runIntegrationRecordedSitePlan(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {
    return await maestroWindowHelper.runIntegrationRecordedSitePlan(params)
  }

  async runIntegrationRecordedSiteApply(params: IntegrationRecordedSiteApplyRequest): Promise<IntegrationTargetRunResult> {
    return await maestroWindowHelper.runIntegrationRecordedSiteApply(params)
  }

  async runIntegrationMigration(params: IntegrationMigrationRunRequest): Promise<IntegrationTargetRunResult> {
    return await maestroWindowHelper.runIntegrationMigration(params)
  }

  async runIntegrationReportReadiness(params: IntegrationReportReadinessRequest): Promise<IntegrationTargetRunResult> {
    return await maestroWindowHelper.runIntegrationReportReadiness(params)
  }

  async setIntegrationTargetSchedule(params: IntegrationTargetScheduleRequest): Promise<IntegrationTargetScheduleResult> {
    return await maestroWindowHelper.setIntegrationTargetSchedule(params)
  }

  async listIntegrationMappings(params: IntegrationMappingListRequest): Promise<IntegrationMappingListResult> {
    return await maestroWindowHelper.listIntegrationMappings(params)
  }

  async upsertIntegrationMapping(params: IntegrationMappingUpsertRequest): Promise<IntegrationMappingWriteResult> {
    return await maestroWindowHelper.upsertIntegrationMapping(params)
  }

  async deleteIntegrationMapping(params: IntegrationMappingDeleteRequest): Promise<IntegrationMappingWriteResult> {
    return await maestroWindowHelper.deleteIntegrationMapping(params)
  }

  async listInjectedButtons(): Promise<InjectedButtonDomain[]> {
    return await maestroWindowHelper.listInjectedButtons()
  }

  async removeInjectedButtonDomain(params: { domain: string }): Promise<InjectedButtonRemoveResult> {
    return await maestroWindowHelper.removeInjectedButtonDomain(params)
  }

  async getCaptureOptions(): Promise<CaptureOptions> {
    return await maestroWindowHelper.getCaptureOptions()
  }

  async setCaptureOptions(params: Partial<CaptureOptions>): Promise<CaptureOptions> {
    return await maestroWindowHelper.setCaptureOptions(params)
  }

  async getCaptureState(): Promise<CaptureState> {
    return await maestroWindowHelper.getCaptureState()
  }

  async startCapture(params?: { mode?: CaptureMode } & Partial<CaptureOptions>): Promise<CaptureState> {
    return await maestroWindowHelper.startCapture(params)
  }

  async stopCapture(): Promise<CaptureState> {
    return await maestroWindowHelper.stopCapture()
  }

  async captureSnapshot(): Promise<SnapshotResult> {
    return await maestroWindowHelper.captureSnapshot()
  }

  async syncCaptureRecords(params: CaptureRecordSyncRequest): Promise<CaptureRecordSyncResult> {
    return await maestroWindowHelper.syncCaptureRecords(params)
  }

  async getCaptureRecords(): Promise<CaptureRecordSnapshot> {
    return await maestroWindowHelper.getCaptureRecords()
  }

  async clearCaptureRecordEdits(): Promise<{ ok: boolean }> {
    return await maestroWindowHelper.clearCaptureRecordEdits()
  }

  async exportRecording(params: { startedAt: number; records: IngestRecord[]; format?: CaptureExportFormat }): Promise<ExportRecordingResult> {
    return await maestroWindowHelper.exportRecording(params)
  }

  async replayBrowserRequest(params: BrowserRequestReplayRequest): Promise<BrowserRequestReplayResult> {
    return await maestroWindowHelper.replayBrowserRequest(params)
  }

  async sendAgentMessage(params: { message: string; sessionId?: string; context?: AgentConversationContext }): Promise<AgentReply> {
    return await maestroWindowHelper.sendAgentMessage(params)
  }

  async compactConversation(params: AgentCompactRequest): Promise<AgentCompactReply> {
    return await maestroWindowHelper.compactConversation(params)
  }

  async trainerMessage(params: { message: string; sessionId?: string; files?: { name: string; content: string }[] }): Promise<AgentReply> {
    return await maestroWindowHelper.trainerMessage(params)
  }

  async resetTrainerConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    return await maestroWindowHelper.resetTrainerConversation(params)
  }

  async delegateMessage(params: { message: string; sessionId?: string }): Promise<AgentReply> {
    return await maestroWindowHelper.delegateMessage(params)
  }

  async resetDelegateConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    return await maestroWindowHelper.resetDelegateConversation(params)
  }

  async abortAgent(params?: { sessionId?: string }): Promise<void> {
    await maestroWindowHelper.abortAgent(params)
  }

  async abortTrainer(params?: { sessionId?: string }): Promise<void> {
    await maestroWindowHelper.abortTrainer(params)
  }

  async abortDelegate(params?: { sessionId?: string }): Promise<void> {
    await maestroWindowHelper.abortDelegate(params)
  }

  async summarizeSkill(params: { workflow?: string; records: IngestRecord[] }): Promise<SkillCreateResult> {
    return await maestroWindowHelper.summarizeSkill(params)
  }

  async listSkills(): Promise<SkillSummary[]> {
    return await maestroWindowHelper.listSkills()
  }

  async getSkillDetail(params: { skillId: string }): Promise<SkillDetail | null> {
    return await maestroWindowHelper.getSkillDetail(params)
  }

  async openSkillDirectory(params: { skillId: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await maestroWindowHelper.openSkillDirectory(params)
  }

  async exportSkillPackage(params: { skillId: string }): Promise<SkillExportResult> {
    return await maestroWindowHelper.exportSkillPackage(params)
  }

  async importSkillPackage(): Promise<SkillImportResult> {
    return await maestroWindowHelper.importSkillPackage()
  }

  async openDomainDirectory(params: { domain: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await maestroWindowHelper.openDomainDirectory(params)
  }

  async attachFiles(params: { sessionId?: string; paths: string[] }): Promise<AttachFileResult[]> {
    return await maestroWindowHelper.attachFiles(params)
  }

  async attachClipboardImage(params?: { sessionId?: string }): Promise<AttachFileResult> {
    return await maestroWindowHelper.attachClipboardImage(params)
  }

  async scribeAudio(params: AudioScribeRequest): Promise<AudioScribeResult> {
    return await maestroWindowHelper.scribeAudio(params)
  }

  async chooseWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    return await maestroWindowHelper.chooseWorkspaceDirectory(params)
  }

  async setWorkspaceDirectory(params: { sessionId?: string; path?: string }): Promise<WorkspaceRefResult> {
    return await maestroWindowHelper.setWorkspaceDirectory(params)
  }

  async getWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    return await maestroWindowHelper.getWorkspaceDirectory(params)
  }

  async getFileStatuses(params: { paths: string[] }): Promise<FileStatusResult[]> {
    return await maestroWindowHelper.getFileStatuses(params)
  }

  async openFile(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await maestroWindowHelper.openFile(params)
  }

  async showFileInFolder(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await maestroWindowHelper.showFileInFolder(params)
  }

  async fileThumbnail(params: { path: string }): Promise<{
    ok: boolean
    dataUrl?: string
    width?: number
    height?: number
    error?: string
  }> {
    return await maestroWindowHelper.fileThumbnail(params)
  }

  async listTasks(): Promise<MaestroTask[]> {
    return taskRegistry.list()
  }

  async respondTaskConfirm(params: { taskId: string; confirmId: string; confirm: boolean }): Promise<{ ok: boolean }> {
    return taskRegistry.resolveConfirm(params)
  }

  async trainSkill(params: { skillId: string; guidance: string }): Promise<SkillCreateResult> {
    return await maestroWindowHelper.trainSkill(params)
  }

  async deleteSkill(params: { skillId: string }): Promise<DeleteSkillResult> {
    return await maestroWindowHelper.deleteSkill(params)
  }

  async replaySkill(params: { skillId: string; variables: Record<string, string> }): Promise<ReplayResult> {
    return await maestroWindowHelper.replaySkill(params)
  }

  async getLlmConfig(): Promise<LlmConfig> {
    return await maestroWindowHelper.getLlmConfig()
  }

  async setLlmConfig(params: { provider: string; model: string; effort?: LlmEffort }): Promise<LlmConfig> {
    return await maestroWindowHelper.setLlmConfig(params)
  }

  async setLlmCompression(params: { provider: string; model: string; compressionRemainingPercent: number }): Promise<LlmConfig> {
    return await maestroWindowHelper.setLlmCompression(params)
  }

  async setViewBounds(params: { operation: ViewRect; control: ViewRect }): Promise<void> {
    maestroWindowHelper.setViewBounds(params)
  }

  async activateTab(params: { id: string }): Promise<void> {
    await maestroWindowHelper.activateTab(params)
  }

  async reorderTabs(params: { ids: string[] }): Promise<void> {
    await maestroWindowHelper.reorderTabs(params)
  }

  async closeTab(params: { id: string }): Promise<void> {
    await maestroWindowHelper.closeTab(params)
  }

  async getTabs(): Promise<TabInfo[]> {
    return maestroWindowHelper.getTabs()
  }

  async restoreTabs(params: { tabs: SavedTab[] }): Promise<void> {
    await maestroWindowHelper.restoreTabs(params)
  }

  async loginLlm(params: { provider: string; method: LlmLoginMethod }): Promise<LlmConfig> {
    return await maestroWindowHelper.loginLlm(params)
  }

  async loginCodex(params: { method: string }): Promise<LlmConfig> {
    return await maestroWindowHelper.loginCodex(params)
  }

  async logoutLlm(params?: { provider?: string }): Promise<LlmConfig> {
    return await maestroWindowHelper.logoutLlm(params)
  }

  async logoutCodex(): Promise<LlmConfig> {
    return await maestroWindowHelper.logoutCodex()
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    return await updateService.checkForUpdates()
  }

  async getReadyUpdate(): Promise<UpdateInfo | null> {
    return updateService.getReadyUpdate()
  }

  async quitAndInstall(): Promise<void> {
    updateService.quitAndInstall()
  }
}

export const coachXpcHandler = new CoachXpcHandler()
