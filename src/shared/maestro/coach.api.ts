import type { CaptureMode, TraceEvent } from './trace.types'
import type { SavedTab } from './tabs.api'
import type { CaptureRule } from './captureFilter.api'
import type { InjectBtnEntry } from './injectBtn.api'

export const DEFAULT_COACH_START_URL = 'https://example.com'

// The type-safe XPC contract exposed by CoachXpcHandler in the main process.
// Handler methods intentionally accept at most one object parameter, matching
// electron-xpc's handler/emitter pattern.
export interface CoachXpcContract {
  getSettings(): Promise<CoachSettings>
  saveSettings(params: Partial<CoachSettings>): Promise<CoachSettings>
  navigate(params: { url: string }): Promise<void>
  // Reload the active tab's page (works on the pinned home tab too — it reloads, not navigates).
  reload(): Promise<void>
  // History navigation of the active tab (no-ops when unavailable or when the pinned AI-CRMS tab
  // is active).
  goBack(): Promise<void>
  goForward(): Promise<void>
  // Manual per-tab CDP debugger control. Tabs default to enabled; disabling detaches the debugger
  // for external login pages where DevTools/CDP attachment is undesirable.
  setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]>
  openDemo(): Promise<{ url: string }>
  getWorkbenchVisible(): Promise<{ visible: boolean }>
  setWorkbenchVisible(params: { visible: boolean }): Promise<{ visible: boolean }>
  // App identity for Workbench ▸ About — picked from the bundled package.json (see
  // maestroWindow.helper getPackageInfo; mirrors the host package helper).
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
  listIntegrationTargets(): Promise<IntegrationTargetSummary[]>
  getIntegrationTarget(params: { targetId: string }): Promise<IntegrationTarget | null>
  createIntegrationTargetFromCapture(params?: { name?: string; domain?: string }): Promise<IntegrationTargetCreateResult>
  createAiCrmsMigrationTarget(params: IntegrationMigrationTargetRequest): Promise<IntegrationTargetCreateResult>
  deleteIntegrationTarget(params: { targetId: string }): Promise<IntegrationTargetDeleteResult>
  runIntegrationTargetDryRun(params: { targetId: string }): Promise<IntegrationTargetRunResult>
  runIntegrationRecordedSiteDryRun(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult>
  runIntegrationRecordedSitePlan(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult>
  runIntegrationRecordedSiteApply(params: IntegrationRecordedSiteApplyRequest): Promise<IntegrationTargetRunResult>
  runIntegrationMigration(params: IntegrationMigrationRunRequest): Promise<IntegrationTargetRunResult>
  runIntegrationReportReadiness(params: IntegrationReportReadinessRequest): Promise<IntegrationTargetRunResult>
  setIntegrationTargetSchedule(params: IntegrationTargetScheduleRequest): Promise<IntegrationTargetScheduleResult>
  listIntegrationMappings(params: IntegrationMappingListRequest): Promise<IntegrationMappingListResult>
  upsertIntegrationMapping(params: IntegrationMappingUpsertRequest): Promise<IntegrationMappingWriteResult>
  deleteIntegrationMapping(params: IntegrationMappingDeleteRequest): Promise<IntegrationMappingWriteResult>
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
  sendAgentMessage(params: { message: string; sessionId?: string; context?: AgentConversationContext }): Promise<AgentReply>
  compactConversation(params: AgentCompactRequest): Promise<AgentCompactReply>
  // `files` (md only, parsed to text in the renderer) are folded into the trainer turn as
  // reference/source material; they also render as a separate `type:'files'` user bubble.
  trainerMessage(params: { message: string; sessionId?: string; files?: { name: string; content: string }[] }): Promise<AgentReply>
  resetTrainerConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }>
  // Delegate chat: agent acts AS the user toward the user's customer (the message sender).
  delegateMessage(params: { message: string; sessionId?: string }): Promise<AgentReply>
  resetDelegateConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }>
  // Stop the in-flight turn for a chat channel (the Stop button): aborts the live pi session so
  // the pending turn resolves. The agent session is then dropped so aborted output is not carried
  // into later model context.
  abortAgent(params?: { sessionId?: string }): Promise<void>
  abortTrainer(params?: { sessionId?: string }): Promise<void>
  abortDelegate(params?: { sessionId?: string }): Promise<void>
  // Ingest the CURRENT, non-deleted records (each carrying its source event + the
  // operator `spec`) plus the overall workflow description into a skill. The renderer
  // is the source of truth here — NOT the main process's raw trace buffer.
  summarizeSkill(params: { workflow?: string; records: IngestRecord[] }): Promise<SkillCreateResult>
  trainSkill(params: { skillId: string; guidance: string }): Promise<SkillCreateResult>
  listSkills(): Promise<SkillSummary[]>
  getSkillDetail(params: { skillId: string }): Promise<SkillDetail | null>
  openSkillDirectory(params: { skillId: string }): Promise<{ ok: boolean; path?: string; error?: string }>
  exportSkillPackage(params: { skillId: string }): Promise<SkillExportResult>
  importSkillPackage(): Promise<SkillImportResult>
  // Reveal the folder holding ALL skills for a domain ('' → the skills root).
  openDomainDirectory(params: { domain: string }): Promise<{ ok: boolean; path?: string; error?: string }>
  // Register user-attached files (by ABSOLUTE PATH — never bytes) into the chat session's
  // read_file allowlist; main stats/validates each and reads them in place on demand.
  attachFiles(params: { sessionId?: string; paths: string[] }): Promise<AttachFileResult[]>
  // Materialize the current system clipboard image into userData and register that file path.
  // Used for pasted screenshots: no image bytes cross renderer↔main or model boundaries.
  attachClipboardImage(params?: { sessionId?: string }): Promise<AttachFileResult>
  // Transcribe a local audio file through the AI-CRMS Bailian relay. The renderer records audio
  // and passes only a temp file path; main reads the file and owns the shared session token.
  scribeAudio(params: AudioScribeRequest): Promise<AudioScribeResult>
  chooseWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult>
  setWorkspaceDirectory(params: { sessionId?: string; path?: string }): Promise<WorkspaceRefResult>
  getWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult>
  getFileStatuses(params: { paths: string[] }): Promise<FileStatusResult[]>
  openFile(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }>
  showFileInFolder(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }>
  deleteSkill(params: { skillId: string }): Promise<DeleteSkillResult>
  replaySkill(params: { skillId: string; variables: Record<string, string> }): Promise<ReplayResult>
  getLlmConfig(): Promise<LlmConfig>
  setLlmConfig(params: { provider: string; model: string; effort?: LlmEffort }): Promise<LlmConfig>
  setLlmCompression(params: { provider: string; model: string; compressionRemainingPercent: number }): Promise<LlmConfig>
  // Geometry pushed from the home renderer: the operation/control placeholders in
  // Layout.vue define where the main process layers the native WebContentsViews.
  setViewBounds(params: { operation: ViewRect; control: ViewRect }): Promise<void>
  // Multi-tab: each tab is its own operation-view WebContentsView; tabs are opened
  // when the active page opens a new window. The active tab is what capture / replay
  // / the agent target. The home renderer drives switching/closing via these.
  // Open a new blank tab (empty operation view) and make it active.
  newTab(): Promise<void>
  // Open `url` in a NEW tab and activate it — atomic: the tab is born with the URL and loaded into
  // its OWN view (not the active view), so it can't desync the current tab. Used by Demo / "open in
  // new tab". Empty url → same as newTab().
  openTab(params: { url: string }): Promise<void>
  activateTab(params: { id: string }): Promise<void>
  // Reorder the visible tab strip by current tab ids. Main validates against the live tab set and
  // keeps pinned tabs fixed; home persists the rebroadcast order.
  reorderTabs(params: { ids: string[] }): Promise<void>
  closeTab(params: { id: string }): Promise<void>
  getTabs(): Promise<TabInfo[]>
  // Restore persisted tabs the home renderer read from the sqlite store (renderer-driven
  // persistence): main recreates them as cold tabs after the pinned crms tab. Idempotent.
  restoreTabs(params: { tabs: SavedTab[] }): Promise<void>
  // Right-click a tab → native context menu (built + popped in the main process, so it
  // renders above the operation view).
  showTabMenu(params: { id: string }): Promise<void>
  // Sign in to an LLM provider through the pi SDK's in-process OAuth flow (no `pi` CLI).
  // Codex supports 'browser' and 'device_code'; Claude/Anthropic supports 'browser' only.
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
  quitAndInstall(): Promise<void>
}

