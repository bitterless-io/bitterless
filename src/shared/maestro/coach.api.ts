import type { CaptureMode, TraceEvent } from './trace.types'
import type { SavedTab } from './tabs.api'
import type { CaptureRule } from './captureFilter.api'
import type { InjectBtnEntry } from './injectBtn.api'
import type { MaestroTask } from './task.api'

export const DEFAULT_COACH_START_URL = 'https://example.com'
export const MAESTRO_HOME_READY_TOKEN_QUERY = 'maestroReadyToken'
export const MAESTRO_FORCE_PINNED_HOME_QUERY = 'maestroForcePinnedHome'
export const MAESTRO_FORCE_PINNED_HOME_QUERY_VALUE = '1'
export const MAESTRO_LOCAL_HOME_DISPLAY_URL = 'bitterless://home'
export const MAESTRO_WORKBENCH_DISPLAY_URL = 'bitterless://workbench'

export interface WorkbenchTabState {
  open: boolean
  visible: boolean
}

export interface HomeRendererReadyParams {
  token: string
}

export interface HomeRendererReadyResult {
  accepted: boolean
}

// The type-safe XPC contract exposed by CoachXpcHandler in the main process.
// Handler methods intentionally accept at most one object parameter, matching
// electron-xpc's handler/emitter pattern.
export interface CoachXpcContract {
  homeRendererReady(params: HomeRendererReadyParams): Promise<HomeRendererReadyResult>
  getSettings(): Promise<CoachSettings>
  saveSettings(params: Partial<CoachSettings>): Promise<CoachSettings>
  navigate(params: { url: string }): Promise<void>
  // Reload the active tab's page (works on the pinned home tab too — it reloads, not navigates).
  reload(): Promise<void>
  // History navigation of the active tab (no-ops when unavailable or when the pinned Home tab
  // is active).
  goBack(): Promise<void>
  goForward(): Promise<void>
  // Manual per-tab CDP debugger control. Tabs default to enabled; disabling detaches the debugger
  // for external login pages where DevTools/CDP attachment is undesirable.
  setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]>
  openDemo(): Promise<{ url: string }>
  getWorkbenchTab(): Promise<WorkbenchTabState>
  openWorkbenchTab(): Promise<WorkbenchTabState>
  backgroundWorkbenchTab(): Promise<WorkbenchTabState>
  closeWorkbenchTab(): Promise<WorkbenchTabState>
  // App identity for Workbench ▸ About — picked from the bundled package.json (see
  // MaestroWindowController.getPackageInfo mirrors the host package helper.
  getPackageInfo(): Promise<PackageInfo>
  // Host-approved log file/dir/env for Workbench ▸ Log.
  getLogInfo(): Promise<LogInfo>
  // Reveal the log directory in Finder/Explorer (shell.openPath) — mirrors openSkillDirectory.
  openLogDirectory(): Promise<{ ok: boolean; path?: string; error?: string }>
  // Read the provider-neutral host tool catalog shown to agents and Workbench.
  getHostToolCatalog(params?: { scope?: HostToolScope; category?: string; query?: string }): Promise<HostToolCatalogResult>
  setHostToolPolicy(params: { toolName: string; mode: HostToolPolicyMode }): Promise<HostToolPolicyResult>
  getHostApprovalEvents(): Promise<HostApprovalHistoryResult>
  exportHostApprovalEvents(): Promise<HostApprovalExportResult>
  clearHostApprovalEvents(): Promise<HostApprovalHistoryResult>
  listInjectedButtons(): Promise<InjectedButtonDomain[]>
  removeInjectedButtonDomain(params: { domain: string }): Promise<InjectedButtonRemoveResult>
  getCaptureOptions(): Promise<CaptureOptions>
  setCaptureOptions(params: Partial<CaptureOptions>): Promise<CaptureOptions>
  getCaptureState(): Promise<CaptureState>
  startCapture(params?: { mode?: CaptureMode } & Partial<CaptureOptions>): Promise<CaptureState>
  stopCapture(): Promise<CaptureState>
  captureSnapshot(): Promise<SnapshotResult>
  // Renderer-edited capture view (deleted rows removed, per-row spec/flagged kept). Agent capture
  // tools and ingest_recording prefer this when present; raw traceEvents remain the fallback.
  syncCaptureRecords(params: CaptureRecordSyncRequest): Promise<CaptureRecordSyncResult>
  getCaptureRecords(): Promise<CaptureRecordSnapshot>
  clearCaptureRecordEdits(): Promise<{ ok: boolean }>
  exportRecording(params: { startedAt: number; records: IngestRecord[]; format?: CaptureExportFormat }): Promise<ExportRecordingResult>
  replayBrowserRequest(params: BrowserRequestReplayRequest): Promise<BrowserRequestReplayResult>
  claimAgentTurn(params: AgentTurnClaimRequest): Promise<AgentTurnClaimResult>
  getActiveAgentTurn(): Promise<AgentTurnRecoverySnapshot>
  ackAgentTurnFinished(params: { sessionId: string; turnId: string }): Promise<void>
  sendAgentMessage(params: AgentMessageRequest): Promise<AgentReply>
  copyNextTurnContext(params: ContextExportRequest): Promise<ContextExportSummary>
  /**
   * `/view_context_graph` —— 同一份组装的**结构投影**:类型、体量、上下文回合、压缩边界。
   *
   * 与 `copyNextTurnContext` 的分工:那条出的是**正文**(逐字、不截断,所以原则上无界 ⇒ 它去剪贴板,
   * 不过 xpc);这条出的是**结构**,每块只带一小段 preview(≤160),而且被压缩吸收的条目
   * **只汇总不逐条列** —— 它们模型已经看不到,逐条列出来就是把结构画错(契约
   * `docs/features/maestro-context-graph.md` #1 / #4)。**因此这条的载荷有界,可以安全地过 xpc。**
   *
   * 组装在 main(`main/agent/contextGraph.service.ts`),与 `/view_context` 共用同一份展平映射。
   */
  readContextGraph(params: ContextGraphRequest): Promise<ContextGraphResult>
  /**
   * 这个聊天会话的**模型 I/O jsonl 目录绝对路径** —— 写进剪贴板并回给渲染端
   * (`/copy_session_path`,契约 `docs/features/maestro-slash-commands.md`)。
   *
   * 复制的是**目录**而不是单个文件:一个会话的 io 按 `part-NNN.jsonl` 分卷
   * (`modelIoLog.append` 到量就换卷),给一个文件名等于只交出其中一段。
   * 不新建任何审计子系统 —— 它只是把 `modelIoLog` 已经在写的那个目录说出来。
   */
  ensureSessionIo(params: { sessionId: string; workspace?: WorkspaceRef }): Promise<SessionIoPathResult>
  copySessionIoPath(params: { sessionId: string; workspace?: WorkspaceRef }): Promise<SessionIoPathResult>
  showSessionMenu(params: { sessionId: string }): Promise<SessionMenuResult>
  // Editable Cmd/Ctrl+Z reaches Chromium's undo stack in the fixed, focused Control view.
  editControlText(params: { action: 'undo' }): Promise<{ ok: boolean; error?: string }>;
  generateSessionTitle(params: SessionTitleRequest): Promise<SessionTitleResult>;
  compactConversation(params: AgentCompactRequest): Promise<AgentCompactReply>
  // Delegate chat: agent acts AS the user toward the user's customer (the message sender).
  delegateMessage(params: { message: string; sessionId?: string }): Promise<AgentReply>
  resetDelegateConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }>
  // Stop the in-flight turn for a chat channel (the Stop button): aborts the live pi session so
  // the pending turn resolves. The agent session is then dropped so aborted output is not carried
  // into later model context.
  abortAgent(params: { sessionId: string; turnId: string }): Promise<{ ok: true }>
  abortDelegate(params?: { sessionId?: string }): Promise<void>
  listTasks(): Promise<MaestroTask[]>
  respondTaskConfirm(params: { taskId: string; confirmId: string; confirm: boolean }): Promise<{ ok: boolean }>
  // Ingest the CURRENT, non-deleted records (each carrying its source event + the
  // operator `spec`) plus the overall workflow description into a skill. The renderer
  // is the source of truth here — NOT the main process's raw trace buffer.
  summarizeSkill(params: { workflow?: string; records: IngestRecord[]; sharingScope?: SkillSharingScope }): Promise<SkillCreateResult>
  trainSkill(params: { skillId: string; guidance: string }): Promise<SkillCreateResult>
  listSkills(params?: { sessionId?: string }): Promise<SkillSummary[]>
  skillCatalog(params?: { sessionId?: string; checkUpdates?: boolean }): Promise<SkillCatalogSnapshot>
  setSkillEnabled(params: { reference: string; enabled: boolean; sessionId?: string }): Promise<void>
  manageSkillInstallation(params: SkillInstallationRequest): Promise<SkillInstallationResult>
  diagnoseSkill(params: { reference: string; sessionId?: string }): Promise<SkillRuntimeDiagnostics>
  setSkillViewContext(params: { sessionId: string; workspace?: { path: string; name: string; exists: boolean; updatedAt: number } }): Promise<void>
  openSkillFile(params: { skillId: string; sessionId?: string }): Promise<{ ok: boolean; error?: string }>
  openSkillSource(params: { layer: SkillLayer; sessionId?: string }): Promise<{ ok: boolean; error?: string }>
  getSkillDetail(params: { skillId: string }): Promise<SkillDetail | null>
  openSkillDirectory(params: { skillId: string }): Promise<{ ok: boolean; path?: string; error?: string }>
  exportSkillPackage(params: { skillId: string }): Promise<SkillExportResult>
  importSkillPackage(params?: { sharingScope?: SkillSharingScope }): Promise<SkillImportResult>
  assignSkillScope(params: { skillId: string; sharingScope: SkillSharingScope }): Promise<SkillImportResult>
  getSkillScopeContext(): Promise<SkillScopeContextInfo | null>
  // Reveal the folder holding ALL skills for a domain ('' → the skills root).
  openDomainDirectory(params: { domain: string }): Promise<{ ok: boolean; path?: string; error?: string }>
  // Register user-attached files (by ABSOLUTE PATH — never bytes) into the chat session's
  // read_file allowlist; main stats/validates each and reads them in place on demand.
  attachFiles(params: { sessionId?: string; paths: string[] }): Promise<AttachFileResult[]>
  // Materialize the current system clipboard image into userData and register that file path.
  // Used for pasted screenshots: no image bytes cross renderer↔main or model boundaries.
  attachClipboardImage(params?: { sessionId?: string }): Promise<AttachFileResult>
  chooseWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult>
  adoptPreviewWorkspaceDirectory(params: { sessionId: string }): Promise<WorkspaceRefResult>
  // Drops one session's binding without touching the remembered default.
  releaseWorkspaceBinding(params: { sessionId: string; path: string }): Promise<{ ok: true }>
  setWorkspaceDirectory(params: { sessionId?: string; path?: string }): Promise<WorkspaceRefResult>
  getWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult>
  getFileStatuses(params: { paths: string[] }): Promise<FileStatusResult[]>
  openFile(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }>
  showFileInFolder(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }>
  fileThumbnail(params: { path: string }): Promise<{
    ok: boolean
    dataUrl?: string
    width?: number
    height?: number
    error?: string
  }>
  deleteSkill(params: { skillId: string }): Promise<DeleteSkillResult>
  replaySkill(params: { skillId: string; variables: Record<string, string> }): Promise<ReplayResult>
  getLlmConfig(): Promise<LlmConfig>
  setLlmConfig(params: { provider: string; model: string; effort?: LlmEffort }): Promise<LlmConfig>
  setCompactPrompt(params: { compactPrompt: string }): Promise<LlmConfig>
  testAutoCompaction(params: { sessionId: string; filePath?: string }): Promise<import('@shared/piCompactionTest.types').AutoCompactionTestReport>
  deleteNativeSession(params: { sessionId: string }): Promise<{ ok: true }>
  cancelCompaction(params: { sessionId: string }): Promise<void>
  compactSession(params: { sessionId: string; instructions?: string }): Promise<AgentCompactReply & { tokensBefore?: number; estimatedTokensAfter?: number }>
  setLlmCompression(params: { provider: string; model: string; compressionRemainingPercent: number }): Promise<LlmConfig>
  // Geometry pushed from the home renderer: the operation/control placeholders in
  // Layout.vue define where the main process layers the native WebContentsViews.
  setViewBounds(params: { operation: ViewRect; control: ViewRect }): Promise<void>
  // Multi-tab: each tab is its own operation-view WebContentsView; tabs are opened
  // when the active page opens a new window. The active tab is what capture / replay
  // / the agent target. The home renderer drives switching/closing via these.
  // Open a new blank tab (empty operation view) and make it active.
  newTab(): Promise<void>
  requestLogin(): Promise<void>
  // Open `url` in a NEW tab and activate it — atomic: the tab is born with the URL and loaded into
  // its OWN view (not the active view), so it can't desync the current tab. Used by Demo / "open in
  // new tab". Empty url → same as newTab().
  //
  // `background: true` builds and loads the tab WITHOUT activating it: it appears on the strip and
  // finishes loading while the operator stays on the current page (history-row-opens-background-tab.md
  // #3.1). Only meaningful for a plain web tab born with a URL — the empty-url and Workbench-singleton
  // branches foreground by design and ignore it.
  openTab(params: { url: string; background?: boolean }): Promise<void>
  /**
   * Open a registered composite mini app as a tab in this window, or bring the existing one forward.
   *
   * Its content is the mini app's own container view rather than one web page, so it carries no URL
   * and is never cooled by the warm cap. `id` is the registered spec id, e.g. `'onlypreview'`.
   */
  openCompositeTab(params: { id: string }): Promise<void>
  // Hover the + button → native menu: a blank tab, or one of the registered composite mini apps.
  // `x`/`y` are window-content-relative DIP, measured by the button itself.
  showNewTabMenu(params: { x: number; y: number }): Promise<void>
  /**
   * 地址栏左侧 `menubar__pagetype__button` → 原生菜单:把这个 tab 换成 Website 或某个 mini-app。
   *
   * 只送锚点,不送选择结果 —— 菜单项的 click 在 main 里直接改状态并 `broadcastTabs()`,
   * 所以没有对应的 `setTabKind` 上线。`x`/`y` 是窗口内容坐标系的 DIP,由按钮自己测。
   */
  showPageTypeMenu(params: { tabId: string; x: number; y: number }): Promise<void>
  /**
   * 在 OnlyPreview 的 tab 里打开一个绝对目录。
   *
   * 与「切换工作区」是两件事:那个开选择器,这个显示你已经在的那个目录。
   */
  openWorkspaceInPreview(params: { path: string }): Promise<{ ok: boolean; error?: string }>
  /** 这个会话不再用这个工作区了 —— 预览应用开着的正是它时把它一起收掉(Ral 2026-09-10)。 */
  closeWorkspacePreview(params: { path: string }): Promise<{ ok: boolean; error?: string }>
  activateTab(params: { id: string }): Promise<void>
  // Reorder the visible tab strip by current tab ids. Main validates against the live tab set and
  // keeps pinned tabs fixed; home persists the rebroadcast order.
  reorderTabs(params: { ids: string[] }): Promise<void>
  /**
   * 人点的关闭(tab 条的 `×`)。
   *
   * 关闭范围里有 Zellij tab 时,main 会先弹一次确认 —— 所以这条**不是**一个静默的 `closeTab`,
   * 它可能什么都不做(docs/features/maestro-zellij-close-confirm.md #3)。
   */
  closeTab(params: { id: string }): Promise<void>
  /**
   * 就地改名:把 alias 写回一个 tab,空串 = 删除别名、退回页面/spec 的 title。
   *
   * main 侧**只认 Zellij tab**,其余一律忽略(docs/features/zellij-tab-inline-rename.md #2)。
   */
  setTabAlias(params: { id: string; alias: string }): Promise<void>
  getTabs(): Promise<TabInfo[]>
  getAgentBrowserSession(params: { sessionId: string }): Promise<AgentBrowserSessionState>
  showAgentBrowserTab(params: { sessionId: string; tabId: string }): Promise<{ ok: boolean; error?: string }>
  // Restore persisted tabs the home renderer read from the sqlite store (renderer-driven
  // persistence): main recreates them as cold tabs after the pinned Home tab. Idempotent.
  restoreTabs(params: { tabs: SavedTab[] }): Promise<void>
  // Right-click a tab → native context menu (built + popped in the main process, so it
  // renders above the operation view).
  showTabMenu(params: { id: string }): Promise<void>
  /**
   * Right-click the Workbench chip → the SAME native menu, with the rows that cannot apply to it
   * greyed out rather than hidden.
   *
   * It takes no id on purpose: the Workbench is not an `OperationTab` (two booleans on
   * `WorkbenchViewService`, not a row of `tabs`), so `showTabMenu` could only serve it through a
   * synthetic id — which would turn its "unknown id → return" guard into something bypassable.
   */
  showWorkbenchTabMenu(): Promise<void>
  // Sign in to a selectable LLM provider. Main rejects hidden/unknown provider IDs.
  // Codex supports 'browser' and 'device_code'; Local account login lives in Configuration.
  loginLlm(params: { provider: string; method: LlmLoginMethod }): Promise<LlmConfig>
  // Back-compat wrapper for older renderer code.
  loginCodex(params: { method: string }): Promise<LlmConfig>
  // Sign out of a provider (defaults to the active provider); returns the refreshed config.
  logoutLlm(params?: { provider?: string }): Promise<LlmConfig>
  // Back-compat wrapper for older renderer code.
  logoutCodex(): Promise<LlmConfig>
  // Auto-update (see features/release-and-update.md §5). Polling runs automatically in
  // UpdateService; checkForUpdates forces an immediate version_info poll, quitAndInstall installs
  // the downloaded build & relaunches. Update availability flows back on
  // 'coach/update-available' ({ version, versionCode }); readiness flows back on
  // 'coach/update-downloaded' ({ version, versionCode }).
  checkForUpdates(): Promise<UpdateCheckResult>
  getReadyUpdate(): Promise<UpdateInfo | null>
  quitAndInstall(): Promise<void>
}

