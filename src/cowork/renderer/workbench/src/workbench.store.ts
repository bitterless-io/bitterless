import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import type {
  BrowserRequestReplayRequest,
  BrowserRequestReplayResult,
  CaptureExportFormat,
  CaptureOptions,
  CoachXpcContract,
  ExportRecordingResult,
  HostApprovalExportResult,
  HostApprovalEvent,
  HostToolCatalogEntry,
  HostToolCatalogResult,
  HostToolPolicyMode,
  HostToolScope,
  InjectedButtonDomain,
  InjectedButtonRemoveResult,
  IntegrationMappingEntry,
  IntegrationMappingSummary,
  IntegrationTarget,
  IntegrationTargetCreateResult,
  IntegrationTargetDeleteResult,
  IntegrationTargetRunResult,
  IntegrationTargetScheduleResult,
  IntegrationTargetSummary,
  IngestRecord,
  LlmConfig,
  LlmEffort,
  LlmLoginState,
  LlmLoginMethod,
  LlmProviderState,
  LlmTarget,
  SkillCreateResult,
  SkillDetail,
  SkillExportResult,
  SkillImportResult,
  SkillSummary,
  WorkbenchPane
} from '@cowork-shared/coach.api'
import type { HeaderMap, NetworkTiming, TraceEvent } from '@cowork-shared/trace.types'
import type { NetResponseEvent, Row } from '@cowork-renderer/control/src/record/record.types'
import { fmtHeaders } from '@cowork-renderer/control/src/record/record.format'
import { captureConfig } from '@cowork-renderer/control/src/config/captureConfig.store'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

const PREFS_KEY = 'coach.workbench.prefs'

interface WorkbenchPrefs {
  activePane?: WorkbenchPane
}

interface LlmProviderGroup extends LlmProviderState {
  models: LlmTarget[]
}

export interface NetworkExchangeDetail {
  requestId: string
  method: string
  url: string
  host: string
  path: string
  status?: number
  mime?: string
  resourceType?: string
  durationMs?: number
  encodedDataLength?: number
  requestHeaders?: HeaderMap
  responseHeaders?: HeaderMap
  requestBody?: string | null
  responseBody?: string | null
  requestBodyTruncated?: boolean
  responseBodyTruncated?: boolean
  responseBodyOmittedReason?: string
  responseBodyByteLength?: number
  responseBodyBase64Encoded?: boolean
  responseBodyStreamed?: boolean
  responseBodyChunkCount?: number
  decodedDataLength?: number
  timing?: NetworkTiming
  requestTs?: number
  responseTs?: number
}

const firstEffort = (model: LlmTarget): LlmEffort => model.efforts[0]?.id || model.effort

const loadPrefs = (): WorkbenchPrefs => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as WorkbenchPrefs
  } catch {
    return {}
  }
}

const savePrefs = (patch: WorkbenchPrefs): void => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
  } catch {
    /* localStorage unavailable — ignore */
  }
}

const isInternalUrl = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'micromeet:'
  } catch {
    return false
  }
}

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const pathOf = (url: string): string => {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

const requestIdOf = (row: Row | undefined): string => {
  const event = row?.event
  return event && (event.kind === 'net.request' || event.kind === 'net.response') ? event.requestId : ''
}

export const workbenchPanes: WorkbenchPane[] = ['recording', 'skills', 'integrations', 'injections', 'tools', 'models', 'about', 'log']

export const isWorkbenchPane = (value: string): value is WorkbenchPane =>
  workbenchPanes.includes(value as WorkbenchPane)

export const preferredWorkbenchPane = (): WorkbenchPane => {
  const pane = loadPrefs().activePane
  return pane && isWorkbenchPane(pane) ? pane : 'recording'
}

const fmt = (e: TraceEvent): string => {
  if (e.kind === 'net.request') return `${e.method} ${e.url}`
  if (e.kind === 'net.response') return `${e.status} ${e.url}`
  if (e.kind === 'action') return e.desc
  if (e.kind === 'snapshot') return `${e.title || e.url} · ${e.nodeCount} elements`
  return e.msg
}

const toRow = (e: TraceEvent): Row => {
  const base = { is_deleted: false, delete_flag: 0, spec: '', flagged: false, event: e, response: undefined }
  if (e.kind === 'action') return { ...base, kind: e.kind, text: fmt(e), title: e.step.yaml, yaml: e.step.yaml, shot: e.shot, ts: e.ts }
  if (e.kind === 'snapshot') return { ...base, kind: e.kind, text: fmt(e), title: e.yaml, yaml: e.yaml, shot: e.shot, url: e.url, ts: e.ts }
  if (e.kind === 'net.response')
    return { ...base, kind: e.kind, text: fmt(e), title: e.bodyPreview || fmt(e), body: e.bodyPreview, ts: e.ts, status: e.status, url: e.url, headers: e.headers }
  if (e.kind === 'net.request')
    return { ...base, kind: e.kind, text: fmt(e), title: e.postData || fmt(e), body: e.postData, ts: e.ts, method: e.method, url: e.url, headers: e.headers }
  return { ...base, kind: e.kind, text: fmt(e), title: fmt(e), ts: e.ts }
}

// Fold a response into its pending request row so one exchange renders as one record:
// stamp the response status onto the row (for the list badge + search) and keep the
// response event for the detail panel / ingest expansion.
const attachResponseToRow = (row: Row, event: NetResponseEvent): void => {
  row.response = event
  row.status = event.status
  row.text = `${row.method || ''} ${event.status} ${event.url}`.trim()
}

// Rebuild display rows from a flat record list (persisted-capture reload), re-folding
// each net.response into its net.request row. Records arrive in ascending ts order, so
// a request always precedes its response; a response with no request row stays standalone.
const mergeRecordsIntoRows = (records: { event: TraceEvent; spec?: string; flagged?: boolean }[]): Row[] => {
  const rows: Row[] = []
  const requestRowById = new Map<string, Row>()
  for (const record of records) {
    const event = record.event
    if (event.kind === 'net.response') {
      const requestRow = requestRowById.get(event.requestId)
      if (requestRow) {
        attachResponseToRow(requestRow, event)
        continue
      }
    }
    const row = toRow(event)
    row.spec = record.spec || ''
    row.flagged = Boolean(record.flagged)
    if (event.kind === 'net.request') requestRowById.set(event.requestId, row)
    rows.push(row)
  }
  return rows.sort((a, b) => b.ts - a.ts)
}

const rowTokenCache = new WeakMap<Row, number>()

const recordSearchTerms = (query: string): string[] =>
  Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[\s/\\:.#"'`()[\]{}<>|,;=+*&!?]+/)
        .map((term) => term.trim())
        .filter(Boolean)
    )
  ).slice(0, 12)

