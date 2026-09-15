import { XpcMainHandler } from 'electron-xpc/main'
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller'
import { getMaestroPreviewOpener } from '@maestro-main/windows/main/previewOpener.registry'
import { updateService } from '@maestro-main/update/update.service'
import { taskRegistry } from '@maestro-main/tasks/taskRegistry.service'
import { sessionTitleService } from '@main/agent/sessionTitle.service';
import type { MaestroTask } from '@maestro-shared/task.api'
import type {
  AgentConversationContext,
  ContextExportRequest,
  ContextExportSummary,
  ContextGraphRequest,
  ContextGraphResult,
  SessionIoPathResult,
  AgentCompactReply,
  AgentCompactRequest,
  AgentMessageRequest,
  AgentReply,
  AgentTurnClaimRequest,
  AgentTurnClaimResult,
  AgentTurnRecoverySnapshot,
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
  async getAgentBrowserSession(params: { sessionId: string }): ReturnType<CoachXpcContract['getAgentBrowserSession']> {
    return maestroWindowHelper.getAgentBrowserSession(params)
  }

  async showAgentBrowserTab(params: { sessionId: string; tabId: string }): ReturnType<CoachXpcContract['showAgentBrowserTab']> {
    return maestroWindowHelper.showAgentBrowserTab(params)
  }

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

  async showNewTabMenu(params: { x: number; y: number }): Promise<void> {
    await maestroWindowHelper.showNewTabMenu(params)
  }

  async showPageTypeMenu(params: { tabId: string; x: number; y: number }): Promise<void> {
    await maestroWindowHelper.showPageTypeMenu(params)
  }

  async showTabMenu(params: { id: string }): Promise<void> {
    await maestroWindowHelper.showTabMenu(params)
  }

  async openDemo(): Promise<{ url: string }> {
    return await maestroWindowHelper.openDemo()
  }

  async getWorkbenchTab(): ReturnType<CoachXpcContract['getWorkbenchTab']> {
    return await maestroWindowHelper.getWorkbenchTab()
  }

  async openWorkbenchTab(): ReturnType<CoachXpcContract['openWorkbenchTab']> {
    return await maestroWindowHelper.openWorkbenchTab()
  }

  async backgroundWorkbenchTab(): ReturnType<CoachXpcContract['backgroundWorkbenchTab']> {
    return await maestroWindowHelper.backgroundWorkbenchTab()
  }

  async closeWorkbenchTab(): ReturnType<CoachXpcContract['closeWorkbenchTab']> {
    return await maestroWindowHelper.closeWorkbenchTab()
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

  async claimAgentTurn(params: AgentTurnClaimRequest): Promise<AgentTurnClaimResult> {
    return maestroWindowHelper.claimAgentTurn(params)
  }

  async getActiveAgentTurn(): Promise<AgentTurnRecoverySnapshot> {
    return maestroWindowHelper.getActiveAgentTurn()
  }

  async ackAgentTurnFinished(params: { sessionId: string; turnId: string }): Promise<void> {
    maestroWindowHelper.ackAgentTurnFinished(params)
  }

  async sendAgentMessage(params: AgentMessageRequest): Promise<AgentReply> {
    return await maestroWindowHelper.sendAgentMessage(params)
  }

  async copyNextTurnContext(params: ContextExportRequest): Promise<ContextExportSummary> {
    return await maestroWindowHelper.copyNextTurnContext(params)
  }

  async readContextGraph(params: ContextGraphRequest): Promise<ContextGraphResult> {
    return await maestroWindowHelper.readContextGraph(params)
  }

  async copySessionIoPath(params: { sessionId: string }): Promise<SessionIoPathResult> {
    return await maestroWindowHelper.copySessionIoPath(params)
  }

  async showSessionMenu(params: { sessionId: string }): ReturnType<CoachXpcContract['showSessionMenu']> {
    return maestroWindowHelper.showSessionMenu(params)
  }

  async editControlText(params: { action: 'undo' }): ReturnType<CoachXpcContract['editControlText']> {
    return maestroWindowHelper.editControlText(params);
  }

  async generateSessionTitle(params: Parameters<CoachXpcContract['generateSessionTitle']>[0]): ReturnType<CoachXpcContract['generateSessionTitle']> {
    return sessionTitleService.generate(params);
  }

  async compactConversation(params: AgentCompactRequest): Promise<AgentCompactReply> {
    return await maestroWindowHelper.compactConversation(params)
  }

  async delegateMessage(params: { message: string; sessionId?: string }): Promise<AgentReply> {
    return await maestroWindowHelper.delegateMessage(params)
  }

  async resetDelegateConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    return await maestroWindowHelper.resetDelegateConversation(params)
  }

  async abortAgent(params: { sessionId: string; turnId: string }): Promise<void> {
    await maestroWindowHelper.abortAgent(params)
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

  async openCompositeTab(params: { id: string }): Promise<void> {
    await maestroWindowHelper.openCompositeTab(params)
  }

  /**
   * Open a workspace directory in OnlyPreview's tab (Ral 2026-09-07).
   *
   * The chat workspace chip used to put the folder picker behind its label, so "click the folder you
   * are already in" answered by asking which folder you wanted — the same mismatch the Cowork port
   * had, and the same fix: the label opens, a separate control switches.
   *
   * Order matters. The composite tab is built FIRST, because `openOnlyPreviewAbsoluteTarget` runs
   * through `ensureStandalone()`, which returns the existing host when one is already mounted and
   * otherwise creates a standalone WINDOW — hand it the target first and the button spawns a window
   * instead of filling the tab.
   */
  async openWorkspaceInPreview(params: { path: string }): Promise<{ ok: boolean; error?: string }> {
    // 走**宿主注册的那个 preview 槽**,而不是直接开某个 composite tab。
    //
    // 「开哪一种承载」是宿主才知道的事:OnlyPreview 可能已经被切成一个独立窗口,那时正确动作是
    // 复用它而不是新建 tab(`docs/issues/onlypreview-detached-window-gets-a-second-tab.md`)。
    // 这个槽本来就是为此存在的(EyesOnAgents 也用它),而 maestro 这棵树不许 import OnlyPreview,
    // 所以判断只能在槽的那一端。
    const opener = getMaestroPreviewOpener()
    if (!opener) {
      // 没有宿主注册预览应用的构建 —— 退回既有的「开 tab 再交目标」。
      return await maestroWindowHelper.openWorkspaceInPreview(params)
    }
    const target = String(params?.path || '').trim()
    if (!target) return { ok: false, error: 'A path is required.' }
    try {
      await opener.open(target)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  /**
   * 会话解除工作区绑定时,同时解绑预览中匹配的 Project,保留预览 tab/窗口。
   *
   * 没有注册预览应用的构建里这是一个**无操作**,不是错误:那种构建里工作区从来没有被打开过,
   * 所以也没有预览绑定需要解除。
   */
  async closeWorkspacePreview(params: { path: string }): Promise<{ ok: boolean; error?: string }> {
    const target = String(params?.path || '').trim()
    if (!target) return { ok: false, error: 'A path is required.' }
    const opener = getMaestroPreviewOpener()
    if (!opener) return { ok: true }
    try {
      await opener.closeForPath(target)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
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