export interface UpdateInfo {
  version: string
  versionCode: string
}

export type UpdateCheckStatus = 'available' | 'latest' | 'disabled' | 'unsupported' | 'error'

export interface UpdateCheckResult {
  status: UpdateCheckStatus
  currentVersionCode: string
  info?: UpdateInfo
  error?: string
}

// One record handed to ingest: the (shot-stripped) source trace event plus the
// operator's per-record `spec` note. The set is the non-deleted Record rows.
export interface IngestRecord {
  event: TraceEvent
  spec?: string
  flagged?: boolean
}

export interface CaptureRecordSyncRequest {
  startedAt?: number
  workflow?: string
  records: IngestRecord[]
}

export interface CaptureRecordSyncResult {
  ok: boolean
  count: number
  updatedAt: number
}

export interface CaptureRecordSnapshot {
  ok: boolean
  source: 'edited' | 'raw' | 'none'
  startedAt?: number
  workflow?: string
  updatedAt?: number
  records: IngestRecord[]
  error?: string
}

export interface BrowserRequestReplayRequest {
  url: string
  method?: string
  query?: Record<string, string | number | boolean>
  headers?: Record<string, string>
  body?: unknown
}

export interface BrowserRequestReplayResult {
  ok: boolean
  status: number
  data?: unknown
  error?: string
  durationMs: number
  auth?: { header: string; source: string; key?: string; applied: boolean }[]
}

