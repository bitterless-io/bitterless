import { XpcMainHandler } from 'electron-xpc/main'
import { coworkWindowHelper } from '@cowork-main/windows/coworkWindow.helper'
import { updateService } from '@cowork-main/update/update.service'
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
  ViewRect,
  WorkspaceRefResult
} from '@cowork-shared/coach.api'
import type { SavedTab } from '@cowork-shared/tabs.api'
import type { CaptureMode } from '@cowork-shared/trace.types'

export class CoachXpcHandler extends XpcMainHandler implements CoachXpcContract {
  async getSettings(): Promise<CoachSettings> {
    return await coworkWindowHelper.getSettings()
  }

  async saveSettings(params: Partial<CoachSettings>): Promise<CoachSettings> {
    return await coworkWindowHelper.saveSettings(params)
  }

  async navigate(params: { url: string }): Promise<void> {
    await coworkWindowHelper.navigate(params)
  }

  async reload(): Promise<void> {
    await coworkWindowHelper.reload()
  }

  async goBack(): Promise<void> {
    await coworkWindowHelper.goBack()
  }

  async goForward(): Promise<void> {
    await coworkWindowHelper.goForward()
  }

  async setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]> {
    return await coworkWindowHelper.setTabDebugger(params)
  }

  async newTab(): Promise<void> {
    await coworkWindowHelper.newTab()
  }

  async openTab(params: { url: string }): Promise<void> {
    await coworkWindowHelper.openTab(params)
  }

  async showTabMenu(params: { id: string }): Promise<void> {
    await coworkWindowHelper.showTabMenu(params)
  }

  async openDemo(): Promise<{ url: string }> {
    return await coworkWindowHelper.openDemo()
  }

  async getWorkbenchVisible(): Promise<{ visible: boolean }> {
    return await coworkWindowHelper.getWorkbenchVisible()
  }

  async setWorkbenchVisible(params: { visible: boolean }): Promise<{ visible: boolean }> {
    return await coworkWindowHelper.setWorkbenchVisible(params)
  }

  async getPackageInfo(): Promise<PackageInfo> {
    return await coworkWindowHelper.getPackageInfo()
  }

  async getLogInfo(): Promise<LogInfo> {
    return await coworkWindowHelper.getLogInfo()
  }

  async openLogDirectory(): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await coworkWindowHelper.openLogDirectory()
  }

  async getHostToolCatalog(params?: { scope?: HostToolScope; category?: string; query?: string }): Promise<HostToolCatalogResult> {
    return await coworkWindowHelper.getHostToolCatalog(params)
  }

  async setHostToolPolicy(params: { toolName: string; mode: HostToolPolicyMode }): Promise<HostToolPolicyResult> {
    return await coworkWindowHelper.setHostToolPolicy(params)
  }

  async getHostApprovalEvents(): Promise<HostApprovalHistoryResult> {
    return await coworkWindowHelper.getHostApprovalEvents()
  }

  async exportHostApprovalEvents(): Promise<HostApprovalExportResult> {
    return await coworkWindowHelper.exportHostApprovalEvents()
  }

  async clearHostApprovalEvents(): Promise<HostApprovalHistoryResult> {
    return await coworkWindowHelper.clearHostApprovalEvents()
  }

  async listIntegrationTargets(): Promise<IntegrationTargetSummary[]> {
    return await coworkWindowHelper.listIntegrationTargets()
  }

  async getIntegrationTarget(params: { targetId: string }): Promise<IntegrationTarget | null> {
    return await coworkWindowHelper.getIntegrationTarget(params)
  }

  async createIntegrationTargetFromCapture(params?: { name?: string; domain?: string }): Promise<IntegrationTargetCreateResult> {
    return await coworkWindowHelper.createIntegrationTargetFromCapture(params)
  }

  async createAiCrmsMigrationTarget(params: IntegrationMigrationTargetRequest): Promise<IntegrationTargetCreateResult> {
    return await coworkWindowHelper.createAiCrmsMigrationTarget(params)
  }

  async deleteIntegrationTarget(params: { targetId: string }): Promise<IntegrationTargetDeleteResult> {
    return await coworkWindowHelper.deleteIntegrationTarget(params)
  }

  async runIntegrationTargetDryRun(params: { targetId: string }): Promise<IntegrationTargetRunResult> {
    return await coworkWindowHelper.runIntegrationTargetDryRun(params)
  }

  async runIntegrationRecordedSiteDryRun(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {
    return await coworkWindowHelper.runIntegrationRecordedSiteDryRun(params)
  }

  async runIntegrationRecordedSitePlan(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {
    return await coworkWindowHelper.runIntegrationRecordedSitePlan(params)
  }

  async runIntegrationRecordedSiteApply(params: IntegrationRecordedSiteApplyRequest): Promise<IntegrationTargetRunResult> {
    return await coworkWindowHelper.runIntegrationRecordedSiteApply(params)
  }

  async runIntegrationMigration(params: IntegrationMigrationRunRequest): Promise<IntegrationTargetRunResult> {
    return await coworkWindowHelper.runIntegrationMigration(params)
  }

  async runIntegrationReportReadiness(params: IntegrationReportReadinessRequest): Promise<IntegrationTargetRunResult> {
    return await coworkWindowHelper.runIntegrationReportReadiness(params)
  }

  async setIntegrationTargetSchedule(params: IntegrationTargetScheduleRequest): Promise<IntegrationTargetScheduleResult> {
    return await coworkWindowHelper.setIntegrationTargetSchedule(params)
  }

  async listIntegrationMappings(params: IntegrationMappingListRequest): Promise<IntegrationMappingListResult> {
    return await coworkWindowHelper.listIntegrationMappings(params)
  }

  async upsertIntegrationMapping(params: IntegrationMappingUpsertRequest): Promise<IntegrationMappingWriteResult> {
    return await coworkWindowHelper.upsertIntegrationMapping(params)
  }

  async deleteIntegrationMapping(params: IntegrationMappingDeleteRequest): Promise<IntegrationMappingWriteResult> {
    return await coworkWindowHelper.deleteIntegrationMapping(params)
  }

  async listInjectedButtons(): Promise<InjectedButtonDomain[]> {
    return await coworkWindowHelper.listInjectedButtons()
  }

  async removeInjectedButtonDomain(params: { domain: string }): Promise<InjectedButtonRemoveResult> {
    return await coworkWindowHelper.removeInjectedButtonDomain(params)
  }

  async getCaptureOptions(): Promise<CaptureOptions> {
    return await coworkWindowHelper.getCaptureOptions()
  }

  async setCaptureOptions(params: Partial<CaptureOptions>): Promise<CaptureOptions> {
    return await coworkWindowHelper.setCaptureOptions(params)
  }

  async getCaptureState(): Promise<CaptureState> {
    return await coworkWindowHelper.getCaptureState()
  }

  async startCapture(params?: { mode?: CaptureMode } & Partial<CaptureOptions>): Promise<CaptureState> {
    return await coworkWindowHelper.startCapture(params)
  }

  async stopCapture(): Promise<CaptureState> {
    return await coworkWindowHelper.stopCapture()
  }

  async captureSnapshot(): Promise<SnapshotResult> {
    return await coworkWindowHelper.captureSnapshot()
  }

  async syncCaptureRecords(params: CaptureRecordSyncRequest): Promise<CaptureRecordSyncResult> {
    return await coworkWindowHelper.syncCaptureRecords(params)
  }

  async getCaptureRecords(): Promise<CaptureRecordSnapshot> {
    return await coworkWindowHelper.getCaptureRecords()
  }

  async clearCaptureRecordEdits(): Promise<{ ok: boolean }> {
    return await coworkWindowHelper.clearCaptureRecordEdits()
  }

  async exportRecording(params: { startedAt: number; records: IngestRecord[]; format?: CaptureExportFormat }): Promise<ExportRecordingResult> {
    return await coworkWindowHelper.exportRecording(params)
  }

  async replayBrowserRequest(params: BrowserRequestReplayRequest): Promise<BrowserRequestReplayResult> {
    return await coworkWindowHelper.replayBrowserRequest(params)
  }

  async sendAgentMessage(params: { message: string; sessionId?: string; context?: AgentConversationContext }): Promise<AgentReply> {
    return await coworkWindowHelper.sendAgentMessage(params)
  }

  async compactConversation(params: AgentCompactRequest): Promise<AgentCompactReply> {
    return await coworkWindowHelper.compactConversation(params)
  }

  async trainerMessage(params: { message: string; sessionId?: string; files?: { name: string; content: string }[] }): Promise<AgentReply> {
    return await coworkWindowHelper.trainerMessage(params)
  }

  async resetTrainerConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    return await coworkWindowHelper.resetTrainerConversation(params)
  }

  async delegateMessage(params: { message: string; sessionId?: string }): Promise<AgentReply> {
    return await coworkWindowHelper.delegateMessage(params)
  }

  async resetDelegateConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    return await coworkWindowHelper.resetDelegateConversation(params)
  }

  async abortAgent(params?: { sessionId?: string }): Promise<void> {
    await coworkWindowHelper.abortAgent(params)
  }

  async abortTrainer(params?: { sessionId?: string }): Promise<void> {
    await coworkWindowHelper.abortTrainer(params)
  }

  async abortDelegate(params?: { sessionId?: string }): Promise<void> {
    await coworkWindowHelper.abortDelegate(params)
  }

  async summarizeSkill(params: { workflow?: string; records: IngestRecord[] }): Promise<SkillCreateResult> {
    return await coworkWindowHelper.summarizeSkill(params)
  }

  async listSkills(): Promise<SkillSummary[]> {
    return await coworkWindowHelper.listSkills()
  }

  async getSkillDetail(params: { skillId: string }): Promise<SkillDetail | null> {
    return await coworkWindowHelper.getSkillDetail(params)
  }

  async openSkillDirectory(params: { skillId: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await coworkWindowHelper.openSkillDirectory(params)
  }

  async exportSkillPackage(params: { skillId: string }): Promise<SkillExportResult> {
    return await coworkWindowHelper.exportSkillPackage(params)
  }

  async importSkillPackage(): Promise<SkillImportResult> {
    return await coworkWindowHelper.importSkillPackage()
  }

  async openDomainDirectory(params: { domain: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await coworkWindowHelper.openDomainDirectory(params)
  }

  async attachFiles(params: { sessionId?: string; paths: string[] }): Promise<AttachFileResult[]> {
    return await coworkWindowHelper.attachFiles(params)
  }

  async attachClipboardImage(params?: { sessionId?: string }): Promise<AttachFileResult> {
    return await coworkWindowHelper.attachClipboardImage(params)
  }

  async scribeAudio(params: AudioScribeRequest): Promise<AudioScribeResult> {
    return await coworkWindowHelper.scribeAudio(params)
  }

  async chooseWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    return await coworkWindowHelper.chooseWorkspaceDirectory(params)
  }

  async setWorkspaceDirectory(params: { sessionId?: string; path?: string }): Promise<WorkspaceRefResult> {
    return await coworkWindowHelper.setWorkspaceDirectory(params)
  }

  async getWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    return await coworkWindowHelper.getWorkspaceDirectory(params)
  }

  async getFileStatuses(params: { paths: string[] }): Promise<FileStatusResult[]> {
    return await coworkWindowHelper.getFileStatuses(params)
  }

  async openFile(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await coworkWindowHelper.openFile(params)
  }

  async showFileInFolder(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await coworkWindowHelper.showFileInFolder(params)
  }

  async trainSkill(params: { skillId: string; guidance: string }): Promise<SkillCreateResult> {
    return await coworkWindowHelper.trainSkill(params)
  }

  async deleteSkill(params: { skillId: string }): Promise<DeleteSkillResult> {
    return await coworkWindowHelper.deleteSkill(params)
  }

  async replaySkill(params: { skillId: string; variables: Record<string, string> }): Promise<ReplayResult> {
    return await coworkWindowHelper.replaySkill(params)
  }

  async getLlmConfig(): Promise<LlmConfig> {
    return await coworkWindowHelper.getLlmConfig()
  }

  async setLlmConfig(params: { provider: string; model: string; effort?: LlmEffort }): Promise<LlmConfig> {
    return await coworkWindowHelper.setLlmConfig(params)
  }

  async setLlmCompression(params: { provider: string; model: string; compressionRemainingPercent: number }): Promise<LlmConfig> {
    return await coworkWindowHelper.setLlmCompression(params)
  }

  async setViewBounds(params: { operation: ViewRect; control: ViewRect }): Promise<void> {
    coworkWindowHelper.setViewBounds(params)
  }

  async activateTab(params: { id: string }): Promise<void> {
    await coworkWindowHelper.activateTab(params)
  }

  async reorderTabs(params: { ids: string[] }): Promise<void> {
    await coworkWindowHelper.reorderTabs(params)
  }

  async closeTab(params: { id: string }): Promise<void> {
    await coworkWindowHelper.closeTab(params)
  }

  async getTabs(): Promise<TabInfo[]> {
    return coworkWindowHelper.getTabs()
  }

  async restoreTabs(params: { tabs: SavedTab[] }): Promise<void> {
    await coworkWindowHelper.restoreTabs(params)
  }

  async loginLlm(params: { provider: string; method: LlmLoginMethod }): Promise<LlmConfig> {
    return await coworkWindowHelper.loginLlm(params)
  }

  async loginCodex(params: { method: string }): Promise<LlmConfig> {
    return await coworkWindowHelper.loginCodex(params)
  }

  async logoutLlm(params?: { provider?: string }): Promise<LlmConfig> {
    return await coworkWindowHelper.logoutLlm(params)
  }

  async logoutCodex(): Promise<LlmConfig> {
    return await coworkWindowHelper.logoutCodex()
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    return await updateService.checkForUpdates()
  }

  async quitAndInstall(): Promise<void> {
    updateService.quitAndInstall()
  }
}

export const coachXpcHandler = new CoachXpcHandler()
