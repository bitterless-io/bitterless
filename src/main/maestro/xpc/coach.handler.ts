import { agentDecisionRegistry } from '@main/agent/decisionRegistry.service';
import type { AgentDecisionAnswer, AgentDecisionRequest } from '@shared/agentDecision.api';
import type { SkillInstallationRequest, SessionIoExportResult, SessionIoExportTarget } from '@maestro-shared/coach.api'
import type { SkillSharingScope, SkillScopeContextInfo } from '@maestro-shared/coach.api'
import { XpcMainHandler } from 'electron-xpc/main'
import { applicationAuth } from '@main/auth/applicationAuth.service';
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
  async requestLogin(): Promise<void> { maestroWindowHelper.requestLogin(); }
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

  async openTab(params: { url: string; background?: boolean }): Promise<void> {
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

  async showWorkbenchTabMenu(): Promise<void> {
    await maestroWindowHelper.showWorkbenchTabMenu()
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
    await applicationAuth.requireReady();
    await maestroWindowHelper.resumeAuthenticatedSession();
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

  async ensureSessionIo(params: Parameters<CoachXpcContract['ensureSessionIo']>[0]): Promise<SessionIoPathResult> {
    return maestroWindowHelper.ensureSessionIo(params)
  }

  async copySessionIoPath(params: { sessionId: string }): Promise<SessionIoPathResult> {
    return await maestroWindowHelper.copySessionIoPath(params)
  }

  async pickSessionIoExportTarget(params: { sessionId: string }): Promise<SessionIoExportTarget> {
    return await maestroWindowHelper.pickSessionIoExportTarget(params);
  }

  async writeSessionIoArchive(params: { sessionId: string; target: string }): Promise<SessionIoExportResult> {
    return await maestroWindowHelper.writeSessionIoArchive(params);
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

  // **回执必须原样返回。** renderer 的 `stop()` 只认 `{ ok: true }`,收到别的就判停止失败、
  // 不执行 `forceStop`,于是回合永远不清 —— 一次成功的停止在界面上变成永久的「Stopping…」。
  // 这里曾经声明 `Promise<void>` 并把返回值扔掉,`tsc` 为此报了 TS2416
  // (见 docs/issues/chat-stop-never-confirms-and-the-ui-has-no-escape.md #3)。
  async abortAgent(params: { sessionId: string; turnId: string }): Promise<{ ok: true }> {
    return await maestroWindowHelper.abortAgent(params)
  }

  async abortDelegate(params?: { sessionId?: string }): Promise<void> {
    await maestroWindowHelper.abortDelegate(params)
  }

  async summarizeSkill(params: { workflow?: string; records: IngestRecord[]; sharingScope?: SkillSharingScope }): Promise<SkillCreateResult> {
    return await maestroWindowHelper.summarizeSkill(params)
  }

  async listSkills(params?: { sessionId?: string }): Promise<SkillSummary[]> { return maestroWindowHelper.listSkills(params) }
  async skillCatalog(params?: { sessionId?: string; checkUpdates?: boolean }) { return maestroWindowHelper.skillCatalog(params) }
  async setSkillEnabled(params: { reference: string; enabled: boolean; sessionId?: string }): Promise<void> { return maestroWindowHelper.setSkillEnabled(params) }
  async manageSkillInstallation(params: SkillInstallationRequest) { return maestroWindowHelper.manageSkillInstallation(params) }
  async diagnoseSkill(params: { reference: string; sessionId?: string }) { return maestroWindowHelper.diagnoseSkill(params) }
  async setSkillViewContext(params: { sessionId: string; workspace?: { path: string; name: string; exists: boolean; updatedAt: number } }) { return maestroWindowHelper.setSkillViewContext(params) }
  async openSkillFile(params: { skillId: string; sessionId?: string }) { return maestroWindowHelper.openSkillFile(params) }
  async openSkillSource(params: { layer: 'global' | 'workspace' | 'institution'; sessionId?: string }) { return maestroWindowHelper.openSkillSource(params) }

  async getSkillDetail(params: { skillId: string }): Promise<SkillDetail | null> {
    return await maestroWindowHelper.getSkillDetail(params)
  }

  async openSkillDirectory(params: { skillId: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await maestroWindowHelper.openSkillDirectory(params)
  }

  async exportSkillPackage(params: { skillId: string }): Promise<SkillExportResult> {
    return await maestroWindowHelper.exportSkillPackage(params)
  }

  async assignSkillScope(params: { skillId: string; sharingScope: SkillSharingScope }): Promise<SkillImportResult> {
    return await maestroWindowHelper.assignSkillScope(params)
  }

  async getSkillScopeContext(): Promise<SkillScopeContextInfo | null> {
    return await maestroWindowHelper.getSkillScopeContext()
  }

  async importSkillPackage(params?: { sharingScope?: SkillSharingScope }): Promise<SkillImportResult> {
    return await maestroWindowHelper.importSkillPackage(params)
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

  async adoptPreviewWorkspaceDirectory(params: { sessionId: string }): Promise<WorkspaceRefResult> {
    return await maestroWindowHelper.adoptPreviewWorkspaceDirectory(params)
  }

  async releaseWorkspaceBinding(params: { sessionId: string; path: string }): Promise<{ ok: true }> {
    return await maestroWindowHelper.releaseWorkspaceBinding(params)
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
  /** 当前待人拍板的 decision —— 渲染端据此把它们投影成底面的卡。 */
  async listAgentDecisions(): Promise<AgentDecisionRequest[]> {
    return agentDecisionRegistry.list();
  }

  /** 人点了提交或取消。同一个 `decisionId` 只认第一次。 */
  async respondAgentDecision(params: AgentDecisionAnswer): Promise<{ ok: boolean }> {
    return agentDecisionRegistry.resolve(params);
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

  async setCompactPrompt(params: { compactPrompt: string }): Promise<LlmConfig> {
    return await maestroWindowHelper.setCompactPrompt(params)
  }

  async testAutoCompaction(params: { sessionId: string; filePath?: string }): Promise<import('@shared/piCompactionTest.types').AutoCompactionTestReport> {
    return await maestroWindowHelper.testAutoCompaction(params)
  }

  async deleteNativeSession(params: { sessionId: string }): Promise<{ ok: true }> {
    return await maestroWindowHelper.deleteNativeSession(params)
  }

  async cancelCompaction(params: { sessionId: string }): Promise<void> {
    await maestroWindowHelper.cancelCompaction(params)
  }

  async compactSession(params: { sessionId: string; instructions?: string }): Promise<AgentCompactReply & { tokensBefore?: number; estimatedTokensAfter?: number }> {
    return await maestroWindowHelper.compactSession(params)
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
  async openWorkspaceInPreview(params: { path: string; line?: number }): Promise<{ ok: boolean; error?: string }> {
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
      await opener.open(target, { line: params?.line })
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

  /**
   * tab 条的 `×`。走 `closeTabByUser` 而不是 `closeTab` —— 这是渲染层唯一的关闭调用,也就是人点的
   * 那一下,所以它要过 Zellij 确认那一道(docs/features/maestro-zellij-close-confirm.md #3)。
   */
  async closeTab(params: { id: string }): Promise<void> {
    await maestroWindowHelper.closeTabByUser(params)
  }

  async setTabAlias(params: { id: string; alias: string }): Promise<void> {
    await maestroWindowHelper.setTabAlias(params)
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