export type TabKind = 'home' | 'browser' | 'onlypreview' | 'trench' | 'zellij'

/** D3: a value snapshot of the foreground when a message arrives, independent of tool targets. */
export type ActiveTabContent = {
  /** Actual OperationTab id; null for a foreground surface outside that tab collection. */
  readonly tab_id: string | null
  /** Visible tab label, including the user's alias. */
  readonly title: string
} & (
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'miniapp'; readonly miniapp: string | null }
  | { readonly kind: 'web'; readonly url: string }
)

/** D3 and D4 captured together, before any message-processing await. */
export interface AgentWindowTabSnapshot {
  readonly activeTab: ActiveTabContent | null
  readonly openTabs: readonly ActiveTabContent[]
}

export interface AgentBrowserTabState {
  id: string
  title: string
  url: string
  status: 'ready' | 'cold' | 'loading' | 'crashed' | 'destroyed' | 'closed' | 'load-failed' | 'unavailable'
  error?: string
}

export interface AgentBrowserSessionState {
  sessionId: string
  selectedTabId?: string
  initiatingTab?: AgentBrowserTabState
  /** Current task markers; independent of historical targets and drill recording members. */
  activeUseTabIds?: string[]
  tabs: AgentBrowserTabState[]
}
export type WorkbenchPane =
  | 'recording'
  | 'skills'
  | 'workflows'
  | 'injections'
  | 'tools'
  | 'models'
  | 'apps'
  | 'connectors'
  | 'settings'
  | 'about'
  | 'log'