class WorkbenchStoreState {
  activePane: WorkbenchPane = preferredWorkbenchPane()
  rows: Row[] = []
  skills: SkillSummary[] = []
  llmConfig: LlmConfig | null = null
  llmLoading = false
  llmActionSaving = false
  llmLoginProvider = ''
  hostToolCatalog: HostToolCatalogResult | null = null
  hostToolLoading = false
  hostApprovalLoading = false
  hostApprovalExporting = false
  hostToolScope: HostToolScope = 'cowork'
  hostToolCategory = ''
  hostToolQuery = ''
  hostApprovalEvents: HostApprovalEvent[] = []
  integrationTargets: IntegrationTargetSummary[] = []
  integrationTargetDetail: IntegrationTarget | null = null
  integrationMappings: IntegrationMappingEntry[] = []
  integrationMappingSummary: IntegrationMappingSummary | null = null
  integrationLoading = false
  integrationMappingLoading = false
  integrationCreating = false
  integrationRunningTargetId = ''
  integrationSchedulingTargetId = ''
  integrationDeletingTargetId = ''
  selectedIntegrationTargetId = ''
  injectedButtons: InjectedButtonDomain[] = []
  injectedButtonLoading = false
  injectedButtonRemovingDomain = ''
  selectedSkillId = ''
  skillDetail: SkillDetail | null = null
  currentDomain = ''
  selectedDomain = ''
  workflowDesc = ''
  activeFilters: string[] = []
  recordSearch = ''
  recordActions = true
  recordNetwork = true
  recordingStartedAt = 0
  capturing = false
  selectedNetworkRequestId = ''
  ingesting = false
  previewVisible = false
  initialized = false
  private captureRecordsEdited = false
  private captureRecordSyncTimer: ReturnType<typeof setTimeout> | null = null

  readonly filterCats = [
    { key: 'action', label: 'Action' },
    { key: 'snapshot', label: 'Snapshots' },
    { key: 'network', label: 'Network' },
    { key: 'flagged', label: 'Flagged' }
  ]

  readonly hostToolCategories = [
    { key: '', label: 'All' },
    { key: 'observe', label: 'Observe' },
    { key: 'act', label: 'Act' },
    { key: 'api', label: 'API' },
    { key: 'capture', label: 'Capture' },
    { key: 'skill', label: 'Skill' },
    { key: 'integration', label: 'Integration' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'file', label: 'File' },
    { key: 'tab', label: 'Tab' },
    { key: 'training', label: 'Training' }
  ]

  get visibleRows(): Row[] {
    return this.rows.filter((row) => !row.is_deleted)
  }

  get ingestRows(): Row[] {
    return this.visibleRows.filter((row) => row.kind !== 'error')
  }

  get displayedRows(): Row[] {
    const wantsFlagged = this.activeFilters.includes('flagged')
    const activeCategories = this.activeFilters.filter((key) => key !== 'flagged')
    const categoryFiltered = activeCategories.length
      ? this.visibleRows.filter((row) => activeCategories.includes(this.rowCategory(row)))
      : this.visibleRows
    const flaggedFiltered = wantsFlagged ? categoryFiltered.filter((row) => row.flagged) : categoryFiltered
    const terms = recordSearchTerms(this.recordSearch)
    if (!terms.length) return this.sortDisplayRows(flaggedFiltered)
    return this.sortDisplayRows(flaggedFiltered.filter((row) => this.rowMatchesSearch(row, terms)))
  }

  get selectedNetworkRows(): Row[] {
    if (!this.selectedNetworkRequestId) return []
    return this.visibleRows.filter((row) => requestIdOf(row) === this.selectedNetworkRequestId)
  }

  get selectedNetworkDetail(): NetworkExchangeDetail | null {
    if (!this.selectedNetworkRequestId) return null
    const row = this.visibleRows.find((item) => requestIdOf(item) === this.selectedNetworkRequestId)
    if (!row) return null
    const reqEvent = row.event.kind === 'net.request' ? row.event : undefined
    const resEvent = row.response ?? (row.event.kind === 'net.response' ? row.event : undefined)
    if (!reqEvent && !resEvent) return null
    const url = reqEvent?.url || resEvent?.url || ''
    return {
      requestId: this.selectedNetworkRequestId,
      method: reqEvent?.method || '',
      url,
      host: hostnameOf(url),
      path: pathOf(url),
      status: resEvent?.status,
      mime: resEvent?.mime,
      resourceType: reqEvent?.resourceType,
      durationMs: reqEvent && resEvent ? Math.max(0, resEvent.ts - reqEvent.ts) : undefined,
      encodedDataLength: resEvent?.encodedDataLength,
      requestHeaders: reqEvent?.headers,
      responseHeaders: resEvent?.headers,
      requestBody: reqEvent?.postData,
      responseBody: resEvent?.bodyPreview,
      requestBodyTruncated: reqEvent?.postDataTruncated,
      responseBodyTruncated: resEvent?.bodyTruncated,
      responseBodyOmittedReason: resEvent?.bodyOmittedReason,
      responseBodyByteLength: resEvent?.bodyByteLength,
      responseBodyBase64Encoded: resEvent?.bodyBase64Encoded,
      responseBodyStreamed: resEvent?.bodyStreamed,
      responseBodyChunkCount: resEvent?.bodyChunkCount,
      decodedDataLength: resEvent?.decodedDataLength,
      timing: resEvent?.timing,
      requestTs: reqEvent?.ts,
      responseTs: resEvent?.ts
    }
  }