export interface UpdateInfo {
  version: string
  versionCode: number
}

export type UpdateCheckStatus = 'available' | 'latest' | 'disabled' | 'unsupported' | 'error'

export interface UpdateCheckResult {
  status: UpdateCheckStatus
  currentVersionCode: number
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

export type TabKind = 'ai-crms' | 'browser'
export type WorkbenchPane = 'recording' | 'skills' | 'integrations' | 'injections' | 'tools' | 'models' | 'about' | 'log'
// Approval history persists the original scope id; the user-facing label is Maestro.
export type HostToolScope = 'cowork' | 'trainer'
export type HostToolCategory = 'observe' | 'act' | 'api' | 'capture' | 'skill' | 'integration' | 'workspace' | 'file' | 'tab' | 'training'
export type HostToolRisk = 'read' | 'write' | 'destructive'
export type HostToolPolicyMode = 'bypass' | 'confirm' | 'disabled'

export type IntegrationTargetSourceKind = 'recorded-site' | 'ai-crms-migration'
export type IntegrationTargetDestinationKind = 'ai-crms'
export type IntegrationEntity = 'patient' | 'corporate' | 'project' | 'data_mapping' | 'mcu_record' | 'mcu_report'
export type IntegrationEndpointRole = 'read' | 'write' | 'unknown'
export type IntegrationEndpointSafety = 'safe' | 'confirm' | 'unsafe'
export type IntegrationTargetStatus = 'draft' | 'ready' | 'dry-run-ok' | 'error'
export type IntegrationRunMode = 'dry-run' | 'readiness' | 'apply'
export type IntegrationRunStatus = 'success' | 'warning' | 'failed'
export type IntegrationScheduleRunKind = 'safe-default' | 'migration-dry-run' | 'report-readiness' | 'recorded-site-dry-run'
export type IntegrationMappingStatus = 'pending' | 'linked' | 'conflict' | 'ignored'

export interface IntegrationEndpointContract {
  id: string
  method: string
  host: string
  path: string
  urlTemplate: string
  role: IntegrationEndpointRole
  safety: IntegrationEndpointSafety
  count: number
  lastSeenAt: number
  sampleStatus?: number
  resourceType?: string
  requestBodyKind?: 'none' | 'json' | 'form' | 'raw'
  responseMime?: string
}

export interface IntegrationTargetSchedule {
  enabled: boolean
  intervalMinutes?: number
  cron?: string
  runKind?: IntegrationScheduleRunKind
  nextRunAt?: number
  lastScheduledRunAt?: number
}

export interface IntegrationRunSummary {
  id: string
  mode: IntegrationRunMode
  status: IntegrationRunStatus
  startedAt: number
  finishedAt: number
  endpointCount: number
  readCount: number
  writeCount: number
  entityCount: number
  commandCount?: number
  notes: string[]
  missing: string[]
  outputs?: IntegrationRunOutput[]
}

export interface IntegrationRunOutput {
  name: string
  ok: boolean
  command: string
  exitCode?: number
  durationMs?: number
  summary?: string
  error?: string
}

export interface IntegrationReportReadinessRequest {
  targetId: string
  mcuRecordIds?: string[]
  keyword?: string
  corporateId?: string
  projectId?: string
  pageSize?: number
  /** false/default = read-only status check; true = enqueue validate/conclusion/report/queue via CLI. */
  generate?: boolean
  /** Only meaningful when generate=true; enqueue email sending after report generation. */
  send?: boolean
}

export interface IntegrationRecordedSiteSyncRequest {
  targetId: string
  endpointIds?: string[]
  maxEndpoints?: number
  maxRowsPerEndpoint?: number
}

export interface IntegrationRecordedSiteApplyRequest extends IntegrationRecordedSiteSyncRequest {
  /** Must be true; recorded-site writes are never implicit. */
  apply?: boolean
  /** Optional entity allow-list. Currently supports patient/corporate/project/data_mapping/mcu_record. */
  entities?: IntegrationEntity[]
  /** Maximum number of AI-CRMS create/update commands in one run. Default 10, max 50. */
  maxWrites?: number
  /** Default false: linked rows with changed sourceHash are reported but not updated. */
  allowUpdates?: boolean
}

export interface IntegrationMigrationConfig {
  source: string
  target: string
  domains: string[]
}

export interface IntegrationMigrationTargetRequest {
  name?: string
  source: string
  target: string
  domains?: string[]
}

export interface IntegrationMigrationRunRequest {
  targetId: string
  /** false/default = backend dryRun; true = write migrated rows. */
  apply?: boolean
  /** Optional backend migration step labels; defaults to target source.migration.domains. */
  domains?: string[]
  timeoutMs?: number
}

export interface IntegrationTargetScheduleRequest {
  targetId: string
  enabled: boolean
  intervalMinutes?: number
  runKind?: IntegrationScheduleRunKind
}

export interface IntegrationMappingEntry {
  id: string
  targetId: string
  entity: IntegrationEntity
  sourceKey: string
  sourceLabel?: string
  aiCrmsId?: string
  aiCrmsLabel?: string
  status: IntegrationMappingStatus
  sourceHash?: string
  lastSyncedAt?: number
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface IntegrationMappingSummary {
  total: number
  byEntity: Partial<Record<IntegrationEntity, number>>
  byStatus: Partial<Record<IntegrationMappingStatus, number>>
}

export interface IntegrationMappingListRequest {
  targetId: string
  entity?: IntegrationEntity
  limit?: number
}

export interface IntegrationMappingListResult {
  ok: boolean
  targetId: string
  mappings: IntegrationMappingEntry[]
  summary: IntegrationMappingSummary
  message?: string
  error?: string
}

export interface IntegrationMappingUpsertRequest {
  targetId: string
  entity: IntegrationEntity
  sourceKey: string
  sourceLabel?: string
  aiCrmsId?: string
  aiCrmsLabel?: string
  status?: IntegrationMappingStatus
  sourceHash?: string
  lastSyncedAt?: number
  metadata?: Record<string, unknown>
}

export interface IntegrationMappingDeleteRequest {
  targetId: string
  entity: IntegrationEntity
  sourceKey: string
}

export interface IntegrationMappingWriteResult {
  ok: boolean
  targetId: string
  mapping?: IntegrationMappingEntry
  message: string
  error?: string
}

export interface IntegrationTarget {
  id: string
  name: string
  source: {
    kind: IntegrationTargetSourceKind
    domain: string
    startUrl?: string
    migration?: IntegrationMigrationConfig
  }
  destination: {
    kind: IntegrationTargetDestinationKind
    region?: string
    workspaceId?: string
  }
  entities: IntegrationEntity[]
  schedule: IntegrationTargetSchedule
  state: {
    status: IntegrationTargetStatus
    cursor?: Record<string, string>
    lastRun?: IntegrationRunSummary
  }
  endpoints: IntegrationEndpointContract[]
  createdAt: number
  updatedAt: number
}

export interface IntegrationTargetSummary {
  id: string
  name: string
  domain: string
  sourceKind: IntegrationTargetSourceKind
  destinationKind: IntegrationTargetDestinationKind
  entities: IntegrationEntity[]
  endpointCount: number
  readCount: number
  writeCount: number
  scheduleEnabled: boolean
  scheduleIntervalMinutes?: number
  scheduleRunKind?: IntegrationScheduleRunKind
  scheduleNextRunAt?: number
  status: IntegrationTargetStatus
  lastRunStatus?: IntegrationRunStatus
  updatedAt: number
}

export interface IntegrationTargetCreateResult {
  ok: boolean
  target?: IntegrationTarget
  message: string
  error?: string
}

export interface IntegrationTargetRunResult {
  ok: boolean
  targetId: string
  run?: IntegrationRunSummary
  message: string
  error?: string
}

export interface IntegrationTargetScheduleResult {
  ok: boolean
  targetId: string
  target?: IntegrationTarget
  message: string
  error?: string
}

export interface IntegrationTargetDeleteResult {
  ok: boolean
  targetId: string
  message: string
  error?: string
}

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
  url: string
  active: boolean
  /** Pinned tabs (e.g. the AI-CRMS home tab) can't be closed and keep a fixed title/favicon. */
  pinned: boolean
  /** Favicon URL for the tab chip ('' = none). */
  favicon: string
  /** Desired CDP debugger state for this tab. Defaults to true for every new/restored tab. */
  debuggerEnabled: boolean
  /** Live CDP attachment state. Can lag briefly while a new tab is warming. */
  debuggerAttached: boolean
}

// A window-content-relative rectangle (DIP), as read from a placeholder element's
// getBoundingClientRect() and fed straight to WebContentsView.setBounds().
export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

// Broadcast on 'coach/load-progress' from the operation view's load events; the
// header progress bar animates a simulated bar between start (true) and stop (false).
export interface LoadProgress {
  loading: boolean
  ts: number
}

export interface CoachSettings {
  startUrl: string
  llmProvider: string
  llmModel: string
  llmEffort: LlmEffort
}

export type LlmProviderId = 'ai-crms' | 'openai-codex' | 'anthropic' | string
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
  effort: LlmEffort
  efforts: LlmEffortOption[]
  /** Context length as integer K units, e.g. 256 means 256K tokens. */
  contextLengthK: number
  /** Human-readable context length, e.g. 256K or 1M. */
  contextLengthLabel: string
  /** Remaining context percentage that should trigger context compression, e.g. 10 = trigger near 90% used. */
  compressionRemainingPercent: number
  authLabel: string
}

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
}

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
  versionCode: number
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

export interface SkillSummary {
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

export interface SkillDetail {
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
  error?: string
}

export interface AudioScribeRequest {
  path: string
  mime?: string
  format?: string
  sampleRate?: number
}

export type AudioScribeErrorCode =
  | 'ai-crms-login-required'
  | 'audio-not-found'
  | 'audio-too-large'
  | 'invalid-audio'
  | 'media-upload-unavailable'
  | 'relay-error'

export interface AudioScribeResult {
  ok: boolean
  text: string
  model: string
  durationMs: number
  code?: AudioScribeErrorCode
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
}

export interface AgentStreamDelta {
  sessionId: string
  delta: string
  ts: number
}

export interface AgentThinkingState {
  sessionId: string
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
  compactSummary?: string
  recentMessages?: AgentContextMessage[]
  /** Absolute paths explicitly attached on the current user turn. Main verifies they were registered. */
  attachedPaths?: string[]
  workspace?: WorkspaceRef
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
  ok: boolean
  text: string
  ts: number
  skill?: SkillSummary
  skills?: SkillSummary[]
  replay?: ReplayResult
  files?: AgentFileArtifact[]
  error?: string
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
  size?: number
  error?: string
}

export type CoachTraceEvent = TraceEvent