// Approval history persists the original scope id; the user-facing label is Maestro.
export type HostToolScope = 'cowork'
export type HostToolCategory = 'observe' | 'act' | 'api' | 'capture' | 'skill' | 'workspace' | 'file' | 'tab' | 'training'
export type HostToolRisk = 'read' | 'write' | 'destructive'
export type HostToolPolicyMode = 'bypass' | 'confirm' | 'disabled'

export interface HostToolPolicy {
  toolName: string
  mode: HostToolPolicyMode
  updatedAt: number
}

export type HostToolPolicyMap = Record<string, HostToolPolicy>

export interface HostToolCatalogEntry {
  name: string
  scopes: HostToolScope[]
  category: HostToolCategory
  risk: HostToolRisk
  summary: string
  useWhen: string
  safety: string
  policy?: HostToolPolicy
}

export interface HostToolCatalogResult {
  ok: true
  scope: HostToolScope
  total: number
  policies: HostToolPolicyMap
  tools: HostToolCatalogEntry[]
}

export interface HostToolPolicyResult {
  ok: boolean
  policies: HostToolPolicyMap
  error?: string
}

export type HostApprovalKind = 'tool' | 'api'
export type HostApprovalStatus = 'pending' | 'approved' | 'denied' | 'blocked'

export interface HostApprovalEvent {
  id: string
  kind: HostApprovalKind
  status: HostApprovalStatus
  label: string
  detail?: string
  scope?: HostToolScope
  toolName?: string
  method?: string
  path?: string
  reason?: string
  requestedAt: number
  resolvedAt?: number
}

export interface HostApprovalHistoryResult {
  ok: boolean
  events: HostApprovalEvent[]
}

export interface HostApprovalExportPayload {
  exportedAt: number
  count: number
  events: HostApprovalEvent[]
}

export interface HostApprovalExportResult {
  ok: boolean
  path?: string
  count?: number
  canceled?: boolean
  error?: string
}