  get apiCount(): number {
    return this.visibleRows.filter((row) => row.kind.startsWith('net.')).length
  }

  get uiCount(): number {
    return this.visibleRows.filter((row) => row.kind === 'action').length
  }

  get tokenCount(): number {
    return this.visibleRows.reduce((sum, row) => sum + this.rowTokens(row), 0)
  }

  get flaggedCount(): number {
    return this.visibleRows.filter((row) => row.flagged).length
  }

  get domainSkills(): SkillSummary[] {
    return this.selectedDomain ? this.skills.filter((skill) => skill.domain === this.selectedDomain) : this.skills
  }

  get domains(): { domain: string; count: number; active: boolean }[] {
    const counts = new Map<string, number>()
    for (const skill of this.skills) {
      const domain = skill.domain || 'all domains'
      counts.set(domain, (counts.get(domain) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => {
        if (a === this.currentDomain) return -1
        if (b === this.currentDomain) return 1
        return a.localeCompare(b)
      })
      .map(([domain, count]) => ({ domain, count, active: domain === this.currentDomain }))
  }

  get selectedSkill(): SkillSummary | undefined {
    return this.skills.find((skill) => skill.id === this.selectedSkillId)
  }

  get hostTools(): HostToolCatalogEntry[] {
    return this.hostToolCatalog?.tools || []
  }

  get recentHostApprovalEvents(): HostApprovalEvent[] {
    return this.hostApprovalEvents.slice(0, 30)
  }

  get selectedIntegrationTarget(): IntegrationTargetSummary | undefined {
    return this.integrationTargets.find((target) => target.id === this.selectedIntegrationTargetId)
  }

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    xpcRenderer.subscribe('coach/capture-started', (payload) => {
      const params = payload.params as { ts?: number } | undefined
      this.resetRecordingForCaptureStart(typeof params?.ts === 'number' ? params.ts : Date.now())
    })
    xpcRenderer.subscribe('coach/capture-stopped', () => {
      this.capturing = false
    })
    xpcRenderer.subscribe('coach/trace', (payload) => {
      const event = payload.params as TraceEvent
      const url = 'url' in event ? event.url || '' : ''
      if ((event.kind === 'net.request' || event.kind === 'net.response') && !captureConfig.passes(url)) return
      this.appendTraceEvent(event)
      if (this.captureRecordsEdited) this.syncCaptureRecordsSoon()
    })
    xpcRenderer.subscribe('coach/capture-options', (payload) => {
      this.applyCaptureOptions(payload.params as CaptureOptions)
    })
    xpcRenderer.subscribe('coach/nav', (payload) => {
      const url = String(payload.params || '')
      if (isInternalUrl(url)) return
      const domain = hostnameOf(url)
      if (domain === this.currentDomain) return
      this.currentDomain = domain
      this.selectedDomain = this.domainExists(domain) ? domain : this.selectedDomain
      void this.refreshSkills()
    })
    xpcRenderer.subscribe('coach/skills-changed', () => void this.refreshSkills())
    xpcRenderer.subscribe('coach/injected-buttons-changed', () => {
      if (this.activePane === 'injections') void this.refreshInjectedButtons()
    })
    xpcRenderer.subscribe('coach/integration-targets-changed', () => {
      if (this.activePane === 'integrations') void this.refreshIntegrationTargets()
    })
    xpcRenderer.subscribe('coach/llm-config', (payload) => {
      this.llmConfig = payload.params as LlmConfig
    })
    xpcRenderer.subscribe('coach/llm-login-state', (payload) => {
      const state = payload.params as LlmLoginState
      this.llmLoginProvider = state?.loading ? state.provider : ''
    })
    xpcRenderer.subscribe('coach/auth', () => void this.refreshLlmConfig())
    xpcRenderer.subscribe('coach/host-approval', (payload) => {
      const params = payload.params as HostApprovalEvent | { cleared?: boolean; events?: HostApprovalEvent[] }
      if ('cleared' in params && params.cleared) {
        this.hostApprovalEvents = params.events || []
        return
      }
      this.upsertHostApprovalEvent(params as HostApprovalEvent)
    })

    await captureConfig.load()
    this.applyCaptureOptions(await coach.getCaptureOptions())
    await this.syncCaptureState()
    await this.loadPersistedCaptureRecords()
    await this.syncCaptureOptions()
    await this.seedDomain()
    await this.refreshSkills()
    await this.refreshLlmConfig()
    if (this.activePane === 'tools') {
      await this.refreshHostToolCatalog()
      await this.refreshHostApprovalEvents()
    }
    if (this.activePane === 'integrations') await this.refreshIntegrationTargets()
    if (this.activePane === 'injections') await this.refreshInjectedButtons()
  }

  destroy(): void {
    /* no-op; kept for the WorkbenchApp lifecycle symmetry */
  }

  // Add a live trace event to the record list. A net.response is folded into its pending
  // net.request row (one exchange = one record); everything else prepends a fresh row.
  private appendTraceEvent(event: TraceEvent): void {
    if (event.kind === 'net.response') {
      // Fold into the request row; a later response for the same id wins (redirects / streaming).
      const requestRow = this.rows.find(
        (row) => row.event.kind === 'net.request' && row.event.requestId === event.requestId
      )
      if (requestRow) {
        attachResponseToRow(requestRow, event)
        rowTokenCache.delete(requestRow)
        return
      }
    }
    this.rows.unshift(toRow(event))
    if (this.rows.length > 500) this.rows.pop()
  }

  setPane(pane: WorkbenchPane): void {
    this.activePane = pane
    savePrefs({ activePane: pane })
    if (this.initialized && pane === 'skills') void this.refreshSkills()
    if (this.initialized && pane === 'integrations') void this.refreshIntegrationTargets()
    if (this.initialized && pane === 'tools') {
      void this.refreshHostToolCatalog()
      void this.refreshHostApprovalEvents()
    }
    if (this.initialized && pane === 'injections') void this.refreshInjectedButtons()
    if (this.initialized && pane === 'models') void this.refreshLlmConfig()
  }

  get llmProviderGroups(): LlmProviderGroup[] {
    const groups: LlmProviderGroup[] = []
    for (const provider of this.llmConfig?.providers || []) {
      groups.push({ ...provider, models: [] })
    }
    for (const preset of this.llmConfig?.presets || []) {
      let group = groups.find((item) => item.provider === preset.provider)
      if (!group) {
        group = {
          provider: preset.provider,
          label: preset.providerLabel,
          authLabel: preset.authLabel,
          ready: false,
          active: preset.provider === this.llmConfig?.provider,
          models: []
        }
        groups.push(group)
      }
      group.models.push(preset)
    }
    return groups
  }

  get activeLlmGroup(): LlmProviderGroup | undefined {
    return this.llmProviderGroups.find((group) => group.provider === this.llmConfig?.provider) || this.llmProviderGroups[0]
  }

  get activeLlmModel(): LlmTarget | undefined {
    return this.activeLlmGroup?.models.find((model) => model.model === this.llmConfig?.model) || this.activeLlmGroup?.models[0]
  }

  get activeLlmEfforts(): { id: LlmEffort; label: string }[] {
    return this.activeLlmModel?.efforts || [{ id: 'default', label: 'Default' }]
  }

  get activeLlmLoginMethods(): { id: LlmLoginMethod; label: string }[] {
    const provider = this.activeLlmGroup?.provider || this.llmConfig?.provider || ''
    return this.llmConfig?.loginProviders.find((item) => item.provider === provider)?.methods || [{ id: 'browser', label: 'Browser Login' }]
  }

  get llmSaving(): boolean {
    return this.llmActionSaving || Boolean(this.llmLoginProvider)
  }

  async refreshLlmConfig(): Promise<void> {
    if (this.llmLoading) return
    this.llmLoading = true
    try {
      this.llmConfig = await coach.getLlmConfig()
    } finally {
      this.llmLoading = false
    }
  }

  async refreshHostToolCatalog(): Promise<void> {
    if (this.hostToolLoading) return
    this.hostToolLoading = true
    try {
      this.hostToolCatalog = await coach.getHostToolCatalog({
        scope: this.hostToolScope,
        category: this.hostToolCategory,
        query: this.hostToolQuery.trim()
      })
    } finally {
      this.hostToolLoading = false
    }
  }

  async refreshHostApprovalEvents(): Promise<void> {
    if (this.hostApprovalLoading) return
    this.hostApprovalLoading = true
    try {
      const result = await coach.getHostApprovalEvents()
      this.hostApprovalEvents = result.events || []
    } finally {
      this.hostApprovalLoading = false
    }
  }

  async exportHostApprovalEvents(): Promise<HostApprovalExportResult> {
    if (this.hostApprovalExporting) return { ok: false, error: 'export already running' }
    this.hostApprovalExporting = true
    try {
      return await coach.exportHostApprovalEvents()
    } finally {
      this.hostApprovalExporting = false
    }
  }

  async clearHostApprovalEvents(): Promise<void> {
    const result = await coach.clearHostApprovalEvents()
    this.hostApprovalEvents = result.events || []
  }

  async refreshInjectedButtons(): Promise<void> {
    if (this.injectedButtonLoading) return
    this.injectedButtonLoading = true
    try {
      this.injectedButtons = await coach.listInjectedButtons()
    } finally {
      this.injectedButtonLoading = false
    }
  }

  async refreshIntegrationTargets(): Promise<void> {
    if (this.integrationLoading) return
    this.integrationLoading = true
    try {
      this.integrationTargets = await coach.listIntegrationTargets()
      if (!this.selectedIntegrationTargetId || !this.integrationTargets.some((item) => item.id === this.selectedIntegrationTargetId)) {
        this.selectedIntegrationTargetId = this.integrationTargets[0]?.id || ''
      }
      await this.loadIntegrationTargetDetail(this.selectedIntegrationTargetId)
    } finally {
      this.integrationLoading = false
    }
  }

  async selectIntegrationTarget(targetId: string): Promise<void> {
    this.selectedIntegrationTargetId = targetId
    await this.loadIntegrationTargetDetail(targetId)
  }

  async loadIntegrationTargetDetail(targetId: string): Promise<void> {
    this.integrationTargetDetail = targetId ? await coach.getIntegrationTarget({ targetId }) : null
    await this.loadIntegrationMappings(targetId)
  }

  async loadIntegrationMappings(targetId: string): Promise<void> {
    if (!targetId) {
      this.integrationMappings = []
      this.integrationMappingSummary = null
      return
    }
    this.integrationMappingLoading = true
    try {
      const result = await coach.listIntegrationMappings({ targetId, limit: 30 })
      this.integrationMappings = result.mappings || []
      this.integrationMappingSummary = result.summary || null
    } finally {
      this.integrationMappingLoading = false
    }
  }

  async createIntegrationTargetFromCapture(): Promise<IntegrationTargetCreateResult> {
    if (this.integrationCreating) return { ok: false, message: 'Integration target creation already running', error: 'busy' }
    this.integrationCreating = true
    try {
      const result = await coach.createIntegrationTargetFromCapture({})
      if (result.ok && result.target) {
        await this.refreshIntegrationTargets()
        this.selectedIntegrationTargetId = result.target.id
        this.integrationTargetDetail = result.target
      }
      return result
    } finally {
      this.integrationCreating = false
    }
  }

  async createAiCrmsMigrationTarget(params: { name?: string; source: string; target: string; domains?: string[] }): Promise<IntegrationTargetCreateResult> {
    if (this.integrationCreating) return { ok: false, message: 'Integration target creation already running', error: 'busy' }
    this.integrationCreating = true
    try {
      const result = await coach.createAiCrmsMigrationTarget(params)
      if (result.ok && result.target) {
        await this.refreshIntegrationTargets()
        this.selectedIntegrationTargetId = result.target.id
        this.integrationTargetDetail = result.target
      }
      return result
    } finally {
      this.integrationCreating = false
    }
  }

  async runIntegrationTargetDryRun(targetId: string): Promise<IntegrationTargetRunResult> {
    if (!targetId) return { ok: false, targetId: '', message: 'No integration target selected', error: 'missing-target-id' }
    if (this.integrationRunningTargetId) return { ok: false, targetId, message: 'Dry-run already running', error: 'busy' }
    this.integrationRunningTargetId = targetId
    try {
      const result = await coach.runIntegrationTargetDryRun({ targetId })
      await this.refreshIntegrationTargets()
      if (this.selectedIntegrationTargetId === targetId) await this.loadIntegrationTargetDetail(targetId)
      return result
    } finally {
      this.integrationRunningTargetId = ''
    }
  }

  async runIntegrationRecordedSiteDryRun(targetId: string): Promise<IntegrationTargetRunResult> {
    if (!targetId) return { ok: false, targetId: '', message: 'No integration target selected', error: 'missing-target-id' }
    if (this.integrationRunningTargetId) return { ok: false, targetId, message: 'Integration run already running', error: 'busy' }
    this.integrationRunningTargetId = targetId
    try {
      const result = await coach.runIntegrationRecordedSiteDryRun({ targetId, maxEndpoints: 5, maxRowsPerEndpoint: 50 })
      await this.refreshIntegrationTargets()
      if (this.selectedIntegrationTargetId === targetId) await this.loadIntegrationTargetDetail(targetId)
      return result
    } finally {
      this.integrationRunningTargetId = ''
    }
  }

  async runIntegrationRecordedSitePlan(targetId: string): Promise<IntegrationTargetRunResult> {
    if (!targetId) return { ok: false, targetId: '', message: 'No integration target selected', error: 'missing-target-id' }
    if (this.integrationRunningTargetId) return { ok: false, targetId, message: 'Integration run already running', error: 'busy' }
    this.integrationRunningTargetId = targetId
    try {
      const result = await coach.runIntegrationRecordedSitePlan({ targetId, maxEndpoints: 5, maxRowsPerEndpoint: 50 })
      await this.refreshIntegrationTargets()
      if (this.selectedIntegrationTargetId === targetId) await this.loadIntegrationTargetDetail(targetId)
      return result
    } finally {
      this.integrationRunningTargetId = ''
    }
  }

  async runIntegrationRecordedSiteApply(targetId: string, allowUpdates = false): Promise<IntegrationTargetRunResult> {
    if (!targetId) return { ok: false, targetId: '', message: 'No integration target selected', error: 'missing-target-id' }
    if (this.integrationRunningTargetId) return { ok: false, targetId, message: 'Integration run already running', error: 'busy' }
    this.integrationRunningTargetId = targetId
    try {
      const result = await coach.runIntegrationRecordedSiteApply({
        targetId,
        apply: true,
        maxEndpoints: 5,
        maxRowsPerEndpoint: 50,
        maxWrites: 10,
        allowUpdates,
        entities: ['patient', 'corporate', 'project', 'data_mapping', 'mcu_record']
      })
      await this.refreshIntegrationTargets()
      if (this.selectedIntegrationTargetId === targetId) await this.loadIntegrationTargetDetail(targetId)
      return result
    } finally {
      this.integrationRunningTargetId = ''
    }
  }

  async runIntegrationMigrationDryRun(targetId: string): Promise<IntegrationTargetRunResult> {
    if (!targetId) return { ok: false, targetId: '', message: 'No integration target selected', error: 'missing-target-id' }
    if (this.integrationRunningTargetId) return { ok: false, targetId, message: 'Integration run already running', error: 'busy' }
    this.integrationRunningTargetId = targetId
    try {
      const result = await coach.runIntegrationMigration({ targetId, apply: false })
      await this.refreshIntegrationTargets()
      if (this.selectedIntegrationTargetId === targetId) await this.loadIntegrationTargetDetail(targetId)
      return result
    } finally {
      this.integrationRunningTargetId = ''
    }
  }

  async runIntegrationReportReadiness(targetId: string): Promise<IntegrationTargetRunResult> {
    if (!targetId) return { ok: false, targetId: '', message: 'No integration target selected', error: 'missing-target-id' }
    if (this.integrationRunningTargetId) return { ok: false, targetId, message: 'Integration run already running', error: 'busy' }
    this.integrationRunningTargetId = targetId
    try {
      const result = await coach.runIntegrationReportReadiness({ targetId, pageSize: 20, generate: false })
      await this.refreshIntegrationTargets()
      if (this.selectedIntegrationTargetId === targetId) await this.loadIntegrationTargetDetail(targetId)
      return result
    } finally {
      this.integrationRunningTargetId = ''
    }
  }

  async setIntegrationTargetSchedule(
    targetId: string,
    params: { enabled: boolean; intervalMinutes?: number; runKind?: 'safe-default' | 'migration-dry-run' | 'report-readiness' | 'recorded-site-dry-run' }
  ): Promise<IntegrationTargetScheduleResult> {
    if (!targetId) return { ok: false, targetId: '', message: 'No integration target selected', error: 'missing-target-id' }
    if (this.integrationSchedulingTargetId) return { ok: false, targetId, message: 'Another schedule update is running', error: 'busy' }
    this.integrationSchedulingTargetId = targetId
    try {
      const result = await coach.setIntegrationTargetSchedule({ targetId, ...params })
      await this.refreshIntegrationTargets()
      if (this.selectedIntegrationTargetId === targetId) await this.loadIntegrationTargetDetail(targetId)
      return result
    } finally {
      this.integrationSchedulingTargetId = ''
    }
  }

  async deleteIntegrationTarget(targetId: string): Promise<IntegrationTargetDeleteResult> {
    if (!targetId) return { ok: false, targetId: '', message: 'No integration target selected', error: 'missing-target-id' }
    if (this.integrationDeletingTargetId) return { ok: false, targetId, message: 'Another integration target deletion is running', error: 'busy' }
    this.integrationDeletingTargetId = targetId
    try {
      const result = await coach.deleteIntegrationTarget({ targetId })
      await this.refreshIntegrationTargets()
      return result
    } finally {
      this.integrationDeletingTargetId = ''
    }
  }

  async removeInjectedButtonDomain(domain: string): Promise<InjectedButtonRemoveResult> {
    const target = String(domain || '').trim()
    if (!target) return { ok: false, domain: '', removed: 0, unInjected: 0, error: 'Missing domain' }
    if (this.injectedButtonRemovingDomain) return { ok: false, domain: target, removed: 0, unInjected: 0, error: 'Another removal is running' }
    this.injectedButtonRemovingDomain = target
    try {
      const result = await coach.removeInjectedButtonDomain({ domain: target })
      if (result.ok) this.injectedButtons = this.injectedButtons.filter((item) => item.domain !== result.domain)
      else await this.refreshInjectedButtons()
      return result
    } finally {
      this.injectedButtonRemovingDomain = ''
    }
  }

  async setHostToolScope(scope: HostToolScope): Promise<void> {
    if (scope !== 'cowork' && scope !== 'trainer') return
    this.hostToolScope = scope
    await this.refreshHostToolCatalog()
  }

  async setHostToolCategory(category: string): Promise<void> {
    this.hostToolCategory = category
    await this.refreshHostToolCatalog()
  }

  async setHostToolQuery(query: string): Promise<void> {
    this.hostToolQuery = query
    await this.refreshHostToolCatalog()
  }

  async setHostToolPolicy(toolName: string, mode: HostToolPolicyMode): Promise<void> {
    await coach.setHostToolPolicy({ toolName, mode })
    await this.refreshHostToolCatalog()
  }

  private upsertHostApprovalEvent(event: HostApprovalEvent): void {
    if (!event?.id) return
    const existing = this.hostApprovalEvents.findIndex((item) => item.id === event.id)
    if (existing >= 0) this.hostApprovalEvents.splice(existing, 1)
    this.hostApprovalEvents.unshift(event)
    if (this.hostApprovalEvents.length > 80) this.hostApprovalEvents.splice(80)
  }

  async setLlmProvider(provider: string): Promise<void> {
    const group = this.llmProviderGroups.find((item) => item.provider === provider)
    const model = group?.models[0]
    if (!model) return
    await this.setLlmTarget(model.provider, model.model, firstEffort(model))
  }

  async setLlmModel(modelId: string): Promise<void> {
    const group = this.activeLlmGroup
    const model = group?.models.find((item) => item.model === modelId)
    if (!model) return
    await this.setLlmTarget(model.provider, model.model, firstEffort(model))
  }

  async setLlmEffort(effort: LlmEffort): Promise<void> {
    const model = this.activeLlmModel
    if (!model) return
    await this.setLlmTarget(model.provider, model.model, effort)
  }

  async setLlmCompressionRemainingPercent(value: number): Promise<void> {
    const model = this.activeLlmModel
    if (!model || this.llmSaving) return
    this.llmActionSaving = true
    try {
      this.llmConfig = await coach.setLlmCompression({
        provider: model.provider,
        model: model.model,
        compressionRemainingPercent: value
      })
    } finally {
      this.llmActionSaving = false
    }
  }

  async loginLlmProvider(provider?: string, method: LlmLoginMethod = 'browser'): Promise<void> {
    if (this.llmSaving) return
    this.llmConfig = await coach.loginLlm({ provider: provider || this.llmConfig?.provider || 'openai-codex', method })
  }

  async logoutLlmProvider(provider?: string): Promise<void> {
    if (this.llmSaving) return
    this.llmActionSaving = true
    try {
      this.llmConfig = await coach.logoutLlm({ provider: provider || this.llmConfig?.provider })
    } finally {
      this.llmActionSaving = false
    }
  }

  private async setLlmTarget(provider: string, model: string, effort: LlmEffort): Promise<void> {
    if (this.llmSaving) return
    this.llmActionSaving = true
    try {
      this.llmConfig = await coach.setLlmConfig({ provider, model, effort })
    } finally {
      this.llmActionSaving = false
    }
  }

  async close(): Promise<void> {
    await coach.setWorkbenchVisible({ visible: false })
  }

  toggleFilter(key: string): void {
    const i = this.activeFilters.indexOf(key)
    if (i >= 0) this.activeFilters.splice(i, 1)
    else this.activeFilters.push(key)
  }

  clearFilters(): void {
    this.activeFilters = []
  }

  clearRecordSearch(): void {
    this.recordSearch = ''
  }

  async setRecordActions(value: boolean): Promise<void> {
    this.applyCaptureOptions(await coach.setCaptureOptions({ recordActions: value }))
  }

  async setRecordNetwork(value: boolean): Promise<void> {
    this.applyCaptureOptions(await coach.setCaptureOptions({ recordNetwork: value }))
  }

  async syncCaptureOptions(): Promise<void> {
    await captureConfig.load()
    this.applyCaptureOptions(
      await coach.setCaptureOptions({
        recordActions: this.recordActions,
        recordNetwork: this.recordNetwork,
        networkWhitelistEnabled: captureConfig.whitelistEnabled,
        // Vue wraps the shared capture store (including both rule arrays and their rows) in
        // reactive proxies. Electron IPC cannot structured-clone those proxies, so hand the
        // main process plain rule records.
        networkWhitelist: captureConfig.whitelist.map((rule) => ({ ...rule })),
        networkBlacklist: captureConfig.blacklist.map((rule) => ({ ...rule }))
      })
    )
  }

  // Add a network record's host to the allowlist / blocklist (domain-suffix rule) and push the
  // refreshed capture filter to main. `whitelistInactive` flags a whitelist add while the allowlist
  // toggle is off (the rule is saved but won't filter until the toggle is enabled).
  async addCaptureRuleForRow(row: Row, type: 'whitelist' | 'blacklist'): Promise<{ ok: boolean; host: string; whitelistInactive: boolean }> {
    const host = hostnameOf(row.url || '')
    if (!host) return { ok: false, host: '', whitelistInactive: false }
    await captureConfig.addRule({ type, rule: 'domain-suffix', value: host })
    await this.syncCaptureOptions()
    return { ok: true, host, whitelistInactive: type === 'whitelist' && !captureConfig.whitelistEnabled }
  }

  deleteRow(row: Row): void {
    row.is_deleted = true
    row.delete_flag = Date.now()
    const requestId = requestIdOf(row)
    if (requestId && requestId === this.selectedNetworkRequestId && !this.visibleRows.some((item) => requestIdOf(item) === requestId)) {
      this.selectedNetworkRequestId = ''
    }
    this.markCaptureRecordsEdited()
  }

  toggleFlag(row: Row): void {
    row.flagged = !row.flagged
    this.markCaptureRecordsEdited()
  }

  undoDelete(): void {
    let latest: Row | null = null
    for (const row of this.rows) {
      if (row.is_deleted && (!latest || row.delete_flag > latest.delete_flag)) latest = row
    }
    if (latest) {
      latest.is_deleted = false
      latest.delete_flag = 0
      this.markCaptureRecordsEdited()
    }
  }

  markCaptureRecordsEdited(): void {
    this.captureRecordsEdited = true
    this.syncCaptureRecordsSoon()
  }

  async refreshSkills(): Promise<void> {
    this.skills = await coach.listSkills()
    this.ensureSelectedDomain()
    const selected = this.skills.find((skill) => skill.id === this.selectedSkillId)
    const selectedInDomain = selected && (!this.selectedDomain || selected.domain === this.selectedDomain)
    if (!selectedInDomain) this.selectedSkillId = this.domainSkills[0]?.id || ''
    await this.loadSkillDetail(this.selectedSkillId)
  }

  async selectDomain(domain: string): Promise<void> {
    this.selectedDomain = domain === 'all domains' ? '' : domain
    const selected = this.skills.find((skill) => skill.id === this.selectedSkillId)
    if (!selected || (this.selectedDomain && selected.domain !== this.selectedDomain)) {
      this.selectedSkillId = this.domainSkills[0]?.id || ''
    }
    await this.loadSkillDetail(this.selectedSkillId)
  }

  async selectSkill(skillId: string): Promise<void> {
    this.selectedSkillId = skillId
    await this.loadSkillDetail(skillId)
  }

  async loadSkillDetail(skillId: string): Promise<void> {
    this.skillDetail = skillId ? await coach.getSkillDetail({ skillId }) : null
  }

  async openSelectedSkillDirectory(): Promise<{ ok: boolean; path?: string; error?: string }> {
    if (!this.selectedSkillId) return { ok: false, error: 'No skill selected' }
    return await coach.openSkillDirectory({ skillId: this.selectedSkillId })
  }

  async exportSelectedSkillPackage(): Promise<SkillExportResult> {
    if (!this.selectedSkillId) return { ok: false, skillId: '', message: 'No skill selected', error: 'no-skill-selected' }
    return await coach.exportSkillPackage({ skillId: this.selectedSkillId })
  }

  async importSkillPackage(): Promise<SkillImportResult> {
    const result = await coach.importSkillPackage()
    if (result.ok && result.skill) {
      await this.refreshSkills()
      this.selectedDomain = result.skill.domain
      this.selectedSkillId = result.skill.id
      await this.loadSkillDetail(result.skill.id)
    }
    return result
  }

  // Open the folder with ALL skills for the current domain ('' → the skills root).
  async openDomainDirectory(): Promise<{ ok: boolean; path?: string; error?: string }> {
    return await coach.openDomainDirectory({ domain: this.selectedDomain })
  }

  async deleteSelectedSkill(): Promise<{ ok: boolean; message: string }> {
    const skill = this.selectedSkill
    if (!skill || skill.source === 'builtin') return { ok: false, message: 'Only user-managed skills can be deleted' }
    const result = await coach.deleteSkill({ skillId: skill.id })
    if (result.ok) {
      this.selectedSkillId = ''
      await this.refreshSkills()
    }
    return { ok: result.ok, message: result.message }
  }

  async ingest(): Promise<SkillCreateResult> {
    if (this.ingesting) return { ok: false, message: 'Ingest already running', error: 'busy' }
    this.ingesting = true
    try {
      await this.syncCaptureRecordsNow()
      const result = await coach.summarizeSkill({ workflow: this.workflowDesc.trim(), records: this.buildIngestRecords() })
      if (result.ok && result.skill) {
        await this.refreshSkills()
        this.selectedSkillId = result.skill.id
        await this.loadSkillDetail(result.skill.id)
        this.workflowDesc = ''
      }
      return result
    } finally {
      this.ingesting = false
    }
  }

  async exportRecording(format: CaptureExportFormat = 'json'): Promise<ExportRecordingResult> {
    return await coach.exportRecording({
      startedAt: this.recordingStartedAt || this.recordingStartFromRows(),
      records: this.buildExportRecords(),
      format
    })
  }

  async replayBrowserRequest(params: BrowserRequestReplayRequest): Promise<BrowserRequestReplayResult> {
    return await coach.replayBrowserRequest(params)
  }

  private async seedDomain(): Promise<void> {
    const tabs = await coach.getTabs()
    const active = tabs.find((tab) => tab.active)
    const target = active || tabs.find((tab) => tab.kind === 'browser') || tabs.find((tab) => tab.kind === 'ai-crms')
    this.currentDomain = hostnameOf(target?.url || '')
    this.selectedDomain = this.currentDomain
  }

  private ensureSelectedDomain(): void {
    if (this.selectedDomain && this.domainExists(this.selectedDomain)) return
    if (this.currentDomain && this.domainExists(this.currentDomain)) {
      this.selectedDomain = this.currentDomain
      return
    }
    this.selectedDomain = this.domains[0]?.domain === 'all domains' ? '' : this.domains[0]?.domain || ''
  }

  private domainExists(domain: string): boolean {
    if (!domain) return false
    return this.skills.some((skill) => skill.domain === domain)
  }

  private applyCaptureOptions(options: CaptureOptions): void {
    this.recordActions = options.recordActions
    this.recordNetwork = options.recordNetwork
  }

  private resetRecordingForCaptureStart(startedAt: number): void {
    if (this.captureRecordSyncTimer) clearTimeout(this.captureRecordSyncTimer)
    this.captureRecordSyncTimer = null
    this.captureRecordsEdited = false
    this.rows = []
    this.selectedNetworkRequestId = ''
    this.workflowDesc = ''
    this.recordSearch = ''
    this.activeFilters = []
    this.previewVisible = false
    this.ingesting = false
    this.recordingStartedAt = startedAt
    this.capturing = true
    this.setPane('recording')
    void coach.clearCaptureRecordEdits().catch(() => undefined)
  }

  private async syncCaptureState(): Promise<void> {
    try {
      const state = await coach.getCaptureState()
      this.capturing = state.capturing
      this.recordingStartedAt = state.startedAt || 0
    } catch {
      /* main window not ready yet */
    }
  }

  private async loadPersistedCaptureRecords(): Promise<void> {
    if (this.capturing || this.rows.length) return
    const snapshot = await coach.getCaptureRecords().catch(() => null)
    if (!snapshot?.ok || snapshot.source !== 'edited') return
    this.rows = mergeRecordsIntoRows(snapshot.records)
    this.workflowDesc = snapshot.workflow || ''
    this.recordingStartedAt = snapshot.startedAt || this.recordingStartFromRows()
    this.captureRecordsEdited = true
  }

  private rowCategory(row: Row): string {
    if (row.kind === 'action') return 'action'
    if (row.kind === 'snapshot') return 'snapshot'
    if (row.kind.startsWith('net.')) return 'network'
    return 'other'
  }

  private sortDisplayRows(rows: Row[]): Row[] {
    return [...rows].sort((a, b) => {
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1
      return 0
    })
  }

  selectRecord(row: Row): void {
    const requestId = requestIdOf(row)
    this.selectedNetworkRequestId = requestId
  }

  clearNetworkSelection(): void {
    this.selectedNetworkRequestId = ''
  }

  private rowMatchesSearch(row: Row, terms: string[]): boolean {
    const haystack = [
      row.kind,
      row.text,
      row.title,
      row.method,
      row.status,
      row.url,
      fmtHeaders(row.headers),
      row.yaml,
      row.body,
      row.event.kind === 'net.response' ? row.event.bodyOmittedReason : '',
      row.response ? fmtHeaders(row.response.headers) : '',
      row.response?.bodyPreview,
      row.response?.bodyOmittedReason,
      row.spec
    ]
      .filter((item) => item !== undefined && item !== null)
      .join('\n')
      .toLowerCase()
    return terms.every((term) => haystack.includes(term))
  }

  private rowTokens(row: Row): number {
    let n = rowTokenCache.get(row)
    if (n === undefined) {
      const text = [
        row.text,
        fmtHeaders(row.headers),
        row.yaml,
        row.body,
        row.response ? fmtHeaders(row.response.headers) : '',
        row.response?.bodyPreview
      ]
        .filter(Boolean)
        .join('\n')
      n = text ? encode(text).length : 0
      rowTokenCache.set(row, n)
    }
    return n
  }

  private syncCaptureRecordsSoon(): void {
    if (this.captureRecordSyncTimer) clearTimeout(this.captureRecordSyncTimer)
    this.captureRecordSyncTimer = setTimeout(() => {
      this.captureRecordSyncTimer = null
      void this.syncCaptureRecordsNow()
    }, 250)
  }

  private rowsForRecordPayload(): Row[] {
    return this.visibleRows.slice().sort((a, b) => a.ts - b.ts)
  }

  private async syncCaptureRecordsNow(): Promise<void> {
    if (!this.captureRecordsEdited) return
    await coach
      .syncCaptureRecords({
        startedAt: this.recordingStartedAt || this.recordingStartFromRows(),
        workflow: this.workflowDesc.trim() || undefined,
        records: this.buildIngestRecords()
      })
      .catch(() => undefined)
  }

  // Expand a display row back into the flat request/response record stream the main-side
  // exporter / skill generator / integration service pair by requestId. A merged network
  // row yields its request AND response records; the exchange's spec/flag ride on both.
  private rowToRecords(row: Row): IngestRecord[] {
    const strip = (event: TraceEvent): TraceEvent =>
      (event.kind === 'action' || event.kind === 'snapshot') && event.shot ? { ...event, shot: undefined } : event
    const spec = row.spec.trim() || undefined
    const flagged = row.flagged || undefined
    const records: IngestRecord[] = [{ event: strip(row.event), spec, flagged }]
    if (row.response) records.push({ event: row.response, spec, flagged })
    return records
  }

  private buildIngestRecords(): IngestRecord[] {
    const records = this.rowsForRecordPayload()
      .filter((row) => row.kind !== 'error')
      .flatMap((row) => this.rowToRecords(row))
      .sort((a, b) => a.event.ts - b.event.ts)
    return JSON.parse(JSON.stringify(records)) as IngestRecord[]
  }

  private buildExportRecords(): IngestRecord[] {
    const records = this.rowsForRecordPayload()
      .flatMap((row) => this.rowToRecords(row))
      .sort((a, b) => a.event.ts - b.event.ts)
    return JSON.parse(JSON.stringify(records)) as IngestRecord[]
  }

  private recordingStartFromRows(): number {
    return this.visibleRows.reduce((min, row) => (row.ts && row.ts < min ? row.ts : min), Date.now())
  }
}

export const workbenchStore = reactive<WorkbenchStoreState>(new WorkbenchStoreState())