// One operation-view tab, broadcast to the renderer on the `coach/tabs` channel.
export interface TabInfo {
  id: string
  kind: TabKind
  title: string
  /**
   * The operator's own name for this tab, when they gave it one.
   *
   * A SEPARATE field from `title` on purpose: six writers overwrite `title` without asking — every
   * `page-title-updated`, the composite `setTitle` seam (OnlyPreview pushes on every file change),
   * the two tab factories, `setTabKind`, and restore. Storing the operator's name in `title` means
   * any one of them silently wipes it (docs/features/tab-alias.md #1).
   *
   * Empty / absent = no alias, show the page title. It is USER TEXT, not a trusted instruction —
   * `list_tabs` puts the whole `TabInfo` in front of the model, so treat it exactly like a page
   * title that a page chose for itself.
   */
  alias?: string
  /** Main-owned real targets (such as the bundled Home file URL) are never exposed here. */
  url: string
  /** Stable renderer-facing URL for first-party local tabs. */
  displayUrl?: string
  active: boolean
  /** Pinned tabs (e.g. the bundled Home tab) can't be closed and keep a fixed title/favicon. */
  pinned: boolean
  /** Favicon URL for the tab chip ('' = none). */
  favicon: string
  /** Desired CDP debugger state for this tab. Defaults to true for every new/restored tab. */
  debuggerEnabled: boolean
  /** Live CDP attachment state. Can lag briefly while a new tab is warming. */
  debuggerAttached: boolean
  /** Page load in flight; the tab chip shows a spinner until stop/failure/teardown/watchdog. */
  loading: boolean
  /**
   * A task has active browser use on this tab, or temporary page work is still in flight.
   *
   * Why it is on the wire and not merely a main-side fact: a tab that moves on its own with no
   * visible cause reads as the app misbehaving. The chip animates its favicon slot while this is
   * true, so "something is happening here, and it is the agent" is answered before it is asked
   * (Ral 2026-09-11: 「tab 的 favicon 区域有动画表明正在被控制」).
   */
  controlled: boolean
  /**
   * A composite mini-app tab's persistent identity (absent on web/home tabs).
   *
   * The home renderer owns tab persistence, and a composite tab has no URL to be saved by — so the
   * id Maestro minted has to be on the wire for the saved row to carry it, and for the restored tab
   * to be recognised as the same one.
   */
  instanceId?: string
  /** This composite tab's mini app asked to come back on the next launch (`spec.restorable`). */
  restorable?: boolean
}

// A window-content-relative rectangle (DIP), as read from a placeholder element's
// getBoundingClientRect() and fed straight to WebContentsView.setBounds().
export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CoachSettings {
  compactPrompt?: string
  startUrl: string
  llmProvider: string
  llmModel: string
  llmEffort: LlmEffort
  /**
   * 固有槽位装哪个 composite mini-app。`undefined` / 空串 / registry 不认识的 id = 内置本地 Home。
   *
   * **刻意不与 `startUrl` 合并**:`startUrl` 说的是「除固有 tab 之外再开一个网页」,而且明确拒绝
   * mini-app;这一条说的是「固有槽位装哪个 mini-app」。取值域不相交,合并等于让一个键同时表达两件
   * 互斥的事(docs/features/custom-homepage-tab.md #2)。
   */
  homeCompositeId?: string
  /**
   * 固有槽位那个 mini-app 的 `instanceId` —— 设为主页那一刻它**真实的**身份,原样记下来。
   *
   * 非存不可的理由是一条结构性的事实:固有 tab 是 `pinned` 的,而 pinned tab 按设计**不进**
   * SavedTab 持久化(`tab.store.ts` 的 `isRestorableComposite` 要求 `!t.pinned`)。这一格的 tab
   * 每次启动都是从这份设置里重建的,设置里没有的东西就等于不存在。少了它,重建只能按 spec id
   * 推导一个身份,而 Zellij 这类 `restorable` mini app「`instanceId` 就是它回到自己那条会话的
   * 依据」—— 设主页那一刻在槽位里的那条会话从此再没人接管、也没人关掉:每设一次主页留一条孤儿。
   *
   * 空 = 这份设置写于本字段之前的版本,读取方回退到那个按 spec id 推导的值(见
   * `homeCompositeInstanceId`)。**只作存量兜底**,新写入一律记真实 id。
   */
  homeInstanceId?: string
  /**
   * 固有槽位那个 tab 的别名(`Alias…` 起的名字)。
   *
   * 同上一条同一个理由:pinned tab 不进 SavedTab,设置是它唯一的落脚点。而且这里比别处更严重
   * —— `Set as homepage` 会顺手关掉旧的 Home tab,连第二份带着名字的副本都不存在
   * (docs/features/tab-alias.md G5)。空串 = 没别名,显示页面标题。
   */
  homeAlias?: string
}

export type LlmProviderId = 'openai-codex' | 'anthropic' | string
export type LlmEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface LlmEffortOption {
  id: LlmEffort
  label: string
}

// A selectable LLM backend (subscription OAuth via pi).
export interface LlmTarget {
  provider: string
  providerLabel: string
  model: string
  label: string
  /** Compact display label for dense controls, e.g. 5.5 or Opus 4.8. */
  shortLabel: string
  /** The preset's DEFAULT effort — what a fresh switch to this model selects. Not necessarily
   * `efforts[0]`: the option list stays in descending order for the picker, while the default can
   * sit anywhere in it (gpt-6-astra lists max..low but defaults to medium). Read it through
   * `defaultLlmEffort()`, never as `efforts[0]`. */
  effort: LlmEffort
  /** Selectable efforts for this model, in picker order (descending). */
  efforts: LlmEffortOption[]
  /** Context length as integer K units, e.g. 256 means 256K tokens. */
  contextLengthK: number
  /** Human-readable context length, e.g. 256K or 1M. */
  contextLengthLabel: string
  /** Remaining context percentage that should trigger context compression, e.g. 10 = trigger near 90% used. */
  compressionRemainingPercent: number
  authLabel: string
}

/**
 * The effort a fresh switch to `preset` should select. `preset.effort` is the declared default and
 * wins whenever it is actually offered; `efforts[0]` is only the fallback for a preset whose
 * declared default is not in its own list. Main and both renderers MUST agree on this, or the
 * picker and the persisted target disagree about what "default" means.
 *
 * 2026-09-11 之前 bl **没有**这个函数,三处(`normalizeLlmTarget`、ControlApp、Workbench)各自
 * 写着 `efforts[0]`,等于把预设声明的默认档整个忽略掉 —— Ral 要的 astra@medium 会被静静改成
 * astra@low。cowork 早有这一条(2026-09-07),这次把 bl 对齐。
 */
export const defaultLlmEffort = (preset: LlmTarget): LlmEffort =>
  preset.efforts.some((item) => item.id === preset.effort) ? preset.effort : preset.efforts[0]?.id || preset.effort

export interface LlmProviderState {
  provider: LlmProviderId
  label: string
  authLabel: string
  ready: boolean
  active: boolean
  hint?: string
}

export type LlmLoginMethod = 'browser' | 'device_code'

export interface LlmLoginMethodOption {
  id: LlmLoginMethod
  label: string
}

export interface LlmLoginProviderOption {
  provider: string
  label: string
  methods: LlmLoginMethodOption[]
}

export interface LlmConfig {
  compactPrompt?: string
  defaultCompactPrompt?: string
  provider: string
  model: string
  effort: LlmEffort
  /** Whether the chosen provider has a usable credential (pi /login done). */
  ready: boolean
  /** When not ready, how to fix it (e.g. run pi /login for that provider). */
  hint?: string
  /** Provider auth/activation state for Workbench ▸ Models. */
  providers: LlmProviderState[]
  /** Selectable presets shown as the switch options. */
  presets: LlmTarget[]
  /** Provider -> login-method options shown by the AI Login dropdown. */
  loginProviders: LlmLoginProviderOption[]
}

export interface LlmLoginState {
  provider: string
  loading: boolean
  ts: number
}

export interface CaptureState {
  capturing: boolean
  mode: CaptureMode
  file: string | null
  startedAt?: number
  /** 「录制期间自动取消文件选择框」这个开关的当前电平（默认关，agent 流程自己开）。 */
  autoDismissFileDialogs?: boolean
}

/**
 * 这份录制是**谁开的**。它是「能不能停」的唯一判据 ——
 * `stopCaptureIfAgentStarted` 只收 `'agent'` 那一种。
 */
export type CaptureStartedBy = 'operator' | 'agent'

export interface CaptureOptions {
  recordActions: boolean
  recordNetwork: boolean
  networkWhitelistEnabled: boolean
  networkWhitelist: CaptureRule[]
  networkBlacklist: CaptureRule[]
}

// App identity for Workbench ▸ About, picked from the bundled package.json (mirrors
// the host's PackageInfo). `productName` is the display name; `name` is the package name.
export interface PackageInfo {
  name: string
  productName: string
  version: string
  versionCode: string
  description: string
}

// Host-approved logging location shown by Workbench ▸ Log.
export interface LogInfo {
  dir: string
  file: string
  env: 'dev' | 'prod'
}

export interface SnapshotResult {
  ok: boolean
  nodeCount: number
  yaml: string
  error?: string
}

export interface ExportRecordingResult {
  ok: boolean
  path?: string
  format?: CaptureExportFormat
  canceled?: boolean
  error?: string
}

export type CaptureExportFormat = 'json' | 'har'

export interface SkillInput {
  name: string
  label: string
  required: boolean
  example?: string
  // Optional value constraints → a runtime zod schema validates the skill's vars before running.
  type?: 'string' | 'number' | 'boolean' | 'enum'
  enum?: string[]
  pattern?: string
}

export type SkillSource = 'builtin' | 'recording' | 'external'

export type SkillSharingScope = 'shared' | 'institution'
export interface SkillScopeContextInfo { institutionId: string; institutionName?: string }

export type SkillLayer = 'global' | 'workspace' | 'institution'
export interface SkillCatalogSnapshot { institution?: SkillScopeContextInfo | null; generation?: string | number; revision: string; workspace: string; roots: Record<SkillLayer, string[]>; skills: SkillSummary[]; watchError?: string; cloudStatus?: string; cloudError?: string }
export interface SkillSummary {
  enabled?: boolean
  canonicalName?: string
  displayName?: string
  aliases?: string[]
  layer?: SkillLayer
  status?: 'ready' | 'error'
  error?: string
  skillRevision?: string
  realPath?: string
  root?: string
  readonly?: boolean
  managed?: boolean
  allowImplicitInvocation?: boolean
  scope?: SkillSharingScope | 'unassigned'
  institutionId?: string
  institutionName?: string
  reference?: string
  id: string
  name: string
  description: string
  source: SkillSource
  // Hostname the skill was recorded on (from recipe.sourceUrl). Skills are
  // partitioned by domain: the agent only loads skills whose domain matches the
  // current page. Empty for skills with no/invalid source URL.
  domain: string
  path: string
  recipePath?: string
  updatedAt: number
  inputs: SkillInput[]
  triggers: string[]
}

export interface SkillRuntimeDiagnostics {
  status: 'ready' | 'missing' | 'unknown'
  behaviorVerified: false
  checks: { kind: 'entry' | 'interpreter' | 'command' | 'package' | 'metadata'; subject: string; status: 'ready' | 'missing' | 'unknown'; detail: string; repair: string }[]
}

export interface SkillDetail {
  files?: string[]
  id: string
  name: string
  description: string
  body: string
  runtime: 'coach' | 'external'
  externalOnly: boolean
  notes?: string
  fieldRules?: string
  audit?: SkillAuditResult
  triggers: string[]
  inputs: SkillInput[]
  stepCount: number
  networkCount: number
  snapshotCount: number
}

export interface SkillCreateResult {
  ok: boolean
  skill?: SkillSummary
  message: string
  error?: string
}

export interface DeleteSkillResult {
  ok: boolean
  skillId: string
  message: string
  error?: string
}

export interface SkillExportResult {
  ok: boolean
  skillId: string
  path?: string
  message: string
  audit?: SkillAuditResult
  canceled?: boolean
  error?: string
}

export interface SkillImportResult {
  ok: boolean
  skill?: SkillSummary
  path?: string
  message: string
  audit?: SkillAuditResult
  canceled?: boolean
  error?: string
}

export interface SkillAuditIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export interface SkillAuditResult {
  ok: boolean
  checkedAt: number
  issues: SkillAuditIssue[]
}

// Result of registering a user-attached file for the agent's read_file tool. Picked/dropped
// files stay where they are on disk; clipboard screenshots are first materialized by main
// into userData. In both cases the model-facing boundary is an absolute `path`.
export interface AttachFileResult {
  ok: boolean
  name?: string
  path?: string
  size?: number
  isDirectory?: boolean
  error?: string
}

export interface CodexDebugEvent {
  scope: 'summarize' | 'agent' | 'codex'
  phase: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  detail?: unknown
  ts: number
}

export interface ReplayResult {
  ok: boolean
  skillId: string
  stepsRun: number
  errors: string[]
  mode?: 'api' | 'ui'
  apiCalls?: number
  responseText?: string
  auth?: ReplayAuthResolution[]
}

export interface ReplayAuthResolution {
  header: string
  source: string
  key?: string
  applied: boolean
}

// A single live step the invocation agent took during a turn, broadcast on
// 'coach/agent-activity' so the chat can show the observe→act loop in real time.
export interface AgentActivityStep {
  phase: 'think' | 'tool' | 'skill' | 'observe' | 'act' | 'api-read' | 'api-call' | 'api' | 'tab'
  label: string
  ok: boolean
  ts: number
  sessionId?: string
  turnId?: string
  generation?: number
}

export interface AgentStreamDelta {
  sessionId: string
  turnId?: string
  generation?: number
  delta: string
  ts: number
}

export interface AgentThinkingState {
  sessionId: string
  turnId?: string
  generation?: number
  active: boolean
  ts: number
}

export interface InjectedSkillTrigger {
  domain: string
  skillTitle: string
  skillDescription: string
  message: string
  ts: number
}

export interface InjectedButtonDomain {
  domain: string
  triggers: InjectBtnEntry[]
  updatedAt: number
}

export interface InjectedButtonRemoveResult {
  ok: boolean
  domain: string
  removed: number
  unInjected: number
  error?: string
}

export interface AgentContextMessage {
  role: 'human' | 'ai'
  content: string
  ts: number
}

export interface AgentConversationContext {
  /** Exact qualified reference selected for this message; main resolves current source and body. */
  selectedSkillRef?: string
  compactSummary?: string
  recentMessages?: AgentContextMessage[]
  /** Absolute paths explicitly attached on the current user turn. Main verifies they were registered. */
  attachedPaths?: string[]
  workspace?: WorkspaceRef
}

export interface ContextExportRequest {
  sessionId: string
  draft: string
  context?: AgentConversationContext
}

/** 会话日志操作的回包。`path` 是已复制或已在系统文件管理器打开的绝对目录。 */
export type SessionIoPathResult = { ok: true; path: string } | { ok: false; error: string }

export interface SessionTitleRequest {
  requestId: string;
  sessionId: string;
  firstMessageId: string;
  text: string;
}

export type SessionTitleResult = { ok: true; title: string } | { ok: false };

export type SessionMenuResult =
  | { ok: true; action: 'copy' | 'open'; path: string }
  | { ok: true; action: null }
  | { ok: false; error: string }

export type ContextExportSummary =
  | { ok: true; chars: number; entries: number }
  | { ok: false; error: string }

/**
 * `/view_context_graph` 的入参。与 `ContextExportRequest` 的差别只有一个 `messages` ——
 * 两条命令读的是同一批真源,只是出口不同。
 */
export interface ContextGraphRequest {
  sessionId: string
  draft: string
  context?: AgentConversationContext
  /**
   * 渲染层的消息摘要(id + role + 正文前 `CONTEXT_GRAPH_MATCH_HEAD_CHARS` 个字符),按时间顺序。
   *
   * **join 在 main 做** —— `user` 条目的正文是整块拼装后的 turn prompt,不是用户那句话,
   * 只有持有完整正文的一侧才能认领归属。缺省 = 所有块都不可点。
   */
  messages?: { id: string; role: 'human' | 'ai'; head: string }[]
}

/**
 * `/view_context_graph` 的回执 —— **有界**:每块只有类型 / 体量 / 回合 / 一小段 preview。
 * 正文不走这条路(去 `/view_context` 的剪贴板),所以一个钻探会话的几十万字符不会被搬进渲染层。
 * 结构生成在 `main/agent/contextGraph.service.ts`。
 */
export interface ContextGraphBlockView {
  /** 在**存活**块里的序号,从 1 开始。 */
  i: number
  /** 界面上承载这一块的消息 —— **没有就是不可点**。认领不到也留空(绝不错链)。 */
  messageId?: string
  /** 来自哪个 pi 条目;同一条 assistant 条目展平出的多块共享它。 */
  entryId: string
  parentId: string | null
  /** `user` · `assistant` · `tool_call` · `tool_result` · `compaction` · `custom_message:<t>` · … */
  type: string
  tool?: string
  chars: number
  /** 上下文回合序号(从 1);第一条 user 条目之前的块为 0。**不是**渲染层那个 `Turn`。 */
  turn: number
  preview: string
}

export interface ContextGraphTypeTotalView {
  type: string
  blocks: number
  chars: number
}

export interface ContextGraphView {
  sessionId: string
  provider?: string
  model?: string
  /**
   * **刻意没有 token 窗口,也没有 jsonl 目录。**
   *
   * 窗口:这份投影的单位是**字符**(结构与体量),而窗口的单位是 token —— 写成一个比值
   * (`113k / 210k`)看着精确,实际是两个单位相除。预算账已经有自己的展示位(控制面板那条上下文条)。
   * jsonl:日志目录由 /copy_session_path 与 /view_context 提供，结构图不重复展示(契约 #2.5)。
   */
  systemChars: number
  systemPreview: string
  blocks: ContextGraphBlockView[]
  /** 被 summary 吸收的那一段,只有合计 —— 它已经不在上下文里。 */
  absorbed?: { blocks: number; chars: number; byType: ContextGraphTypeTotalView[] }
  turns: number
  /** system + 存活块 + pending 的字符合计 —— 与 `absorbed` 刻意分开,后者已不在上下文里。 */
  totalChars: number
  byType: ContextGraphTypeTotalView[]
  pending: { workspace?: string; attachments?: string[]; draft?: string; chars: number }
  /** 模型侧还没有历史(这个会话一轮都没发过)—— 与"历史是空的"是两件事,如实带出。 */
  noHistory: boolean
}

export type ContextGraphResult = { ok: true; graph: ContextGraphView } | { ok: false; error: string }

/**
 * 认领消息归属时比对的头部长度 —— **两侧必须是同一个数**,所以它在 shared,不在任何一侧。
 *
 * 渲染层按它截 `head`,main 按 `entryText.includes(head)` 认领(`main/agent/contextGraph.service.ts`)。
 * 渲染层截 120、main 期望 200 的话,长消息会全部认领失败,而症状是「块莫名不可点」——
 * 一个不会报错、只会让人以为功能没做的偏差。
 */
export const CONTEXT_GRAPH_MATCH_HEAD_CHARS = 200

export type AgentMessageIntent = 'root' | 'steering'

export interface AgentTurnSnapshot {
  sessionId: string
  operationTabId?: string
  turnId: string
  generation: number
  rootText: string
  startedAt: number
  state: 'reserved' | 'running' | 'aborting'
  stopError?: string
  /**
   * The root text was written by the host, not typed by the user.
   *
   * The renderer must never render it as a human message: a background workflow finishing is not
   * the user speaking, and a fabricated user line would also be replayed as theirs on reload.
   */
  hostAuthored?: boolean
}

export interface AgentTurnClaimRequest {
  continuationOf?: string
  sessionId: string
  operationTabId?: string
  turnId: string
  rootText: string
  startedAt: number
  /** See AgentTurnSnapshot.hostAuthored. */
  hostAuthored?: boolean
}

export interface AgentTurnClaimResult {
  ok: boolean
  turn: AgentTurnSnapshot
  reason?: 'busy-here' | 'busy-elsewhere'
}

export interface AgentMessageSnapshot { windowTabs: AgentWindowTabSnapshot; sentAt: string }

export interface AgentMessageRequest {
  snapshot?: AgentMessageSnapshot
  messageId?: string
  message: string
  sessionId: string
  turnId: string
  intent: AgentMessageIntent
  context?: AgentConversationContext
}

export interface AgentCompactMessage {
  role: 'human' | 'ai'
  content: string
  ts: number
}

export interface AgentCompactRequest {
  previousSummary?: string
  messages: AgentCompactMessage[]
  bridgeMessages?: AgentCompactMessage[]
  maxSummaryChars: number
  targetContextLabel: string
}

export interface AgentCompactReply {
  ok: boolean
  summary: string
  ts: number
  error?: string
}

export interface AgentReply {
  /** The addressed owner completed; safely retry this same message as a new root, never steer a different owner. */
  continueAsRoot?: { turnId: string; reply: AgentReply; snapshot: AgentMessageSnapshot }
  ok: boolean
  text: string
  ts: number
  skill?: SkillSummary
  skills?: SkillSummary[]
  replay?: ReplayResult
  files?: AgentFileArtifact[]
  error?: string
  retryExhausted?: { attempt: number; max: number }
  authoredByModel?: boolean
  mergedIntoTurn?: boolean
}

export const MODEL_RETRY_CHANNEL = 'coach/model-retry'
export const AGENT_TURN_CHANNEL = 'coach/agent-turn'

export interface ModelRetryProgress {
  sessionId: string
  turnId: string
  generation: number
  attempt: number
  max: number
  recovered?: boolean
}

export interface AgentTurnUpdate {
  revision: number
  turn: AgentTurnSnapshot | null
  finished?: AgentTurnFinished
}

export interface AgentTurnFinished {
  turn: AgentTurnSnapshot
  reason: 'completed' | 'stopped' | 'reservation-expired'
  reply?: AgentReply
}

/** All active owners plus unacknowledged finishes, replayable after a renderer reload. */
export interface AgentTurnRecoverySnapshot {
  revision: number
  /** First active turn retained for older callers; new callers must reconcile all turns. */
  turn: AgentTurnSnapshot | null
  turns: AgentTurnSnapshot[]
  finished: AgentTurnFinished[]
}

export interface WorkspaceRef {
  path: string
  name: string
  exists: boolean
  updatedAt: number
}

export interface WorkspaceRefResult {
  ok: boolean
  workspace?: WorkspaceRef
  previewError?: 'unavailable' | 'open-failed'
  missing?: boolean
  error?: string
}

export interface AgentFileArtifact {
  name: string
  path: string
  action: 'created' | 'updated'
  size?: number
}

export interface FileStatusResult {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  size?: number
  error?: string
}

export type CoachTraceEvent = TraceEvent

export interface SkillInstallationRequest { action: 'list' | 'update' | 'remove'; scope: 'workspace' | 'shared'; installationId?: string; sessionId?: string }
export interface ManagedSkillInstallation {
  id: string; destination: string; source: { kind: 'github' | 'npm' | 'git'; identity: string; requested: string; requestedRef?: string; requestedVersion?: string; resolvedCommit?: string; version?: string; integrity?: string; path?: string }
  skills: { name: string; description: string; path: string }[]; digest: string; installedAt: string; updatedAt: string; status: 'installed' | 'modified' | 'missing'
}
export interface SkillInstallationResult { ok: boolean; scope: 'workspace' | 'shared'; authoringRoot: string; installations?: ManagedSkillInstallation[]; installation?: ManagedSkillInstallation; removed?: string }
