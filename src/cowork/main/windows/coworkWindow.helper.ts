import { BrowserWindow, Menu, WebContentsView, app, clipboard, dialog, shell } from 'electron'
import type { ContextMenuParams, MenuItemConstructorOptions, MessageBoxOptions, OpenDialogOptions, WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { createHash, randomUUID } from 'crypto'
import { homedir } from 'os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import { fetch } from 'undici'
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
  type Dirent,
  type WriteStream
} from 'fs'
// Async fs for read/list/search tools — they must NOT block the main event loop (a
// synchronous scan freezes the whole app: no thinking/tooling updates reach the UI).
import { readdir, readFile as readFileAsync, stat as statAsync } from 'fs/promises'
import { inject, injectable } from 'inversify'
import { WindowHelper } from './window.helper'
import { DebuggerCapture } from '@cowork-main/capture/debuggerCapture'
import { buildPersistedRawCaptureRecords } from '@cowork-main/capture/captureRecordPersistence'
import { chromeIdentity } from '@cowork-main/capture/chromeIdentity'
import {
  interceptionRuleSummary,
  normalizeNetworkInterceptionRule,
  publicInterceptionRule,
  type NetworkInterceptionRule
} from '@cowork-main/capture/networkInterception'
import { authBridge } from '@cowork-main/auth/authBridge'
import { BaseAgent, type PiToolSpec } from '@cowork-main/agent/BaseAgent'
import { CoworkAgent } from '@cowork-main/agent/CoworkAgent'
import { CoachAgent } from '@cowork-main/agent/CoachAgent'
import { DelegateAgent } from '@cowork-main/agent/DelegateAgent'
import { readHostToolCatalog } from '@cowork-main/agent/hostToolCatalog'
import { HostApprovalHistory } from '@cowork-main/agent/runtime/hostApprovalHistory'
import { HostToolRegistry, type HostToolConfirmRequest } from '@cowork-main/agent/runtime/hostToolRegistry'
import type { AgentRuntimeImage, AgentRuntimeMediaRef } from '@cowork-main/agent/runtime/agentRuntime.types'
import { mediaTransportForProvider, resolveRuntimeMediaRefs } from '@cowork-main/agent/runtime/mediaRefResolver'
import { sanitizeRuntimeError } from '@cowork-main/agent/runtime/errorSanitizer'
import { extractVariablesFromMessage } from '@cowork-main/agent/naturalLanguageVariables'
import { BookingDemoService } from '@cowork-main/demo/bookingDemo.service'
import {
  ReplayEngine,
  collectApiReads,
  collectApiWrites,
  type AgentUiAction,
  type ApiCallResult,
  type AuthHint,
  type BrowserCommand,
  type CommandResult
} from '@cowork-main/drive/replayEngine'
import { classifySkillApiCall, isMutatingHttpMethod, normalizeHttpMethod, type SkillApiSafetyDecision } from '@cowork-main/drive/apiSafety'
import { runSkillScript, validateSkillVars } from '@cowork-main/drive/skillScript'
import { readApiProfile } from '@cowork-main/skills/apiProfile.service'
import { getLogPaths } from '@cowork-main/logging/log.setup'
import { CoachSettingsService, normalizeUrl } from '@cowork-main/settings/coachSettings.service'
import { SkillGeneratorService } from '@cowork-main/skills/skillGenerator.service'
import { SkillRegistryService } from '@cowork-main/skills/skillRegistry.service'
import { readFileForAgent, FileReadError } from '@cowork-main/files/fileReader.service'
import { writeArtifactFromJson } from '@cowork-main/files/artifactWriter.service'
import { cleanupTempFile } from '@cowork-main/files/tempCleanup.service'
import { CoworkLlmService, type CoworkLlmServiceState } from '@cowork-main/llm/coworkLlm.service'
import { integrationTargetStore } from '@cowork-main/integration/integrationTarget.service'
import { integrationScheduler, type IntegrationSchedulerEvent } from '@cowork-main/integration/integrationScheduler.service'
import { integrationMappingStore } from '@cowork-main/integration/integrationMapping.service'
import { runMicromeetCli } from '@cowork-main/integration/integrationRunner.service'
import { coworkAuthPath, coworkModelsPath } from '@cowork-main/llm/llmPaths'
import { uploadFileThroughAiCrmsCore } from '@cowork-main/networking/api/aiCrmsCoreFileUpload.api'
import { uploadMediaRefsForProvider } from '@cowork-main/networking/api/mediaUpload.api'
import { resolveAiCrmsRelayEndpoint } from '@cowork-main/networking/clients/relay.client'
import { iocHelper } from '@cowork-shared/iocHelper/ioc.helper'
import { providerLabel, type LlmStoredTarget } from '@cowork-main/llm/llmModels'
import type { AuthSession, SessionApi } from '@cowork-shared/session.api'
import { DEFAULT_COACH_START_URL } from '@cowork-shared/coach.api'
import type {
  AgentConversationContext,
  AgentActivityStep,
  AgentCompactReply,
  AgentCompactRequest,
  AgentFileArtifact,
  AgentThinkingState,
  AgentReply,
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
  CodexDebugEvent,
  DeleteSkillResult,
  ExportRecordingResult,
  FileStatusResult,
  HostApprovalEvent,
  HostApprovalExportResult,
  HostApprovalHistoryResult,
  IntegrationEndpointContract,
  IntegrationEntity,
  IntegrationMappingEntry,
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
  IntegrationRunOutput,
  IntegrationRunSummary,
  IntegrationTarget,
  IntegrationTargetCreateResult,
  IntegrationTargetDeleteResult,
  IntegrationTargetRunResult,
  IntegrationTargetScheduleRequest,
  IntegrationTargetScheduleResult,
  IntegrationTargetSummary,
  HostToolCatalogResult,
  HostToolPolicyMap,
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
  TabKind,
  TabInfo,
  ViewRect,
  WorkspaceRef,
  WorkspaceRefResult
} from '@cowork-shared/coach.api'
import { HOST_APPROVAL_HISTORY_KEY, HOST_TOOL_CONFIG_DOMAIN, HOST_TOOL_POLICY_KEY, WORKSPACE_CONFIG_DOMAIN, WORKSPACE_DEFAULT_KEY, type ConfigApi } from '@cowork-shared/config.api'
import type { InjectBtnApi, InjectBtnEntry, InjectBtnInput } from '@cowork-shared/injectBtn.api'
import type { SavedTab } from '@cowork-shared/tabs.api'
import type { CaptureRule } from '@cowork-shared/captureFilter.api'
import type { CaptureMode, HeaderMap, NetworkTiming, TraceEvent } from '@cowork-shared/trace.types'
import type { SkillRecipe } from '@cowork-main/skills/skillRecipe.types'
import { COWORK_PARTITION, coworkDataRoot } from '@cowork-main/data/coworkDataRoot'

// Initial geometry used for the very first frame, before the home renderer reports
// the real placeholder rects (see setViewBounds). Header height matches Layout.vue's
// h-12 (48px); the renderer's measured bounds are authoritative thereafter.
const TOOLBAR_H = 96
const SIDEBAR_W = 480
const MAX_MEMORY_EVENTS = 1200
const TOOL_RESULT_LIMIT = 8_000
const REPLAY_RESPONSE_PREVIEW_LIMIT = 2_000
const MAX_AGENT_SKILL_BRIEFS = 40
const MAX_AGENT_SKILL_INPUTS = 32
const MAX_AGENT_SKILL_TRIGGERS = 16
const MAX_AGENT_SKILL_DESCRIPTION_CHARS = 420
const MAX_AGENT_SKILL_INLINE_CHARS = 600
const CAPTURE_RECORD_CONFIG_DOMAIN = 'capture-records'
const CAPTURE_RECORD_CONFIG_KEY = 'latest'
const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')
const aiCrmsSession = createXpcMainEmitter<SessionApi>('CoworkSessionDao')
const injectBtnStore = createXpcMainEmitter<InjectBtnApi>('InjectBtnDao')

// The page snapshot is the agent's eyes for driving the UI — it must stay complete,
// so it gets a far larger bound than generic tool results. The meaningful-node filter
// keeps real pages well under this; it's a safety ceiling against a runaway DOM, not
// a content limit.
const SNAPSHOT_RESULT_LIMIT = 200_000

// One operation-view tab: its own WebContentsView + capture + replay engine. The
// helper's operationView/capture/replayEngine fields point at the ACTIVE tab's
// objects, re-pointed on switch.
// The pinned AI-CRMS home tab: always leftmost, non-closable, fixed title + favicon.
const AI_CRMS_URL = 'http://crms.micromeet.ai/'
const AI_CRMS_LOGIN_URL = 'http://crms.micromeet.ai/?mrgn=ID#/login'
const AI_CRMS_TITLE = 'AI-CRMS'
const AI_CRMS_HOST = new URL(AI_CRMS_URL).hostname.toLowerCase()
// Favicon is bundled locally in the renderer (src/renderer/common/assets/icons/crms-favicon.png,
// downloaded from https://mcu.micromeet.ai/favicon.ico); the MenuBar renders that asset for
// pinned tabs, so main sends no remote URL — the icon shows offline with no network fetch.
const AI_CRMS_FAVICON = ''
const isWorkbenchInternalUrl = (url: string): boolean => /^micromeet:\/\/workbench(?:[/?#].*)?$/i.test(url.trim())
const isAiCrmsUrl = (url: string): boolean => {
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.toLowerCase() === AI_CRMS_HOST
  } catch {
    return false
  }
}
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

type CapturedRequest = Extract<TraceEvent, { kind: 'net.request' }>
type CapturedResponse = Extract<TraceEvent, { kind: 'net.response' }>

interface NetworkExchange {
  requestId: string
  request?: CapturedRequest
  response?: CapturedResponse
  flagged?: boolean
}

interface CaptureRecordSource {
  source: 'edited' | 'raw'
  records: IngestRecord[]
  workflow?: string
  updatedAt?: number
}

interface PersistedCaptureRecordOptions {
  startedAt?: number
  workflow?: string
  updatedAt?: number
  records?: IngestRecord[]
}

const headerEntries = (headers?: HeaderMap): { name: string; value: string }[] => {
  const out: { name: string; value: string }[] = []
  for (const [name, value] of Object.entries(headers || {})) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) out.push({ name, value: String(item) })
  }
  return out
}

const headerValue = (headers: HeaderMap | undefined, name: string): string => {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() !== target) continue
    return Array.isArray(value) ? String(value[0] || '') : String(value || '')
  }
  return ''
}

const queryEntries = (url: string): { name: string; value: string }[] => {
  try {
    const parsed = new URL(url)
    return Array.from(parsed.searchParams.entries()).map(([name, value]) => ({ name, value }))
  } catch {
    return []
  }
}

const byteLength = (text?: string | null): number => (text ? Buffer.byteLength(text, 'utf8') : 0)

const timingDuration = (timing: NetworkTiming | undefined, start: keyof NetworkTiming, end: keyof NetworkTiming): number | undefined => {
  const a = timing?.[start]
  const b = timing?.[end]
  if (typeof a !== 'number' || typeof b !== 'number' || a < 0 || b < 0 || b < a) return undefined
  return b - a
}

const harTimings = (timing: NetworkTiming | undefined, totalTime: number, requestBodySize: number): Record<string, number> => {
  const receive =
    typeof timing?.receiveHeadersEnd === 'number' && timing.receiveHeadersEnd >= 0 && totalTime >= timing.receiveHeadersEnd
      ? totalTime - timing.receiveHeadersEnd
      : 0
  return {
    blocked: timingDuration(timing, 'proxyStart', 'proxyEnd') ?? -1,
    dns: timingDuration(timing, 'dnsStart', 'dnsEnd') ?? -1,
    connect: timingDuration(timing, 'connectStart', 'connectEnd') ?? -1,
    send: timingDuration(timing, 'sendStart', 'sendEnd') ?? (requestBodySize ? 1 : 0),
    wait: timingDuration(timing, 'sendEnd', 'receiveHeadersEnd') ?? totalTime,
    receive,
    ssl: timingDuration(timing, 'sslStart', 'sslEnd') ?? -1
  }
}

const buildNetworkExchanges = (records: IngestRecord[]): NetworkExchange[] => {
  const byId = new Map<string, NetworkExchange>()
  for (const record of records) {
    const event = record.event
    if (event.kind !== 'net.request' && event.kind !== 'net.response') continue
    const existing = byId.get(event.requestId) || { requestId: event.requestId }
    if (event.kind === 'net.request') existing.request = event
    else existing.response = event
    existing.flagged = existing.flagged || Boolean(record.flagged)
    byId.set(event.requestId, existing)
  }
  return Array.from(byId.values()).sort((a, b) => {
    const aTs = a.request?.ts || a.response?.ts || 0
    const bTs = b.request?.ts || b.response?.ts || 0
    return aTs - bTs
  })
}

const buildHarPostData = (request: CapturedRequest): Record<string, unknown> | undefined => {
  if (!request.postData) return undefined
  return {
    mimeType: headerValue(request.headers, 'content-type') || 'text/plain',
    text: request.postData,
    _coachTruncated: Boolean(request.postDataTruncated)
  }
}

const buildHar = (params: { startedAt: number; records: IngestRecord[] }): Record<string, unknown> => {
  const entries = buildNetworkExchanges(params.records).map((exchange) => {
    const request = exchange.request
    const response = exchange.response
    const url = request?.url || response?.url || ''
    const startedAt = request?.ts || response?.ts || params.startedAt || Date.now()
    const totalTime = request && response ? Math.max(0, response.ts - request.ts) : 0
    const requestBodySize = byteLength(request?.postData)
    const responseContentSize = response?.bodyByteLength ?? byteLength(response?.bodyPreview)
    const responseBodySize = response?.encodedDataLength ?? responseContentSize
    const content: Record<string, unknown> = {
      size: responseContentSize,
      mimeType: response?.mime || headerValue(response?.headers, 'content-type') || ''
    }
    if (response?.bodyPreview) content.text = response.bodyPreview
    if (response?.bodyTruncated) content._coachTruncated = true
    if (response?.bodyOmittedReason) content._coachOmittedReason = response.bodyOmittedReason
    if (typeof response?.bodyByteLength === 'number') content._coachBodyByteLength = response.bodyByteLength
    if (response?.bodyBase64Encoded) content._coachBase64Encoded = true
    if (response?.bodyStreamed) content._coachStreamed = true
    if (typeof response?.bodyChunkCount === 'number') content._coachChunkCount = response.bodyChunkCount
    if (typeof response?.decodedDataLength === 'number') content._coachDecodedDataLength = response.decodedDataLength

    const harRequest: Record<string, unknown> = {
      method: request?.method || 'GET',
      url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: headerEntries(request?.headers),
      queryString: queryEntries(url),
      headersSize: -1,
      bodySize: requestBodySize
    }
    const postData = request ? buildHarPostData(request) : undefined
    if (postData) harRequest.postData = postData

    return {
      startedDateTime: new Date(startedAt).toISOString(),
      time: totalTime,
      request: harRequest,
      response: {
        status: response?.status || 0,
        statusText: '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: headerEntries(response?.headers),
        content,
        redirectURL: headerValue(response?.headers, 'location'),
        headersSize: -1,
        bodySize: responseBodySize
      },
      cache: {},
      timings: harTimings(response?.timing, totalTime, requestBodySize),
      _coach: {
        requestId: exchange.requestId,
        flagged: Boolean(exchange.flagged),
        resourceType: request?.resourceType || '',
        requestBodyTruncated: Boolean(request?.postDataTruncated),
        responseBodyTruncated: Boolean(response?.bodyTruncated),
        responseBodyOmittedReason: response?.bodyOmittedReason,
        responseBodyByteLength: response?.bodyByteLength,
        responseBodyBase64Encoded: Boolean(response?.bodyBase64Encoded),
        responseBodyStreamed: Boolean(response?.bodyStreamed),
        responseBodyChunkCount: response?.bodyChunkCount,
        decodedDataLength: response?.decodedDataLength,
        timing: response?.timing,
        incomplete: !request || !response
      }
    }
  })
  return {
    log: {
      version: '1.2',
      creator: { name: 'MeetAgent Coach', version: '1' },
      pages: [
        {
          startedDateTime: new Date(params.startedAt || Date.now()).toISOString(),
          id: 'coach-capture',
          title: 'Coach Capture',
          pageTimings: {}
        }
      ],
      entries
    }
  }
}

// Attached-file size cap: matches the read-side limit in fileReader.service.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const AI_CRMS_ASR_MODEL = 'fun-asr-flash-2026-06-15'
// Keep composer voice clips bounded before handing them to the remote media upload node.
const MAX_ASR_AUDIO_BYTES = 16 * 1024 * 1024
const MAX_AGENT_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_AGENT_IMAGES = 8
const MAX_AGENT_MEDIA_REFS = 16
const WORKSPACE_TEXT_SCAN_BYTES = 256 * 1024
const WORKSPACE_SEARCH_MAX_RESULTS = 60
const WORKSPACE_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.turbo',
  '.cache'
])

const safeUrlForDebug = (value: string): string => {
  try {
    const url = new URL(value)
    const hadSearch = Boolean(url.search)
    const hadHash = Boolean(url.hash)
    url.search = ''
    url.hash = ''
    return `${url.toString()}${hadSearch ? '?...' : ''}${hadHash ? '#...' : ''}`
  } catch {
    return value ? '[invalid-url]' : ''
  }
}

const bailianMultimodalGenerationUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/multimodal-generation\/generation$/i.test(trimmed)) return trimmed
  return `${trimmed}/multimodal-generation/generation`
}

const normalizeAsrFormat = (format?: string, mime?: string): string => {
  const raw = String(format || '').trim().toLowerCase()
  if (raw === 'wav' || raw === 'mp3' || raw === 'mpeg' || raw === 'opus') return raw === 'mpeg' ? 'mp3' : raw
  const normalizedMime = String(mime || '').trim().toLowerCase()
  if (normalizedMime.includes('mpeg') || normalizedMime.includes('mp3')) return 'mp3'
  if (normalizedMime.includes('opus')) return 'opus'
  return 'wav'
}

const readAssistantContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      return typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('')
}

const readScribeText = (body: unknown): string => {
  if (!body || typeof body !== 'object') return ''
  const record = body as Record<string, any>
  const nativeText = record.output?.text || record.output?.sentence?.text || record.text || record.sentence?.text
  if (typeof nativeText === 'string') return nativeText.trim()
  const dashscopeText = readAssistantContent(record.output?.choices?.[0]?.message?.content)
  if (dashscopeText) return dashscopeText.trim()
  const choiceText = readAssistantContent(record.choices?.[0]?.message?.content)
  return choiceText.trim()
}
const WORKSPACE_TEXT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.svelte',
  '.css',
  '.less',
  '.scss',
  '.html',
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.xml',
  '.csv',
  '.tsv',
  '.sql',
  '.sh',
  '.zsh',
  '.env',
  '.gitignore'
])
const AGENT_IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}
const AGENT_FILE_MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.log': 'text/plain'
}

interface WorkspacePathResolution {
  ok: boolean
  root: string
  realRoot?: string
  path?: string
  rel?: string
  error?: string
}

interface WorkspaceSearchHit {
  path: string
  name: string
  kind: 'name' | 'content'
  line?: number
  preview?: string
  matches?: string[]
}

const isInsideRoot = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

const nearestExistingAncestor = (path: string): string => {
  let current = path
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
  return current
}

// A read/list/search hit an OS permission gate (macOS TCC folder access, or plain EACCES).
const isPermissionError = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EACCES'
}

// Shown when a read is blocked by macOS folder protection: the user just needs to approve
// the OS prompt (or grant Full Disk Access), then retry. Empty off macOS.
const FOLDER_AUTH_HINT =
  process.platform === 'darwin'
    ? ' macOS is protecting this folder — approve the permission prompt if it appears, or grant access under System Settings › Privacy & Security › Files and Folders (or Full Disk Access), then ask me to try again.'
    : ''

// Depth/visit caps so searching a large tree (e.g. a whole Documents folder) stays bounded.
const READ_SEARCH_MAX_DEPTH = 8
const READ_SEARCH_MAX_DIRS = 4000
// Wall-clock budget for a single search so a huge tree returns partial results with a
// note instead of running (and appearing to hang) indefinitely.
const READ_SEARCH_BUDGET_MS = 20_000

const workspaceNameForPath = (path: string): string => basename(path) || path

const fileExtension = (path: string): string => {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : name.toLowerCase()
}

const workspaceSearchTerms = (query: string): string[] =>
  Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[\s/\\:.#"'`()[\]{}<>|,;=+*&!?]+/)
        .map((term) => term.trim())
        .filter(Boolean)
    )
  ).slice(0, 12)

const workspaceTextMatches = (text: string, terms: string[]): boolean => {
  const haystack = text.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

const shouldOpenWorkbenchDevTools = (): boolean => {
  if (process.env.COACH_DEMO_SMOKE_OUT) return false
  if (process.env.COACH_WORKBENCH_DEVTOOLS === '0') return false
  return is.dev || process.env.COACH_WORKBENCH_DEVTOOLS === '1' || process.env.COACH_DEVTOOLS === '1' || process.env.COACH_OPEN_DEVTOOLS === '1'
}

// A pre-warmed live view + its capture/replay, not yet bound to a tab. Reused to make a cold tab
// warm instantly (see ensureWarm) — the heavy WebContentsView + CDP attach is paid ahead of time.
interface ViewSlot {
  view: WebContentsView
  capture: DebuggerCapture
  replay: ReplayEngine
}

interface OperationTab {
  id: string
  kind: TabKind
  // The live view slot — NULL when the tab is "cold" (metadata only, no WebContentsView). Only up
  // to MAX_WARM tabs stay warm at once; the rest are cold and re-materialize (reload their URL into
  // a spare view) when activated. The ACTIVE tab and the pinned tab are always warm.
  view: WebContentsView | null
  capture: DebuggerCapture | null
  replay: ReplayEngine | null
  url: string
  title: string
  favicon: string
  // Desired CDP attachment state. Defaults on; the operator can turn it off per tab before
  // sensitive external logins, then turn it back on after login to restore automation.
  debuggerEnabled: boolean
  // Pinned tabs can't be closed and keep their fixed title/favicon regardless of the page.
  pinned: boolean
  // Last time this tab was the active tab (ms) — drives LRU eviction. 0 = never activated.
  lastActive: number
}

@injectable()
class CoworkWindowHelper extends WindowHelper implements CoworkLlmServiceState {
  protected preloadFile = 'coworkCoach.js'
  protected rendererPath = 'coworkHome/index.html'
  protected windowOptions = { title: 'Micromeet Cowork', width: 1360, height: 900 }
  protected showOnReady = false
  // The main app window — base WindowHelper remembers its size/position/display.
  protected windowStateKey = 'cowork-main'

  constructor(
    @inject(Symbol.for(CoworkLlmService.name))
    public readonly llmService: CoworkLlmService
  ) {
    super()
    this.llmService.setState(this)
  }

  private operationView: WebContentsView | null = null
  private controlView: WebContentsView | null = null
  private workbenchView: WebContentsView | null = null
  private workbenchVisible = false
  private capture: DebuggerCapture | null = null
  private replayEngine: ReplayEngine | null = null
  // operationView/capture/replayEngine above always point at the ACTIVE tab.
  private tabs: OperationTab[] = []
  private activeTabId: string | null = null
  // Cap on simultaneously-live operation views (incl. pinned crms + the active tab). Over this,
  // the least-recently-active non-pinned, non-active tab is "cooled" (its view destroyed, metadata
  // kept) — see enforceWarmCap. Switching back re-loads its URL into a spare view.
  private readonly MAX_WARM = 4
  private opBounds: ViewRect | null = null
  private tabSeq = 0
  private startupTabOpened = false
  private capturing = false
  private captureMode: CaptureMode = 'ui'
  private captureOptions: CaptureOptions = defaultCaptureOptions()
  private traceStream: WriteStream | null = null
  private traceFile: string | null = null
  private captureStartedAt = 0
  private traceEvents: TraceEvent[] = []
  private editedCaptureRecords: { records: IngestRecord[]; workflow?: string; startedAt?: number; updatedAt: number } | null = null
  private captureRecordLoadPromise: Promise<void> | null = null
  private captureTargetTabId: string | null = null
  private currentUrl = DEFAULT_COACH_START_URL
  private initialReady: Promise<void> = Promise.resolve()
  private skillRegistry: SkillRegistryService | null = null
  private skillGenerator: SkillGeneratorService | null = null
  // Three pi instances, one per concern: invocation chat, trainer chat (separate
  // conversations), and one-shot skill generation (fresh session per call).
  private pi: CoworkAgent | null = null
  private piTrainer: CoachAgent | null = null
  private piDelegate: DelegateAgent | null = null
  private piGen: BaseAgent | null = null
  private coworkAgents = new Map<string, CoworkAgent>()
  private trainerAgents = new Map<string, CoachAgent>()
  private delegateAgents = new Map<string, DelegateAgent>()
  // Tracks Cowork pi sessions that have already been hydrated with persisted chat memory.
  // Running sessions keep their own native model history; only a newly created/restored agent
  // needs compactSummary + recentMessages injected once.
  private hydratedCoworkAgentSessions = new Set<string>()
  // Per-session read_file allowlist: absolute paths the user attached (no bytes copied).
  private attachedPaths = new Map<string, Set<string>>()
  // Per-session project workspace root. Persisted by the renderer in SQLite detail_json;
  // main keeps the live copy for filesystem tool execution.
  private workspaceRefs = new Map<string, WorkspaceRef>()
  // What the pi agents' tools executed during the CURRENT turn (cleared per turn),
  // so the AgentReply can carry the skill + replay payload to the renderer.
  private lastAgentRun: { skill?: SkillSummary; skills?: SkillSummary[]; replay?: ReplayResult } = {}
  private lastAgentArtifacts: AgentFileArtifact[] = []
  // Tabs opened during the CURRENT agent turn (reset each turn).
  private tabsOpenedThisTurn: TabInfo[] = []
  private lastTrainerRun: { skill?: SkillSummary } = {}
  // Active LLM backend (applied to all pi instances; persisted in settings).
  private activeLlmProvider = 'openai-codex'
  private activeLlmModel = 'gpt-5.5'
  private activeLlmEffort: LlmEffort = 'low'
  private llmApplied = false
  private settings: CoachSettingsService | null = null
  private demo: BookingDemoService | null = null
  private hostToolPolicies: HostToolPolicyMap = {}
  private hostToolPolicyLoadPromise: Promise<void> | null = null
  private hostApprovalHistory = new HostApprovalHistory()
  private hostApprovalHistoryLoadPromise: Promise<void> | null = null
  private browserInterceptionRules: NetworkInterceptionRule[] = []
  private browserInterceptionSeq = 0
  private injectedButtonNonces = new Map<string, string>()
  private shuttingDown = false

  create(): BrowserWindow {
    this.shuttingDown = false
    this.ensureServices()
    void this.loadHostToolPolicies()
    void this.loadHostApprovalHistory()
    integrationScheduler.start({
      emit: (event) => this.handleIntegrationSchedulerEvent(event),
      runRecordedSiteDryRun: (target) => this.runIntegrationRecordedSiteDryRun({ targetId: target.id })
    })
    this.currentUrl = AI_CRMS_URL

    const win = super.create()

    // First tab = the pinned AI-CRMS home (leftmost, non-closable, fixed title/favicon). It is
    // ALWAYS warm: build a view slot + assemble the tab directly (CDP attaches via the
    // initialReady chain below). operationView/capture/replayEngine always track the active tab.
    const slot = this.buildViewSlot()
    const first: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'ai-crms',
      view: slot.view,
      capture: slot.capture,
      replay: slot.replay,
      url: AI_CRMS_URL,
      title: AI_CRMS_TITLE,
      favicon: AI_CRMS_FAVICON,
      debuggerEnabled: true,
      pinned: true,
      lastActive: Date.now()
    }
    this.tabs.push(first)
    this.activeTabId = first.id
    this.operationView = slot.view
    this.capture = slot.capture
    this.replayEngine = slot.replay
    const homeReady = this.rendererReady.catch((err) => {
      this.emit({ kind: 'error', msg: 'home load: ' + (err as Error).message, ts: Date.now() })
      throw err
    })
    const workbenchReady = this.createWorkbenchView()
    // Stay HIDDEN until AI-CRMS has loaded (revealed in the initialReady chain below). Until then
    // the white Layout placeholder shows in the operation area, so the boot never flashes the
    // view's black pre-paint surface.

    // The control panel (Coach/Agent UI) lives in its own WebContentsView so the
    // main window = thin address bar + webpage view + control view. It needs the
    // coach preload so its XPC bridge (invoke + subscribe) works like the main window.
    const controlView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/coworkCoach.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: COWORK_PARTITION
      }
    })
    this.controlView = controlView
    win.contentView.addChildView(controlView)
    const controlLoad = is.dev && process.env['ELECTRON_RENDERER_URL']
      ? controlView.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/coworkControl/index.html`)
      : controlView.webContents.loadFile(join(__dirname, '../renderer/coworkControl/index.html'))
    const controlReady = controlLoad.catch((err) => {
      this.emit({ kind: 'error', msg: 'control load: ' + (err as Error).message, ts: Date.now() })
      throw err
    })
    // Control-panel DevTools: auto-open in dev (or COACH_DEVTOOLS=1). The repaint-flash caveat in
    // the operation-view note below is about the CAPTURED page (ai-crms's SPA re-renders), not this
    // static panel, so opening here is safe. Detached + not activated so it never steals focus.
    if (process.env.BITTERLESS_E2E !== '1' && (is.dev || process.env.COACH_DEVTOOLS === '1')) {
      controlView.webContents.once('did-finish-load', () => {
        if (!controlView.webContents.isDevToolsOpened()) {
          controlView.webContents.openDevTools({ mode: 'detach', activate: false })
        }
      })
    }

    this.layout()
    win.on('resize', () => this.layout())

    // about:blank bootstrap — INTERNAL, never seen by the user: the operation view stays HIDDEN
    // behind the home loading splash until AI-CRMS paints (the .finally below), and about:blank is
    // ignored in did-navigate so it never reaches the address bar. It's required because a fresh,
    // never-navigated webContents has no render process — capture.attach()'s CDP commands would
    // HANG on it (which blanked the view + froze navigate). Loading about:blank gives it a render
    // process for attach + a live document for the auth bridge to register its document-start
    // session injection on, BEFORE AI-CRMS loads.
    this.initialReady = slot.view.webContents
      .loadURL('about:blank')
      .catch((err) => this.emit({ kind: 'error', msg: 'bootstrap blank: ' + err.message, ts: Date.now() }))
      .then(() => this.capture?.attach())
      .catch((err) => {
        this.emit({ kind: 'error', msg: 'attach: ' + err.message, ts: Date.now() })
      })
      .then(async () => {
        // Auth bridge: on the pinned ai-crms tab, piggyback the (capture-attached) debugger
        // to inject `isMicromeetAgentBrowser` + the shared session and register the
        // `__micromeetAuth` page→main token bridge. Runs before AI_CRMS_URL loads so the
        // restore value is present at document-start. Scoped to the pinned ai-crms tab.
        const authWc = this.operationView?.webContents
        if (authWc && !authWc.isDestroyed()) {
          await authBridge
            .attach(authWc)
            .catch((err) => this.emit({ kind: 'error', msg: 'auth bridge: ' + (err as Error).message, ts: Date.now() }))
        }
      })
      .then(() => {
        // DevTools auto-open is OPT-IN (COACH_DEVTOOLS=1), OFF by default. With DevTools attached
        // to a page, Chromium disables its compositing fast-path and full-repaints on same-document
        // re-renders (ai-crms's region `replaceState`, the password/code login toggle) → a white
        // "flash" the packaged build and Chrome (no DevTools) never show. Must run AFTER
        // capture.attach() — debugger.attach() throws if DevTools is already attached.
        if (process.env.COACH_DEVTOOLS !== '1') return
        const wc = this.operationView?.webContents
        if (wc && !wc.isDestroyed() && !wc.isDevToolsOpened()) {
          try {
            wc.openDevTools({ mode: 'detach', activate: false })
          } catch (err) {
            this.emit({ kind: 'error', msg: 'operation devtools: ' + (err as Error).message, ts: Date.now() })
          }
        }
      })
      .then(() => undefined)
    this.initialReady = this.initialReady.then(async () => {
      const view = this.operationView
      if (!view || view.webContents.isDestroyed()) return
      await view.webContents
        .loadURL(AI_CRMS_URL)
        .catch((err) => this.emit({ kind: 'error', msg: 'initial load: ' + err.message, ts: Date.now() }))
        .finally(() => {
          // Reveal the operation view now that AI-CRMS has loaded — the white placeholder covered
          // the boot, so this is a clean white→page reveal with no black pre-paint flash. Guard on
          // it still being the active view (the user may have switched tabs mid-load; activateTab
          // owns visibility then).
          if (this.operationView === view && !view.webContents.isDestroyed()) view.setVisible(true)
        })
      await this.openStartupTabIfNeeded()
    })
    const operationReady = this.initialReady
    this.initialReady = Promise.all([homeReady, controlReady, workbenchReady, operationReady]).then(() => undefined)
    // Pre-warm one spare view so warming a tab (new open / switching to a cold tab) is instant.
    void this.prewarmSpare()
    return win
  }

  async whenReady(): Promise<void> {
    await this.initialReady
  }

  private async openStartupTabIfNeeded(): Promise<void> {
    if (this.startupTabOpened) return
    this.startupTabOpened = true
    const services = this.ensureServices()
    const settings = services.settings.read()
    if (!services.settings.hasCustomStartUrl()) return
    const url = settings.startUrl
    if (!url) return
    await this.openTab({ url }).catch((err) => {
      this.emit({ kind: 'error', msg: 'startup tab: ' + (err as Error).message, ts: Date.now() })
    })
  }

  private createWorkbenchView(): Promise<void> {
    if (!this.browserWindow) return Promise.reject(new Error('Cowork window is not available.'))
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/coworkCoach.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: COWORK_PARTITION
      }
    })
    view.setBackgroundColor('#f8fafc')
    view.setVisible(false)
    this.workbenchView = view
    this.browserWindow.contentView.addChildView(view)
    if (shouldOpenWorkbenchDevTools()) {
      view.webContents.once('did-finish-load', () => {
        if (view.webContents.isDestroyed() || view.webContents.isDevToolsOpened()) return
        try {
          view.webContents.openDevTools({ mode: 'detach', activate: false })
        } catch (err) {
          this.emit({ kind: 'error', msg: 'workbench devtools: ' + (err as Error).message, ts: Date.now() })
        }
      })
    }
    const load = is.dev && process.env['ELECTRON_RENDERER_URL']
      ? view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/coworkWorkbench/index.html`)
      : view.webContents.loadFile(join(__dirname, '../renderer/coworkWorkbench/index.html'))
    return load.catch((err) => {
      this.emit({ kind: 'error', msg: 'workbench load: ' + (err as Error).message, ts: Date.now() })
      throw err
    })
  }

  async getSettings(): Promise<CoachSettings> {
    return this.ensureServices().settings.read()
  }

  async saveSettings(params: Partial<CoachSettings>): Promise<CoachSettings> {
    return this.ensureServices().settings.save(params)
  }

  async getWorkbenchVisible(): Promise<{ visible: boolean }> {
    return { visible: this.workbenchVisible }
  }

  async setWorkbenchVisible(params: { visible: boolean }): Promise<{ visible: boolean }> {
    this.workbenchVisible = Boolean(params.visible)
    if (this.opBounds) this.applyBounds(this.workbenchView, this.opBounds)
    else this.layout()
    if (this.workbenchView && !this.workbenchView.webContents.isDestroyed()) {
      this.workbenchView.setVisible(this.workbenchVisible)
    }
    this.broadcastWorkbenchVisibility()
    return { visible: this.workbenchVisible }
  }

  async navigate(params: { url: string }): Promise<void> {
    if (!this.operationView) return
    // The pinned home tab (AI-CRMS) is locked: the address bar is disabled in the UI,
    // and we refuse URL-bar navigation here too so nothing can swap out its page.
    const active = this.tabs.find((t) => t.id === this.activeTabId)
    if (active?.pinned) return
    if (isWorkbenchInternalUrl(params.url || '')) return
    // NB: do NOT await this.initialReady here — that's the pinned tab's boot chain. The active
    // (non-pinned) tab being navigated has its own ready view, and coupling the address bar to the
    // boot meant a stalled boot froze Enter. Load straight into the active view.
    const target = normalizeUrl(params.url)
    if (!target) return
    await this.operationView.webContents
      .loadURL(target)
      .catch((err) => this.emit({ kind: 'error', msg: 'navigate: ' + err.message, ts: Date.now() }))
  }

  // Reload the active tab's page. Allowed on the pinned home tab — reloading the same
  // page isn't navigating away, so it doesn't violate the pinned-tab lock.
  async reload(): Promise<void> {
    const wc = this.operationView?.webContents
    if (!wc || wc.isDestroyed()) return
    wc.reload()
  }

  // History nav of the active tab. The pinned AI-CRMS tab is locked because its history contains
  // the internal about:blank bootstrap page; exposing that would desync the chrome and the view.
  async goBack(): Promise<void> {
    const active = this.getActiveTab()
    if (this.isPinnedAiCrmsTab(active)) return
    const wc = this.operationView?.webContents
    if (!wc || wc.isDestroyed() || !wc.navigationHistory.canGoBack()) return
    wc.navigationHistory.goBack()
  }

  async goForward(): Promise<void> {
    const active = this.getActiveTab()
    if (this.isPinnedAiCrmsTab(active)) return
    const wc = this.operationView?.webContents
    if (!wc || wc.isDestroyed() || !wc.navigationHistory.canGoForward()) return
    wc.navigationHistory.goForward()
  }

  async setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]> {
    const tab = this.tabs.find((item) => item.id === params.id)
    if (!tab) return await this.getTabs()

    const enabled = Boolean(params.enabled)
    if (tab.debuggerEnabled !== enabled) {
      if (!enabled && this.capturing && this.captureTargetTabId === tab.id) await this.stopCapture()
      tab.debuggerEnabled = enabled
      if (tab.capture && tab.view && !tab.view.webContents.isDestroyed()) {
        if (enabled) {
          await tab.capture.resume().catch((err) => {
            this.emit({ kind: 'error', msg: 'debugger attach: ' + (err as Error).message, ts: Date.now() })
          })
        } else {
          tab.capture.suspend()
        }
      }
    }

    this.broadcastTabs()
    return await this.getTabs()
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
  // versionCode + productName) into the dmg, so the same read works in both.
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
      versionCode: typeof raw.versionCode === 'number' ? raw.versionCode : 0,
      description: str(raw.description)
    }
  }

  // Workbench ▸ Log uses the host-approved Electron log directory. Cowork does not install
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
    await this.loadHostToolPolicies()
    return readHostToolCatalog({
      scope: params?.scope === 'trainer' ? 'trainer' : 'cowork',
      category: params?.category || '',
      query: params?.query || '',
      policies: this.hostToolPolicies
    })
  }

  async setHostToolPolicy(params: { toolName: string; mode: HostToolPolicyMode }): Promise<HostToolPolicyResult> {
    await this.loadHostToolPolicies()
    const toolName = String(params.toolName || '').trim()
    const mode = normalizeHostToolPolicyMode(params.mode)
    if (!toolName) return { ok: false, policies: this.hostToolPolicies, error: 'toolName is required' }
    const known = readHostToolCatalog({ scope: 'cowork', policies: this.hostToolPolicies }).tools.some((tool) => tool.name === toolName) ||
      readHostToolCatalog({ scope: 'trainer', policies: this.hostToolPolicies }).tools.some((tool) => tool.name === toolName)
    if (!known) return { ok: false, policies: this.hostToolPolicies, error: `unknown tool: ${toolName}` }

    this.hostToolPolicies = {
      ...this.hostToolPolicies,
      [toolName]: { toolName, mode, updatedAt: Date.now() }
    }
    await configStore.upsert({ domain: HOST_TOOL_CONFIG_DOMAIN, key: HOST_TOOL_POLICY_KEY, options: this.hostToolPolicies }).catch((err) => {
      this.emit({ kind: 'error', msg: 'save host tool policy: ' + (err as Error).message, ts: Date.now() })
    })
    this.resetLlmAgentSessions()
    return { ok: true, policies: this.hostToolPolicies }
  }

  async getHostApprovalEvents(): Promise<HostApprovalHistoryResult> {
    await this.loadHostApprovalHistory()
    return { ok: true, events: this.hostApprovalHistory.list() }
  }

  async exportHostApprovalEvents(): Promise<HostApprovalExportResult> {
    await this.loadHostApprovalHistory()
    const result = this.browserWindow
      ? await dialog.showOpenDialog(this.browserWindow, {
        title: 'Choose host approval export directory',
        properties: ['openDirectory', 'createDirectory']
      })
      : await dialog.showOpenDialog({
        title: 'Choose host approval export directory',
        properties: ['openDirectory', 'createDirectory']
      })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    try {
      const payload = this.hostApprovalHistory.exportPayload()
      const stamp = new Date(payload.exportedAt).toISOString().replace(/[:.]/g, '-')
      const file = join(result.filePaths[0], `coach-host-approvals-${stamp}.json`)
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
      shell.showItemInFolder(file)
      return { ok: true, path: file, count: payload.count }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async clearHostApprovalEvents(): Promise<HostApprovalHistoryResult> {
    await this.loadHostApprovalHistory()
    const events = this.hostApprovalHistory.clear()
    await this.saveHostApprovalHistory()
    xpcMain.broadcast('coach/host-approval', { cleared: true, events: [] })
    return { ok: true, events }
  }

  async listIntegrationTargets(): Promise<IntegrationTargetSummary[]> {
    return await integrationTargetStore.listSummaries()
  }

  async getIntegrationTarget(params: { targetId: string }): Promise<IntegrationTarget | null> {
    return await integrationTargetStore.getTarget(params.targetId)
  }

  async createIntegrationTargetFromCapture(params?: { name?: string; domain?: string }): Promise<IntegrationTargetCreateResult> {
    await this.ensurePersistedCaptureRecordsLoaded()
    const capture = this.captureRecordsForAgent()
    const result = await integrationTargetStore.createFromCapture({
      name: params?.name,
      domain: params?.domain,
      currentUrl: this.currentUrl,
      records: capture.records
    })
    if (result.ok) xpcMain.broadcast('coach/integration-targets-changed', { targetId: result.target?.id, ts: Date.now() })
    return result
  }

  async createAiCrmsMigrationTarget(params: IntegrationMigrationTargetRequest): Promise<IntegrationTargetCreateResult> {
    const result = await integrationTargetStore.createAiCrmsMigrationTarget(params)
    if (result.ok) xpcMain.broadcast('coach/integration-targets-changed', { targetId: result.target?.id, migration: true, ts: Date.now() })
    return result
  }

  async deleteIntegrationTarget(params: { targetId: string }): Promise<IntegrationTargetDeleteResult> {
    const result = await integrationTargetStore.deleteTarget(params.targetId)
    if (result.ok) xpcMain.broadcast('coach/integration-targets-changed', { targetId: result.targetId, deleted: true, ts: Date.now() })
    return result
  }

  async runIntegrationTargetDryRun(params: { targetId: string }): Promise<IntegrationTargetRunResult> {
    const result = await integrationTargetStore.runDryRun(params.targetId)
    if (result.ok) xpcMain.broadcast('coach/integration-targets-changed', { targetId: result.targetId, dryRun: true, ts: Date.now() })
    return result
  }

  async runIntegrationRecordedSiteDryRun(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {
    const targetId = String(params.targetId || '').trim()
    const target = await integrationTargetStore.getTarget(targetId)
    if (!target) return { ok: false, targetId, message: `Integration target ${targetId} was not found.`, error: 'target-not-found' }
    const run = await this.buildRecordedSiteDryRun(target, params)
    await integrationTargetStore.recordRun(target.id, run)
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: target.id,
      recordedSiteDryRun: true,
      ts: Date.now()
    })
    return {
      ok: run.status !== 'failed',
      targetId: target.id,
      run,
      message:
        run.status === 'success'
          ? 'Recorded-site sync dry-run completed.'
          : run.status === 'warning'
            ? `Recorded-site sync dry-run finished with ${run.missing.length} item${run.missing.length === 1 ? '' : 's'} to review.`
            : 'Recorded-site sync dry-run failed.',
      error: run.status === 'failed' ? 'recorded-site-dry-run-failed' : undefined
    }
  }

  async runIntegrationRecordedSitePlan(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {
    const targetId = String(params.targetId || '').trim()
    const target = await integrationTargetStore.getTarget(targetId)
    if (!target) return { ok: false, targetId, message: `Integration target ${targetId} was not found.`, error: 'target-not-found' }
    const run = await this.buildRecordedSiteDryRun(target, params, { plan: true })
    await integrationTargetStore.recordRun(target.id, run)
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: target.id,
      recordedSitePlan: true,
      ts: Date.now()
    })
    return {
      ok: run.status !== 'failed',
      targetId: target.id,
      run,
      message:
        run.status === 'success'
          ? 'Recorded-site sync plan completed.'
          : run.status === 'warning'
            ? `Recorded-site sync plan finished with ${run.missing.length} item${run.missing.length === 1 ? '' : 's'} to review.`
            : 'Recorded-site sync plan failed.',
      error: run.status === 'failed' ? 'recorded-site-plan-failed' : undefined
    }
  }

  async runIntegrationRecordedSiteApply(params: IntegrationRecordedSiteApplyRequest): Promise<IntegrationTargetRunResult> {
    const targetId = String(params.targetId || '').trim()
    const target = await integrationTargetStore.getTarget(targetId)
    if (!target) return { ok: false, targetId, message: `Integration target ${targetId} was not found.`, error: 'target-not-found' }
    if (params.apply !== true) {
      return {
        ok: false,
        targetId: target.id,
        message: 'Recorded-site apply requires apply=true.',
        error: 'apply-confirmation-required'
      }
    }
    const run = await this.buildRecordedSiteApply(target, params)
    await integrationTargetStore.recordRun(target.id, run)
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: target.id,
      recordedSiteApply: true,
      ts: Date.now()
    })
    return {
      ok: run.status !== 'failed',
      targetId: target.id,
      run,
      message:
        run.status === 'success'
          ? 'Recorded-site sync apply completed.'
          : run.status === 'warning'
            ? `Recorded-site sync apply finished with ${run.missing.length} item${run.missing.length === 1 ? '' : 's'} to review.`
            : 'Recorded-site sync apply failed.',
      error: run.status === 'failed' ? 'recorded-site-apply-failed' : undefined
    }
  }

  private async buildRecordedSiteDryRun(
    target: IntegrationTarget,
    params: IntegrationRecordedSiteSyncRequest,
    options: { plan?: boolean } = {}
  ): Promise<IntegrationRunSummary> {
    const startedAt = Date.now()
    const notes = [
      'Recorded-site dry-run reads captured GET/list endpoints through the live browser session.',
      'No AI-CRMS writes are performed. Response rows are counted only; full source payloads are not persisted.',
      'Existing source-to-AI-CRMS mappings are used to classify rows as linked, pending, or conflict.'
    ]
    if (options.plan) {
      notes.push('Plan mode converts source rows into create/update/conflict intent counts only; source row payloads are not persisted.')
    }
    const missing: string[] = []
    const outputs: IntegrationRunOutput[] = []
    if (target.source.kind !== 'recorded-site') missing.push('recorded-site target')

    const selectedIds = new Set((params.endpointIds || []).map((id) => String(id || '').trim()).filter(Boolean))
    const maxEndpoints = Math.min(Math.max(Math.round(Number(params.maxEndpoints || 5)), 1), 20)
    const maxRows = Math.min(Math.max(Math.round(Number(params.maxRowsPerEndpoint || 50)), 1), 200)
    const readEndpoints = target.endpoints
      .filter((endpoint) => endpoint.role === 'read')
      .filter((endpoint) => !selectedIds.size || selectedIds.has(endpoint.id))
    const detailEndpoints = readEndpoints.filter(recordedSiteEndpointNeedsRow)
    const endpoints = readEndpoints.filter((endpoint) => !recordedSiteEndpointNeedsRow(endpoint)).slice(0, maxEndpoints)
    if (!endpoints.length) missing.push('captured read/list API endpoint')

    const tab = await this.findRecordedSiteTab(target)
    if (!tab?.replay) missing.push(`open logged-in browser tab for ${target.source.domain || 'recorded site'}`)

    let totalRows = 0
    let linkedRows = 0
    let pendingRows = 0
    let conflictRows = 0
    let planCreateRows = 0
    let planUpdateRows = 0
    let planMissingRows = 0
    let fetchCount = 0
    const mappingsByEntity = new Map<IntegrationEntity, Map<string, IntegrationMappingEntry>>()

    if (tab?.replay) {
      const sourceHost = normalizeRecordedSiteHost(target.source.domain || target.source.startUrl)
      const domainAuth = readApiProfile(sourceHost)
      for (const endpoint of endpoints) {
        const entity = integrationEntityForEndpoint(endpoint, target.entities)
        const endpointPlan = recordedSiteDryRunUrl(endpoint)
        if (!endpointPlan.ok || !endpointPlan.url) {
          outputs.push({
            name: `${endpoint.method} ${endpoint.path}`,
            ok: false,
            command: `${endpoint.method} ${endpoint.urlTemplate}`,
            summary: 'skipped',
            error: endpointPlan.error
          })
          missing.push(endpointPlan.error || 'safe endpoint url')
          continue
        }

        const result = await tab.replay.apiFetch({ method: endpoint.method, url: endpointPlan.url }, domainAuth)
        fetchCount += 1
        this.broadcastApiActivity(endpoint.method, endpointPlan.url, result.ok, result.auth)
        if (!result.ok) {
          outputs.push({
            name: `${endpoint.method} ${endpoint.path}`,
            ok: false,
            command: `${endpoint.method} ${endpointPlan.url}`,
            summary: 'fetch failed',
            error: result.error || `HTTP ${result.status}`
          })
          missing.push(`${endpoint.method} ${endpoint.path}`)
          continue
        }

        const rows = extractRecordedSiteRows(result.data, maxRows)
        const entityDetailEndpoints = recordedSiteDetailEndpointsForEntity(detailEndpoints, entity).slice(0, 4)
        if (!mappingsByEntity.has(entity)) {
          const mappingResult = await integrationMappingStore.listMappings({ targetId: target.id, entity, limit: 500 })
          mappingsByEntity.set(entity, new Map(mappingResult.mappings.map((mapping) => [mapping.sourceKey, mapping])))
        }
        const mappings = mappingsByEntity.get(entity) || new Map<string, IntegrationMappingEntry>()
        let endpointLinked = 0
        let endpointPending = 0
        let endpointConflict = 0
        let endpointPlanCreate = 0
        let endpointPlanUpdate = 0
        let endpointPlanMissing = 0
        let endpointDetailFetches = 0
        for (const row of rows) {
          const detailFetch = await this.fetchRecordedSiteRowDetails(row, entityDetailEndpoints, tab.replay, domainAuth)
          fetchCount += detailFetch.fetchCount
          endpointDetailFetches += detailFetch.fetchCount
          for (const output of detailFetch.outputs) outputs.push(output)
          for (const item of detailFetch.missing) missing.push(item)
          const enrichedRow = detailFetch.row
          const sourceKey = sourceKeyForRecordedSiteRow(enrichedRow)
          const sourceHash = stableSourceHash(enrichedRow)
          const mapping = mappings.get(sourceKey)
          if (!mapping) {
            endpointPending += 1
          } else if (mapping.sourceHash && sourceHash && mapping.sourceHash !== sourceHash) {
            endpointConflict += 1
          } else if (mapping.aiCrmsId && mapping.status === 'linked') {
            endpointLinked += 1
          } else if (mapping.status === 'conflict') {
            endpointConflict += 1
          } else {
            endpointPending += 1
          }
          if (options.plan) {
            const rowPlan = recordedSiteRowSyncPlan(entity, enrichedRow, mapping, sourceHash)
            if (rowPlan.action === 'create') endpointPlanCreate += 1
            if (rowPlan.action === 'update') endpointPlanUpdate += 1
            if (rowPlan.missingFields.length) endpointPlanMissing += 1
          }
        }
        totalRows += rows.length
        linkedRows += endpointLinked
        pendingRows += endpointPending
        conflictRows += endpointConflict
        planCreateRows += endpointPlanCreate
        planUpdateRows += endpointPlanUpdate
        planMissingRows += endpointPlanMissing
        if (!rows.length) missing.push(`${endpoint.method} ${endpoint.path} source rows`)
        if (options.plan && endpointPlanMissing) missing.push(`${entity} rows missing required fields (${endpointPlanMissing})`)
        outputs.push({
          name: `${endpoint.method} ${endpoint.path}`,
          ok: true,
          command: `${endpoint.method} ${endpointPlan.url}`,
          durationMs: undefined,
          summary: options.plan
            ? `${rows.length} ${entity} row(s), ${endpointDetailFetches} detail fetch(es): plan ${endpointPlanCreate} create, ${endpointPlanUpdate} update, ${endpointConflict} conflict, ${endpointPlanMissing} missing-fields`
            : `${rows.length} ${entity} row(s), ${endpointDetailFetches} detail fetch(es): ${endpointLinked} linked, ${endpointPending} pending, ${endpointConflict} conflict`
        })
      }
    }

    const allFetchesFailed = fetchCount > 0 && outputs.filter((output) => output.command.startsWith('GET ') && output.ok).length === 0
    const status =
      missing.includes('recorded-site target') || allFetchesFailed || (!fetchCount && endpoints.length > 0)
        ? 'failed'
        : missing.length || pendingRows || conflictRows
          ? 'warning'
          : 'success'
    notes.push(`Dry-run total: ${totalRows} row(s), ${linkedRows} linked, ${pendingRows} pending, ${conflictRows} conflict.`)
    if (options.plan) {
      notes.push(`Plan total: ${planCreateRows} create, ${planUpdateRows} update, ${conflictRows} conflict, ${planMissingRows} missing required fields.`)
    }
    return {
      id: randomUUID(),
      mode: 'dry-run',
      status,
      startedAt,
      finishedAt: Date.now(),
      endpointCount: endpoints.length,
      readCount: endpoints.length,
      writeCount: target.endpoints.filter((endpoint) => endpoint.role === 'write').length,
      entityCount: target.entities.length,
      commandCount: fetchCount,
      notes,
      missing: Array.from(new Set(missing)),
      outputs
    }
  }

  private async buildRecordedSiteApply(target: IntegrationTarget, params: IntegrationRecordedSiteApplyRequest): Promise<IntegrationRunSummary> {
    const startedAt = Date.now()
    const notes = [
      'Recorded-site apply reads captured GET/list endpoints through the live browser session.',
      'Apply writes patient, corporate, project, data_mapping, and mcu_record rows through the bundled micromeet CLI.',
      'Linked MCU record updates can write patient-info, diagnostic-data, and conclusion sections when allow_updates=true.',
      'Source payloads and auth tokens are not persisted; successful writes update source-to-AI-CRMS mappings.'
    ]
    const missing: string[] = []
    const outputs: IntegrationRunOutput[] = []
    if (target.source.kind !== 'recorded-site') missing.push('recorded-site target')

    const selectedIds = new Set((params.endpointIds || []).map((id) => String(id || '').trim()).filter(Boolean))
    const entities = normalizeRecordedSiteApplyEntities(params.entities)
    const maxEndpoints = Math.min(Math.max(Math.round(Number(params.maxEndpoints || 5)), 1), 20)
    const maxRows = Math.min(Math.max(Math.round(Number(params.maxRowsPerEndpoint || 50)), 1), 200)
    const maxWrites = Math.min(Math.max(Math.round(Number(params.maxWrites || 10)), 1), 50)
    const readEndpoints = target.endpoints
      .filter((endpoint) => endpoint.role === 'read')
      .filter((endpoint) => !selectedIds.size || selectedIds.has(endpoint.id))
    const detailEndpoints = readEndpoints.filter(recordedSiteEndpointNeedsRow)
    const endpoints = readEndpoints.filter((endpoint) => !recordedSiteEndpointNeedsRow(endpoint)).slice(0, maxEndpoints)
    if (!endpoints.length) missing.push('captured read/list API endpoint')

    const tab = await this.findRecordedSiteTab(target)
    if (!tab?.replay) missing.push(`open logged-in browser tab for ${target.source.domain || 'recorded site'}`)

    let fetchCount = 0
    let cliCommandCount = 0
    let writeCount = 0
    let createCount = 0
    let updateCount = 0
    let skippedCount = 0
    let failed = false
    const mappingsByEntity = new Map<IntegrationEntity, Map<string, IntegrationMappingEntry>>()

    const loadMappings = async (entity: IntegrationEntity): Promise<Map<string, IntegrationMappingEntry>> => {
      if (!mappingsByEntity.has(entity)) {
        const mappingResult = await integrationMappingStore.listMappings({ targetId: target.id, entity, limit: 500 })
        mappingsByEntity.set(entity, new Map(mappingResult.mappings.map((mapping) => [mapping.sourceKey, mapping])))
      }
      return mappingsByEntity.get(entity) || new Map<string, IntegrationMappingEntry>()
    }

    if (tab?.replay) {
      const sourceHost = normalizeRecordedSiteHost(target.source.domain || target.source.startUrl)
      const domainAuth = readApiProfile(sourceHost)
      for (const endpoint of endpoints) {
        if (writeCount >= maxWrites || failed) break
        const entity = integrationEntityForEndpoint(endpoint, target.entities)
        if (!entities.includes(entity)) continue
        const endpointPlan = recordedSiteDryRunUrl(endpoint)
        if (!endpointPlan.ok || !endpointPlan.url) {
          outputs.push({
            name: `${endpoint.method} ${endpoint.path}`,
            ok: false,
            command: `${endpoint.method} ${endpoint.urlTemplate}`,
            summary: 'skipped',
            error: endpointPlan.error
          })
          missing.push(endpointPlan.error || 'safe endpoint url')
          continue
        }

        const result = await tab.replay.apiFetch({ method: endpoint.method, url: endpointPlan.url }, domainAuth)
        fetchCount += 1
        this.broadcastApiActivity(endpoint.method, endpointPlan.url, result.ok, result.auth)
        if (!result.ok) {
          outputs.push({
            name: `${endpoint.method} ${endpoint.path}`,
            ok: false,
            command: `${endpoint.method} ${endpointPlan.url}`,
            summary: 'fetch failed',
            error: result.error || `HTTP ${result.status}`
          })
          missing.push(`${endpoint.method} ${endpoint.path}`)
          failed = true
          break
        }

        const rows = extractRecordedSiteRows(result.data, maxRows)
        const entityDetailEndpoints = recordedSiteDetailEndpointsForEntity(detailEndpoints, entity).slice(0, 4)
        const mappings = await loadMappings(entity)
        const dependencyMappings =
          entity === 'project' || entity === 'mcu_record'
            ? {
                patient: entity === 'mcu_record' ? await loadMappings('patient') : undefined,
                corporate: await loadMappings('corporate'),
                project: entity === 'mcu_record' ? await loadMappings('project') : undefined
              }
            : undefined
        let endpointWrites = 0
        let endpointSkips = 0
        let endpointDetailFetches = 0
        for (const row of rows) {
          if (writeCount >= maxWrites) break
          const detailFetch = await this.fetchRecordedSiteRowDetails(row, entityDetailEndpoints, tab.replay, domainAuth)
          fetchCount += detailFetch.fetchCount
          endpointDetailFetches += detailFetch.fetchCount
          for (const output of detailFetch.outputs) outputs.push(output)
          for (const item of detailFetch.missing) missing.push(item)
          const enrichedRow = detailFetch.row
          const sourceKey = sourceKeyForRecordedSiteRow(enrichedRow)
          const sourceHash = stableSourceHash(enrichedRow)
          const mapping = mappings.get(sourceKey)
          const rowPlan = recordedSiteRowSyncPlan(entity, enrichedRow, mapping, sourceHash)
          if (rowPlan.action === 'conflict') {
            skippedCount += 1
            endpointSkips += 1
            missing.push(`${entity} conflict ${sourceKey}`)
            continue
          }
          if (rowPlan.action === 'noop' || rowPlan.action === 'update' && !params.allowUpdates) {
            skippedCount += 1
            endpointSkips += 1
            continue
          }

          const bodyPlan = recordedSiteAiCrmsBody(entity, enrichedRow, {
            action: rowPlan.action,
            mapping,
            dependencyMappings
          })
          const rowMissing = [...rowPlan.missingFields, ...bodyPlan.missing]
          if (rowMissing.length) {
            skippedCount += 1
            endpointSkips += 1
            missing.push(`${entity} ${sourceKey} missing ${Array.from(new Set(rowMissing)).join(', ')}`)
            continue
          }

          const commands = recordedSiteAiCrmsCommands(entity, rowPlan.action, bodyPlan.body)
          if (!commands.length) {
            skippedCount += 1
            endpointSkips += 1
            missing.push(`${entity} ${rowPlan.action} apply command`)
            continue
          }
          let aiCrmsId = stringFrom(bodyPlan.body.id) || stringFrom(bodyPlan.body.mcu_record_id)
          let rowFailed = false
          for (const command of commands) {
            if (writeCount >= maxWrites) {
              rowFailed = true
              missing.push('max writes reached')
              break
            }
            const cli = await runMicromeetCli(command.name, command.args, { timeoutMs: 60_000 })
            cliCommandCount += 1
            const commandAiCrmsId = aiCrmsIdFromResponse(cli.json) || stringFrom(command.body.id) || stringFrom(command.body.mcu_record_id)
            if (commandAiCrmsId) aiCrmsId = commandAiCrmsId
            outputs.push({
              name: command.name,
              ok: cli.ok && Boolean(commandAiCrmsId || aiCrmsId),
              command: command.preview,
              exitCode: cli.exitCode,
              durationMs: cli.durationMs,
              summary: cli.ok ? `${rowPlan.action} ${entity}${aiCrmsId ? ` -> ${aiCrmsId}` : ''}` : undefined,
              error: cli.ok && !commandAiCrmsId && !aiCrmsId ? 'AI-CRMS id was not returned; mapping was not updated.' : cli.error
            })
            if (!cli.ok || (!commandAiCrmsId && !aiCrmsId)) {
              failed = !cli.ok
              rowFailed = true
              missing.push(cli.ok ? `${entity} AI-CRMS id` : `${entity} ${rowPlan.action}`)
              break
            }
            writeCount += 1
            endpointWrites += 1
          }
          if (rowFailed) {
            skippedCount += 1
            endpointSkips += 1
            if (failed) break
            continue
          }
          if (rowPlan.action === 'create') createCount += 1
          if (rowPlan.action === 'update') updateCount += 1
          const mappingResult = await integrationMappingStore.upsertMapping({
            targetId: target.id,
            entity,
            sourceKey,
            sourceHash,
            aiCrmsId,
            aiCrmsLabel: recordedSiteSourceLabel(entity, enrichedRow),
            sourceLabel: recordedSiteSourceLabel(entity, enrichedRow),
            status: 'linked',
            lastSyncedAt: Date.now(),
            metadata: {
              lastAction: rowPlan.action,
              endpointId: endpoint.id
            }
          })
          if (mappingResult.mapping) mappings.set(sourceKey, mappingResult.mapping)
        }
        outputs.push({
          name: `${endpoint.method} ${endpoint.path}`,
          ok: !failed,
          command: `${endpoint.method} ${endpointPlan.url}`,
          summary: `${endpointWrites} write(s), ${endpointSkips} skipped, ${endpointDetailFetches} detail fetch(es)`
        })
      }
    }

    if (!writeCount && !failed) missing.push('eligible source rows to apply')
    notes.push(`Apply total: ${writeCount} write(s), ${createCount} create, ${updateCount} update, ${skippedCount} skipped, limit ${maxWrites}.`)
    const status =
      missing.includes('recorded-site target') || failed || (!fetchCount && endpoints.length > 0)
        ? 'failed'
        : missing.length || skippedCount
          ? 'warning'
          : 'success'
    return {
      id: randomUUID(),
      mode: 'apply',
      status,
      startedAt,
      finishedAt: Date.now(),
      endpointCount: endpoints.length,
      readCount: endpoints.length,
      writeCount: target.endpoints.filter((endpoint) => endpoint.role === 'write').length,
      entityCount: target.entities.length,
      commandCount: fetchCount + cliCommandCount,
      notes,
      missing: Array.from(new Set(missing)),
      outputs
    }
  }

  private async fetchRecordedSiteRowDetails(
    row: unknown,
    detailEndpoints: IntegrationEndpointContract[],
    replay: ReplayEngine,
    auth: AuthHint | AuthHint[] | null
  ): Promise<{ row: unknown; fetchCount: number; outputs: IntegrationRunOutput[]; missing: string[] }> {
    if (!detailEndpoints.length) return { row, fetchCount: 0, outputs: [], missing: [] }
    const outputs: IntegrationRunOutput[] = []
    const missing: string[] = []
    const details: unknown[] = []
    let fetchCount = 0
    for (const endpoint of detailEndpoints) {
      const plan = recordedSiteRowDetailUrl(endpoint, row)
      if (!plan.ok || !plan.url) {
        missing.push(plan.error || `${endpoint.method} ${endpoint.path} detail url`)
        continue
      }
      const result = await replay.apiFetch({ method: endpoint.method, url: plan.url }, auth)
      fetchCount += 1
      this.broadcastApiActivity(endpoint.method, plan.url, result.ok, result.auth)
      outputs.push({
        name: `${endpoint.method} ${endpoint.path}`,
        ok: result.ok,
        command: `${endpoint.method} ${recordedSiteRedactDetailUrl(plan.url)}`,
        summary: result.ok ? 'detail fetched' : 'detail fetch failed',
        error: result.ok ? undefined : result.error || `HTTP ${result.status}`
      })
      if (result.ok) details.push(result.data)
      else missing.push(`${endpoint.method} ${endpoint.path}`)
    }
    if (!details.length) return { row, fetchCount, outputs, missing }
    return {
      row: mergeRecordedSiteRowDetails(row, details),
      fetchCount,
      outputs,
      missing
    }
  }

  private async findRecordedSiteTab(target: IntegrationTarget): Promise<OperationTab | undefined> {
    const expected = normalizeRecordedSiteHost(target.source.domain || target.source.startUrl)
    const active = this.getActiveTab()
    const activeHost = normalizeRecordedSiteHost(active?.view?.webContents.getURL() || active?.url || this.currentUrl)
    let tab = active && recordedSiteHostMatches(activeHost, expected) ? active : undefined
    if (!tab) {
      tab = this.tabs.find((item) => {
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
    const result = await integrationTargetStore.runMigration(params)
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: result.targetId,
      migration: true,
      apply: Boolean(params.apply),
      ts: Date.now()
    })
    return result
  }

  async runIntegrationReportReadiness(params: IntegrationReportReadinessRequest): Promise<IntegrationTargetRunResult> {
    const result = await integrationTargetStore.runReportReadiness(params)
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: result.targetId,
      readiness: true,
      generate: Boolean(params.generate),
      ts: Date.now()
    })
    return result
  }

  async setIntegrationTargetSchedule(params: IntegrationTargetScheduleRequest): Promise<IntegrationTargetScheduleResult> {
    const result = await integrationTargetStore.setSchedule(params)
    if (result.ok) {
      xpcMain.broadcast('coach/integration-targets-changed', {
        targetId: result.targetId,
        schedule: true,
        enabled: result.target?.schedule.enabled,
        ts: Date.now()
      })
    }
    return result
  }

  async listIntegrationMappings(params: IntegrationMappingListRequest): Promise<IntegrationMappingListResult> {
    return await integrationMappingStore.listMappings(params)
  }

  async upsertIntegrationMapping(params: IntegrationMappingUpsertRequest): Promise<IntegrationMappingWriteResult> {
    const result = await integrationMappingStore.upsertMapping(params)
    if (result.ok) {
      xpcMain.broadcast('coach/integration-targets-changed', {
        targetId: result.targetId,
        mappings: true,
        ts: Date.now()
      })
    }
    return result
  }

  async deleteIntegrationMapping(params: IntegrationMappingDeleteRequest): Promise<IntegrationMappingWriteResult> {
    const result = await integrationMappingStore.deleteMapping(params)
    if (result.ok) {
      xpcMain.broadcast('coach/integration-targets-changed', {
        targetId: result.targetId,
        mappings: true,
        deleted: true,
        ts: Date.now()
      })
    }
    return result
  }

  private handleIntegrationSchedulerEvent(event: IntegrationSchedulerEvent): void {
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: event.targetId,
      schedule: true,
      phase: event.phase,
      nextRunAt: event.nextRunAt,
      ts: Date.now()
    })
    if (event.phase === 'scheduled') return
    this.broadcastActivity(
      'tool',
      `${event.phase === 'started' ? 'started' : 'finished'} scheduled integration ${event.targetId}${event.runKind ? ` (${event.runKind})` : ''}`,
      event.phase !== 'failed'
    )
  }

  async listInjectedButtons(): Promise<InjectedButtonDomain[]> {
    const entries = await injectBtnStore.list({})
    return groupInjectedButtonDomains(entries)
  }

  async removeInjectedButtonDomain(params: { domain: string }): Promise<InjectedButtonRemoveResult> {
    const domain = normalizeInjectedButtonDomain(params.domain)
    if (!domain) return { ok: false, domain: '', removed: 0, unInjected: 0, error: 'Missing domain' }
    const removed = await injectBtnStore.removeDomain({ domain })
    const unInjected = await this.removeInjectedButtonFromTabs(domain)
    this.injectedButtonNonces.delete(domain)
    xpcMain.broadcast('coach/injected-buttons-changed', { domain, ts: Date.now() })
    return {
      ok: removed.ok,
      domain,
      removed: removed.count,
      unInjected,
      error: removed.ok ? undefined : 'Could not remove injected button rows'
    }
  }

  private async loadHostApprovalHistory(): Promise<void> {
    if (this.hostApprovalHistoryLoadPromise) return await this.hostApprovalHistoryLoadPromise
    this.hostApprovalHistoryLoadPromise = configStore
      .get({ domain: HOST_TOOL_CONFIG_DOMAIN, key: HOST_APPROVAL_HISTORY_KEY })
      .then((entry) => {
        this.hostApprovalHistory.replace(Array.isArray(entry?.options) ? entry.options as HostApprovalEvent[] : [])
      })
      .catch((err) => {
        this.emit({ kind: 'error', msg: 'load host approval history: ' + (err as Error).message, ts: Date.now() })
      })
      .finally(() => {
        this.hostApprovalHistoryLoadPromise = null
      })
    return await this.hostApprovalHistoryLoadPromise
  }

  private async saveHostApprovalHistory(): Promise<void> {
    await configStore
      .upsert({
        domain: HOST_TOOL_CONFIG_DOMAIN,
        key: HOST_APPROVAL_HISTORY_KEY,
        options: this.hostApprovalHistory.snapshot()
      })
      .catch((err) => {
        this.emit({ kind: 'error', msg: 'save host approval history: ' + (err as Error).message, ts: Date.now() })
      })
  }

  private async loadHostToolPolicies(): Promise<void> {
    if (this.hostToolPolicyLoadPromise) return await this.hostToolPolicyLoadPromise
    this.hostToolPolicyLoadPromise = configStore
      .get({ domain: HOST_TOOL_CONFIG_DOMAIN, key: HOST_TOOL_POLICY_KEY })
      .then((entry) => {
        this.hostToolPolicies = normalizeHostToolPolicies(entry?.options)
      })
      .catch((err) => {
        this.emit({ kind: 'error', msg: 'load host tool policy: ' + (err as Error).message, ts: Date.now() })
        this.hostToolPolicies = {}
      })
      .finally(() => {
        this.hostToolPolicyLoadPromise = null
      })
    return await this.hostToolPolicyLoadPromise
  }

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

  getCaptureState(): CaptureState {
    return {
      capturing: this.capturing,
      mode: this.captureMode,
      file: this.traceFile,
      startedAt: this.capturing ? this.captureStartedAt : 0
    }
  }

  private cloneCaptureOptions(): CaptureOptions {
    return {
      ...this.captureOptions,
      networkWhitelist: this.captureOptions.networkWhitelist.map((rule) => ({ ...rule })),
      networkBlacklist: this.captureOptions.networkBlacklist.map((rule) => ({ ...rule }))
    }
  }

  async startCapture(params?: { mode?: CaptureMode } & Partial<CaptureOptions>): Promise<CaptureState> {
    if (params?.mode) this.captureMode = params.mode
    if (params) await this.setCaptureOptions(params)
    if (this.capturing) await this.discardActiveCaptureForRestart()
    const target = this.currentCaptureTarget()
    if (!target?.capture) {
      return this.getCaptureState()
    }
    const dir = join(coworkDataRoot(), 'traces')
    mkdirSync(dir, { recursive: true })
    this.traceFile = join(dir, `trace-${Date.now()}.jsonl`)
    this.traceStream = createWriteStream(this.traceFile, { flags: 'a' })
    this.capturing = true
    this.captureStartedAt = Date.now()
    this.captureTargetTabId = target.id
    this.traceEvents = []
    await this.clearCaptureRecordEdits()
    // Turn ON the recording bridge (Runtime.enable) for the selected browser tab only. Workbench
    // is a first-party renderer, so opening it to inspect records must not move capture onto it.
    await target.capture.startRecording()
    xpcMain.broadcast('coach/capture-started', { file: this.traceFile, mode: this.captureMode, ts: this.captureStartedAt })
    this.emit({ kind: 'info', msg: `capture (${this.captureMode}) -> ${this.traceFile}`, ts: Date.now() })
    return this.getCaptureState()
  }

  async stopCapture(): Promise<CaptureState> {
    const stoppedStartedAt = this.captureStartedAt
    this.capturing = false
    this.captureStartedAt = 0
    const target = this.captureTargetTab()
    // Tear down the recording bridge and revert Runtime.enable on the target tab so the page is
    // undetectable again (kept on for ai-crms, where authBridge needs it).
    await target?.capture?.stopRecording({ keepRuntime: target.kind === 'ai-crms' })
    this.captureTargetTabId = null
    if (this.traceStream) {
      this.traceStream.end()
      this.traceStream = null
    }
    await this.persistRawCaptureRecordsIfNeeded(stoppedStartedAt)
    this.emit({ kind: 'info', msg: 'capture stopped', ts: Date.now() })
    // Mirror of coach/capture-started: tell every renderer recording ended, so the home record
    // dot (and the control panel's capturing-gated UI) flip back regardless of who stopped it.
    xpcMain.broadcast('coach/capture-stopped', { ts: Date.now() })
    return this.getCaptureState()
  }

  private async discardActiveCaptureForRestart(): Promise<void> {
    const target = this.captureTargetTab()
    await target?.capture?.stopRecording({ keepRuntime: target.kind === 'ai-crms' }).catch((err) => {
      this.emit({ kind: 'error', msg: 'capture restart cleanup: ' + (err as Error).message, ts: Date.now() })
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
      this.debugCodex({
        scope: 'agent',
        phase: 'capture-record-persist',
        level: 'warn',
        message: 'Failed to persist latest raw capture records.',
        detail: { error: err instanceof Error ? err.message : String(err) },
        ts: Date.now()
      })
    })
    this.debugCodex({
      scope: 'agent',
      phase: 'capture-record-persist',
      level: 'debug',
      message: 'Persisted latest raw capture records.',
      detail: { count: persisted.records.length },
      ts: Date.now()
    })
  }

  private isCapturableTab(tab: OperationTab | undefined): tab is OperationTab {
    return !!tab && tab.debuggerEnabled && !!tab.capture && !!tab.view && !tab.view.webContents.isDestroyed()
  }

  private captureTargetTab(): OperationTab | undefined {
    return this.tabs.find((t) => t.id === this.captureTargetTabId)
  }

  private currentCaptureTarget(): OperationTab | undefined {
    const active = this.tabs.find((t) => t.id === this.activeTabId)
    if (active && !active.debuggerEnabled) return undefined
    if (this.isCapturableTab(active)) return active
    const existing = this.captureTargetTab()
    if (this.isCapturableTab(existing)) return existing
    return this.tabs
      .filter((t) => this.isCapturableTab(t))
      .sort((a, b) => b.lastActive - a.lastActive)[0]
  }

  private currentBrowserTarget(): OperationTab | undefined {
    return this.currentCaptureTarget()
  }

  private async switchCaptureTarget(next: OperationTab): Promise<void> {
    if (!this.capturing || !this.isCapturableTab(next) || this.captureTargetTabId === next.id) return
    const prev = this.captureTargetTab()
    if (prev && prev.id !== next.id) await prev.capture?.stopRecording({ keepRuntime: prev.kind === 'ai-crms' })
    this.captureTargetTabId = next.id
    await next.capture?.startRecording()
  }

  // Capture a simplified DOM "element" tree of the live page as a YAML structure
  // and record it into the current trace (UI-mode recordings only).
  async captureSnapshot(): Promise<SnapshotResult> {
    if (!this.capturing) return { ok: false, nodeCount: 0, yaml: '', error: 'Capture is not running' }
    if (this.captureMode === 'api' || !this.captureOptions.recordActions) {
      return { ok: false, nodeCount: 0, yaml: '', error: 'Action capture is off' }
    }
    const target = this.currentBrowserTarget()
    if (!target?.capture) return { ok: false, nodeCount: 0, yaml: '', error: 'capture not ready' }
    const result = await target.capture.snapshot({ shot: true })
    if (result.ok) {
      this.emit({
        kind: 'snapshot',
        url: target.url || this.currentUrl,
        title: result.title,
        nodeCount: result.nodeCount,
        yaml: result.yaml,
        shot: result.shot,
        ts: Date.now()
      })
    } else {
      this.emit({ kind: 'error', msg: 'snapshot: ' + (result.error || 'failed'), ts: Date.now() })
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
      this.debugCodex({
        scope: 'agent',
        phase: 'capture-record-persist',
        level: 'warn',
        message: 'Failed to persist renderer-edited capture records.',
        detail: { error: err instanceof Error ? err.message : String(err) },
        ts: Date.now()
      })
    })
    this.debugCodex({
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

  async exportRecording(params: { startedAt: number; records: IngestRecord[]; format?: CaptureExportFormat }): Promise<ExportRecordingResult> {
    const format = params.format === 'har' ? 'har' : 'json'
    const parent = this.browserWindow && !this.browserWindow.isDestroyed() ? this.browserWindow : undefined
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
          : {
              version: 1,
              startedAt: params.startedAt || Date.now(),
              exportedAt: Date.now(),
              records: params.records
            }
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
      return { ok: true, path: file, format }
    } catch (err) {
      return { ok: false, path: file, format, error: (err as Error).message }
    }
  }

  async replayBrowserRequest(params: BrowserRequestReplayRequest): Promise<BrowserRequestReplayResult> {
    const startedAt = Date.now()
    if (!this.replayEngine) return { ok: false, status: 0, error: 'browser view is not ready', durationMs: 0 }
    const url = String(params.url || '').trim()
    if (!url) return { ok: false, status: 0, error: 'url is required', durationMs: Date.now() - startedAt }
    const method = String(params.method || 'GET').toUpperCase()
    const auth = readApiProfile(hostFromUrl(url || this.currentUrl))
    const result = await this.replayEngine.apiFetch(
      {
        url,
        method,
        query: normalizeApiQuery(params.query),
        headers: sanitizeReplayHeaders(params.headers),
        body: params.body
      },
      auth
    )
    this.broadcastApiActivity(method, url, result.ok, result.auth)
    this.emit({
      kind: result.ok ? 'info' : 'error',
      msg: `workbench replay: ${method} ${apiActivityPath(url, this.currentUrl)} -> ${result.status || result.error || 'failed'}`,
      ts: Date.now()
    })
    return {
      ok: result.ok,
      status: result.status,
      data: compactReplayData(result.data),
      error: result.error,
      auth: result.auth,
      durationMs: Date.now() - startedAt
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

  private async toolStartRecording(modeArg: string): Promise<string> {
    const mode = normalizeCaptureToolMode(modeArg)
    const state = await this.startCapture(mode ? { mode } : undefined)
    const ok = Boolean(state.capturing)
    this.broadcastActivity('tool', `start_recording${state.mode ? ` (${state.mode})` : ''}`, ok)
    return JSON.stringify(
      {
        ok,
        capturing: state.capturing,
        mode: state.mode,
        file: state.file || '',
        startedAt: state.startedAt || 0
      },
      null,
      2
    )
  }

  private async toolStopRecording(): Promise<string> {
    const wasCapturing = this.capturing
    const state = await this.stopCapture()
    this.broadcastActivity('tool', 'stop_recording', wasCapturing)
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

  private async toolListIntegrationTargets(targetId?: string): Promise<string> {
    if (targetId) {
      const target = await this.getIntegrationTarget({ targetId })
      this.broadcastActivity('tool', `read integration target ${targetId}`, Boolean(target))
      return JSON.stringify({ ok: Boolean(target), target }, null, 2)
    }
    const targets = await this.listIntegrationTargets()
    this.broadcastActivity('tool', `read integration targets (${targets.length})`)
    return JSON.stringify({ ok: true, targets }, null, 2)
  }

  private async toolCreateIntegrationTargetFromCapture(name?: string, domain?: string): Promise<string> {
    const startedAt = Date.now()
    this.broadcastActivity('tool', 'create integration target from capture')
    const result = await this.createIntegrationTargetFromCapture({ name, domain })
    this.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok
          ? `created integration target (${result.target?.endpoints.length || 0} endpoints)`
          : `create integration target failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async toolCreateAiCrmsMigrationTarget(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationMigrationTargetRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const domains = Array.isArray(raw.domains)
        ? raw.domains.map(String)
        : typeof raw.domains === 'string'
          ? raw.domains.split(',').map((item) => item.trim()).filter(Boolean)
          : undefined
      params = {
        name: raw.name ? String(raw.name) : undefined,
        source: String(raw.source || '').trim(),
        target: String(raw.target || '').trim(),
        domains
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    this.broadcastActivity('tool', 'create AI-CRMS migration target')
    const result = await this.createAiCrmsMigrationTarget(params)
    this.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok
          ? `created migration target (${result.target?.source.migration?.domains.length || 0} domains)`
          : `create migration target failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async toolRunIntegrationDryRun(targetId: string): Promise<string> {
    const startedAt = Date.now()
    this.broadcastActivity('tool', `run integration dry-run ${targetId}`)
    const result = await this.runIntegrationTargetDryRun({ targetId })
    this.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok
          ? `integration dry-run ${result.run?.status || 'finished'}`
          : `integration dry-run failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async toolRunRecordedSiteSyncDryRun(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationRecordedSiteSyncRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const endpointIds = Array.isArray(raw.endpoint_ids)
        ? raw.endpoint_ids.map(String)
        : Array.isArray(raw.endpointIds)
          ? raw.endpointIds.map(String)
          : typeof raw.endpoint_ids === 'string'
            ? raw.endpoint_ids.split(',').map((item) => item.trim()).filter(Boolean)
            : typeof raw.endpointIds === 'string'
              ? raw.endpointIds.split(',').map((item) => item.trim()).filter(Boolean)
              : undefined
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        endpointIds,
        maxEndpoints: Number.isFinite(Number(raw.max_endpoints || raw.maxEndpoints)) ? Number(raw.max_endpoints || raw.maxEndpoints) : undefined,
        maxRowsPerEndpoint: Number.isFinite(Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint))
          ? Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint)
          : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    this.broadcastActivity('tool', `recorded-site sync dry-run ${params.targetId}`)
    const result = await this.runIntegrationRecordedSiteDryRun(params)
    this.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok
          ? `recorded-site dry-run ${result.run?.status || 'finished'}`
          : `recorded-site dry-run failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async toolRunRecordedSiteSyncPlan(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationRecordedSiteSyncRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const endpointIds = Array.isArray(raw.endpoint_ids)
        ? raw.endpoint_ids.map(String)
        : Array.isArray(raw.endpointIds)
          ? raw.endpointIds.map(String)
          : typeof raw.endpoint_ids === 'string'
            ? raw.endpoint_ids.split(',').map((item) => item.trim()).filter(Boolean)
            : typeof raw.endpointIds === 'string'
              ? raw.endpointIds.split(',').map((item) => item.trim()).filter(Boolean)
              : undefined
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        endpointIds,
        maxEndpoints: Number.isFinite(Number(raw.max_endpoints || raw.maxEndpoints)) ? Number(raw.max_endpoints || raw.maxEndpoints) : undefined,
        maxRowsPerEndpoint: Number.isFinite(Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint))
          ? Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint)
          : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    this.broadcastActivity('tool', `recorded-site sync plan ${params.targetId}`)
    const result = await this.runIntegrationRecordedSitePlan(params)
    this.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok
          ? `recorded-site sync plan ${result.run?.status || 'finished'}`
          : `recorded-site sync plan failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async toolRunRecordedSiteSyncApply(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationRecordedSiteApplyRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const endpointIds = Array.isArray(raw.endpoint_ids)
        ? raw.endpoint_ids.map(String)
        : Array.isArray(raw.endpointIds)
          ? raw.endpointIds.map(String)
          : typeof raw.endpoint_ids === 'string'
            ? raw.endpoint_ids.split(',').map((item) => item.trim()).filter(Boolean)
            : typeof raw.endpointIds === 'string'
              ? raw.endpointIds.split(',').map((item) => item.trim()).filter(Boolean)
              : undefined
      const entities = Array.isArray(raw.entities)
        ? raw.entities.map(String).filter((item): item is IntegrationEntity => RECORDED_SITE_APPLY_ENTITIES.includes(item as IntegrationEntity))
        : typeof raw.entities === 'string'
          ? raw.entities.split(',').map((item) => item.trim()).filter((item): item is IntegrationEntity => RECORDED_SITE_APPLY_ENTITIES.includes(item as IntegrationEntity))
          : undefined
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        endpointIds,
        maxEndpoints: Number.isFinite(Number(raw.max_endpoints || raw.maxEndpoints)) ? Number(raw.max_endpoints || raw.maxEndpoints) : undefined,
        maxRowsPerEndpoint: Number.isFinite(Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint))
          ? Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint)
          : undefined,
        maxWrites: Number.isFinite(Number(raw.max_writes || raw.maxWrites)) ? Number(raw.max_writes || raw.maxWrites) : undefined,
        allowUpdates: raw.allow_updates === true || raw.allowUpdates === true || raw.allow_updates === 'true' || raw.allowUpdates === 'true',
        apply: raw.apply === true || raw.apply === 'true',
        entities
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    if (params.apply !== true) {
      return JSON.stringify({ ok: false, error: 'apply-confirmation-required', message: 'params_json must include {"apply":true}.' }, null, 2)
    }
    this.broadcastActivity('tool', `recorded-site sync apply ${params.targetId}`)
    const result = await this.runIntegrationRecordedSiteApply(params)
    this.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok
          ? `recorded-site sync apply ${result.run?.status || 'finished'}`
          : `recorded-site sync apply failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async toolRunIntegrationMigration(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationMigrationRunRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const domains = Array.isArray(raw.domains)
        ? raw.domains.map(String)
        : typeof raw.domains === 'string'
          ? raw.domains.split(',').map((item) => item.trim()).filter(Boolean)
          : undefined
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        apply: raw.apply === true || raw.apply === 'true',
        domains,
        timeoutMs: Number.isFinite(Number(raw.timeout_ms || raw.timeoutMs)) ? Number(raw.timeout_ms || raw.timeoutMs) : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    this.broadcastActivity('tool', `${params.apply ? 'apply' : 'dry-run'} AI-CRMS migration ${params.targetId}`)
    const result = await this.runIntegrationMigration(params)
    this.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok
          ? `AI-CRMS migration ${result.run?.status || 'finished'}`
          : `AI-CRMS migration failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async toolRunIntegrationReportReadiness(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationReportReadinessRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const ids = Array.isArray(raw.mcu_record_ids)
        ? raw.mcu_record_ids.map(String)
        : Array.isArray(raw.mcuRecordIds)
          ? raw.mcuRecordIds.map(String)
          : typeof raw.mcu_record_ids === 'string'
            ? raw.mcu_record_ids.split(',').map((item) => item.trim()).filter(Boolean)
            : typeof raw.mcuRecordIds === 'string'
              ? raw.mcuRecordIds.split(',').map((item) => item.trim()).filter(Boolean)
              : undefined
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        mcuRecordIds: ids,
        keyword: raw.keyword ? String(raw.keyword) : undefined,
        corporateId: raw.corporate_id ? String(raw.corporate_id) : raw.corporateId ? String(raw.corporateId) : undefined,
        projectId: raw.project_id ? String(raw.project_id) : raw.projectId ? String(raw.projectId) : undefined,
        pageSize: Number.isFinite(Number(raw.page_size || raw.pageSize)) ? Number(raw.page_size || raw.pageSize) : undefined,
        generate: raw.generate === true || raw.generate === 'true',
        send: raw.send === true || raw.send === 'true'
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    this.broadcastActivity('tool', `${params.generate ? 'run' : 'check'} AI-CRMS report readiness ${params.targetId}`)
    const result = await this.runIntegrationReportReadiness(params)
    this.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok
          ? `AI-CRMS readiness ${result.run?.status || 'finished'}`
          : `AI-CRMS readiness failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async toolSetIntegrationSchedule(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationTargetScheduleRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        enabled: raw.enabled === true || raw.enabled === 'true',
        intervalMinutes: Number.isFinite(Number(raw.interval_minutes || raw.intervalMinutes))
          ? Number(raw.interval_minutes || raw.intervalMinutes)
          : undefined,
        runKind:
          raw.run_kind === 'migration-dry-run' || raw.runKind === 'migration-dry-run'
            ? 'migration-dry-run'
            : raw.run_kind === 'report-readiness' || raw.runKind === 'report-readiness'
              ? 'report-readiness'
              : raw.run_kind === 'recorded-site-dry-run' || raw.runKind === 'recorded-site-dry-run'
                ? 'recorded-site-dry-run'
                : raw.run_kind === 'safe-default' || raw.runKind === 'safe-default'
                  ? 'safe-default'
                  : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    this.broadcastActivity('tool', `${params.enabled ? 'enable' : 'disable'} integration schedule ${params.targetId}`)
    const result = await this.setIntegrationTargetSchedule(params)
    this.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok
          ? `integration schedule ${result.target?.schedule.enabled ? 'enabled' : 'disabled'}`
          : `integration schedule failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async toolListIntegrationMappings(paramsJson: string): Promise<string> {
    let params: IntegrationMappingListRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        entity: typeof raw.entity === 'string' ? raw.entity as IntegrationMappingListRequest['entity'] : undefined,
        limit: Number.isFinite(Number(raw.limit)) ? Number(raw.limit) : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    const result = await this.listIntegrationMappings(params)
    this.broadcastActivity('tool', `read integration mappings ${params.targetId} (${result.summary.total})`, result.ok)
    return JSON.stringify(result, null, 2)
  }

  private async toolUpsertIntegrationMapping(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationMappingUpsertRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        entity: String(raw.entity || '') as IntegrationMappingUpsertRequest['entity'],
        sourceKey: String(raw.source_key || raw.sourceKey || '').trim(),
        sourceLabel: raw.source_label ? String(raw.source_label) : raw.sourceLabel ? String(raw.sourceLabel) : undefined,
        aiCrmsId: raw.ai_crms_id ? String(raw.ai_crms_id) : raw.aiCrmsId ? String(raw.aiCrmsId) : undefined,
        aiCrmsLabel: raw.ai_crms_label ? String(raw.ai_crms_label) : raw.aiCrmsLabel ? String(raw.aiCrmsLabel) : undefined,
        status: typeof raw.status === 'string' ? raw.status as IntegrationMappingUpsertRequest['status'] : undefined,
        sourceHash: raw.source_hash ? String(raw.source_hash) : raw.sourceHash ? String(raw.sourceHash) : undefined,
        lastSyncedAt: Number.isFinite(Number(raw.last_synced_at || raw.lastSyncedAt)) ? Number(raw.last_synced_at || raw.lastSyncedAt) : undefined,
        metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata as Record<string, unknown> : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    this.broadcastActivity('tool', `upsert integration mapping ${params.targetId || '(missing target)'}`)
    const result = await this.upsertIntegrationMapping(params)
    this.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok ? `integration mapping ${result.mapping?.status || 'saved'}` : `integration mapping failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async toolDeleteIntegrationMapping(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationMappingDeleteRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        entity: String(raw.entity || '') as IntegrationMappingDeleteRequest['entity'],
        sourceKey: String(raw.source_key || raw.sourceKey || '').trim()
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    this.broadcastActivity('tool', `delete integration mapping ${params.targetId || '(missing target)'}`)
    const result = await this.deleteIntegrationMapping(params)
    this.broadcastActivity(
      'tool',
      appendActivityDuration(result.ok ? 'integration mapping deleted' : `delete mapping failed: ${result.error || result.message}`, startedAt),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  private async ensurePersistedCaptureRecordsLoaded(): Promise<void> {
    if (this.editedCaptureRecords || this.capturing || this.traceEvents.length) return
    if (!this.captureRecordLoadPromise) this.captureRecordLoadPromise = this.loadPersistedCaptureRecords()
    await this.captureRecordLoadPromise
  }

  private async loadPersistedCaptureRecords(): Promise<void> {
    if (this.editedCaptureRecords || this.capturing || this.traceEvents.length) return
    const entry = await configStore.get({ domain: CAPTURE_RECORD_CONFIG_DOMAIN, key: CAPTURE_RECORD_CONFIG_KEY }).catch(() => null)
    const saved = normalizePersistedCaptureRecordOptions(entry?.options)
    if (!saved) return
    this.editedCaptureRecords = saved
    this.debugCodex({
      scope: 'agent',
      phase: 'capture-record-load',
      level: 'debug',
      message: 'Loaded persisted edited capture records.',
      detail: { count: saved.records.length, flagged: saved.records.filter((record) => record.flagged).length },
      ts: Date.now()
    })
  }

  private rawCaptureRecords(): IngestRecord[] {
    return this.traceEvents.map((event) => ({ event }))
  }

  private captureRecordsForAgent(): CaptureRecordSource {
    if (this.editedCaptureRecords) {
      return {
        source: 'edited',
        records: this.editedCaptureRecords.records,
        workflow: this.editedCaptureRecords.workflow,
        updatedAt: this.editedCaptureRecords.updatedAt
      }
    }
    return { source: 'raw', records: this.rawCaptureRecords() }
  }

  async listSkills(): Promise<SkillSummary[]> {
    return this.ensureServices().registry.listSkills()
  }

  async deleteSkill(params: { skillId: string }): Promise<DeleteSkillResult> {
    return this.ensureServices().registry.deleteSkill(params.skillId)
  }

  async summarizeSkill(params: { workflow?: string; records: IngestRecord[] }): Promise<SkillCreateResult> {
    const startedAt = Date.now()
    const services = this.ensureServices()
    // Ingest from the renderer's CURRENT, non-deleted records (NOT the raw trace buffer):
    // the user may have pruned noise + annotated steps with per-record specs.
    // NEVER feed error/info events to ingest — they're capture noise, not part of the workflow the
    // skill should learn. The renderer's Ingest button already drops them, but filter here too so
    // the agent's summarize-intent path (which ingests the raw trace buffer) is covered as well.
    const records = (params.records || []).filter((r) => r.event.kind !== 'error' && r.event.kind !== 'info')
    const events = records.map((r) => r.event)
    const specNotes = buildIngestSpecNotes(records)
    this.broadcastActivity('tool', `call generate_skill (${events.length} records)`)
    try {
      const result = await services.generator.summarize(events, this.currentUrl, params.workflow, undefined, specNotes || undefined)
      this.broadcastActivity(
        'tool',
        appendActivityDuration(
          result.ok ? `generate_skill returned ${result.skill?.name || 'skill'}` : `generate_skill failed: ${result.error || result.message}`,
          startedAt
        ),
        result.ok
      )
      return result
    } catch (err) {
      this.broadcastActivity('tool', appendActivityDuration(`generate_skill failed: ${(err as Error).message}`, startedAt), false)
      throw err
    }
  }

  // Cowork `ingest_recording` tool: turn the CURRENT capture (renderer-edited records if present,
  // otherwise raw trace buffer; error/info dropped) into one or MORE skills via the generator's
  // multi-skill split, tell the renderer to refresh the skill list, and return generated skills.
  async ingestRecordingToSkills(): Promise<string> {
    const startedAt = Date.now()
    const capture = this.captureRecordsForAgent()
    const records = capture.records.filter((r) => r.event.kind !== 'error' && r.event.kind !== 'info')
    const events = records.map((r) => r.event)
    const specNotes = buildIngestSpecNotes(records, capture.workflow)
    this.broadcastActivity('tool', `call ingest_recording (${events.length} ${capture.source === 'edited' ? 'edited records' : 'events'})`)
    try {
      const result = await this.ensureServices().generator.summarizeMulti(events, this.currentUrl, specNotes || undefined)
      this.broadcastActivity(
        'tool',
        appendActivityDuration(
          result.ok ? `ingest_recording returned ${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}` : `ingest_recording failed: ${result.message}`,
          startedAt
        ),
        result.ok
      )
      if (result.ok && result.skills.length) {
        this.lastAgentRun = { ...this.lastAgentRun, skill: result.skills[0], skills: result.skills }
        this.broadcastActivity('skill', `generated ${result.skills.map((skill) => skill.name).join(', ')}`)
        xpcMain.broadcast('coach/skills-changed', { ts: Date.now() })
      }
      return result.ok ? result.message : `Ingest failed: ${result.message}`
    } catch (err) {
      this.broadcastActivity('tool', appendActivityDuration(`ingest_recording failed: ${(err as Error).message}`, startedAt), false)
      throw err
    }
  }

  private toolCaptureTimeline(args: Record<string, unknown>): string {
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
    const actionApiLinks = buildActionApiLinks(capture.records, timelineIndex, { windowMs: apiWindowMs, limit: apiWindowLimit })
    const filtered = indexed.filter(({ event }) => timelineKindMatches(event, kind))
    const selected = filtered.slice(-limit)
    const payload = {
      ok: true,
      capturing: this.capturing,
      source: capture.source,
      mode: this.captureMode,
      currentUrl: this.currentUrl,
      traceFile: this.traceFile,
      filter: { kind, limit, include_bodies: includeBodies, include_headers: includeHeaders, api_window_ms: apiWindowMs, api_window_limit: apiWindowLimit },
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
    this.broadcastActivity('tool', `read capture_timeline (${selected.length}/${filtered.length} ${kind})`)
    return clipText(JSON.stringify(payload, null, 2), 32_000)
  }

  private toolCaptureSearch(args: Record<string, unknown>): string {
    const query = String(args.query || '').trim()
    if (!query) return 'ERROR: query is required.'
    const kind = normalizeTimelineKind(args.kind)
    const limit = normalizeTimelineLimit(args.limit)
    const includeBodies = coerceToolBoolean(args.include_bodies)
    const includeHeaders = coerceToolBoolean(args.include_headers)
    const capture = this.captureRecordsForAgent()
    const events = capture.records.map((record) => record.event)
    const timelineIndex = buildTimelineIndex(events)
    const apiWindowMs = normalizeApiWindowMs(args.api_window_ms)
    const apiWindowLimit = normalizeApiWindowLimit(args.api_window_limit)
    const actionApiLinks = buildActionApiLinks(capture.records, timelineIndex, { windowMs: apiWindowMs, limit: apiWindowLimit })
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const matched = capture.records
      .map((record, index) => ({ record, event: record.event, index: index + 1 }))
      .filter(({ record, event }) => timelineKindMatches(event, kind) && timelineSearchMatchesRecord(record, tokens))
    const selected = matched.slice(0, limit)
    const payload = {
      ok: true,
      source: capture.source,
      query,
      filter: { kind, limit, include_bodies: includeBodies, include_headers: includeHeaders, api_window_ms: apiWindowMs, api_window_limit: apiWindowLimit },
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
    this.broadcastActivity('tool', `search capture (${selected.length}/${matched.length})`)
    return clipText(JSON.stringify(payload, null, 2), 32_000)
  }

  private toolCaptureEventDetail(args: Record<string, unknown>): string {
    const includeBodies = coerceToolBoolean(args.include_bodies)
    const includeHeaders = coerceToolBoolean(args.include_headers)
    const around = normalizeTimelineAround(args.around)
    const apiWindowMs = normalizeApiWindowMs(args.api_window_ms)
    const apiWindowLimit = normalizeApiWindowLimit(args.api_window_limit)
    const requestedIndex = Number(args.event_index)
    const requestedRequestId = String(args.request_id || '').trim()
    const capture = this.captureRecordsForAgent()
    const records = capture.records
    const eventsForIndex = records.map((record) => record.event)
    const timelineIndex = buildTimelineIndex(eventsForIndex)
    const actionApiLinks = buildActionApiLinks(records, timelineIndex, { windowMs: apiWindowMs, limit: apiWindowLimit })
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
      if (!matchedIndexes.size) return `ERROR: request_id "${requestedRequestId}" was not found in the current capture memory.`
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
        const event = record.event
        const requestId = timelineRequestId(event)
        const relation = matchedIndexes.has(index) ? 'match' : forcedRelation.get(index) || (requestId && selectedRequestIds.has(requestId) ? 'same_request' : 'context')
        return {
          relation,
          ...summarizeTimelineDetailRecord(record, index, includeBodies, includeHeaders, timelineIndex, actionApiLinks.get(index))
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
        includeBodies ? 'Bodies are captured previews, not guaranteed full payloads for very large/binary/evicted responses.' : 'Payloads are hidden; call again with include_bodies=true only when needed.',
        includeHeaders ? 'Auth/cookie-like header values remain redacted.' : 'Header values are hidden; call again with include_headers=true only when header shape matters.'
      ].filter(Boolean)
    }
    this.broadcastActivity('tool', `read capture_detail (${events.length} events)`)
    return clipText(JSON.stringify(payload, null, 2), 48_000)
  }

  async getSkillDetail(params: { skillId: string }): Promise<SkillDetail | null> {
    return this.ensureServices().registry.readSkillDetail(params.skillId)
  }

  async openSkillDirectory(params: { skillId: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    const skill = this.ensureServices().registry.listSkills().find((item) => item.id === params.skillId)
    if (!skill) return { ok: false, error: 'skill-not-found' }
    const dir = dirname(skill.path)
    const error = await shell.openPath(dir)
    return error ? { ok: false, path: dir, error } : { ok: true, path: dir }
  }

  async exportSkillPackage(params: { skillId: string }): Promise<SkillExportResult> {
    const registry = this.ensureServices().registry
    const skill = registry.listSkills().find((item) => item.id === params.skillId)
    if (!skill) return { ok: false, skillId: params.skillId, message: 'Skill not found.', error: 'not-found' }
    const options: OpenDialogOptions = {
      title: `Export ${skill.name}`,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = this.browserWindow ? await dialog.showOpenDialog(this.browserWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, skillId: params.skillId, message: 'Export cancelled.', canceled: true }
    }
    const exported = registry.exportSkillPackage(params.skillId, result.filePaths[0])
    if (exported.ok && exported.path) shell.showItemInFolder(exported.path)
    return exported
  }

  async importSkillPackage(): Promise<SkillImportResult> {
    const options: OpenDialogOptions = {
      title: 'Import Coach skill package',
      properties: ['openDirectory']
    }
    const result = this.browserWindow ? await dialog.showOpenDialog(this.browserWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, message: 'Import cancelled.', canceled: true }
    }
    const imported = this.ensureServices().registry.importSkillPackage(result.filePaths[0])
    if (imported.ok) xpcMain.broadcast('coach/skills-changed', { ts: Date.now() })
    return imported
  }

  // Reveal the folder that holds ALL skills for a domain (empty domain → skills root).
  async openDomainDirectory(params: { domain: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    const dir = this.ensureServices().registry.domainDirectory(params.domain)
    if (!dir) return { ok: false, error: 'domain-folder-not-found' }
    const error = await shell.openPath(dir)
    return error ? { ok: false, path: dir, error } : { ok: true, path: dir }
  }

  // Register attached files (by ABSOLUTE PATH) into the session's read_file allowlist.
  // The files stay where they are on disk — we stat/validate and remember the paths, so
  // NO bytes ever cross IPC and read_file can't reach anything the user didn't attach.
  async attachFiles(params: { sessionId?: string; paths: string[] }): Promise<AttachFileResult[]> {
    const key = this.agentSessionKey(params.sessionId)
    let allow = this.attachedPaths.get(key)
    if (!allow) {
      allow = new Set<string>()
      this.attachedPaths.set(key, allow)
    }
    const results: AttachFileResult[] = []
    for (const raw of params.paths || []) {
      const abs = resolve(String(raw || ''))
      const name = abs.split(sep).pop() || abs
      if (!raw) {
        results.push({ ok: false, name, path: abs, error: 'empty-path' })
        continue
      }
      try {
        const stats = statSync(abs)
        if (!stats.isFile()) {
          results.push({ ok: false, name, path: abs, error: 'not-a-file' })
          continue
        }
        if (stats.size > MAX_ATTACHMENT_BYTES) {
          results.push({ ok: false, name, path: abs, error: `too-large (${(stats.size / 1024 / 1024).toFixed(1)} MB)` })
          continue
        }
        allow.add(abs)
        results.push({ ok: true, name, path: abs, size: stats.size })
      } catch {
        results.push({ ok: false, name, path: abs, error: 'not-found' })
      }
    }
    return results
  }

  async attachClipboardImage(params?: { sessionId?: string }): Promise<AttachFileResult> {
    const image = clipboard.readImage()
    if (image.isEmpty()) return { ok: false, name: 'clipboard.png', error: 'clipboard-has-no-image' }
    const png = image.toPNG()
    if (!png.length) return { ok: false, name: 'clipboard.png', error: 'clipboard-image-empty' }
    if (png.length > MAX_ATTACHMENT_BYTES) {
      return { ok: false, name: 'clipboard.png', error: `too-large (${(png.length / 1024 / 1024).toFixed(1)} MB)` }
    }
    const key = this.agentSessionKey(params?.sessionId)
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, '_') || 'default'
    const dir = join(coworkDataRoot(), 'attachments', safeKey)
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(dir, `${stamp}-${randomUUID().slice(0, 8)}.png`)
    writeFileSync(file, png)
    const [registered] = await this.attachFiles({ sessionId: params?.sessionId, paths: [file] })
    return registered || { ok: false, name: basename(file), path: file, error: 'register-failed' }
  }

  async scribeAudio(params: AudioScribeRequest): Promise<AudioScribeResult> {
    const startedAt = Date.now()
    const fail = (code: AudioScribeResult['code'], error: string): AudioScribeResult => ({
      ok: false,
      text: '',
      model: AI_CRMS_ASR_MODEL,
      durationMs: Date.now() - startedAt,
      code,
      error
    })
    const session = await aiCrmsSession.getSession().catch(() => null)
    if (!session?.jwt_token) return fail('ai-crms-login-required', 'Sign in to AI-CRMS before using voice scribe.')

    const audioPath = resolve(String(params.path || ''))
    let audioSize = 0
    try {
      const stats = statSync(audioPath)
      if (!stats.isFile()) return fail('audio-not-found', 'Audio file is not a file.')
      if (stats.size <= 0) return fail('invalid-audio', 'Audio file is empty.')
      if (stats.size > MAX_ASR_AUDIO_BYTES) {
        return fail('audio-too-large', `Audio is too large for ASR (${(stats.size / 1024 / 1024).toFixed(1)} MB).`)
      }
      audioSize = stats.size
    } catch {
      return fail('audio-not-found', 'Audio file not found.')
    }

    let stage: 'core-upload' | 'asr-request' = 'core-upload'
    try {
      const format = normalizeAsrFormat(params.format, params.mime)
      const uploadStartedAt = Date.now()
      this.debugCodex({
        scope: 'agent',
        phase: 'ai-crms-asr-upload',
        level: 'info',
        message: 'AI-CRMS ASR audio upload starting.',
        detail: {
          transport: 'core-sts-private-url',
          bytes: audioSize,
          format,
          mimeType: params.mime || 'audio/wav',
          purpose: 'coach_voice_scribe'
        },
        ts: Date.now()
      })
      const upload = await uploadFileThroughAiCrmsCore({
        session,
        path: audioPath,
        mimeType: params.mime || 'audio/wav',
        name: basename(audioPath),
        size: audioSize,
        purpose: 'coach_voice_scribe'
      })
      const audioUrl = upload.fileUrl
      this.debugCodex({
        scope: 'agent',
        phase: 'ai-crms-asr-upload',
        level: 'info',
        message: 'AI-CRMS ASR core upload completed.',
        detail: {
          transport: 'core-sts-private-url',
          durationMs: Date.now() - uploadStartedAt,
          fileId: upload.fileId,
          coreBaseUrl: upload.coreBaseUrl,
          audioUrl: safeUrlForDebug(audioUrl),
          uploadUrl: safeUrlForDebug(upload.uploadUrl)
        },
        ts: Date.now()
      })
      const endpoint = resolveAiCrmsRelayEndpoint(session)
      const url = bailianMultimodalGenerationUrl(endpoint.baseUrl)
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${session.jwt_token}`,
        'Content-Type': 'application/json',
        'x-region': endpoint.region
      }
      if (session.tenant_id) headers['x-workspace-id'] = session.tenant_id
      const parameters: Record<string, unknown> = { format }
      const sampleRate = Math.round(Number(params.sampleRate))
      if (Number.isFinite(sampleRate) && sampleRate > 0) parameters.sample_rate = String(sampleRate)
      const body = {
        model: AI_CRMS_ASR_MODEL,
        input: {
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: audioUrl
                  }
                }
              ]
            }
          ]
        },
        parameters
      }
      this.debugCodex({
        scope: 'agent',
        phase: 'ai-crms-asr-request',
        level: 'info',
        message: 'AI-CRMS ASR request.',
        detail: {
          url,
          model: AI_CRMS_ASR_MODEL,
          transport: 'core-sts-private-url',
          endpoint: 'multimodal-generation.generation',
          format,
          parameters,
          bytes: audioSize,
          fileId: upload.fileId,
          audioUrl: safeUrlForDebug(audioUrl),
          region: endpoint.region,
          headerKeys: Object.keys(headers).sort(),
          hasAuthorizationHeader: true
        },
        ts: Date.now()
      })
      stage = 'asr-request'
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      })
      const text = await res.text()
      let json: unknown = {}
      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        json = { raw: text }
      }
      if (!res.ok) {
        const error = sanitizeRuntimeError(text || `HTTP ${res.status}`, 'AI-CRMS ASR')
        this.debugCodex({
          scope: 'agent',
          phase: 'ai-crms-asr-error',
          level: 'error',
          message: 'AI-CRMS ASR failed.',
          detail: { status: res.status, transport: 'core-sts-private-url', durationMs: Date.now() - startedAt, error },
          ts: Date.now()
        })
        return fail('relay-error', `AI-CRMS ASR HTTP ${res.status}${error ? ` ${error}` : ''}`)
      }
      const transcript = readScribeText(json)
      this.debugCodex({
        scope: 'agent',
        phase: 'ai-crms-asr-response',
        level: transcript ? 'info' : 'warn',
        message: 'AI-CRMS ASR response.',
        detail: {
          durationMs: Date.now() - startedAt,
          status: res.status,
          transport: 'core-sts-private-url',
          outputChars: transcript.length,
          requestId: typeof (json as Record<string, any>)?.request_id === 'string' ? (json as Record<string, any>).request_id : ''
        },
        ts: Date.now()
      })
      if (!transcript) return fail('relay-error', 'AI-CRMS ASR returned no transcript.')
      return {
        ok: true,
        text: transcript,
        model: AI_CRMS_ASR_MODEL,
        durationMs: Date.now() - startedAt
      }
    } catch (err) {
      const error = sanitizeRuntimeError(err instanceof Error ? err.message : String(err), 'AI-CRMS ASR')
      this.debugCodex({
        scope: 'agent',
        phase: stage === 'core-upload' ? 'ai-crms-asr-upload' : 'ai-crms-asr-error',
        level: 'error',
        message: stage === 'core-upload' ? 'AI-CRMS ASR core upload failed.' : 'AI-CRMS ASR failed before response.',
        detail: { transport: 'core-sts-private-url', durationMs: Date.now() - startedAt, error },
        ts: Date.now()
      })
      return fail(stage === 'core-upload' ? 'media-upload-unavailable' : 'relay-error', error)
    } finally {
      cleanupTempFile(audioPath)
    }
  }

  async chooseWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    const options: OpenDialogOptions = {
      title: 'Choose workspace',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = this.browserWindow ? await dialog.showOpenDialog(this.browserWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'cancelled' }
    return await this.setWorkspaceDirectory({ sessionId: params?.sessionId, path: result.filePaths[0] })
  }

  async setWorkspaceDirectory(params: { sessionId?: string; path?: string }): Promise<WorkspaceRefResult> {
    const key = this.agentSessionKey(params.sessionId)
    const raw = String(params.path || '').trim()
    if (!raw) {
      this.clearWorkspaceRef(key)
      await this.persistDefaultWorkspace()
      return { ok: true }
    }
    const abs = resolve(raw)
    try {
      const stats = statSync(abs)
      if (!stats.isDirectory()) return { ok: false, error: 'not-a-directory' }
    } catch {
      this.clearWorkspaceRef(key)
      await this.removeDefaultWorkspaceIfPathMatches(abs)
      return { ok: false, missing: true, error: 'workspace-not-found' }
    }
    const workspace = this.workspaceRefFromPath(abs)
    this.workspaceRefs.set(key, workspace)
    this.workspaceRefs.set('default', workspace)
    await this.persistDefaultWorkspace(workspace)
    this.broadcastWorkspaceChanged(key, workspace)
    return { ok: true, workspace }
  }

  async getWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    const key = this.agentSessionKey(params?.sessionId)
    let workspace = this.workspaceRefs.get(key)
    if (!workspace && key === 'default') {
      workspace = await this.readDefaultWorkspace()
      if (workspace) this.workspaceRefs.set('default', workspace)
    }
    if (!workspace) return { ok: true }
    try {
      const stats = statSync(workspace.path)
      if (!stats.isDirectory()) {
        this.clearWorkspaceRef(key)
        await this.removeDefaultWorkspaceIfPathMatches(workspace.path)
        return { ok: false, missing: true, error: 'workspace-not-directory' }
      }
    } catch {
      this.clearWorkspaceRef(key)
      await this.removeDefaultWorkspaceIfPathMatches(workspace.path)
      return { ok: false, missing: true, error: 'workspace-not-found' }
    }
    const fresh = { ...workspace, exists: true, updatedAt: Date.now() }
    this.workspaceRefs.set(key, fresh)
    if (key === 'default') await this.persistDefaultWorkspace(fresh)
    this.broadcastWorkspaceChanged(key, fresh)
    return { ok: true, workspace: fresh }
  }

  async getFileStatuses(params: { paths: string[] }): Promise<FileStatusResult[]> {
    return (params.paths || []).map((raw) => {
      const abs = resolve(String(raw || ''))
      try {
        const stats = statSync(abs)
        return {
          path: abs,
          exists: true,
          isFile: stats.isFile(),
          size: stats.size
        }
      } catch {
        return {
          path: abs,
          exists: false,
          isFile: false,
          error: 'not-found'
        }
      }
    })
  }

  async openFile(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    const abs = resolve(String(params.path || ''))
    if (!abs || !existsSync(abs)) return { ok: false, path: abs, error: 'not-found' }
    const error = await shell.openPath(abs)
    return error ? { ok: false, path: abs, error } : { ok: true, path: abs }
  }

  async showFileInFolder(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    const abs = resolve(String(params.path || ''))
    if (!abs || !existsSync(abs)) return { ok: false, path: abs, error: 'not-found' }
    shell.showItemInFolder(abs)
    return { ok: true, path: abs }
  }

  private syncWorkspaceFromContext(sessionKey: string, workspace?: WorkspaceRef): void {
    if (!workspace?.path) return
    const current = this.workspaceRefs.get(sessionKey)
    if (current?.path === workspace.path) return
    const abs = resolve(workspace.path)
    try {
      if (!statSync(abs).isDirectory()) return
      this.workspaceRefs.set(sessionKey, {
        path: abs,
        name: workspaceNameForPath(abs),
        exists: true,
        updatedAt: Date.now()
      })
    } catch {
      this.clearWorkspaceRef(sessionKey)
    }
  }

  private workspaceRefFromPath(path: string): WorkspaceRef {
    const abs = resolve(path)
    return {
      path: abs,
      name: workspaceNameForPath(abs),
      exists: true,
      updatedAt: Date.now()
    }
  }

  private async readDefaultWorkspace(): Promise<WorkspaceRef | undefined> {
    const path = await this.readDefaultWorkspacePath()
    if (!path) return undefined
    const abs = resolve(path)
    try {
      if (!statSync(abs).isDirectory()) {
        await this.removeDefaultWorkspaceIfPathMatches(abs)
        return undefined
      }
      return this.workspaceRefFromPath(abs)
    } catch {
      await this.removeDefaultWorkspaceIfPathMatches(abs)
      return undefined
    }
  }

  private async readDefaultWorkspacePath(): Promise<string> {
    const entry = await configStore.get({ domain: WORKSPACE_CONFIG_DOMAIN, key: WORKSPACE_DEFAULT_KEY }).catch(() => null)
    const options = entry?.options as Partial<WorkspaceRef> | null | undefined
    return typeof options?.path === 'string' ? options.path : ''
  }

  private async persistDefaultWorkspace(workspace?: WorkspaceRef): Promise<void> {
    if (!workspace?.path) {
      await configStore.remove({ domain: WORKSPACE_CONFIG_DOMAIN, key: WORKSPACE_DEFAULT_KEY }).catch(() => undefined)
      this.workspaceRefs.delete('default')
      this.broadcastWorkspaceChanged('default')
      return
    }
    const normalized = this.workspaceRefFromPath(workspace.path)
    this.workspaceRefs.set('default', normalized)
    await configStore.upsert({ domain: WORKSPACE_CONFIG_DOMAIN, key: WORKSPACE_DEFAULT_KEY, options: normalized }).catch(() => undefined)
    this.broadcastWorkspaceChanged('default', normalized)
  }

  private async removeDefaultWorkspaceIfPathMatches(path?: string): Promise<void> {
    const target = path ? resolve(path) : ''
    const currentPath = this.workspaceRefs.get('default')?.path || (await this.readDefaultWorkspacePath())
    if (!currentPath || (target && resolve(currentPath) !== target)) return
    await this.persistDefaultWorkspace()
  }

  private resolveWorkspacePath(sessionKey: string, pathArg: string): WorkspacePathResolution {
    const workspace = this.workspaceRefs.get(sessionKey)
    if (!workspace) return { ok: false, root: '', error: 'no-workspace' }
    const root = resolve(workspace.path)
    let realRoot = root
    try {
      if (!statSync(root).isDirectory()) {
        this.clearWorkspaceRef(sessionKey)
        return { ok: false, root, error: 'workspace-not-found' }
      }
      realRoot = realpathSync(root)
    } catch {
      this.clearWorkspaceRef(sessionKey)
      return { ok: false, root, error: 'workspace-not-found' }
    }
    const cleaned = pathArg.trim().replace(/^@/, '')
    const target = cleaned ? (isAbsolute(cleaned) ? resolve(cleaned) : resolve(root, cleaned)) : root
    if (!isInsideRoot(root, target)) return { ok: false, root, error: 'outside-workspace' }
    try {
      const existing = nearestExistingAncestor(target)
      const realExisting = realpathSync(existing)
      if (!isInsideRoot(realRoot, realExisting)) return { ok: false, root, realRoot, error: 'outside-workspace' }
    } catch {
      return { ok: false, root, realRoot, error: 'workspace-path-unavailable' }
    }
    return { ok: true, root, realRoot, path: target, rel: relative(root, target) || '.' }
  }

  // Unconfined resolver for READ / LIST / SEARCH: any ABSOLUTE path is allowed — the OS is the
  // real gate (macOS TCC folder access + filesystem permissions), per Ral's "let the user
  // authorize any folder" model. A RELATIVE path resolves against the selected workspace, else
  // the user's home directory. `root` is only used to render tidy relative paths in output.
  private resolveReadPath(sessionKey: string, pathArg: string): { path: string; root: string } {
    let cleaned = String(pathArg || '').trim().replace(/^@/, '')
    // Expand a leading ~ to the home dir so "~/Downloads/x" works regardless of any selected
    // workspace (Node's path doesn't expand ~). This is how the agent naturally names ~/Downloads etc.
    if (cleaned === '~') cleaned = homedir()
    else if (cleaned.startsWith('~/') || cleaned.startsWith('~\\')) cleaned = join(homedir(), cleaned.slice(2))
    const ws = this.workspaceRefs.get(sessionKey)
    const wsRoot = ws ? resolve(ws.path) : ''
    const base = wsRoot || homedir()
    const path = !cleaned ? base : isAbsolute(cleaned) ? resolve(cleaned) : resolve(base, cleaned)
    const root = wsRoot && isInsideRoot(wsRoot, path) ? wsRoot : path
    return { path, root }
  }

  private recordAgentArtifact(file: AgentFileArtifact): void {
    const existing = this.lastAgentArtifacts.find((item) => item.path === file.path)
    if (existing) {
      existing.action = file.action
      existing.size = file.size
      existing.name = file.name
      return
    }
    this.lastAgentArtifacts.push(file)
  }

  private broadcastWorkspaceChanged(sessionId: string, workspace?: WorkspaceRef): void {
    xpcMain.broadcast('coach/workspace-changed', {
      sessionId,
      workspace,
      ts: Date.now()
    })
  }

  private clearWorkspaceRef(sessionId: string): void {
    this.workspaceRefs.delete(sessionId)
    this.broadcastWorkspaceChanged(sessionId)
  }

  // read_file tool body: reads any file the OS lets us — an attached "@/abs/path", any absolute
  // path, or a path relative to the selected workspace / home. The gate is the OS (macOS TCC +
  // filesystem permissions), so a first read of a protected folder may trigger the macOS prompt;
  // if it's denied we return a one-line hint to authorize + retry (never throws the turn).
  private async toolReadFile(sessionKey: string, pathArg: string, options: { offset?: number; limit?: number }): Promise<string> {
    const trimmed = pathArg.trim().replace(/^@/, '')
    if (!trimmed) return 'ERROR: read_file needs a "path" (an attached @/abs/path, an absolute path, or a workspace-relative path).'
    const target = this.resolveReadPath(sessionKey, trimmed).path
    try {
      const stats = statSync(target)
      if (!stats.isFile()) return `ERROR: "${pathArg}" is not a file.`
      return await readFileForAgent(target, options)
    } catch (err) {
      if (err instanceof FileReadError) return `ERROR: ${err.message}`
      if (isPermissionError(err)) return `ERROR: no permission to read "${trimmed}".${FOLDER_AUTH_HINT}`
      return `ERROR: could not read "${trimmed}": ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private async toolListWorkspaceFiles(sessionKey: string, pathArg?: string, maxEntriesArg?: number): Promise<string> {
    const resolved = this.resolveReadPath(sessionKey, String(pathArg || ''))
    try {
      const stats = await statAsync(resolved.path)
      if (!stats.isDirectory()) return `ERROR: "${resolved.path}" is not a directory.`
      const maxEntries = Math.max(1, Math.min(300, Math.round(maxEntriesArg || 120)))
      const entries = (await readdir(resolved.path, { withFileTypes: true }))
        .filter((entry) => !entry.isDirectory() || !WORKSPACE_SKIP_DIRS.has(entry.name))
        .slice(0, maxEntries)
        .map((entry) => ({
          name: entry.name,
          path: relative(resolved.root, join(resolved.path, entry.name)) || entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
        }))
      return JSON.stringify({ ok: true, root: resolved.root, dir: resolved.path, entries }, null, 2)
    } catch (err) {
      if (isPermissionError(err)) return `ERROR: no permission to list "${resolved.path}".${FOLDER_AUTH_HINT}`
      return `ERROR: could not list "${resolved.path}": ${err instanceof Error ? err.message : String(err)}`
    }
  }

  // Async on purpose: every readdir/stat/readFile awaits, so the main event loop stays free to
  // flush thinking/tooling activity to the UI during a scan; a wall-clock budget + dir/depth caps
  // keep a huge tree from running (and appearing to hang) forever.
  private async toolSearchWorkspaceFiles(sessionKey: string, queryArg: string, pathArg?: string, maxResultsArg?: number): Promise<string> {
    const query = String(queryArg || '').trim()
    if (!query) return this.toolListWorkspaceFiles(sessionKey, String(pathArg || ''), maxResultsArg)
    const terms = workspaceSearchTerms(query)
    if (!terms.length) return this.toolListWorkspaceFiles(sessionKey, String(pathArg || ''), maxResultsArg)
    const resolved = this.resolveReadPath(sessionKey, String(pathArg || ''))
    try {
      if (!(await statAsync(resolved.path)).isDirectory()) return `ERROR: "${resolved.path}" is not a directory.`
    } catch (err) {
      if (isPermissionError(err)) return `ERROR: no permission to search "${resolved.path}".${FOLDER_AUTH_HINT}`
      return `ERROR: could not search "${resolved.path}": ${err instanceof Error ? err.message : String(err)}`
    }
    const maxResults = Math.max(1, Math.min(WORKSPACE_SEARCH_MAX_RESULTS, Math.round(maxResultsArg || WORKSPACE_SEARCH_MAX_RESULTS)))
    const deadline = Date.now() + READ_SEARCH_BUDGET_MS
    const hits: WorkspaceSearchHit[] = []
    let dirsVisited = 0
    let permissionBlocked = false
    let timedOut = false
    const pushHit = (hit: WorkspaceSearchHit): void => {
      if (hits.length >= maxResults) return
      hits.push({ ...hit, matches: terms })
    }
    const visit = async (dir: string, depth: number): Promise<void> => {
      if (hits.length >= maxResults || dirsVisited >= READ_SEARCH_MAX_DIRS || timedOut) return
      if (Date.now() > deadline) {
        timedOut = true
        return
      }
      dirsVisited += 1
      let entries: Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (err) {
        if (isPermissionError(err)) permissionBlocked = true
        return
      }
      for (const entry of entries) {
        if (hits.length >= maxResults || timedOut) break
        if (Date.now() > deadline) {
          timedOut = true
          break
        }
        const abs = join(dir, entry.name)
        const rel = relative(resolved.root, abs)
        if (entry.isDirectory()) {
          if (depth < READ_SEARCH_MAX_DEPTH && !WORKSPACE_SKIP_DIRS.has(entry.name)) await visit(abs, depth + 1)
          continue
        }
        if (!entry.isFile()) continue
        if (workspaceTextMatches(`${entry.name}\n${rel}`, terms)) {
          pushHit({ path: rel, name: entry.name, kind: 'name' })
          if (hits.length >= maxResults) break
        }
        const ext = fileExtension(entry.name)
        if (!WORKSPACE_TEXT_EXTS.has(ext)) continue
        try {
          const stats = await statAsync(abs)
          if (stats.size > WORKSPACE_TEXT_SCAN_BYTES) continue
          const lines = (await readFileAsync(abs, 'utf8')).split(/\r?\n/)
          const index = lines.findIndex((line) => workspaceTextMatches(line, terms))
          if (index >= 0) {
            pushHit({
              path: rel,
              name: entry.name,
              kind: 'content',
              line: index + 1,
              preview: lines[index].trim().slice(0, 220)
            })
          }
        } catch {
          /* skip unreadable files */
        }
      }
    }
    await visit(resolved.path, 0)
    const notes: string[] = []
    if (permissionBlocked) notes.push(`Some subfolders were skipped for lack of permission.${FOLDER_AUTH_HINT}`)
    if (timedOut) notes.push(`Search stopped after ${Math.round(READ_SEARCH_BUDGET_MS / 1000)}s — narrow the path or query for complete results.`)
    const note = notes.length ? notes.join(' ') : undefined
    return JSON.stringify({ ok: true, root: resolved.path, query, terms, results: hits, ...(note ? { note } : {}) }, null, 2)
  }

  private toolWriteWorkspaceFile(sessionKey: string, pathArg: string, contentArg: string): string {
    const resolved = this.resolveWorkspacePath(sessionKey, String(pathArg || ''))
    if (!resolved.ok || !resolved.path) return `ERROR: ${resolved.error || 'workspace unavailable'}`
    if (resolved.path === resolved.root) return 'ERROR: write_file needs a file path under the workspace, not the workspace directory itself.'
    try {
      if (existsSync(resolved.path) && statSync(resolved.path).isDirectory()) return `ERROR: "${resolved.rel}" is a directory. write_file can only create or update files.`
      const parent = dirname(resolved.path)
      if (!isInsideRoot(resolved.root, parent)) return 'ERROR: target directory is outside the workspace.'
      const existed = existsSync(resolved.path)
      mkdirSync(parent, { recursive: true })
      writeFileSync(resolved.path, String(contentArg ?? ''), 'utf8')
      const stats = statSync(resolved.path)
      const artifact: AgentFileArtifact = {
        name: basename(resolved.path),
        path: resolved.path,
        action: existed ? 'updated' : 'created',
        size: stats.size
      }
      this.recordAgentArtifact(artifact)
      return JSON.stringify({ ok: true, file: artifact }, null, 2)
    } catch (err) {
      return `ERROR: could not write "${resolved.rel || pathArg}": ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private async toolCreateArtifact(sessionKey: string, artifactJson: string): Promise<string> {
    const workspace = this.resolveWorkspacePath(sessionKey, '')
    const workspaceRoot = workspace.ok ? workspace.root : undefined
    const result = await writeArtifactFromJson({
      userDataPath: coworkDataRoot(),
      sessionKey,
      workspaceRoot,
      artifactJson
    })
    if (!result.ok || !result.path) return `ERROR: ${result.error || 'could not create artifact'}`
    const artifact: AgentFileArtifact = {
      name: result.name || basename(result.path),
      path: result.path,
      action: result.action || 'created',
      size: result.size
    }
    this.recordAgentArtifact(artifact)
    return JSON.stringify(
      {
        ok: true,
        file: artifact,
        type: result.type,
        output_root: result.root,
        workspace: workspace.ok ? workspace.root : null
      },
      null,
      2
    )
  }

  private async toolWorkspaceContext(sessionKey: string, actionArg: string): Promise<string> {
    const action = String(actionArg || 'status').trim().toLowerCase()
    if (action === 'clear' || action === 'remove' || action === 'unset') {
      this.clearWorkspaceRef(sessionKey)
      return JSON.stringify({ ok: true, action: 'clear', workspace: null }, null, 2)
    }
    if (action === 'choose' || action === 'switch' || action === 'set') {
      const result = await this.chooseWorkspaceDirectory({ sessionId: sessionKey })
      return JSON.stringify({ action: 'choose', ...result }, null, 2)
    }
    const result = await this.getWorkspaceDirectory({ sessionId: sessionKey })
    return JSON.stringify({ action: 'status', ...result, workspace: result.workspace || null }, null, 2)
  }

  async trainSkill(params: { skillId: string; guidance: string }): Promise<SkillCreateResult> {
    return await this.ensureServices().generator.train(params.skillId, params.guidance)
  }

  async replaySkill(params: { skillId: string; variables: Record<string, string> }): Promise<ReplayResult> {
    const recipe = this.ensureServices().registry.readRecipe(params.skillId)
    if (!recipe) {
      return { ok: false, skillId: params.skillId, stepsRun: 0, errors: ['Skill recipe not found.'] }
    }
    if (!this.replayEngine) {
      return { ok: false, skillId: params.skillId, stepsRun: 0, errors: ['Browser view is not ready.'] }
    }
    const result = await this.replayRecipe(recipe, params.variables || {})
    this.emit({
      kind: result.ok ? 'info' : 'error',
      msg: result.ok
        ? `replay completed: ${result.stepsRun} steps`
        : `replay failed: ${result.errors.join('; ')}`,
      ts: Date.now()
    })
    return result
  }

  async sendAgentMessage(params: { message: string; sessionId?: string; context?: AgentConversationContext }): Promise<AgentReply> {
    const message = params.message.trim()
    if (!message) return { ok: false, text: 'Empty message.', ts: Date.now(), error: 'empty-message' }
    // Renderer supplies compacted older context plus recent verbatim turns so model-window
    // changes can continue a chat without relying on an oversized pi-native history.
    let reply: AgentReply
    try {
      await this.ensurePersistedCaptureRecordsLoaded()
      reply = await this.routeAgentMessage(message, params.sessionId, params.context)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      reply = {
        ok: false,
        text: describeAgentPromptError(this.activeLlmProvider, this.activeLlmModel, error),
        ts: Date.now(),
        error
      }
    }
    this.debugCodex({
      scope: 'agent',
      phase: 'agent-reply',
      level: reply.ok ? 'info' : 'warn',
      message: 'agent reply returned to renderer.',
      detail: {
        sessionId: this.agentSessionKey(params.sessionId),
        ok: reply.ok,
        textChars: reply.text?.length || 0,
        error: reply.error
      },
      ts: Date.now()
    })
    return reply
  }

  async compactConversation(params: AgentCompactRequest): Promise<AgentCompactReply> {
    const maxSummaryChars = Math.max(800, Math.min(500_000, Math.round(params.maxSummaryChars || 6000)))
    if (!params.messages?.length && !params.previousSummary?.trim()) {
      return { ok: false, summary: '', ts: Date.now(), error: 'nothing-to-compact' }
    }
    const prompt = buildConversationCompactPrompt({ ...params, maxSummaryChars })
    try {
      this.ensureServices()
      const result = await this.piGen!.oneShot(prompt, 120_000)
      const summary = normalizeCompactSummary(result.text || '', maxSummaryChars)
      if (!result.ok || !summary) {
        return {
          ok: false,
          summary: '',
          ts: Date.now(),
          error: result.error || result.errorMessage || 'compact-summary-empty'
        }
      }
      return { ok: true, summary, ts: Date.now() }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { ok: false, summary: '', ts: Date.now(), error }
    }
  }

  // Delegate chat: the agent acts AS the user toward the user's CUSTOMER (the message sender).
  // Same tools/flow as Cowork (handleAgentTurn) but its OWN session + customer-facing persona.
  async delegateMessage(params: { message: string; sessionId?: string }): Promise<AgentReply> {
    const message = params.message.trim()
    if (!message) return { ok: false, text: 'Empty message.', ts: Date.now(), error: 'empty-message' }
    await this.loadHostToolPolicies()
    return await this.handleAgentTurn(message, this.getDelegateAgent(params.sessionId))
  }

  async resetDelegateConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    this.lastAgentRun = {}
    this.getExistingDelegateAgent(params?.sessionId)?.reset()
    return { ok: true }
  }

  // Stop a chat channel's in-flight turn (the Stop button): aborts the live pi session so the
  // pending turn resolves with any partial output, then BaseAgent drops that session so aborted
  // output is not carried into later model context. No-op when idle / not yet created.
  async abortAgent(params?: { sessionId?: string }): Promise<void> {
    this.hydratedCoworkAgentSessions.delete(this.agentSessionKey(params?.sessionId))
    await this.getExistingCoworkAgent(params?.sessionId)?.abort()
  }

  async abortTrainer(params?: { sessionId?: string }): Promise<void> {
    await this.getExistingTrainerAgent(params?.sessionId)?.abort()
  }

  async abortDelegate(params?: { sessionId?: string }): Promise<void> {
    await this.getExistingDelegateAgent(params?.sessionId)?.abort()
  }

  private agentSessionKey(sessionId?: string): string {
    return sessionId?.trim() || 'default'
  }

  private assertAgentRuntimeActive(): void {
    if (this.shuttingDown) throw new Error('Cowork runtime is shutting down.')
  }

  private configureAgent<T extends BaseAgent>(agent: T): T {
    agent.setTarget(this.activeLlmProvider, this.activeLlmModel, this.activeLlmEffort)
    return agent
  }

  private broadcastAgentStream(sessionId: string, delta: string): void {
    if (!delta) return
    xpcMain.broadcast('coach/agent-stream', { sessionId: this.agentSessionKey(sessionId), delta, ts: Date.now() })
  }

  private broadcastAgentThinking(sessionId: string, state: Omit<AgentThinkingState, 'sessionId'>): void {
    xpcMain.broadcast('coach/agent-thinking', {
      sessionId: this.agentSessionKey(sessionId),
      active: state.active,
      ts: state.ts || Date.now()
    })
  }

  private relayAgentActivity = (step: AgentActivityStep): void => {
    this.broadcastActivity(step.phase, step.label, step.ok)
  }

  private getCoworkAgent(sessionId?: string): CoworkAgent {
    this.assertAgentRuntimeActive()
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.ensureServices().pi
    let agent = this.coworkAgents.get(key)
    if (!agent) {
      agent = this.configureAgent(
        new CoworkAgent({
          buildTools: () => this.buildPiTools({ ingest: true, sessionKey: key }),
          authPath: coworkAuthPath(),
          modelsPath: coworkModelsPath(),
          onDebug: this.debugCodex,
          onActivity: this.relayAgentActivity,
          onThinking: (state) => this.broadcastAgentThinking(key, state),
          onStream: (delta) => this.broadcastAgentStream(key, delta)
        })
      )
      this.coworkAgents.set(key, agent)
    }
    return agent
  }

  private getTrainerAgent(sessionId?: string): CoachAgent {
    this.assertAgentRuntimeActive()
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.ensureServices().piTrainer
    let agent = this.trainerAgents.get(key)
    if (!agent) {
      agent = this.configureAgent(
        new CoachAgent({
          buildTools: () => this.buildTrainerTools(),
          authPath: coworkAuthPath(),
          modelsPath: coworkModelsPath(),
          onDebug: this.debugCodex,
          onActivity: this.relayAgentActivity
        })
      )
      this.trainerAgents.set(key, agent)
    }
    return agent
  }

  private getDelegateAgent(sessionId?: string): DelegateAgent {
    this.assertAgentRuntimeActive()
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.ensureServices().piDelegate
    let agent = this.delegateAgents.get(key)
    if (!agent) {
      agent = this.configureAgent(
        new DelegateAgent({
          buildTools: () => this.buildPiTools({ sessionKey: key }),
          authPath: coworkAuthPath(),
          modelsPath: coworkModelsPath(),
          onDebug: this.debugCodex,
          onActivity: this.relayAgentActivity
        })
      )
      this.delegateAgents.set(key, agent)
    }
    return agent
  }

  private getExistingCoworkAgent(sessionId?: string): CoworkAgent | null {
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.pi
    return this.coworkAgents.get(key) ?? null
  }

  private getExistingTrainerAgent(sessionId?: string): CoachAgent | null {
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.piTrainer
    return this.trainerAgents.get(key) ?? null
  }

  private getExistingDelegateAgent(sessionId?: string): DelegateAgent | null {
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.piDelegate
    return this.delegateAgents.get(key) ?? null
  }

  // Apply the LLM backend to every pi instance (each drops its session so the
  // next turn rebuilds against the new provider/model/effort).
  applyLlmTarget(provider: string, model: string, effort: LlmEffort = 'low'): void {
    this.activeLlmProvider = provider
    this.activeLlmModel = model
    this.activeLlmEffort = effort
    this.piGen?.setTarget(provider, model, effort)
    this.pi?.setTarget(provider, model, effort)
    this.piTrainer?.setTarget(provider, model, effort)
    this.piDelegate?.setTarget(provider, model, effort)
    for (const agent of this.coworkAgents.values()) agent.setTarget(provider, model, effort)
    for (const agent of this.trainerAgents.values()) agent.setTarget(provider, model, effort)
    for (const agent of this.delegateAgents.values()) agent.setTarget(provider, model, effort)
    this.hydratedCoworkAgentSessions.clear()
  }


  getLlmRuntimeTarget(): LlmStoredTarget {
    return { provider: this.activeLlmProvider, model: this.activeLlmModel, effort: this.activeLlmEffort }
  }

  resetLlmTurnState(): void {
    this.lastAgentRun = {}
    this.lastTrainerRun = {}
  }

  resetLlmAgentSessions(): void {
    this.pi?.reset()
    this.piTrainer?.reset()
    this.piDelegate?.reset()
    this.piGen?.reset()
    for (const agent of this.coworkAgents.values()) agent.reset()
    for (const agent of this.trainerAgents.values()) agent.reset()
    for (const agent of this.delegateAgents.values()) agent.reset()
    this.hydratedCoworkAgentSessions.clear()
  }

  readCoworkSettings(): CoachSettings {
    return this.ensureServices().settings.read()
  }

  saveCoworkSettings(patch: Partial<CoachSettings>): CoachSettings {
    return this.ensureServices().settings.save(patch)
  }

  emitTrace(e: TraceEvent): void {
    this.emit(e)
  }

  async openAiCrmsLoginTab(): Promise<void> {
    const tab = this.tabs.find((item) => item.kind === 'ai-crms' && item.pinned) || this.tabs[0]
    if (!tab) return
    await this.activateTab({ id: tab.id })
    const wc = tab.view?.webContents
    tab.url = AI_CRMS_LOGIN_URL
    this.currentUrl = AI_CRMS_LOGIN_URL
    this.broadcastTabs()
    xpcMain.broadcast('coach/nav', AI_CRMS_LOGIN_URL)
    if (wc && !wc.isDestroyed()) {
      await wc.loadURL(AI_CRMS_LOGIN_URL).catch((err) => {
        if (!wc.isDestroyed()) this.emit({ kind: 'error', msg: 'AI-CRMS login: ' + (err as Error).message, ts: Date.now() })
      })
    }
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

  private async buildAgentMediaInput(sessionKey: string, attachedPaths?: string[]): Promise<{ media?: AgentRuntimeMediaRef[]; images?: AgentRuntimeImage[]; note: string }> {
    const paths = (attachedPaths || []).map((item) => resolve(String(item || ''))).filter(Boolean)
    if (!paths.length) return { note: '' }
    const allow = this.attachedPaths.get(sessionKey)
    const media: AgentRuntimeMediaRef[] = []
    const skipped: string[] = []
    for (const path of paths) {
      if (media.length >= MAX_AGENT_MEDIA_REFS) {
        skipped.push(`${basename(path)} (too many media refs)`)
        continue
      }
      if (!allow?.has(path)) {
        skipped.push(`${basename(path)} (not registered)`)
        continue
      }
      const mimeType = agentMediaMimeForPath(path)
      const isImage = Boolean(AGENT_IMAGE_MIME_BY_EXT[extname(path).toLowerCase()])
      try {
        const stats = statSync(path)
        if (!stats.isFile()) {
          skipped.push(`${basename(path)} (not a file)`)
          continue
        }
        if (isImage && stats.size > MAX_AGENT_IMAGE_BYTES) {
          skipped.push(`${basename(path)} (${(stats.size / 1024 / 1024).toFixed(1)} MB > 8 MB)`)
          continue
        }
        const ref: AgentRuntimeMediaRef = {
          kind: isImage ? 'image' : 'file',
          path,
          mimeType,
          name: basename(path),
          size: stats.size
        }
        media.push(ref)
      } catch {
        skipped.push(`${basename(path)} (unreadable)`)
      }
    }
    const uploadWarnings: string[] = []
    let refs = media
    if (mediaTransportForProvider(this.activeLlmProvider) === 'url' && media.some((item) => item.path && !item.url)) {
      const upload = await uploadMediaRefsForProvider({
        providerId: this.activeLlmProvider,
        refs: media,
        session: await this.mediaUploadSessionForProvider(this.activeLlmProvider)
      })
      refs = upload.refs
      uploadWarnings.push(...upload.warnings)
      if (upload.uploaded > 0) this.broadcastActivity('tool', `uploaded ${upload.uploaded} media ref${upload.uploaded === 1 ? '' : 's'} for URL transport`)
    }
    const resolved = resolveRuntimeMediaRefs({
      providerId: this.activeLlmProvider,
      modelId: this.activeLlmModel,
      media: refs,
      maxImages: MAX_AGENT_IMAGES
    })
    if (media.length > 0) this.broadcastActivity('tool', `attached ${media.length} media path ref${media.length === 1 ? '' : 's'}`)
    const parts: string[] = []
    if (resolved.labels.length) {
      parts.push(`Attached media references (preferred transport: ${resolved.transport}):\n` + resolved.labels.map((item) => `- ${item}`).join('\n'))
    }
    const warnings = [...uploadWarnings, ...resolved.warnings]
    if (warnings.length) parts.push('Attached media transport warnings:\n' + warnings.map((item) => `- ${item}`).join('\n'))
    if (skipped.length) parts.push('Attached media skipped:\n' + skipped.map((item) => `- ${item}`).join('\n'))
    return {
      media: resolved.media.length ? resolved.media : undefined,
      images: resolved.images.length ? resolved.images : undefined,
      note: parts.length ? '\n\n' + parts.join('\n') : ''
    }
  }

  private async mediaUploadSessionForProvider(providerId: string): Promise<AuthSession | null> {
    if (providerId.trim().toLowerCase() !== 'ai-crms') return null
    return await aiCrmsSession.getSession().catch(() => null)
  }

  private async routeAgentMessage(message: string, sessionId?: string, context?: AgentConversationContext): Promise<AgentReply> {
    await this.loadHostToolPolicies()
    const sessionKey = this.agentSessionKey(sessionId)
    this.syncWorkspaceFromContext(sessionKey, context?.workspace)
    const includeConversationMemory = !this.hydratedCoworkAgentSessions.has(sessionKey)
    const mediaInput = await this.buildAgentMediaInput(sessionKey, context?.attachedPaths)
    // The embedded agent runtime owns the ReAct loop — including skill generation via
    // ingest_recording, which is surfaced as a normal internal tool call.
    return await this.handleAgentTurn(message, this.getCoworkAgent(sessionId), context, {
      includeConversationMemory,
      mediaInput,
      onAgentSessionUsed: () => this.hydratedCoworkAgentSessions.add(sessionKey)
    })
  }

  // One agent turn: deterministic regex fast path first (model-free, keeps the demo
  // smoke deterministic), else hand the message to the selected agent runtime.
  private async handleAgentTurn(
    message: string,
    agent: BaseAgent,
    context?: AgentConversationContext,
    options?: {
      includeConversationMemory?: boolean
      mediaInput?: { media?: AgentRuntimeMediaRef[]; images?: AgentRuntimeImage[]; note: string }
      onAgentSessionUsed?: () => void
    }
  ): Promise<AgentReply> {
    const services = this.ensureServices()
    // Only skills recorded on the CURRENT page's domain are loadable here — a
    // skill from another site is never offered or matched.
    const recordings = services.registry.listSkillsForDomain(this.currentUrl)

    // No recorded skill for this domain is NOT a dead end: the agent always has the
    // browser_use fallback (page_snapshot + ui_act) to observe and operate the page
    // directly, so it works with zero recorded skills. Never bail here — recorded skills
    // are a shortcut, not a requirement.

    const skillBriefs = recordings.map((skill) => {
      const recipe = services.registry.readRecipe(skill.id)
      const seed = recipe ? extractVariablesFromMessage(message, recipe) : {}
      const missing = recipe ? requiredInputNames(recipe).filter((name) => !seed[name]) : []
      return {
        id: skill.id,
        name: skill.name,
        triggers: skill.triggers,
        description: skill.description,
        inputs: skill.inputs,
        seed,
        missing
      }
    })

    // Deterministic fast path (LLM-free): any skill whose required inputs the
    // regex already fully fills.
    for (const candidate of recordings) {
      const recipe = services.registry.readRecipe(candidate.id)
      if (!recipe) continue
      const seed = extractVariablesFromMessage(message, recipe)
      if (hasRequiredInputs(recipe) && requiredInputsSatisfied(recipe, seed)) {
        const replay = await this.replaySkill({ skillId: candidate.id, variables: seed })
        return this.replayReply(candidate, seed, replay)
      }
    }

    this.lastAgentRun = {}
    this.lastAgentArtifacts = []
    this.tabsOpenedThisTurn = []
    const turnMedia = options?.mediaInput || { note: '' }
    const result = await agent.prompt(
      buildAgentTurnPrompt({
        message,
        context,
        includeConversationMemory: Boolean(options?.includeConversationMemory),
        nowIso: new Date().toISOString(),
        currentUrl: this.currentUrl,
        briefs: skillBriefs
      }) + turnMedia.note,
      undefined,
      { freshSession: false, media: turnMedia.media, images: turnMedia.images }
    )
    if (result.ok) options?.onAgentSessionUsed?.()
    const { skill, skills, replay } = this.lastAgentRun
    const files = this.lastAgentArtifacts.slice()
    if (!result.ok) {
      const error = result.error || 'Agent failed.'
      return { ok: false, text: describeAgentPromptError(this.activeLlmProvider, this.activeLlmModel, error), ts: Date.now(), skill, skills, replay, files, error: 'agent-failed' }
    }
    if (replay) {
      return {
        ok: replay.ok,
        text: result.text || (replay.ok ? '✓ Done.' : '✗ Failed.'),
        ts: Date.now(),
        skill,
        skills,
        replay,
        files,
        error: replay.ok ? undefined : 'replay-failed'
      }
    }
    const backend = `${providerLabel(this.activeLlmProvider)} (${this.activeLlmModel})`
    // The provider rejected the request (e.g. a 403) — surface the real cause.
    if (result.errorMessage) {
      return { ok: false, text: describeModelError(this.activeLlmProvider, this.activeLlmModel, result.errorMessage), ts: Date.now(), skill, skills, files, error: 'model-error' }
    }
    // The agent produced no tool action. If it also returned no text, surface a
    // diagnostic instead of a misleading "OK.".
    if (result.text) {
      return { ok: true, text: result.text, ts: Date.now(), skill, skills, files }
    }
    // No text, no tool calls, no stop reason → the model returned an empty completion.
    const modelReturnedNothing = (result.toolCalls ?? 0) === 0 && !result.stopReason
    const text = modelReturnedNothing
      ? `${backend} returned an empty response (no text, no action). This usually means that subscription is rate-limited or temporarily unavailable — wait a bit and retry, or switch the model from the provider selector. It is not a problem with the skill or this page.`
      : `The assistant (${backend}) ended without acting (stop: ${result.stopReason || 'unknown'}, tools used: ${result.toolCalls ?? 0}). Try a clearer instruction, make sure the page is logged in, or re-record the skill if its steps no longer fit this page.`
    return { ok: false, text, ts: Date.now(), skill, skills, files, error: 'empty-agent-turn' }
  }

  // Skill TRAINER chat: a pi agent whose tools do skill CRUD (create / update /
  // optimize / delete) — it never invokes skills, and same-name skills are
  // versioned (old archived) rather than duplicated. Its session is separate from
  // the invocation agent's, so the two conversations never mix.
  async trainerMessage(params: { message: string; sessionId?: string; files?: { name: string; content: string }[] }): Promise<AgentReply> {
    const message = params.message.trim()
    if (!message) return { ok: false, text: 'Empty message.', ts: Date.now(), error: 'empty-message' }
    const services = this.ensureServices()
    await this.ensurePersistedCaptureRecordsLoaded()
    await this.loadHostToolPolicies()
    const trainer = this.getTrainerAgent(params.sessionId)
    this.lastTrainerRun = {}
    // Attached files (md only for now) arrive as parsed text — fold their content into the turn
    // so the trainer can use them as reference / source for the skill it builds.
    const files = (params.files || []).filter((f) => f && f.name && typeof f.content === 'string')
    const withFiles = files.length
      ? files.map((f) => `# Attached file: ${f.name}\n\n${f.content}`).join('\n\n') + `\n\n---\n\n${message}`
      : message
    const result = await trainer.prompt(
      buildTrainerTurnPrompt({
        message: withFiles,
        skills: services.registry.promptContext(this.currentUrl) || '(none)',
        recording: summarizeRecordsForTrainer(this.captureRecordsForAgent().records),
        currentUrl: this.currentUrl
      })
    )
    if (!result.ok) {
      const error = result.error || 'Trainer is unavailable.'
      return { ok: false, text: describeAgentPromptError(this.activeLlmProvider, this.activeLlmModel, error), ts: Date.now(), error: 'trainer-failed' }
    }
    const skill = this.lastTrainerRun.skill
    // Surface a provider rejection (e.g. Codex unreachable / blocked) instead of a bare "OK.".
    if (!skill && result.errorMessage) {
      return { ok: false, text: describeModelError(this.activeLlmProvider, this.activeLlmModel, result.errorMessage), ts: Date.now(), error: 'model-error' }
    }
    this.emit({ kind: 'info', msg: `trainer: ${skill ? `updated ${skill.name}` : 'reply'}`, ts: Date.now() })
    return { ok: true, text: result.text || 'OK.', ts: Date.now(), skill }
  }

  async resetTrainerConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    this.lastTrainerRun = {}
    this.getExistingTrainerAgent(params?.sessionId)?.reset()
    return { ok: true }
  }

  // The trainer agent's CRUD tools. Mutations record the touched skill on
  // lastTrainerRun so the reply carries it (the renderer refreshes its list).
  private buildTrainerTools(): PiToolSpec[] {
    return this.wrapHostTools('trainer', [
      this.buildHostToolCatalogTool('trainer'),
      ...this.buildCaptureAnalysisTools(),
      {
        name: 'get_skill_detail',
        description: "Read a skill's full detail (description, triggers, inputs, body) before deciding how to change it.",
        params: [{ name: 'skill_id', required: true, description: 'Skill id from the existing-skills list.' }],
        execute: async (args) => this.trainerToolDetail(String(args.skill_id ?? ''))
      },
      {
        name: 'create_or_update_skill',
        description:
          'Create a skill from the CURRENT RECORDING after inspecting capture evidence (or update the same-named skill — the previous version is archived automatically). guidance steers the name, triggers, and intent.',
        params: [{ name: 'guidance', required: false, description: 'Operator goal/guidance steering the generated skill.' }],
        execute: async (args) => this.trainerToolCreate(typeof args.guidance === 'string' ? args.guidance : '')
      },
      {
        name: 'optimize_skill',
        description: "Refine an EXISTING skill's metadata/notes per guidance; the previous version is archived automatically.",
        params: [
          { name: 'skill_id', required: true, description: 'Skill id to optimize.' },
          { name: 'guidance', required: true, description: 'What to improve or change.' }
        ],
        execute: async (args) => this.trainerToolOptimize(String(args.skill_id ?? ''), String(args.guidance ?? ''))
      },
      {
        name: 'delete_skill',
        description: 'Delete an existing skill by id. Destructive — only when the user clearly asks for removal.',
        params: [{ name: 'skill_id', required: true, description: 'Skill id to delete.' }],
        execute: async (args) => this.trainerToolDelete(String(args.skill_id ?? ''))
      }
    ])
  }

  private buildCaptureAnalysisTools(): PiToolSpec[] {
    return [
      {
        name: 'capture_timeline',
        description:
          'Read the CURRENT capture timeline as structured JSON: UI actions/snapshots and API requests/responses interleaved in time. ' +
          'Use this before create_or_update_skill/ingest_recording when the user asks what was captured, which API backs a UI action, why a recording failed, or to summarize the business flow. ' +
          'Default output redacts payload/header values; set include_bodies/include_headers only when needed for diagnosis or skill design.',
        params: [
          { name: 'kind', required: false, description: 'Filter: all, ui, api, snapshot, error. Default all.' },
          { name: 'limit', type: 'number', required: false, description: 'Last N matched events to return (default 80, max 200).' },
          { name: 'api_window_ms', type: 'number', required: false, description: 'For UI actions, include likely API requests after the action within this window (default 5000, max 30000; 0 disables).' },
          { name: 'api_window_limit', type: 'number', required: false, description: 'Max likely API links per UI action (default 6, max 20).' },
          { name: 'include_bodies', type: 'boolean', required: false, description: 'Include clipped request/response bodies and UI fill values.' },
          { name: 'include_headers', type: 'boolean', required: false, description: 'Include clipped non-sensitive header values; auth/cookie-like headers stay redacted.' }
        ],
        execute: async (args) => this.toolCaptureTimeline(args)
      },
      {
        name: 'capture_search',
        description:
          'Search the CURRENT capture timeline by URL, method, status, content type, element label/text, request body, response preview, or header name. ' +
          'Use this for long recordings before fetching detail. Returns event indexes/request ids that can be passed to capture_event_detail.',
        params: [
          { name: 'query', required: true, description: 'Case-insensitive words to find, e.g. "POST patients", "401", "booking create".' },
          { name: 'kind', required: false, description: 'Filter: all, ui, api, snapshot, error. Default all.' },
          { name: 'limit', type: 'number', required: false, description: 'Max hits to return (default 80, max 200).' },
          { name: 'api_window_ms', type: 'number', required: false, description: 'For UI action hits, include likely API requests after the action within this window (default 5000, max 30000; 0 disables).' },
          { name: 'api_window_limit', type: 'number', required: false, description: 'Max likely API links per UI action (default 6, max 20).' },
          { name: 'include_bodies', type: 'boolean', required: false, description: 'Include clipped body/value previews in hits.' },
          { name: 'include_headers', type: 'boolean', required: false, description: 'Include clipped non-sensitive header values in hits.' }
        ],
        execute: async (args) => this.toolCaptureSearch(args)
      },
      {
        name: 'capture_event_detail',
        description:
          'Read one captured event in detail by 1-based event_index or a network request_id. ' +
          'For API events it also returns the matching request/response pair when available plus nearby context. ' +
          'Use this to inspect the exact request/response behind a UI action after capture_timeline or capture_search.',
        params: [
          { name: 'event_index', type: 'number', required: false, description: '1-based event index from capture_timeline/capture_search.' },
          { name: 'request_id', required: false, description: 'Network requestId from capture_timeline/capture_search.' },
          { name: 'around', type: 'number', required: false, description: 'Neighbor events before/after the match (default 2, max 20).' },
          { name: 'api_window_ms', type: 'number', required: false, description: 'When event_index points to a UI action, also return likely API requests after it within this window (default 5000, max 30000; 0 disables).' },
          { name: 'api_window_limit', type: 'number', required: false, description: 'Max likely API links for the selected UI action (default 6, max 20).' },
          { name: 'include_bodies', type: 'boolean', required: false, description: 'Include clipped request/response bodies and UI fill values.' },
          { name: 'include_headers', type: 'boolean', required: false, description: 'Include clipped non-sensitive header values; auth/cookie-like headers stay redacted.' }
        ],
        execute: async (args) => this.toolCaptureEventDetail(args)
      }
    ]
  }

  private buildHostToolCatalogTool(scope: HostToolScope): PiToolSpec {
    return {
      name: 'host_tool_catalog',
      description:
        'Read the Coach host tool catalog for this agent: categories, when to use each tool, risk level, and safety boundaries. Use when unsure whether to observe, call API, drive UI, inspect capture, manage skills, or use workspace/file tools.',
      params: [
        { name: 'category', required: false, description: 'Optional category filter: observe, act, api, capture, skill, workspace, file, tab, training.' },
        { name: 'query', required: false, description: 'Optional words to search in tool names/summaries/safety notes.' }
      ],
      execute: async (args) => this.toolHostToolCatalog(scope, args)
    }
  }

  private toolHostToolCatalog(scope: HostToolScope, args: Record<string, unknown>): string {
    const payload = readHostToolCatalog({
      scope,
      category: args.category ? String(args.category) : '',
      query: args.query ? String(args.query) : '',
      policies: this.hostToolPolicies
    })
    this.broadcastActivity('tool', `read host_tool_catalog (${payload.tools.length})`)
    return JSON.stringify(payload, null, 2)
  }

  private trainerToolDetail(skillId: string): string {
    const detail = this.ensureServices().registry.readSkillDetail(skillId)
    if (!detail) return `ERROR: unknown skill_id "${skillId}".`
    return clipText(
      JSON.stringify(
        {
          id: detail.id,
          name: detail.name,
          description: detail.description,
          triggers: detail.triggers,
          inputs: detail.inputs,
          stepCount: detail.stepCount,
          networkCount: detail.networkCount,
          body: clipText(detail.body, 4_000)
        },
        null,
        1
      )
    )
  }

  private async trainerToolCreate(guidance: string): Promise<string> {
    const startedAt = Date.now()
    const capture = this.captureRecordsForAgent()
    const records = capture.records.filter((r) => r.event.kind !== 'error' && r.event.kind !== 'info')
    const events = records.map((r) => r.event)
    const specNotes = buildIngestSpecNotes(records, capture.workflow)
    this.broadcastActivity('tool', `call create_or_update_skill (${events.length} ${capture.source === 'edited' ? 'edited records' : 'events'})`)
    try {
      const result = await this.ensureServices().generator.summarize(events, this.currentUrl, guidance, undefined, specNotes || undefined)
      if (result.skill) this.lastTrainerRun = { skill: result.skill }
      this.broadcastActivity(
        'tool',
        appendActivityDuration(
          result.ok ? `create_or_update_skill returned ${result.skill?.name || 'skill'}` : `create_or_update_skill failed: ${result.error || result.message}`,
          startedAt
        ),
        result.ok
      )
      return JSON.stringify({ ok: result.ok, message: result.message, error: result.error, skillId: result.skill?.id })
    } catch (err) {
      this.broadcastActivity('tool', appendActivityDuration(`create_or_update_skill failed: ${(err as Error).message}`, startedAt), false)
      throw err
    }
  }

  private async trainerToolOptimize(skillId: string, guidance: string): Promise<string> {
    const startedAt = Date.now()
    this.broadcastActivity('tool', `call optimize_skill (${skillId})`)
    try {
      const result = await this.ensureServices().generator.train(skillId, guidance)
      if (result.skill) this.lastTrainerRun = { skill: result.skill }
      this.broadcastActivity(
        'tool',
        appendActivityDuration(result.ok ? `optimize_skill returned ${result.skill?.name || skillId}` : `optimize_skill failed: ${result.error || result.message}`, startedAt),
        result.ok
      )
      return JSON.stringify({ ok: result.ok, message: result.message, error: result.error, skillId: result.skill?.id })
    } catch (err) {
      this.broadcastActivity('tool', appendActivityDuration(`optimize_skill failed: ${(err as Error).message}`, startedAt), false)
      throw err
    }
  }

  private trainerToolDelete(skillId: string): string {
    const result = this.ensureServices().registry.deleteSkill(skillId)
    return JSON.stringify({ ok: result.ok, message: result.message, error: result.error })
  }

  // The runtime agent's tools. The tool LIST is static (so the session never goes
  // stale); each executor looks the recipe up fresh per call, so skills ingested
  // mid-session are immediately usable.
  private buildPiTools(opts: { ingest?: boolean; sessionKey?: string } = {}): PiToolSpec[] {
    const sessionKey = opts.sessionKey || 'default'
    return this.wrapHostTools('cowork', [
      this.buildHostToolCatalogTool('cowork'),
      {
        name: 'read_file',
        description:
          'Read a LOCAL file and get its content as text. Accepts an attached "@/absolute/path", any absolute path on the user’s machine, ' +
          'or a path relative to the selected workspace (else the user’s home). ' +
          'Supports PDF, Excel (xlsx/xlsm), Word (docx), and text/code/csv/json/markdown/html. ' +
          'Text/code return with line numbers (use offset/limit to page through large files); ' +
          'PDF returns page by page; Excel returns one markdown table per sheet. ' +
          'The OS gates access: reading a protected folder (Desktop/Documents/Downloads) may trigger a macOS permission prompt — if it’s denied you’ll get an "authorize + retry" hint.',
        params: [
          { name: 'path', required: true, description: 'Attached @/abs/path, any absolute path, or a path relative to the workspace/home.' },
          { name: 'offset', type: 'number', required: false, description: 'Text files only: 1-based start line (default 1).' },
          { name: 'limit', type: 'number', required: false, description: 'Text files only: max lines to return (default 2000).' }
        ],
        execute: async (args) =>
          this.toolReadFile(sessionKey, String(args.path ?? ''), {
            offset: args.offset != null ? Number(args.offset) : undefined,
            limit: args.limit != null ? Number(args.limit) : undefined
          })
      },
      {
        name: 'list_workspace_files',
        description:
          'List files/directories in a folder. The path may be ANY absolute directory on the user’s machine, or relative to the selected workspace; ' +
          'empty means the workspace root (or the user’s home if no workspace is selected). Use this to browse the user’s directories before reading. ' +
          'Common build/cache folders are skipped. A protected folder may trigger a macOS permission prompt; if denied you’ll get an "authorize + retry" hint.',
        params: [
          { name: 'path', required: false, description: 'Any absolute directory, or a path relative to the workspace/home. Empty = workspace root or home.' },
          { name: 'max_entries', type: 'number', required: false, description: 'Max entries to return (default 120, max 300).' }
        ],
        execute: async (args) => this.toolListWorkspaceFiles(sessionKey, args.path ? String(args.path) : '', args.max_entries != null ? Number(args.max_entries) : undefined)
      },
      {
        name: 'search_files',
        description:
          'Search filenames and small text/code file contents under a folder. `path` may be ANY absolute directory on the user’s machine, or relative to the workspace; ' +
          'empty searches the workspace root (or home if no workspace). Multi-word queries match all terms. Returns relative paths and matching line previews. ' +
          'Recursion is depth/size bounded; protected subfolders are skipped (you’ll get an authorize hint). Prefer giving a specific `path` (e.g. ~/Documents/project) over searching all of home.',
        params: [
          { name: 'query', required: true, description: 'Text to search for.' },
          { name: 'path', required: false, description: 'Any absolute directory to search under, or relative to the workspace. Empty = workspace root or home.' },
          { name: 'max_results', type: 'number', required: false, description: 'Max hits to return (default 60).' }
        ],
        execute: async (args) => this.toolSearchWorkspaceFiles(sessionKey, String(args.query ?? ''), args.path ? String(args.path) : '', args.max_results != null ? Number(args.max_results) : undefined)
      },
      {
        name: 'write_file',
        description:
          'Create or update a UTF-8 text file inside the selected workspace. The path must stay under the workspace root; this tool cannot delete, rename, or move files/directories, and cannot target the workspace directory itself. ' +
          'After writing, the file is shown to the user as a created/updated artifact.',
        params: [
          { name: 'path', required: true, description: 'Workspace-relative file path to create or update.' },
          { name: 'content', required: true, description: 'Full UTF-8 file content to write.' }
        ],
        execute: async (args) => this.toolWriteWorkspaceFile(sessionKey, String(args.path ?? ''), String(args.content ?? ''))
      },
      {
        name: 'create_artifact',
        description:
          'Create a generated file artifact for the user: xlsx, docx, pdf, html, md, txt, or json. ' +
          'If a workspace is selected, relative filenames are written under that workspace (default: workspace/artifacts). ' +
          'If no workspace is selected, files are written under the app userData artifacts directory. ' +
          'Use this for reports, exported tables, Word documents, and printable PDFs. PDF is rendered from HTML using Electron Chromium printToPDF; Excel uses sheets/rows; Word uses title/sections/tables. ' +
          'artifact_json is a JSON object such as {"type":"xlsx","filename":"reports/patients.xlsx","sheets":[{"name":"Patients","rows":[{"name":"Jane","phone":"..."}]}]} or {"type":"pdf","filename":"report.pdf","html":"<h1>...</h1>"}.',
        params: [
          { name: 'artifact_json', required: true, description: 'JSON object with type, optional filename/title, and content fields (html/text/markdown/content/sheets/sections).' }
        ],
        execute: async (args) => this.toolCreateArtifact(sessionKey, String(args.artifact_json ?? ''))
      },
      {
        name: 'workspace_context',
        description:
          'Inspect or update the selected local project workspace for THIS chat. Use status to answer what workspace is active, clear to forget a moved/deleted/wrong workspace, and choose only when the user explicitly asks to select or switch workspace (it opens the native directory picker).',
        params: [
          { name: 'action', required: true, description: 'One of: status, clear, choose.' }
        ],
        execute: async (args) => this.toolWorkspaceContext(sessionKey, String(args.action ?? 'status'))
      },
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
          'Clicking a row later sends a Cowork message with that title/description so the normal agent loop can execute it.',
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
      // Cowork-only (gated by opts.ingest): turn the current capture into one or more skills.
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

  private wrapHostTools(scope: HostToolScope, tools: PiToolSpec[]): PiToolSpec[] {
    const registry = new HostToolRegistry({
      scope,
      policies: this.hostToolPolicies,
      onConfirm: (request) => this.confirmHostToolCall(request),
      onWarning: (message, detail) =>
        this.emit({
          kind: 'info',
          msg: `host tool registry: ${message} ${JSON.stringify(detail || {})}`,
          ts: Date.now()
        })
    })
    registry.add(...tools)
    return registry.toRuntimeTools()
  }

  private async confirmHostToolCall(request: HostToolConfirmRequest): Promise<boolean> {
    const argsSummary = summarizeApprovalArgs(request.args)
    const detail = clipText(JSON.stringify({ scope: request.scope, toolName: request.toolName, args: argsSummary }, null, 2), 4_000)
    const eventId = await this.pushHostApprovalEvent({
      kind: 'tool',
      status: 'pending',
      label: request.toolName,
      detail: argsSummary,
      scope: request.scope,
      toolName: request.toolName
    })
    this.broadcastActivity('tool', `awaiting approval: ${request.toolName}`)
    this.debugCodex({
      scope: 'agent',
      phase: 'tool-confirm',
      level: 'info',
      message: `Awaiting approval for ${request.toolName}.`,
      detail: { toolName: request.toolName, toolScope: request.scope, args: argsSummary },
      ts: Date.now()
    })
    const options: MessageBoxOptions = {
      type: 'question',
      buttons: ['Allow once', 'Deny'],
      defaultId: 0,
      cancelId: 1,
      title: 'Approve Agent Tool Call',
      message: `Allow the agent to run ${request.toolName}?`,
      detail
    }
    const result = this.browserWindow ? await dialog.showMessageBox(this.browserWindow, options) : await dialog.showMessageBox(options)
    const allowed = result.response === 0
    await this.resolveHostApprovalEvent(eventId, allowed ? 'approved' : 'denied')
    this.broadcastActivity('tool', `${allowed ? 'approved' : 'denied'}: ${request.toolName}`, allowed)
    this.debugCodex({
      scope: 'agent',
      phase: allowed ? 'tool-confirmed' : 'tool-denied',
      level: allowed ? 'info' : 'warn',
      message: `${request.toolName} ${allowed ? 'approved' : 'denied'} by operator.`,
      detail: { toolName: request.toolName, toolScope: request.scope },
      ts: Date.now()
    })
    return allowed
  }

  private async handleSkillApiSafety(decision: SkillApiSafetyDecision, url: string): Promise<void> {
    if (decision.safety === 'safe') return
    const label = `${decision.method} ${apiActivityPath(url, this.currentUrl)}`
    if (decision.safety === 'unsafe') {
      await this.pushHostApprovalEvent({
        kind: 'api',
        status: 'blocked',
        label,
        method: decision.method,
        path: apiActivityPath(url, this.currentUrl),
        reason: decision.reason
      })
      this.broadcastActivity('api-call', `blocked ${label} · ${decision.reason}`, false)
      this.debugCodex({
        scope: 'agent',
        phase: 'api-blocked',
        level: 'warn',
        message: `Blocked skill API request: ${label}`,
        detail: decision,
        ts: Date.now()
      })
      throw new Error(`api ${decision.method} ${decision.path} blocked: ${decision.reason}`)
    }
    const allowed = await this.confirmApiRequest({
      method: decision.method,
      url,
      reason: decision.reason
    })
    if (!allowed) {
      this.broadcastActivity('api-call', `denied ${label}`, false)
      throw new Error(`operator denied api ${decision.method} ${decision.path}`)
    }
  }

  private async confirmApiRequest(params: { method: string; url: string; reason: string }): Promise<boolean> {
    const path = apiActivityPath(params.url, this.currentUrl)
    const eventId = await this.pushHostApprovalEvent({
      kind: 'api',
      status: 'pending',
      label: `${params.method} ${path}`,
      method: params.method,
      path,
      reason: params.reason
    })
    const options: MessageBoxOptions = {
      type: 'question',
      buttons: ['Run request', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Confirm API request',
      message: `Allow ${params.method} request?`,
      detail: `${params.reason}\n\n${params.method} ${apiActivityPath(params.url, this.currentUrl)}`
    }
    const result = this.browserWindow ? await dialog.showMessageBox(this.browserWindow, options) : await dialog.showMessageBox(options)
    const allowed = result.response === 0
    await this.resolveHostApprovalEvent(eventId, allowed ? 'approved' : 'denied')
    this.broadcastActivity('api-call', `${allowed ? 'approved' : 'denied'} ${params.method} ${apiActivityPath(params.url, this.currentUrl)}`, allowed)
    this.debugCodex({
      scope: 'agent',
      phase: allowed ? 'api-confirmed' : 'api-denied',
      level: allowed ? 'info' : 'warn',
      message: `${params.method} ${apiActivityPath(params.url, this.currentUrl)} ${allowed ? 'approved' : 'denied'} by operator.`,
      detail: { method: params.method, url: params.url, reason: params.reason },
      ts: Date.now()
    })
    return allowed
  }

  private async pushHostApprovalEvent(event: Omit<HostApprovalEvent, 'id' | 'requestedAt'>): Promise<string> {
    await this.loadHostApprovalHistory()
    const item = this.hostApprovalHistory.push(event)
    await this.saveHostApprovalHistory()
    xpcMain.broadcast('coach/host-approval', item)
    return item.id
  }

  private async resolveHostApprovalEvent(id: string, status: HostApprovalEvent['status']): Promise<void> {
    await this.loadHostApprovalHistory()
    const item = this.hostApprovalHistory.resolve(id, status)
    if (!item) return
    await this.saveHostApprovalHistory()
    xpcMain.broadcast('coach/host-approval', item)
  }

  // Broadcast a live agent step so the Agent chat can render the observe→act loop.
  private broadcastActivity(phase: AgentActivityStep['phase'], label: string, ok = true): void {
    xpcMain.broadcast('coach/agent-activity', { phase, label, ok, ts: Date.now() })
  }

  private broadcastApiActivity(
    method: string | undefined,
    url: string,
    ok: boolean,
    auth?: { header: string; source: string; key?: string; applied: boolean }[]
  ): void {
    const verb = (method || 'GET').toUpperCase()
    const authText = describeApiAuthResolution(auth)
    this.broadcastActivity(apiActivityPhase(verb), `${verb} ${apiActivityPath(url, this.currentUrl)}${authText ? ` · auth ${authText}` : ''}`, ok)
  }

  private async toolBrowserIntercept(commandsJson: string): Promise<string> {
    let parsed: unknown
    try {
      parsed = JSON.parse(commandsJson)
    } catch {
      return 'ERROR: commands_json is not valid JSON.'
    }
    const rawList = Array.isArray(parsed) ? parsed : [parsed]
    const results: Array<Record<string, unknown>> = []
    for (const entry of rawList) {
      if (!entry || typeof entry !== 'object') {
        results.push({ ok: false, error: 'command must be an object' })
        continue
      }
      const command = String((entry as Record<string, unknown>).command || 'list').trim()
      if (command === 'list') {
        results.push({ ok: true, command, rules: this.browserInterceptionRules.map(publicInterceptionRule) })
        continue
      }
      if (command === 'clear') {
        const count = this.browserInterceptionRules.length
        this.browserInterceptionRules = []
        await this.applyBrowserInterceptionRules()
        this.broadcastActivity('tool', `browser_intercept cleared ${count} rules`)
        results.push({ ok: true, command, cleared: count })
        continue
      }
      if (command === 'remove') {
        const id = String((entry as Record<string, unknown>).id || '').trim()
        const before = this.browserInterceptionRules.length
        this.browserInterceptionRules = this.browserInterceptionRules.filter((rule) => rule.id !== id)
        const removed = before - this.browserInterceptionRules.length
        if (removed) await this.applyBrowserInterceptionRules()
        results.push({ ok: removed > 0, command, id, removed })
        continue
      }
      if (command === 'add') {
        const normalized = normalizeNetworkInterceptionRule(entry, `intercept-${Date.now()}-${++this.browserInterceptionSeq}`)
        if (!normalized.ok || !normalized.rule) {
          results.push({ ok: false, command, error: normalized.error || 'invalid rule' })
          continue
        }
        const allowed = await this.confirmBrowserInterceptionRule(normalized.rule)
        if (!allowed) {
          results.push({ ok: false, command, error: 'operator denied interception rule', rule: publicInterceptionRule(normalized.rule) })
          continue
        }
        this.browserInterceptionRules.push(normalized.rule)
        await this.applyBrowserInterceptionRules()
        this.broadcastActivity('tool', `browser_intercept added ${interceptionRuleSummary(normalized.rule)}`)
        results.push({ ok: true, command, rule: publicInterceptionRule(normalized.rule) })
        continue
      }
      results.push({ ok: false, command, error: 'unsupported command; use list, add, remove, or clear' })
    }
    return JSON.stringify(
      {
        ok: results.every((item) => item.ok !== false),
        total: this.browserInterceptionRules.length,
        rules: this.browserInterceptionRules.map(publicInterceptionRule),
        results
      },
      null,
      1
    )
  }

  private async confirmBrowserInterceptionRule(rule: NetworkInterceptionRule): Promise<boolean> {
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
    const options: MessageBoxOptions = {
      type: 'question',
      buttons: ['Allow rule', 'Deny'],
      defaultId: 1,
      cancelId: 1,
      title: 'Approve Browser Interception',
      message: `Allow ${summary}?`,
      detail
    }
    const result = this.browserWindow ? await dialog.showMessageBox(this.browserWindow, options) : await dialog.showMessageBox(options)
    const allowed = result.response === 0
    await this.resolveHostApprovalEvent(eventId, allowed ? 'approved' : 'denied')
    this.broadcastActivity('tool', `${allowed ? 'approved' : 'denied'}: ${summary}`, allowed)
    return allowed
  }

  private async applyBrowserInterceptionRules(): Promise<void> {
    const tasks: Promise<void>[] = []
    for (const tab of this.tabs) {
      if (!tab.capture) continue
      tasks.push(tab.capture.setInterceptionRules(this.browserInterceptionRules))
    }
    if (this.capture && !this.tabs.some((tab) => tab.capture === this.capture)) {
      tasks.push(this.capture.setInterceptionRules(this.browserInterceptionRules))
    }
    await Promise.all(tasks)
  }

  private async toolPageSnapshot(tabId?: string): Promise<string> {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : undefined
    if (tabId && !tab) return `ERROR: unknown tab_id "${tabId}". Call list_tabs to see open tabs.`
    // A cold background tab has no live view — materialize + load it before snapshotting.
    if (tab && (!tab.capture || !tab.view || tab.view.webContents.isDestroyed())) {
      await this.warmAndLoad(tab)
    }
    const capture = tab ? tab.capture : this.capture
    const url = tab ? tab.url : this.currentUrl
    if (!capture) return 'ERROR: page capture is not ready.'
    const snap = await capture.snapshot()
    if (!snap.ok) {
      this.broadcastActivity('observe', 'snapshot failed', false)
      return 'ERROR: ' + (snap.error || 'snapshot failed')
    }
    this.broadcastActivity('observe', `observed ${snap.nodeCount} elements${tab ? ` · tab ${tab.id}` : ''}`)
    this.emit({
      kind: 'info',
      msg: `agent observed: ${snap.title || url} · ${snap.nodeCount} elements`,
      ts: Date.now()
    })
    return clipText(
      [
        `# tab: ${tab?.id ?? this.activeTabId ?? ''}`,
        `# page: ${url}`,
        `# title: ${snap.title || ''}`,
        `# elements: ${snap.nodeCount}`,
        '',
        snap.yaml
      ].join('\n'),
      SNAPSHOT_RESULT_LIMIT
    )
  }

  private async toolUiAct(actionsJson: string): Promise<string> {
    if (!this.replayEngine) return 'ERROR: browser view is not ready.'
    let parsed: unknown
    try {
      parsed = JSON.parse(actionsJson)
    } catch {
      return 'ERROR: actions_json is not valid JSON.'
    }
    const rawList = Array.isArray(parsed) ? parsed : [parsed]
    const allowed = ['click', 'fill', 'select', 'check', 'submit']
    const actions: AgentUiAction[] = []
    for (const entry of rawList) {
      if (!entry || typeof entry !== 'object') continue
      const rec = entry as Record<string, unknown>
      const action = String(rec.action || '')
      if (allowed.indexOf(action) < 0) continue
      // Prefer a ref from the snapshot ([ref=eN] → the stamped data-coach-ref);
      // fall back to a raw CSS selector if the agent supplies one.
      const ref = typeof rec.ref === 'string' ? rec.ref.trim() : ''
      const selector = ref
        ? `[data-coach-ref="${ref.replace(/"/g, '\\"')}"]`
        : typeof rec.selector === 'string'
          ? rec.selector
          : ''
      if (!selector) continue
      actions.push({
        action: action as AgentUiAction['action'],
        selector,
        value: typeof rec.value === 'string' ? rec.value : undefined,
        checked: typeof rec.checked === 'boolean' ? rec.checked : undefined
      })
    }
    if (actions.length === 0) {
      return 'ERROR: no valid actions. Each needs {"action":"click|fill|select|check|submit","ref":"<eN from the snapshot>", ...} (or "selector":"<css>").'
    }
    const run = await this.replayEngine.runUiActions(actions)
    // Describe what was operated on: "<action> <tag> | <id> | <name>" (selector fallback).
    const describe = (r: { target?: { tag: string; id: string; name: string }; selector: string }): string => {
      const t = r.target
      if (!t) return r.selector
      const parts = [t.tag]
      if (t.id) parts.push(t.id)
      if (t.name) parts.push(t.name)
      return parts.join(' | ')
    }
    for (const result of run.results) {
      const label = `${result.action} ${describe(result)}`
      this.broadcastActivity('act', label, result.ok)
      this.emit({
        kind: result.ok ? 'info' : 'error',
        msg: `agent ui_act: ${label} -> ${result.ok ? 'ok' : 'FAIL ' + (result.error || '')}`,
        ts: Date.now()
      })
    }
    // Surface the UI run as the turn's replay result so the reply carries it.
    this.lastAgentRun = {
      skill: this.lastAgentRun.skill,
      skills: this.lastAgentRun.skills,
      replay: {
        ok: run.ok,
        skillId: this.lastAgentRun.skill?.id || 'ui_act',
        stepsRun: run.results.filter((r) => r.ok).length,
        errors: run.results.filter((r) => !r.ok).map((r) => `${r.action} ${describe(r)}: ${r.error || 'failed'}`),
        mode: 'ui'
      }
    }
    // A click can trigger window.open → a new tab; give it a moment to land, then tell
    // the agent (so it recognizes e.g. a success page that opened in a new tab).
    await new Promise((resolve) => setTimeout(resolve, 700))
    return clipText(JSON.stringify(run, null, 1)) + this.drainNewTabsNote()
  }

  private toolSkillContract(skillId: string): string {
    const services = this.ensureServices()
    const recipe = services.registry.readRecipe(skillId)
    // Remember which skill the agent is working on, so the turn's reply carries it.
    const skill = services.registry.listSkills().find((item) => item.id === skillId)
    if (!recipe) {
      if (!skill) return `ERROR: unknown skill_id "${skillId}".`
      const detail = services.registry.readSkillDetail(skillId)
      this.lastAgentRun = { skill, skills: [skill] }
      this.broadcastActivity('skill', `reading ${skill.name}`)
      return clipText(
        JSON.stringify(
          {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            source: skill.source,
            runtime: 'external_markdown',
            executable_by_coach: false,
            note: 'This skill has SKILL.md but no Coach recipe.json. Read markdown_body as guidance only; do not call run_skill_script or replay_skill_ui for it.',
            triggers: skill.triggers,
            inputs: skill.inputs,
            markdown_body: detail?.body || ''
          },
          null,
          1
        )
      )
    }
    if (skill) {
      this.lastAgentRun = { skill, skills: [skill] }
      this.broadcastActivity('skill', `using ${skill.name}`)
    }
    const reads = collectApiReads(recipe)
    const writes = collectApiWrites(recipe)
    // Recorded UI steps are a WORKFLOW GUIDE for the observe→act→observe loop: they show
    // which controls to operate, in order. The agent executes them one at a time against
    // the live page (re-reading refs from each fresh snapshot), NOT as a blind batch.
    const uiSteps = recipe.steps.map((step) => {
      const t = step.target
      const label = t.label || t.text || ''
      const ref = label ? `"${label}"` : t.selector
      // Surface the element name attribute so each step lines up with the snapshot's
      // [name=…] — the agent can match "click [name=Btn_Registration]" to a live ref.
      const id = t.name ? ` [name="${t.name}"]` : ''
      const value = step.valueTemplate ? ` = ${step.valueTemplate}` : ''
      return `${step.action} ${ref}${id}${value}`
    })
    const hasUi = uiSteps.length > 0
    return clipText(
      JSON.stringify(
        {
          id: recipe.id,
          name: recipe.name,
          description: recipe.description,
          inputs: recipe.inputs,
          input_shape:
            'Input names may be dotted paths such as patient.name. variables_json may use either {"patient.name":"Jane"} or {"patient":{"name":"Jane"}}; run_skill_script exposes both vars["patient.name"] and vars.patient.name.',
          // When true, PREFER run_skill_script(skill_id, variables_json) — the skill carries a
          // parametric automation (UI+API) that runs in one shot and adapts to the live page.
          has_script: !!recipe.script,
          // Apply these to resolve/validate inputs BEFORE executing.
          field_rules: recipe.fieldRules ?? null,
          // The recorded UI workflow (drive via page_snapshot + ui_act).
          ui_flow: {
            note: hasUi
              ? 'WORKFLOW GUIDE — recorded_steps are the controls to operate IN ORDER, not a script. Execute them ONE AT A TIME with the page_snapshot → ui_act → page_snapshot loop: observe the live page after each action and adapt (handle dialogs, skip already-correct fields, re-read refs). Do NOT replay them as a batch.'
              : 'No UI steps recorded; observe with page_snapshot and operate the page step by step.',
            recorded_steps: uiSteps
          },
          // First-class path when write_templates exist: call the site's own API via browser_exec,
          // reusing the page's LIVE session. Ground ids via option_reads before any write.
          api: {
            note: 'Call these endpoints directly via browser_exec.fetch. Cookies/session ride along automatically, and token headers are resolved LIVE in-page from the domain auth profile. Use browser_exec.parallel only for independent read/lookup endpoints. GROUND every id/code/option from option_reads before a write — never invent them. After each response, decide whether another API call or a UI step is needed.',
            // Value-free auth scheme — browser_exec.fetch resolves the actual token LIVE from
            // the page; NEVER from the recording. Empty array ⇒ cookie-session.
            auth:
              buildAuthHint([...reads, ...writes]).length > 0
                ? {
                    note: 'Value-free scheme only. Do not manually copy token values; browser_exec.fetch applies these headers from live storage/cookies/meta at call time.',
                    headers: buildAuthHint([...reads, ...writes])
                  }
                : 'cookie-session — no token header recorded; cookies ride along automatically.',
            option_reads: reads.map((item) => apiEndpointContract(item, 'option-read')),
            write_templates: writes.map((item) => ({
              method: (item.method || 'POST').toUpperCase(),
              url: skillEndpointPath(item.url),
              role: item.apiRole || 'write',
              replay: item.replaySafety || 'confirm',
              body_kind: item.bodyKind || (item.requestBody ? 'raw' : 'none'),
              body_template: item.requestBody ?? null
            }))
          }
        },
        null,
        1
      )
    )
  }

  private async toolBrowserExec(commandsJson: string): Promise<string> {
    if (!this.replayEngine) return 'ERROR: browser view is not ready.'
    let parsed: unknown
    try {
      parsed = JSON.parse(commandsJson)
    } catch {
      return 'ERROR: commands_json is not valid JSON.'
    }
    const raw = Array.isArray(parsed) ? parsed : [parsed]
    const commands = raw.map((entry) => this.parseBrowserCommand(entry)).filter((cmd): cmd is BrowserCommand => Boolean(cmd))
    if (commands.length === 0) {
      return 'ERROR: no valid commands. Each needs {"command":"read_context"|"fetch"|"parallel", ...}. Arbitrary eval is not exposed to the agent.'
    }
    const domainAuth = readApiProfile(hostFromUrl(this.currentUrl))
    const results: CommandResult[] = []
    for (const cmd of commands) {
      results.push(...(await this.executeBrowserCommand(cmd, domainAuth)))
    }
    const run = { ok: results.every((r) => r.ok), results }
    // If any fetch ran, surface it to the renderer as the turn's API result.
    const fetches = run.results.filter((r) => isBrowserFetchResultCommand(r.command))
    if (fetches.length > 0) {
      const last = fetches[fetches.length - 1]
      this.lastAgentRun = {
        skill: this.lastAgentRun.skill,
        skills: this.lastAgentRun.skills,
        replay: {
          ok: run.ok,
          skillId: this.lastAgentRun.skill?.id || 'browser_exec',
          stepsRun: run.results.length,
          errors: run.results.filter((r) => !r.ok).map((r) => r.error || `command ${r.command} failed`),
          mode: 'api',
          apiCalls: fetches.length,
          responseText: replayResponsePreview(last.data),
          auth: last.auth
        }
      }
    }
    this.emit({
      kind: run.ok ? 'info' : 'error',
      msg: run.ok
        ? `browser_exec: ${run.results.map((r) => r.command).join(', ')}`
        : `browser_exec failed: ${run.results.filter((r) => !r.ok).map((r) => r.error).join('; ')}`,
      ts: Date.now()
    })
    return clipText(JSON.stringify(run, null, 1)) + this.drainNewTabsNote()
  }

  private async toolInjectButton(skillsJson: string, domainArg: string): Promise<string> {
    const active = this.getActiveTab()
    const wc = active?.view?.webContents
    const pageDomain = hostFromUrl(wc && !wc.isDestroyed() ? wc.getURL() : active?.url || this.currentUrl)
    const domain = normalizeInjectedButtonDomain(domainArg) || pageDomain
    if (!domain) return 'ERROR: no active page domain. Open the customer website first.'

    const items = parseInjectedButtonItems(skillsJson)
    if (!items.length) {
      return 'ERROR: skills_json must contain at least one item with skillTitle and optional skillDescription.'
    }

    const saved = await injectBtnStore.upsertMany({ domain, items })
    const entries = await injectBtnStore.list({ domain })
    const injected = active ? await this.injectButtonIntoTab(active, domain, entries) : { ok: false, error: 'no active tab' }
    this.broadcastActivity('act', `injected micromeet button · ${domain}`, injected.ok)
    xpcMain.broadcast('coach/injected-buttons-changed', { domain, ts: Date.now() })
    return JSON.stringify(
      {
        ok: saved.ok && injected.ok,
        domain,
        saved: saved.count,
        triggers: entries.length,
        injected: injected.ok,
        error: injected.ok ? undefined : injected.error
      },
      null,
      2
    )
  }

  private async toolRemoveInjectedButton(domainArg: string): Promise<string> {
    const active = this.getActiveTab()
    const wc = active?.view?.webContents
    const pageDomain = hostFromUrl(wc && !wc.isDestroyed() ? wc.getURL() : active?.url || this.currentUrl)
    const domain = normalizeInjectedButtonDomain(domainArg) || pageDomain
    if (!domain) return 'ERROR: no active page domain. Open the customer website first or pass a domain.'
    const result = await this.removeInjectedButtonDomain({ domain })
    this.broadcastActivity('act', `removed micromeet button · ${domain}`, result.ok)
    return JSON.stringify(result, null, 2)
  }

  private async injectStoredButtonForTab(tab: OperationTab): Promise<void> {
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return
    const domain = hostFromUrl(wc.getURL() || tab.url)
    if (!domain) return
    const entries = await injectBtnStore.list({ domain }).catch(() => [] as InjectBtnEntry[])
    if (!entries.length) return
    await this.injectButtonIntoTab(tab, domain, entries)
  }

  private async injectButtonIntoTab(tab: OperationTab, domain: string, entries: InjectBtnEntry[]): Promise<{ ok: boolean; error?: string }> {
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'tab webContents is not ready' }
    const liveDomain = hostFromUrl(wc.getURL() || tab.url)
    if (!liveDomain || liveDomain !== domain) return { ok: false, error: `active page is ${liveDomain || 'blank'}, not ${domain}` }
    if (!entries.length) return { ok: false, error: 'no inject button rows for domain' }
    try {
      const nonce = randomUUID()
      this.injectedButtonNonces.set(domain, nonce)
      await wc.executeJavaScript(buildInjectedButtonScript(domain, entries, nonce), true)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async removeInjectedButtonFromTabs(domain: string): Promise<number> {
    let count = 0
    for (const tab of this.tabs) {
      const wc = tab.view?.webContents
      if (!wc || wc.isDestroyed()) continue
      const liveDomain = hostFromUrl(wc.getURL() || tab.url)
      if (liveDomain !== domain) continue
      try {
        await wc.executeJavaScript(removeInjectedButtonScript(), true)
        count += 1
      } catch (err) {
        this.emit({ kind: 'error', msg: 'remove injected button: ' + (err as Error).message, ts: Date.now() })
      }
    }
    return count
  }

  private handleInjectedButtonOpen(url: string): boolean {
    const trigger = parseInjectedButtonTriggerUrl(url)
    if (!trigger) return false
    const expectedNonce = this.injectedButtonNonces.get(trigger.domain)
    if (!expectedNonce || expectedNonce !== trigger.nonce) return true
    const message = injectedButtonTriggerMessage(trigger)
    xpcMain.broadcast('coach/injected-skill-trigger', {
      domain: trigger.domain,
      skillTitle: trigger.skillTitle,
      skillDescription: trigger.skillDescription,
      message,
      ts: Date.now()
    })
    this.broadcastActivity('skill', `trigger ${trigger.skillTitle}`)
    return true
  }

  private parseBrowserCommand(entry: unknown): BrowserCommand | null {
    if (!entry || typeof entry !== 'object') return null
    const rec = entry as Record<string, unknown>
    const command = String(rec.command || '')
    const id = normalizeBrowserCommandId(rec.id)
    if (command === 'read_context') {
      return { command, id, keys: Array.isArray(rec.keys) ? rec.keys.map(String) : undefined }
    }
    if (command === 'fetch' && typeof rec.url === 'string') {
      return {
        command,
        id,
        url: rec.url,
        method: typeof rec.method === 'string' ? rec.method : undefined,
        query: normalizeApiQuery(rec.query),
        headers: sanitizeReplayHeaders(rec.headers),
        auth: normalizeBrowserExecAuth(rec.auth ?? rec.header_policy ?? rec.headerPolicy),
        body: rec.body
      }
    }
    if (command === 'parallel' && Array.isArray(rec.commands)) {
      const commands = rec.commands.map((item) => this.parseBrowserCommand(item)).filter((cmd): cmd is BrowserCommand => Boolean(cmd))
      return commands.length ? { command, id, commands } : null
    }
    return null
  }

  private async executeBrowserCommand(cmd: BrowserCommand, domainAuth: AuthHint[]): Promise<CommandResult[]> {
    if (!this.replayEngine) return [{ command: cmd.command, id: cmd.id, ok: false, error: 'browser view is not ready' }]
    if (cmd.command === 'parallel') {
      if (cmd.commands.some(browserCommandHasMutatingFetch)) {
        return [{ command: 'parallel', id: cmd.id, ok: false, error: 'parallel browser_exec only allows read-only fetches; run mutating API requests sequentially.' }]
      }
      const groups = await Promise.all(cmd.commands.map((item) => this.executeBrowserCommand(item, domainAuth)))
      return groups.flat().map((item) => ({ ...item, command: `parallel.${item.command}` }))
    }
    if (cmd.command === 'fetch') {
      if (isMutatingHttpMethod(cmd.method)) {
        const allowed = await this.confirmApiRequest({
          method: normalizeHttpMethod(cmd.method),
          url: cmd.url,
          reason: 'browser_exec mutating API request'
        })
        if (!allowed) {
          this.broadcastActivity('api-call', `denied ${normalizeHttpMethod(cmd.method)} ${apiActivityPath(cmd.url, this.currentUrl)}`, false)
          return [
            {
              command: 'fetch',
              id: cmd.id,
              ok: false,
              status: 0,
              error: `operator denied ${normalizeHttpMethod(cmd.method)} ${apiActivityPath(cmd.url, this.currentUrl)}`
            }
          ]
        }
      }
      const result = await this.replayEngine.apiFetch(
        {
          url: cmd.url,
          method: cmd.method,
          query: cmd.query,
          headers: cmd.headers,
          body: cmd.body
        },
        mergeAuthHints(domainAuth, cmd.auth)
      )
      this.broadcastApiActivity(cmd.method, cmd.url, result.ok, result.auth)
      return [
        {
          command: 'fetch',
          id: cmd.id,
          ok: result.ok,
          status: result.status,
          data: result.data,
          error: result.error,
          auth: result.auth
        }
      ]
    }
    const single = await this.replayEngine.runCommands([cmd])
    return single.results
  }

  private async toolRunSkillScript(skillId: string, variablesJson: string): Promise<string> {
    if (!this.replayEngine) return 'ERROR: browser view is not ready.'
    const services = this.ensureServices()
    const recipe = services.registry.readRecipe(skillId)
    if (!recipe) {
      const skill = services.registry.listSkills().find((item) => item.id === skillId)
      if (!skill) return `ERROR: unknown skill_id "${skillId}".`
      return `ERROR: skill "${skill.name}" is an external markdown skill with no Coach recipe.json — read get_skill_contract and use normal browser tools if needed.`
    }
    if (!recipe.script) return `ERROR: skill "${recipe.name}" has no automation script — drive it via the page_snapshot → ui_act loop or browser_exec instead.`
    let vars: Record<string, string> = {}
    try {
      const parsed = JSON.parse(variablesJson || '{}')
      if (parsed && typeof parsed === 'object') vars = parsed as Record<string, string>
    } catch {
      return 'ERROR: variables_json is not valid JSON.'
    }
    // Validate inputs against the skill's declarative zod constraints BEFORE running.
    const check = validateSkillVars(recipe.inputs, vars)
    if (!check.ok) return 'ERROR: invalid inputs — ' + check.errors.join('; ')
    vars = check.data as Record<string, string>
    const skill = services.registry.listSkills().find((item) => item.id === skillId)
    if (skill) {
      this.lastAgentRun = { skill, skills: [skill] }
      this.broadcastActivity('skill', `running ${skill.name}`)
    }
    // Overall watchdog: vm `timeout` can't interrupt an `await`, so abort via the signal the
    // driver methods check; per-method waits (page.waitFor) are bounded separately.
    // Domain API Profile: the host's shared value-free auth scheme, applied by api.fetch to
    // EVERY call (resolved live in-page). Keyed on the recipe's OWN host (sourceUrl) — where it
    // was recorded + where the profile was written — not the live view (which may have drifted).
    let host = ''
    try {
      host = new URL(recipe.sourceUrl || this.currentUrl).hostname.replace(/^www\./, '')
    } catch {
      try {
        host = new URL(this.currentUrl).hostname.replace(/^www\./, '')
      } catch {
        /* no host */
      }
    }
    const auth = readApiProfile(host)
    const controller = new AbortController()
    const watchdog = setTimeout(() => controller.abort(), 120_000)
    const apiResults: { call: { method?: string; url: string }; result: ApiCallResult }[] = []
    try {
      const run = await runSkillScript({
        script: recipe.script,
        replay: this.replayEngine,
        vars,
        auth,
        signal: controller.signal,
        onApiFetch: (call, result) => {
          apiResults.push({ call: { method: call.method, url: call.url }, result })
          this.broadcastApiActivity(call.method, call.url, result.ok, result.auth)
        },
        onApiBeforeFetch: async (call) => {
          const decision = classifySkillApiCall(recipe, call)
          await this.handleSkillApiSafety(decision, call.url)
          return decision
        }
      })
      const lastApi = apiResults[apiResults.length - 1]
      const replay: ReplayResult = {
        ok: run.ok,
        skillId: skillId,
        stepsRun: apiResults.length || (run.ok ? 1 : 0),
        errors: run.ok ? [] : [run.error || 'skill script failed'],
        mode: apiResults.length ? 'api' : 'ui',
        apiCalls: apiResults.length || undefined,
        responseText: lastApi ? replayResponsePreview(lastApi.result.data) : undefined,
        auth: lastApi?.result.auth
      }
      this.lastAgentRun = { skill, skills: skill ? [skill] : undefined, replay }
      this.broadcastActivity('act', run.ok ? `ran skill script ${recipe.name}` : `script failed: ${run.error}`, run.ok)
      this.emit({
        kind: run.ok ? 'info' : 'error',
        msg: run.ok ? `run_skill_script: ${recipe.name} ok` : `run_skill_script failed: ${run.error}`,
        ts: Date.now()
      })
      return clipText(JSON.stringify(run, null, 1)) + this.drainNewTabsNote()
    } finally {
      clearTimeout(watchdog)
    }
  }

  private async toolReplayUi(skillId: string, variablesJson: string): Promise<string> {
    const services = this.ensureServices()
    const skill = services.registry.listSkills().find((item) => item.id === skillId)
    if (!skill) return `ERROR: unknown skill_id "${skillId}".`
    const variables: Record<string, string> = {}
    if (variablesJson.trim()) {
      try {
        const parsed = JSON.parse(variablesJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'ERROR: variables_json must be a JSON object.'
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (value !== null && value !== undefined) variables[key] = String(value)
        }
      } catch {
        return 'ERROR: variables_json is not valid JSON.'
      }
    }
    const replay = await this.replaySkill({ skillId, variables })
    this.lastAgentRun = { skill, skills: [skill], replay }
    // The replay may have clicked a control that opened a result tab — let it land.
    await new Promise((resolve) => setTimeout(resolve, 700))
    return (
      JSON.stringify({ ok: replay.ok, stepsRun: replay.stepsRun, errors: replay.errors }) + this.drainNewTabsNote()
    )
  }

  private replayReply(
    skill: SkillSummary,
    _variables: Record<string, string>,
    replay: ReplayResult,
    note?: string
  ): AgentReply {
    const detail = replay.mode === 'api' ? ` (${replay.apiCalls || 0} API call${replay.apiCalls === 1 ? '' : 's'})` : ''
    const text = replay.ok
      ? [note, `✓ Done — ${skill.name}${detail}.`].filter(Boolean).join('\n')
      : `✗ Couldn't run ${skill.name}:\n${replay.errors.join('\n')}`
    return {
      ok: replay.ok,
      text,
      ts: Date.now(),
      skill,
      skills: [skill],
      replay,
      error: replay.ok ? undefined : 'replay-failed'
    }
  }

  private sendNav(url: string, resetTitle = false): void {
    this.currentUrl = url
    xpcMain.broadcast('coach/nav', url)
    // A full navigation loads a new document, so the old <title> is stale until the
    // new page reports one — clear it (the tab falls back to the URL host meanwhile).
    // In-page (SPA) navigation keeps the title.
    if (resetTitle) xpcMain.broadcast('coach/title', '')
    this.broadcastNavState()
  }

  private sendTitle(title: string): void {
    xpcMain.broadcast('coach/title', String(title || ''))
  }

  // Active tab's back/forward availability → home renderer (enables/disables the nav buttons).
  private broadcastNavState(): void {
    const active = this.getActiveTab()
    const wc = this.operationView?.webContents
    const live = wc && !wc.isDestroyed() ? wc : null
    const historyLocked = this.isPinnedAiCrmsTab(active)
    xpcMain.broadcast('coach/nav-state', {
      canGoBack: !historyLocked && live ? live.navigationHistory.canGoBack() : false,
      canGoForward: !historyLocked && live ? live.navigationHistory.canGoForward() : false
    })
  }

  private onCapturedEvent(e: TraceEvent, tabId: string): void {
    // Only record the selected browser target. The Workbench renderer can be visible while a
    // recording is running, but it is first-party control UI and must never pollute the trace.
    if (tabId !== this.captureTargetTabId) return
    if (!this.capturing) return
    // One recording captures BOTH UI (clicks/inputs/snapshots) and API (network) — the
    // generated skill carries a UI flow + an API fallback; cowork prefers the UI loop.
    this.emit(e)
  }

  private emit(e: TraceEvent): void {
    // `info` events are operator-facing chatter (capture path, model switch, observe notes) —
    // never a useful record and never needed for ingest, so drop them everywhere: no record
    // list row, no in-memory buffer, no trace JSONL line.
    if (e.kind === 'info') return
    // The trace list and JSONL recording are capture-owned state. Browser debugger hooks may be
    // attached before/after a recording for stealth/auth/replay, but no event is allowed to enter
    // the recording buffer unless the user explicitly started Capture.
    if (!this.capturing) return
    if (!this.shouldRecordTraceEvent(e)) return
    // Thumbnails (action/snapshot `shot`) are display-only base64 images — broadcast them
    // to the renderer, but NEVER store/persist (they would bloat the trace JSONL and poison
    // ingest). Keep the stored/serialized copy thumbnail-free.
    const stored = (e.kind === 'action' || e.kind === 'snapshot') && e.shot ? { ...e, shot: undefined } : e
    this.traceEvents.push(stored)
    if (this.traceEvents.length > MAX_MEMORY_EVENTS) this.traceEvents.shift()
    xpcMain.broadcast('coach/trace', e)
    if (this.capturing && this.traceStream) {
      this.traceStream.write(JSON.stringify(stored) + '\n')
    }
  }

  private shouldRecordTraceEvent(e: TraceEvent): boolean {
    if (e.kind === 'error') return true
    if (e.kind === 'action' || e.kind === 'snapshot') {
      return this.captureMode !== 'api' && this.captureOptions.recordActions
    }
    if (e.kind === 'net.request' || e.kind === 'net.response') {
      return this.networkCapturePasses(e.url)
    }
    return true
  }

  private networkCapturePasses(url: string): boolean {
    if (!this.captureOptions.recordNetwork) return false
    if (!url) return true
    const host = hostnameOf(url)
    if (this.captureOptions.networkWhitelistEnabled && !this.captureOptions.networkWhitelist.some((rule) => captureRuleMatches(rule, url, host))) {
      return false
    }
    return !this.captureOptions.networkBlacklist.some((rule) => captureRuleMatches(rule, url, host))
  }

  private layout(): void {
    if (!this.browserWindow) return
    const [w, h] = this.browserWindow.getContentSize()
    const viewH = Math.max(0, h - TOOLBAR_H)
    const webW = Math.max(0, w - SIDEBAR_W)
    this.operationView?.setBounds({ x: 0, y: TOOLBAR_H, width: webW, height: viewH })
    this.workbenchView?.setBounds({ x: 0, y: TOOLBAR_H, width: webW, height: viewH })
    this.controlView?.setBounds({ x: webW, y: TOOLBAR_H, width: SIDEBAR_W, height: viewH })
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
    this.applyBounds(this.operationView, params.operation)
    this.applyBounds(this.workbenchView, params.operation)
    this.applyBounds(this.controlView, params.control)
  }

  private applyBounds(view: WebContentsView | null, r: ViewRect): void {
    if (!view || view.webContents.isDestroyed()) return
    view.setBounds({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.max(0, Math.round(r.width)),
      height: Math.max(0, Math.round(r.height))
    })
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────────
  // Each tab is its own operation-view WebContentsView. The active tab's view +
  // capture + replay are mirrored onto operationView/capture/replayEngine, so the
  // rest of the helper (agent tools, recording, replay) is tab-agnostic.

  // Create a COLD tab (metadata only, no live view). It shows in the strip immediately; its view
  // materializes lazily on activation (ensureWarm). Used for restored tabs + new opens.
  private addTab(meta: { url?: string; title?: string; favicon?: string }): OperationTab {
    const tab: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'browser',
      view: null,
      capture: null,
      replay: null,
      url: meta.url || '',
      title: meta.title || '',
      favicon: meta.favicon || '',
      debuggerEnabled: true,
      pinned: false,
      lastActive: 0
    }
    this.tabs.push(tab)
    return tab
  }

  // Build a live view slot (WebContentsView + capture + replay + per-view listeners). Does NOT
  // attach CDP — the caller attaches (prewarmSpare in the background; the boot pinned tab via its
  // initialReady chain). Listeners resolve their owning tab DYNAMICALLY (by view identity), so a
  // slot can be bound to any tab — incl. transplanting a prewarmed spare onto a cold tab.
  private buildViewSlot(): ViewSlot {
    const view = new WebContentsView({ webPreferences: { partition: COWORK_PARTITION } })
    // Pale blue debug background so a blank native operation view is distinguishable from the
    // white Layout placeholder while we diagnose new-tab view attachment.
    view.setBackgroundColor('#d9ecff')
    view.webContents.setUserAgent(chromeIdentity().userAgent)
    // Insert BELOW the control view so the right-side panel stays on top; inactive tab views are
    // hidden, so they never paint over anything regardless.
    this.browserWindow?.contentView.addChildView(view, 0)
    view.setVisible(false)
    const capture = new DebuggerCapture(
      view.webContents,
      (e) => {
        const owner = this.ownerOf(view)
        if (owner) this.onCapturedEvent(e, owner.id)
      },
      // Mirror onCapturedEvent's gating: only screenshot the current capture target while recording.
      () => this.capturing && this.ownerOf(view)?.id === this.captureTargetTabId
    )
    void capture.setInterceptionRules(this.browserInterceptionRules)
    const replay = new ReplayEngine(view.webContents)
    this.attachViewListeners(view)
    return { view, capture, replay }
  }

  // The tab that currently owns this view (by view identity, so it survives transplanting a spare
  // onto a cold tab). Undefined for an unbound spare view.
  private ownerOf(view: WebContentsView): OperationTab | undefined {
    return this.tabs.find((t) => t.view === view)
  }

  private ownerOfWebContents(wc: WebContents): OperationTab | undefined {
    return this.tabs.find((t) => t.view?.webContents === wc)
  }

  private getActiveTab(): OperationTab | undefined {
    return this.activeTabId ? this.tabs.find((t) => t.id === this.activeTabId) : undefined
  }

  private isPinnedAiCrmsTab(tab?: OperationTab): boolean {
    return Boolean(tab?.pinned && tab.kind === 'ai-crms')
  }

  private isAllowedPinnedAiCrmsNavigation(url: string, wc: WebContents): boolean {
    if (isAiCrmsUrl(url)) return true
    // The first hidden load creates a render process for capture/auth injection. Once a real page
    // has loaded, history navigation back to about:blank must be blocked.
    return url === 'about:blank' && !wc.getURL()
  }

  private preventPinnedAiCrmsDomainEscape(tab: OperationTab | undefined, wc: WebContents, url: string): boolean {
    if (!this.isPinnedAiCrmsTab(tab)) return false
    if (this.isAllowedPinnedAiCrmsNavigation(url, wc)) return false
    this.emit({ kind: 'info', msg: `blocked AI-CRMS navigation · ${url}`, ts: Date.now() })
    return true
  }

  // A pre-warmed, hidden view slot kept ready so warming a tab (new open OR switching to a cold
  // tab) is instant — the WebContentsView creation + CDP attach is paid ahead of time.
  private spareSlot: ViewSlot | null = null
  private prewarming = false
  // Re-entrancy guard for newTab() (the + button) — see newTab().
  private creatingTab = false

  // Build the spare slot in the background (creating a view + attaching CDP is the slow part).
  // The `prewarming` guard prevents rapid warms from spawning concurrent (orphaning) builds.
  private async prewarmSpare(): Promise<void> {
    if (this.spareSlot || this.prewarming) return
    this.prewarming = true
    try {
      const slot = this.buildViewSlot()
      // Attach CDP in the BACKGROUND — display + navigation don't need the debugger, so a slow or
      // hung attach must NEVER block warming a tab. Recording/snapshot uses it once attached.
      void slot.capture
        .attach()
        .catch((err) => this.emit({ kind: 'error', msg: 'spare view attach: ' + (err as Error).message, ts: Date.now() }))
      this.spareSlot = slot
    } finally {
      this.prewarming = false
    }
  }

  // Make a cold tab warm: bind the prewarmed spare slot (or build one now) to it. Does NOT
  // navigate — warmAndLoad / activateTab handle (re)loading the URL. Refills the spare + enforces
  // the warm cap in the background. No-op when the tab is already warm.
  private async ensureWarm(tab: OperationTab): Promise<void> {
    if (tab.view && !tab.view.webContents.isDestroyed()) return
    let slot = this.spareSlot
    if (slot) {
      this.spareSlot = null
    } else {
      slot = this.buildViewSlot()
      // Background attach (non-blocking) — see prewarmSpare. The view must display immediately even
      // if CDP attach is slow or hangs on a never-loaded view.
      void slot.capture
        .attach()
        .catch((err) => this.emit({ kind: 'error', msg: 'warm view attach: ' + (err as Error).message, ts: Date.now() }))
    }
    tab.view = slot.view
    tab.capture = slot.capture
    tab.replay = slot.replay
    if (!tab.debuggerEnabled) tab.capture.suspend()
    // Mark as just-touched so the LRU pass below never evicts the tab we just warmed (it has
    // lastActive=0 until activateTab bumps it, which happens AFTER this).
    tab.lastActive = Date.now()
    void this.prewarmSpare()
    this.enforceWarmCap()
  }

  // Warm a tab AND ensure its page is loaded — cold tabs re-load their URL into the fresh view.
  // Used when activating a cold tab and when the agent snapshots a cold background tab.
  private async warmAndLoad(tab: OperationTab): Promise<void> {
    const wasCold = !tab.view || tab.view.webContents.isDestroyed()
    await this.ensureWarm(tab)
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return
    if (wasCold && tab.url && wc.getURL() !== tab.url) {
      await wc.loadURL(tab.url).catch((err) => {
        if (!wc.isDestroyed()) this.emit({ kind: 'error', msg: 'warm load: ' + (err as Error).message, ts: Date.now() })
      })
    }
  }

  // Cool a warm tab: destroy its heavy view but KEEP its metadata (it becomes cold). Switching
  // back re-materializes it via warmAndLoad. Never called on the active or pinned tab.
  private coolTab(tab: OperationTab): void {
    try {
      tab.capture?.detach()
    } catch {
      /* already detached */
    }
    if (tab.view) {
      this.browserWindow?.contentView.removeChildView(tab.view)
      try {
        tab.view.webContents.close()
      } catch {
        /* best effort */
      }
    }
    tab.view = null
    tab.capture = null
    tab.replay = null
  }

  // Keep at most MAX_WARM live views. Over the cap, cool the least-recently-active tabs — never
  // the active tab, the pinned tab, or a tab opened during the current agent turn (protected so
  // the agent can still inspect a result tab it just opened).
  private enforceWarmCap(): void {
    const warm = this.tabs.filter((t) => t.view && !t.view.webContents.isDestroyed())
    if (warm.length <= this.MAX_WARM) return
    const protectedIds = new Set<string>([
      ...(this.activeTabId ? [this.activeTabId] : []),
      ...(this.captureTargetTabId ? [this.captureTargetTabId] : []),
      ...this.tabsOpenedThisTurn.map((t) => t.id)
    ])
    const evictable = warm
      .filter((t) => !t.pinned && !protectedIds.has(t.id))
      .sort((a, b) => a.lastActive - b.lastActive)
    let over = warm.length - this.MAX_WARM
    for (const tab of evictable) {
      if (over <= 0) break
      this.coolTab(tab)
      over -= 1
    }
  }

  // Restore tabs the home renderer read from the sqlite store (renderer-driven persistence): add
  // them as COLD tabs after the pinned crms tab. The active tab stays the pinned crms tab; each
  // restored tab warms lazily on first activation. Idempotent — a renderer remount that re-calls
  // this is a no-op once any non-pinned tab already exists.
  async restoreTabs(params: { tabs: SavedTab[] }): Promise<void> {
    if (this.tabs.some((t) => !t.pinned)) return
    for (const t of params.tabs) {
      if (t.url) this.addTab({ url: t.url, title: t.title, favicon: t.favicon })
    }
    this.broadcastTabs()
  }

  // Per-VIEW listeners (bound once when a slot is built). They resolve the owning tab dynamically
  // via ownerOf(view), so the slot can be transplanted to any tab — and an unbound spare's events
  // simply no-op (ownerOf → undefined) until it's bound.
  private attachViewListeners(view: WebContentsView): void {
    const wc = view.webContents
    wc.on('will-navigate', (event, url) => {
      if (this.preventPinnedAiCrmsDomainEscape(this.ownerOf(view), wc, url)) event.preventDefault()
    })
    wc.on('will-redirect', (event, url) => {
      if (this.preventPinnedAiCrmsDomainEscape(this.ownerOf(view), wc, url)) event.preventDefault()
    })
    wc.on('did-navigate', (_e, url) => {
      const tab = this.ownerOf(view)
      if (!tab) return
      // about:blank is the internal boot bootstrap (see create()) — ignore it so it never becomes a
      // tab's URL or flashes in the address bar; the tab keeps its real URL until the page loads.
      if (url === 'about:blank') return
      tab.url = url
      if (this.activeTabId === tab.id || this.captureTargetTabId === tab.id) this.sendNav(url, true)
      this.broadcastTabs()
    })
    wc.on('did-navigate-in-page', (_e, url) => {
      const tab = this.ownerOf(view)
      if (!tab) return
      tab.url = url
      if (this.activeTabId === tab.id || this.captureTargetTabId === tab.id) this.sendNav(url, false)
      this.broadcastTabs()
    })
    wc.on('page-title-updated', (_e, title) => {
      const tab = this.ownerOf(view)
      if (!tab) return
      // Pinned tabs keep their fixed title (e.g. "AI-CRMS") regardless of the page.
      if (!tab.pinned) {
        tab.title = title
        if (this.activeTabId === tab.id) this.sendTitle(title)
      }
      this.broadcastTabs()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      const tab = this.ownerOf(view)
      if (!tab || tab.pinned) return
      // Pinned tabs keep their fixed favicon; others adopt the page's.
      if (Array.isArray(favicons) && favicons[0]) {
        tab.favicon = favicons[0]
        this.broadcastTabs()
      }
    })
    wc.on('did-start-loading', () => {
      if (this.ownerOf(view)?.id === this.activeTabId) this.broadcastLoading(true)
    })
    wc.on('did-stop-loading', () => {
      if (this.ownerOf(view)?.id === this.activeTabId) this.broadcastLoading(false)
    })
    wc.on('did-finish-load', () => {
      const tab = this.ownerOf(view)
      if (tab) void this.injectStoredButtonForTab(tab)
    })
    // A page opening a new window becomes a NEW TAB in this window (not a separate OS window).
    // Only http(s) targets open a tab; anything else is denied silently.
    wc.setWindowOpenHandler((details) => {
      if (this.handleInjectedButtonOpen(details.url)) return { action: 'deny' }
      // This intercept is SYNCHRONOUS — window.open blocks the opener page until it returns, so we
      // must NOT create a tab/view inline here (that stalls the opener). Defer to a microtask; the
      // open then reuses the prewarmed spare fast path (same as the + button).
      if (/^https?:\/\//i.test(details.url)) {
        const url = details.url
        queueMicrotask(() => void this.openTabWithUrl(url))
      }
      return { action: 'deny' }
    })
    // Chrome-like right-click menu for page content (native popup, renders above the view).
    wc.on('context-menu', (_e, params) => this.showPageMenu(wc, params))
  }

  // ── Context menus (native Menu.popup → renders above the operation view) ─────────────
  // Right-click on a TAB (sent from the home renderer). Chrome-style tab menu.
  async showTabMenu(params: { id: string }): Promise<void> {
    if (!this.browserWindow) return
    const idx = this.tabs.findIndex((t) => t.id === params.id)
    if (idx < 0) return
    const tab = this.tabs[idx]
    const canClose = !tab.pinned && this.tabs.length > 1
    const canDuplicate = !tab.pinned && Boolean(tab.url)
    const otherClosable = this.tabs.some((t) => t.id !== tab.id && !t.pinned)
    const rightClosable = this.tabs.slice(idx + 1).some((t) => !t.pinned)
    const menu = Menu.buildFromTemplate([
      { label: 'New tab', click: () => void this.newTab() },
      { type: 'separator' },
      {
        label: 'Reload',
        click: () => {
          if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.reload()
          else void this.warmAndLoad(tab)
        }
      },
      { label: 'Duplicate', enabled: canDuplicate, click: () => void this.openTabWithUrl(tab.url) },
      { type: 'separator' },
      { label: 'Close', enabled: canClose, click: () => void this.closeTab({ id: tab.id }) },
      { label: 'Close other tabs', enabled: otherClosable, click: () => void this.closeTabsExcept(tab.id) },
      { label: 'Close tabs to the right', enabled: rightClosable, click: () => void this.closeTabsToRight(tab.id) }
    ])
    menu.popup({ window: this.browserWindow })
  }

  private async closeTabsExcept(keepId: string): Promise<void> {
    const ids = this.tabs.filter((t) => t.id !== keepId && !t.pinned).map((t) => t.id)
    for (const id of ids) await this.closeTab({ id })
  }

  private async closeTabsToRight(afterId: string): Promise<void> {
    const idx = this.tabs.findIndex((t) => t.id === afterId)
    if (idx < 0) return
    const ids = this.tabs
      .slice(idx + 1)
      .filter((t) => !t.pinned)
      .map((t) => t.id)
    for (const id of ids) await this.closeTab({ id })
  }

  // Right-click inside a page (operation view): a Chrome-like menu built from the CDP
  // context-menu params, popped natively over the view.
  private showPageMenu(wc: WebContents, params: ContextMenuParams): void {
    if (!this.browserWindow) return
    const nav = wc.navigationHistory
    const historyLocked = this.isPinnedAiCrmsTab(this.ownerOfWebContents(wc))
    const sections: MenuItemConstructorOptions[][] = [
      [
        { label: 'Back', enabled: !historyLocked && nav.canGoBack(), click: () => void this.goBack() },
        { label: 'Forward', enabled: !historyLocked && nav.canGoForward(), click: () => void this.goForward() },
        { label: 'Reload', click: () => wc.reload() }
      ]
    ]
    if (params.linkURL) {
      sections.push([
        { label: 'Open link in new tab', click: () => void this.openTabWithUrl(params.linkURL) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) }
      ])
    }
    if (params.mediaType === 'image' && params.srcURL) {
      sections.push([
        { label: 'Open image in new tab', click: () => void this.openTabWithUrl(params.srcURL) },
        { label: 'Save image as…', click: () => wc.downloadURL(params.srcURL) },
        { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) }
      ])
    }
    if (params.isEditable) {
      const f = params.editFlags
      sections.push([
        { label: 'Cut', enabled: f.canCut, click: () => wc.cut() },
        { label: 'Copy', enabled: f.canCopy, click: () => wc.copy() },
        { label: 'Paste', enabled: f.canPaste, click: () => wc.paste() },
        { label: 'Select all', enabled: f.canSelectAll, click: () => wc.selectAll() }
      ])
    } else if (params.selectionText) {
      sections.push([{ label: 'Copy', click: () => wc.copy() }])
    }
    if (is.dev) {
      sections.push([{ label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) }])
    }
    const template: MenuItemConstructorOptions[] = []
    for (const section of sections) {
      if (template.length) template.push({ type: 'separator' })
      template.push(...section)
    }
    Menu.buildFromTemplate(template).popup({ window: this.browserWindow })
  }

  // Create a WARM tab by claiming the prewarmed spare slot (or building one now) — born with a
  // live view, exactly like the old idle-tab claim. New tabs are warm from birth; only RESTORED /
  // LRU-evicted tabs are cold (and lazily warmed on activation). Refills the spare + enforces the
  // cap. lastActive is stamped now so the cap pass below never evicts the tab we just made.
  private claimSpareTab(meta: { url?: string; title?: string; favicon?: string }): OperationTab {
    let slot = this.spareSlot
    this.spareSlot = null
    // Only reuse the prewarmed spare if it's actually ALIVE — a destroyed/broken spare (left over
    // from an earlier error) must never become a tab's view; build a fresh one instead.
    if (!slot || slot.view.webContents.isDestroyed()) {
      slot = this.buildViewSlot()
      void slot.capture
        .attach()
        .catch((err) => this.emit({ kind: 'error', msg: 'tab attach: ' + (err as Error).message, ts: Date.now() }))
    }
    const tab: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'browser',
      view: slot.view,
      capture: slot.capture,
      replay: slot.replay,
      url: meta.url || '',
      title: meta.title || '',
      favicon: meta.favicon || '',
      debuggerEnabled: true,
      pinned: false,
      lastActive: Date.now()
    }
    this.tabs.push(tab)
    void this.prewarmSpare()
    this.enforceWarmCap()
    return tab
  }

  // Open `url` in a NEW (non-pinned) tab and activate it. The synchronous head (claim + 'tab'
  // activity) runs before the first await — the moment window.open fires — so an in-flight agent
  // turn sees the new tab. The tab is born warm (prewarmed spare), so the open is INSTANT.
  private async openTabWithUrl(url: string): Promise<OperationTab> {
    const tab = this.claimSpareTab({ url })
    // Let the in-flight agent turn know a result/confirmation tab opened (drainNewTabsNote).
    this.tabsOpenedThisTurn.push({
      id: tab.id,
      kind: tab.kind,
      url,
      title: '',
      active: true,
      pinned: false,
      favicon: '',
      debuggerEnabled: tab.debuggerEnabled,
      debuggerAttached: Boolean(tab.capture?.isAttached())
    })
    this.broadcastActivity('tab', `opened tab · ${hostnameOf(url) || url}`)
    await this.activateTab({ id: tab.id })
    const wc = tab.view?.webContents
    if (wc && !wc.isDestroyed()) {
      await wc.loadURL(url).catch((err) => {
        if (!wc.isDestroyed()) this.emit({ kind: 'error', msg: 'tab load: ' + (err as Error).message, ts: Date.now() })
      })
    }
    return tab
  }

  // Open a new BLANK tab (empty operation view) and activate it. No URL is loaded; since the
  // tab isn't pinned, the address bar becomes editable, ready for the user to type one.
  async newTab(): Promise<void> {
    // Hardened so the + button always yields exactly ONE working tab, regardless of other state:
    // ignore re-entrant calls (no tab burst) and never let a failure leave a half-created tab.
    // claimSpareTab only APPENDS, so the pinned AI-CRMS tab is never touched here.
    if (this.creatingTab) return
    this.creatingTab = true
    try {
      const tab = this.claimSpareTab({})
      await this.activateTab({ id: tab.id })
    } catch (err) {
      this.emit({ kind: 'error', msg: 'new tab: ' + (err as Error).message, ts: Date.now() })
    } finally {
      this.creatingTab = false
    }
  }

  // Close Workbench first (Cmd/Ctrl+W), otherwise close the active tab. closeTab refuses the pinned
  // AI-CRMS home tab and always keeps ≥1 tab open — so the first/pinned tab is never closed.
  async closeActiveTab(): Promise<void> {
    if (this.workbenchVisible) {
      await this.setWorkbenchVisible({ visible: false })
      return
    }
    if (this.activeTabId) await this.closeTab({ id: this.activeTabId })
  }

  // Open `url` in a NEW tab and activate it (user-initiated: Demo / "open in new tab"). Atomic and
  // self-contained — the tab is born with the URL and the page is loaded into its OWN view, so it
  // can never touch/desync the previously-active tab (the bug the old newTab()+navigate() two-step
  // had: navigate() loaded into `this.operationView`). Mirrors openTabWithUrl minus the agent-turn
  // bookkeeping. Empty url → a blank tab.
  async openTab(params: { url: string }): Promise<void> {
    const url = (params.url || '').trim()
    if (!url) {
      await this.newTab()
      return
    }
    if (isWorkbenchInternalUrl(url)) return
    const tab = this.claimSpareTab({ url })
    await this.activateTab({ id: tab.id })
    const wc = tab.view?.webContents
    if (wc && !wc.isDestroyed()) {
      await wc
        .loadURL(url)
        .catch((err) => {
          if (!wc.isDestroyed()) this.emit({ kind: 'error', msg: 'open tab: ' + (err as Error).message, ts: Date.now() })
        })
    }
  }

  // Tabs opened since the last drain (within the current turn). Appended to action
  // results so the agent recognizes a result/confirmation tab and can inspect it.
  private drainNewTabsNote(): string {
    if (this.tabsOpenedThisTurn.length === 0) return ''
    const opened = this.tabsOpenedThisTurn.splice(0)
    const lines = opened.map((t) => `  - tab_id=${t.id} url=${t.url}`)
    return (
      `\n\nNOTE: ${opened.length} new browser tab(s) opened during this action — likely a ` +
      `result/confirmation page:\n${lines.join('\n')}\n` +
      `Inspect one with page_snapshot {"tab_id":"<tab_id>"} (does NOT change the active tab), ` +
      `or activate_tab to switch to it.`
    )
  }

  async activateTab(params: { id: string }): Promise<void> {
    const tab = this.tabs.find((t) => t.id === params.id)
    if (!tab) return
    if (this.activeTabId === tab.id) {
      tab.lastActive = Date.now()
      this.broadcastTabs()
      return
    }
    // Warm the target BEFORE touching the current view, so a warm failure can't blank the screen
    // (the current tab stays visible). Cold = restored / LRU-evicted (no live view yet). Claiming
    // the prewarmed spare is instant; the URL load is DEFERRED until after the active tab is set
    // below (otherwise did-start-loading fires while the old tab is still active and the progress
    // bar never animates).
    let needsLoad = false
    if (!tab.view || tab.view.webContents.isDestroyed()) {
      try {
        await this.ensureWarm(tab)
      } catch (err) {
        this.emit({ kind: 'error', msg: 'activate: warm failed — ' + (err as Error).message, ts: Date.now() })
      }
      if (!tab.view || tab.view.webContents.isDestroyed()) {
        // Could not materialize a view — keep the current tab visible, just refresh the strip.
        this.broadcastTabs()
        return
      }
      needsLoad = Boolean(tab.url) && tab.view.webContents.getURL() !== tab.url
    }
    // Switch: hide the previous view, then show the (now warm) target.
    const prev = this.tabs.find((t) => t.id === this.activeTabId)
    if (prev && prev.id !== tab.id && prev.view && !prev.view.webContents.isDestroyed()) prev.view.setVisible(false)
    this.activeTabId = tab.id
    tab.lastActive = Date.now()
    this.operationView = tab.view
    await this.switchCaptureTarget(tab)
    this.capture = tab.capture
    this.replayEngine = tab.replay
    this.currentUrl = tab.url || this.currentUrl
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.setVisible(true)
      if (this.opBounds) this.applyBounds(tab.view, this.opBounds)
      else this.layout()
      // Load the cold/restored tab's URL NOW — active tab is set, so did-start-loading drives the
      // header progress bar (in the BACKGROUND; the blank view shows immediately).
      if (needsLoad) {
        const cwc = tab.view.webContents
        void cwc.loadURL(tab.url).catch((err) => {
          if (!cwc.isDestroyed()) this.emit({ kind: 'error', msg: 'tab load: ' + (err as Error).message, ts: Date.now() })
        })
      }
    }
    // Reflect the visible browser tab in the address bar + header title.
    xpcMain.broadcast('coach/nav', tab.url || '')
    xpcMain.broadcast('coach/title', tab.title || '')
    this.broadcastNavState()
    this.broadcastTabs()
  }

  async reorderTabs(params: { ids: string[] }): Promise<void> {
    const ids = Array.isArray(params.ids) ? params.ids.filter((id) => typeof id === 'string') : []
    if (!ids.length) return

    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length !== this.tabs.length) return

    const byId = new Map(this.tabs.map((t) => [t.id, t]))
    if (uniqueIds.some((id) => !byId.has(id))) return

    const pinned = this.tabs.filter((t) => t.pinned)
    const reordered = uniqueIds.map((id) => byId.get(id)!).filter((t) => !t.pinned)
    if (reordered.length !== this.tabs.length - pinned.length) return

    const next = [...pinned, ...reordered]
    if (next.every((t, i) => t.id === this.tabs[i]?.id)) return

    this.tabs = next
    this.broadcastTabs()
  }

  async closeTab(params: { id: string }): Promise<void> {
    if (this.tabs.length <= 1) return // always keep one tab open
    const i = this.tabs.findIndex((t) => t.id === params.id)
    if (i < 0) return
    const tab = this.tabs[i]
    if (tab.pinned) return // the pinned home tab (AI-CRMS) can't be closed
    const wasActive = this.activeTabId === tab.id
    if (this.capturing && this.captureTargetTabId === tab.id) await this.stopCapture()
    // Drop its live view if warm (a cold tab has none).
    try {
      tab.capture?.detach()
    } catch {
      /* already detached */
    }
    if (tab.view) {
      this.browserWindow?.contentView.removeChildView(tab.view)
      try {
        tab.view.webContents.close()
      } catch {
        /* best effort */
      }
    }
    this.tabs.splice(i, 1)
    if (wasActive) {
      const next = this.tabs[i] || this.tabs[this.tabs.length - 1]
      this.activeTabId = null // force activateTab to switch + re-point
      if (next) await this.activateTab({ id: next.id })
    } else {
      this.broadcastTabs()
    }
  }

  async getTabs(): Promise<TabInfo[]> {
    return this.tabs.map((t) => this.tabInfo(t))
  }

  private broadcastTabs(): void {
    xpcMain.broadcast('coach/tabs', this.tabs.map((t) => this.tabInfo(t)))
  }

  private tabInfo(t: OperationTab): TabInfo {
    return {
      id: t.id,
      kind: t.kind,
      title: t.title,
      url: t.url,
      active: t.id === this.activeTabId,
      pinned: t.pinned,
      favicon: t.favicon,
      debuggerEnabled: t.debuggerEnabled,
      debuggerAttached: Boolean(t.capture?.isAttached())
    }
  }

  private broadcastWorkbenchVisibility(): void {
    xpcMain.broadcast('coach/workbench-visibility', { visible: this.workbenchVisible })
  }

  private broadcastLoading(loading: boolean): void {
    xpcMain.broadcast('coach/load-progress', { loading, ts: Date.now() })
  }

  private ensureServices(): {
    registry: SkillRegistryService
    generator: SkillGeneratorService
    pi: CoworkAgent
    piTrainer: CoachAgent
    piDelegate: DelegateAgent
    settings: CoachSettingsService
    demo: BookingDemoService
  } {
    this.assertAgentRuntimeActive()
    if (!this.settings) this.settings = new CoachSettingsService(coworkDataRoot())
    if (!this.demo) this.demo = new BookingDemoService(coworkDataRoot())
    if (!this.skillRegistry) {
      this.skillRegistry = new SkillRegistryService(coworkDataRoot())
      this.skillRegistry.ensureRuntimeStorage()
    }
    if (!this.piGen)
      this.piGen = new BaseAgent({
        buildTools: () => [],
        scope: 'summarize',
        authPath: coworkAuthPath(),
        modelsPath: coworkModelsPath(),
        onDebug: this.debugCodex,
        onActivity: this.relayAgentActivity
      })
    if (!this.skillGenerator) this.skillGenerator = new SkillGeneratorService(this.skillRegistry, this.piGen, this.debugCodex)
    if (!this.pi)
      this.pi = new CoworkAgent({
        buildTools: () => this.buildPiTools({ ingest: true, sessionKey: 'default' }),
        authPath: coworkAuthPath(),
        modelsPath: coworkModelsPath(),
        onDebug: this.debugCodex,
        onActivity: this.relayAgentActivity,
        onThinking: (state) => this.broadcastAgentThinking('default', state),
        onStream: (delta) => this.broadcastAgentStream('default', delta)
      })
    if (!this.piTrainer)
      this.piTrainer = new CoachAgent({
        buildTools: () => this.buildTrainerTools(),
        authPath: coworkAuthPath(),
        modelsPath: coworkModelsPath(),
        onDebug: this.debugCodex,
        onActivity: this.relayAgentActivity
      })
    if (!this.piDelegate)
      this.piDelegate = new DelegateAgent({
        buildTools: () => this.buildPiTools({ sessionKey: 'default' }),
        authPath: coworkAuthPath(),
        modelsPath: coworkModelsPath(),
        onDebug: this.debugCodex,
        onActivity: this.relayAgentActivity
      })
    if (!this.llmApplied) {
      const saved = this.settings.read()
      this.applyLlmTarget(saved.llmProvider, saved.llmModel, saved.llmEffort)
      this.llmApplied = true
    }
    return {
      registry: this.skillRegistry,
      generator: this.skillGenerator,
      pi: this.pi,
      piTrainer: this.piTrainer,
      piDelegate: this.piDelegate,
      settings: this.settings,
      demo: this.demo
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    await integrationScheduler.stop()

    const agents = new Set([
      this.pi,
      this.piTrainer,
      this.piDelegate,
      this.piGen,
      ...this.coworkAgents.values(),
      ...this.trainerAgents.values(),
      ...this.delegateAgents.values()
    ].filter((agent): agent is BaseAgent => Boolean(agent)))
    await Promise.allSettled([...agents].map((agent) => agent.dispose()))

    this.demo?.stop()
    if (this.capturing) await this.stopCapture().catch(() => undefined)
    if (this.traceStream) {
      this.traceStream.end()
      this.traceStream = null
    }

    for (const tab of this.tabs) {
      try {
        tab.capture?.detach()
      } catch {
        // already detached
      }
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    }
    if (this.spareSlot) {
      try {
        this.spareSlot.capture.detach()
      } catch {
        // already detached
      }
      if (!this.spareSlot.view.webContents.isDestroyed()) this.spareSlot.view.webContents.close()
    }
    for (const view of [this.controlView, this.workbenchView]) {
      if (view && !view.webContents.isDestroyed()) view.webContents.close()
    }
    await authBridge.detach()
    super.destroy()

    this.tabs = []
    this.activeTabId = null
    this.operationView = null
    this.controlView = null
    this.workbenchView = null
    this.workbenchVisible = false
    this.capture = null
    this.replayEngine = null
    this.opBounds = null
    this.tabSeq = 0
    this.startupTabOpened = false
    this.capturing = false
    this.captureStartedAt = 0
    this.captureTargetTabId = null
    this.traceFile = null
    this.traceEvents = []
    this.editedCaptureRecords = null
    this.captureRecordLoadPromise = null
    this.spareSlot = null
    this.prewarming = false
    this.initialReady = Promise.resolve()
    this.attachedPaths.clear()
    this.workspaceRefs.clear()
    this.coworkAgents.clear()
    this.trainerAgents.clear()
    this.delegateAgents.clear()
    this.pi = null
    this.piTrainer = null
    this.piDelegate = null
    this.piGen = null
    this.skillGenerator = null
    this.llmApplied = false
    this.hydratedCoworkAgentSessions.clear()
  }

  private async replayRecipe(recipe: SkillRecipe, variables: Record<string, string>): Promise<ReplayResult> {
    if (!this.replayEngine) {
      return { ok: false, skillId: recipe.id, stepsRun: 0, errors: ['Browser view is not ready.'] }
    }
    return await this.replayEngine.replay(recipe, variables)
  }

  private debugCodex = (event: CodexDebugEvent): void => {
    const duration = formatDebugDuration(event.detail)
    const prefix = `[coach:${event.scope}:${event.phase}${duration ? ` ${duration}` : ''}]`
    const detail = event.detail === undefined ? '' : event.detail
    if (event.level === 'error') console.error(prefix, event.message, detail)
    else if (event.level === 'warn') console.warn(prefix, event.message, detail)
    else console.log(prefix, event.message, detail)
    xpcMain.broadcast('coach/codex-log', event)
  }
}

export const coworkWindowHelper = iocHelper.bind({
  controller: CoworkWindowHelper,
  services: [CoworkLlmService]
}) as CoworkWindowHelper

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

interface InjectedButtonTrigger {
  domain: string
  nonce: string
  skillTitle: string
  skillDescription: string
}

const INJECTED_BUTTON_ROOT_ID = '__micromeet_cowork_button_root__'

const normalizeInjectedButtonDomain = (value: string): string => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return raw.replace(/^www\./, '').replace(/\/.*$/, '')
  }
}

const parseInjectedButtonItems = (value: string): InjectBtnInput[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.skills)
        ? record.skills
        : parsed
          ? [parsed]
          : []
  const out: InjectBtnInput[] = []
  for (const item of rawItems.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const skillTitle = clipInline(firstNonEmptyString(rec.skillTitle, rec.title, rec.name), 90)
    if (!skillTitle) continue
    out.push({
      skillTitle,
      skillDescription: clipInline(firstNonEmptyString(rec.skillDescription, rec.description, rec.summary), 360)
    })
  }
  return out
}

const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

const groupInjectedButtonDomains = (entries: InjectBtnEntry[]): InjectedButtonDomain[] => {
  const byDomain = new Map<string, InjectedButtonDomain>()
  for (const entry of entries) {
    const domain = normalizeInjectedButtonDomain(entry.domain)
    if (!domain) continue
    const group = byDomain.get(domain) || { domain, triggers: [], updatedAt: 0 }
    group.triggers.push(entry)
    group.updatedAt = Math.max(group.updatedAt, entry.updatedAt || 0)
    byDomain.set(domain, group)
  }
  return Array.from(byDomain.values()).sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    return a.domain.localeCompare(b.domain)
  })
}

const removeInjectedButtonScript = (): string => `
(() => {
  const root = document.getElementById('__micromeet_cowork_button_root__');
  if (root) root.remove();
})();
`

const buildInjectedButtonScript = (domain: string, entries: InjectBtnEntry[], nonce: string): string => {
  const payload = {
    domain,
    nonce,
    entries: entries.map((entry) => ({
      skillTitle: entry.skillTitle,
      skillDescription: entry.skillDescription
    }))
  }
  return `
(() => {
  const payload = ${JSON.stringify(payload)};
  const rootId = ${JSON.stringify(INJECTED_BUTTON_ROOT_ID)};
  const old = document.getElementById(rootId);
  if (old) old.remove();
  if (!payload.entries.length || !document.body) return;

  const root = document.createElement('div');
  root.id = rootId;
  root.style.position = 'fixed';
  root.style.left = 'auto';
  root.style.right = '0';
  root.style.top = '42%';
  root.style.width = '0';
  root.style.height = '0';
  root.style.overflow = 'visible';
  root.style.zIndex = '2147483647';
  root.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  root.style.colorScheme = 'light';

  const style = document.createElement('style');
  style.textContent = \`
    #\${rootId}, #\${rootId} * { box-sizing: border-box; }
    #\${rootId} .mmc-btn {
      position: absolute;
      top: 0;
      right: 0;
      min-width: 128px;
      height: 48px;
      border: 0;
      border-radius: 999px;
      background: #165dff;
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      line-height: 48px;
      padding: 0 22px;
      cursor: grab;
      box-shadow: 0 12px 30px rgba(22, 93, 255, .28), 0 3px 10px rgba(15, 23, 42, .18);
      user-select: none;
      touch-action: none;
    }
    #\${rootId} .mmc-btn:active { cursor: grabbing; }
    #\${rootId} .mmc-modal {
      position: absolute;
      top: 58px;
      right: 8px;
      width: 292px;
      max-width: min(292px, calc(100vw - 28px));
      border: 1px solid rgba(148, 163, 184, .36);
      border-radius: 14px;
      background: #fff;
      color: #0f172a;
      box-shadow: 0 24px 70px rgba(15, 23, 42, .24);
      overflow: hidden;
    }
    #\${rootId}[data-side="left"] .mmc-modal {
      left: 8px;
      right: auto;
    }
    #\${rootId} .mmc-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      height: 38px;
      padding: 0 10px 0 12px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 800;
    }
    #\${rootId} .mmc-close {
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      font-size: 18px;
      line-height: 20px;
    }
    #\${rootId} .mmc-close:hover { background: #e2e8f0; color: #0f172a; }
    #\${rootId} .mmc-list {
      max-height: min(360px, calc(100vh - 120px));
      overflow: auto;
      padding: 6px;
    }
    #\${rootId} .mmc-row {
      display: block;
      width: 100%;
      border: 0;
      border-radius: 10px;
      background: transparent;
      padding: 9px 10px;
      text-align: left;
      cursor: pointer;
    }
    #\${rootId} .mmc-row:hover { background: #eef4ff; }
    #\${rootId} .mmc-title {
      display: block;
      color: #0f172a;
      font-size: 12px;
      font-weight: 800;
      line-height: 16px;
    }
    #\${rootId} .mmc-desc {
      display: block;
      margin-top: 3px;
      color: #64748b;
      font-size: 11px;
      font-weight: 500;
      line-height: 15px;
    }
  \`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mmc-btn';
  button.textContent = 'micromeet';
  button.setAttribute('aria-label', 'Open Micromeet skills');

  const modal = document.createElement('div');
  modal.className = 'mmc-modal';
  modal.hidden = true;
  modal.innerHTML = '<div class="mmc-head"><span>Micromeet skills</span><button type="button" class="mmc-close" aria-label="Close">×</button></div><div class="mmc-list"></div>';
  const list = modal.querySelector('.mmc-list');
  for (const item of payload.entries) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mmc-row';
    row.innerHTML = '<span class="mmc-title"></span><span class="mmc-desc"></span>';
    row.querySelector('.mmc-title').textContent = item.skillTitle || 'Untitled skill';
    row.querySelector('.mmc-desc').textContent = item.skillDescription || 'Trigger Cowork';
    row.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const params = new URLSearchParams({
        domain: payload.domain,
        nonce: payload.nonce,
        title: item.skillTitle || '',
        description: item.skillDescription || ''
      });
      window.open('micromeet-cowork://trigger?' + params.toString(), '_blank', 'noopener');
      modal.hidden = true;
    });
    list.appendChild(row);
  }

  root.appendChild(style);
  root.appendChild(button);
  root.appendChild(modal);
  root.dataset.side = 'right';
  document.body.appendChild(root);

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const edgeOffset = () => Math.max(1, Math.round(button.offsetHeight / 2));
  const place = (x, y) => {
    root.dataset.side = 'drag';
    root.style.left = clamp(x, 8, window.innerWidth - button.offsetWidth - 8) + 'px';
    root.style.right = 'auto';
    root.style.top = clamp(y, 8, window.innerHeight - button.offsetHeight - 8) + 'px';
    button.style.left = '0';
    button.style.right = 'auto';
    button.style.transform = 'none';
  };
  const dock = (side, top) => {
    const offset = edgeOffset();
    root.style.setProperty('--mmc-edge-offset', offset + 'px');
    root.dataset.side = side;
    root.style.left = side === 'left' ? '0' : 'auto';
    root.style.right = side === 'right' ? '0' : 'auto';
    root.style.top = clamp(top, 8, window.innerHeight - button.offsetHeight - 8) + 'px';
    button.style.left = side === 'left' ? '0' : 'auto';
    button.style.right = side === 'right' ? '0' : 'auto';
    button.style.transform = side === 'left' ? 'translateX(-' + offset + 'px)' : 'translateX(' + offset + 'px)';
  };
  const snap = () => {
    const rect = button.getBoundingClientRect();
    const side = rect.left + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
    dock(side, rect.top);
  };
  dock('right', window.innerHeight * 0.42);

  button.addEventListener('pointerdown', (event) => {
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    const rect = button.getBoundingClientRect();
    originX = rect.left;
    originY = rect.top;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
    place(originX + dx, originY + dy);
  });
  button.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    button.releasePointerCapture(event.pointerId);
    snap();
    if (!moved) modal.hidden = !modal.hidden;
  });
  modal.querySelector('.mmc-close').addEventListener('click', () => {
    modal.hidden = true;
  });
  window.addEventListener('resize', snap);
})();
`
}

const parseInjectedButtonTriggerUrl = (url: string): InjectedButtonTrigger | null => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'micromeet-cowork:' || parsed.hostname !== 'trigger') return null
    const domain = normalizeInjectedButtonDomain(parsed.searchParams.get('domain') || '')
    const nonce = parsed.searchParams.get('nonce') || ''
    const skillTitle = clipInline(parsed.searchParams.get('title') || '', 120)
    if (!domain || !nonce || !skillTitle) return null
    return {
      domain,
      nonce,
      skillTitle,
      skillDescription: clipInline(parsed.searchParams.get('description') || '', 500)
    }
  } catch {
    return null
  }
}

const injectedButtonTriggerMessage = (trigger: InjectedButtonTrigger): string =>
  [
    `Run injected webpage skill: ${trigger.skillTitle}`,
    `Domain: ${trigger.domain}`,
    trigger.skillDescription ? `Details: ${trigger.skillDescription}` : ''
  ]
    .filter(Boolean)
    .join('\n')

function formatDebugDuration(detail: unknown): string {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return ''
  const ms = Number((detail as { durationMs?: unknown }).durationMs)
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function appendActivityDuration(label: string, startedAt: number): string {
  const duration = formatDebugDuration({ durationMs: Date.now() - startedAt })
  return duration ? `${label} · ${duration}` : label
}

function apiActivityPhase(method: string): AgentActivityStep['phase'] {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) ? 'api-read' : 'api-call'
}

function apiActivityPath(url: string, baseUrl: string): string {
  try {
    const u = new URL(url, baseUrl)
    return u.pathname + u.search
  } catch {
    return url
  }
}

function describeApiAuthResolution(auth?: { header: string; source: string; key?: string; applied: boolean }[]): string {
  if (!auth?.length) return ''
  return auth
    .map((item) => {
      const source = item.applied ? item.source : 'missing'
      return item.key ? `${source}(${item.key})` : source
    })
    .join(', ')
}

// Turn a raw provider error into an actionable message. Codex returns a Cloudflare
// HTML interstitial when unreachable from a blocked network (already collapsed to
// one line upstream by sanitizeProviderError); surface it with a retry hint.
function describeModelError(provider: string, model: string, errorMessage: string): string {
  const head = `${providerLabel(provider)} (${model}) rejected the request: ${errorMessage}`
  if (/blocked|cloudflare|html error page|unreachable/i.test(errorMessage)) {
    return (
      head +
      '\n\nThe request was blocked or the provider is unreachable from this network. Check your proxy/VPN route to ' +
      'OpenAI (Codex is geo-restricted in some regions), then retry.'
    )
  }
  return head + '\n\nRetry once the provider is available, or check that the app is signed in to this provider.'
}

function describeAgentPromptError(provider: string, model: string, errorMessage: string): string {
  const backend = `${providerLabel(provider)} (${model})`
  if (/not signed in|auth file|missing provider|no provider credentials|credential/i.test(errorMessage)) {
    return `${backend} is not ready for this turn.\n\n${errorMessage}\n\nOpen AI Login for this provider, or switch to a provider/model that shows as signed in.`
  }
  if (/session start timed out/i.test(errorMessage)) {
    return (
      `${backend} did not finish starting within the timeout.\n\n` +
      'This usually means the coding-agent auth check or token refresh is stuck. The app now stops the turn instead of spinning forever. ' +
      'Open AI Login for this provider, then retry; if you were already logged in, the auth file may be in an older Cowork/Coach userData directory or the provider token may be expired.\n\n' +
      errorMessage
    )
  }
  if (/timed out/i.test(errorMessage)) {
    return (
      `${backend} timed out while handling the request.\n\n` +
      'The turn was stopped so the chat bubble will not keep spinning. Retry with a smaller recording, switch provider/model, or check whether the provider is reachable from this network.\n\n' +
      errorMessage
    )
  }
  return errorMessage
}

function hasRequiredInputs(recipe: SkillRecipe): boolean {
  return recipe.inputs.some((input) => input.required)
}

function requiredInputNames(recipe: SkillRecipe): string[] {
  return recipe.inputs.filter((input) => input.required).map((input) => input.name)
}

function requiredInputsSatisfied(recipe: SkillRecipe, variables: Record<string, string>): boolean {
  return recipe.inputs.every((input) => !input.required || Boolean(variables[input.name]))
}


// Per-turn context for the trainer agent: fresh skill catalog + recording summary.
// The pi session holds the dialogue history; the tools perform the actual CRUD.
function buildTrainerTurnPrompt(params: { message: string; skills: string; recording: string; currentUrl: string }): string {
  let domain = params.currentUrl
  try {
    domain = new URL(params.currentUrl).hostname
  } catch {
    /* keep raw */
  }
  // The trainer's role + rules live in CoachAgent.systemPrompt (sent once per session). This
  // per-turn prompt carries only what changes: the current site, its existing skills, the latest
  // recording to build from, and the user's message.
  return [
    `Current URL: ${params.currentUrl}`,
    `You train skills for THIS site only (${domain}). The skills below and any you create/optimize/delete belong to this domain; new skills are saved under it automatically.`,
    '',
    `Existing skills for ${domain}:`,
    params.skills,
    '',
    'Current capture quick index (not full evidence; use capture_timeline / capture_search / capture_event_detail for details before creating non-trivial skills):',
    params.recording,
    '',
    'User message:',
    params.message
  ].join('\n')
}

function summarizeRecordsForTrainer(records: IngestRecord[]): string {
  const events = records.map((record) => record.event)
  const actions = events.filter((e) => e.kind === 'action').length
  const net = events.filter((e) => e.kind === 'net.request' || e.kind === 'net.response').length
  if (actions === 0 && net === 0) return '(no active capture — Capture first to create a skill from a capture)'
  const lines = records
    .slice(-40)
    .map((record) => {
      const e = record.event
      const prefix = record.flagged ? '* ' : ''
      const suffix = record.spec?.trim() ? ` — ${record.spec.trim()}` : ''
      if (e.kind === 'action') return `${prefix}[ui] ${e.desc}${suffix}`
      if (e.kind === 'net.request') return `${prefix}[req] ${e.method} ${e.url}${suffix}`
      if (e.kind === 'net.response') return `${prefix}[res] ${e.status} ${e.url}${suffix}`
      if (e.kind === 'snapshot') return `${prefix}[snapshot] ${e.title || e.url}${suffix}`
      return ''
    })
    .filter(Boolean)
    .join('\n')
  const correlations = summarizeActionApiCorrelations(records, 8)
  return `${actions} UI steps, ${net} network events.\n${lines}${correlations ? `\nLikely UI→API links:\n${correlations}` : ''}`
}

// Value-free auth hint for the contract: from the recorded endpoints' headerPolicy, tell the
// agent WHICH header to send + WHERE to find the token live (candidate storage/cookie keys) +
// any prefix — but NEVER a token value (those are resolved live via read_context at call time).
function buildAuthHint(
  items: ReturnType<typeof collectApiReads>
): { header: string; resolve_from: string; candidate_keys: string[]; prefix?: string }[] {
  const byHeader = new Map<string, { header: string; resolve_from: string; candidate_keys: string[]; prefix?: string }>()
  for (const item of items) {
    for (const p of item.headerPolicy || []) {
      if (p.kind === 'static') continue
      const key = p.header.toLowerCase()
      if (byHeader.has(key)) continue
      byHeader.set(key, {
        header: p.header,
        resolve_from: 'live page localStorage / sessionStorage / cookie (read_context)',
        candidate_keys: Array.from(new Set([...(p.storageKeys || []), ...(p.cookieNames || [])])).slice(0, 10),
        prefix: p.prefix || undefined
      })
    }
  }
  return Array.from(byHeader.values())
}

function apiEndpointContract(
  item: ReturnType<typeof collectApiReads>[number],
  fallbackRole: 'option-read' | 'context-read' | 'write' | 'other'
): Record<string, unknown> {
  return {
    method: (item.method || 'GET').toUpperCase(),
    url: skillEndpointPath(item.url),
    role: item.apiRole || fallbackRole,
    replay: item.replaySafety || (fallbackRole === 'write' ? 'confirm' : 'safe'),
    body_kind: item.bodyKind || (item.requestBody ? 'raw' : 'none')
  }
}

function skillEndpointPath(url: string): string {
  try {
    const parsed = new URL(url)
    const params = Array.from(parsed.searchParams.keys())
    const query = params
      .map((key) => `${encodeURIComponent(key)}=<${skillEndpointVarName(key) || 'value'}>`)
      .join('&')
    return `${sanitizeSkillPath(parsed.pathname)}${query ? `?${query}` : ''}`
  } catch {
    const [path, query = ''] = url.split('?')
    const params = new URLSearchParams(query)
    const queryTemplate = Array.from(params.keys())
      .map((key) => `${encodeURIComponent(key)}=<${skillEndpointVarName(key) || 'value'}>`)
      .join('&')
    return `${sanitizeSkillPath(path)}${queryTemplate ? `?${queryTemplate}` : ''}`
  }
}

function sanitizeSkillPath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (
        /^[0-9]{5,}$/.test(decoded) ||
        /^[a-f0-9]{8,}-[a-f0-9-]{12,}$/i.test(decoded) ||
        /^[A-Za-z0-9_-]{16,}$/.test(decoded)
      ) {
        return ':id'
      }
      return segment
    })
    .join('/')
}

function skillEndpointVarName(label: string): string {
  return label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// One-line label for a record, used to attach its operator `spec` note to the
// right step in the ingest prompt.
type TimelineKindFilter = 'all' | 'ui' | 'api' | 'snapshot' | 'error'
type TimelineRequestEvent = Extract<TraceEvent, { kind: 'net.request' }>
type TimelineResponseEvent = Extract<TraceEvent, { kind: 'net.response' }>

interface TimelineIndex {
  requestById: Map<string, TimelineRequestEvent>
  responseById: Map<string, TimelineResponseEvent>
  requestIndexById: Map<string, number>
  responseIndexesById: Map<string, number[]>
}

interface ActionApiLink {
  requestId: string
  requestIndex: number
  responseIndex?: number
  deltaMs: number
  method: string
  url: string
  status?: number
  mime?: string
  resourceType?: string
  reason: string[]
  score: number
}

interface ActionApiLinkOptions {
  windowMs: number
  limit: number
}

function normalizeTimelineKind(value: unknown): TimelineKindFilter {
  const raw = String(value || 'all').toLowerCase()
  if (raw === 'ui' || raw === 'api' || raw === 'snapshot' || raw === 'error') return raw
  return 'all'
}

function normalizeTimelineLimit(value: unknown): number {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return 80
  return Math.max(1, Math.min(200, Math.floor(raw)))
}

function normalizeTimelineAround(value: unknown): number {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw < 0) return 2
  return Math.max(0, Math.min(20, Math.floor(raw)))
}

function normalizeApiWindowMs(value: unknown): number {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw < 0) return 5000
  return Math.max(0, Math.min(30_000, Math.floor(raw)))
}

function normalizeApiWindowLimit(value: unknown): number {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return 6
  return Math.max(1, Math.min(20, Math.floor(raw)))
}

function coerceToolBoolean(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes'
  return false
}

function timelineKindMatches(event: TraceEvent, kind: TimelineKindFilter): boolean {
  if (kind === 'all') return event.kind !== 'info'
  if (kind === 'ui') return event.kind === 'action' || event.kind === 'snapshot'
  if (kind === 'api') return event.kind === 'net.request' || event.kind === 'net.response'
  if (kind === 'snapshot') return event.kind === 'snapshot'
  if (kind === 'error') return event.kind === 'error'
  return true
}

function buildTimelineIndex(events: TraceEvent[]): TimelineIndex {
  const requestById = new Map<string, TimelineRequestEvent>()
  const responseById = new Map<string, TimelineResponseEvent>()
  const requestIndexById = new Map<string, number>()
  const responseIndexesById = new Map<string, number[]>()
  for (const [zeroIndex, event] of events.entries()) {
    const index = zeroIndex + 1
    if (event.kind === 'net.request') {
      requestById.set(event.requestId, event)
      requestIndexById.set(event.requestId, index)
    }
    if (event.kind === 'net.response') {
      responseById.set(event.requestId, event)
      const indexes = responseIndexesById.get(event.requestId) || []
      indexes.push(index)
      responseIndexesById.set(event.requestId, indexes)
    }
  }
  return { requestById, responseById, requestIndexById, responseIndexesById }
}

function buildActionApiLinks(records: IngestRecord[], timelineIndex: TimelineIndex, options: ActionApiLinkOptions): Map<number, ActionApiLink[]> {
  const out = new Map<number, ActionApiLink[]>()
  if (!options.windowMs) return out
  for (const [zeroIndex, record] of records.entries()) {
    const event = record.event
    if (event.kind !== 'action') continue
    const actionIndex = zeroIndex + 1
    const windowEndTs = actionApiWindowEndTs(records, zeroIndex, event.ts, options.windowMs)
    const links: ActionApiLink[] = []
    for (let i = zeroIndex + 1; i < records.length; i += 1) {
      const candidate = records[i].event
      if (candidate.ts > windowEndTs) break
      if (candidate.kind !== 'net.request') continue
      const response = timelineIndex.responseById.get(candidate.requestId)
      const link = buildActionApiLink(candidate, i + 1, response, timelineIndex.responseIndexesById.get(candidate.requestId)?.[0], event.ts)
      if (!link) continue
      links.push(link)
    }
    if (!links.length) continue
    const selected = links.length > options.limit
      ? links
          .slice()
          .sort((a, b) => b.score - a.score || a.requestIndex - b.requestIndex)
          .slice(0, options.limit)
          .sort((a, b) => a.requestIndex - b.requestIndex)
      : links
    out.set(actionIndex, selected)
  }
  return out
}

function actionApiWindowEndTs(records: IngestRecord[], actionZeroIndex: number, actionTs: number, windowMs: number): number {
  let endTs = actionTs + windowMs
  for (let i = actionZeroIndex + 1; i < records.length; i += 1) {
    const event = records[i].event
    if (event.kind === 'action' && event.ts > actionTs) {
      endTs = Math.min(endTs, event.ts - 1)
      break
    }
  }
  return endTs
}

function buildActionApiLink(
  request: TimelineRequestEvent,
  requestIndex: number,
  response: TimelineResponseEvent | undefined,
  responseIndex: number | undefined,
  actionTs: number
): ActionApiLink | null {
  const reasons = actionApiReasons(request, response)
  if (!reasons.length) return null
  const score = actionApiScore(request, response, reasons)
  return {
    requestId: request.requestId,
    requestIndex,
    responseIndex,
    deltaMs: Math.max(0, request.ts - actionTs),
    method: request.method,
    url: request.url,
    status: response?.status,
    mime: response?.mime,
    resourceType: request.resourceType,
    reason: reasons,
    score
  }
}

function actionApiReasons(request: TimelineRequestEvent, response?: TimelineResponseEvent): string[] {
  const reasons: string[] = []
  const method = request.method.toUpperCase()
  const resourceType = String(request.resourceType || '').toLowerCase()
  const url = request.url.toLowerCase()
  const mime = String(response?.mime || '').toLowerCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') reasons.push('mutation')
  if (request.postData) reasons.push('request_body')
  if (resourceType === 'xhr' || resourceType === 'fetch') reasons.push('xhr_fetch')
  if (/\/api(\/|$)|graphql|rpc|booking|patient|appointment|department|price|pricing/.test(url)) reasons.push('business_url')
  if (typeof response?.status === 'number' && response.status >= 400) reasons.push('http_error')
  if (/json|\+json/.test(mime)) reasons.push('json_response')
  if (!reasons.length && !isLikelyStaticAsset(request, response)) reasons.push('non_asset')
  if (isLikelyStaticAsset(request, response) && !reasons.some((reason) => reason === 'http_error')) return []
  return Array.from(new Set(reasons))
}

function actionApiScore(request: TimelineRequestEvent, response: TimelineResponseEvent | undefined, reasons: string[]): number {
  let score = 0
  if (reasons.includes('mutation')) score += 40
  if (reasons.includes('request_body')) score += 20
  if (reasons.includes('business_url')) score += 18
  if (reasons.includes('xhr_fetch')) score += 14
  if (reasons.includes('http_error')) score += 12
  if (reasons.includes('json_response')) score += 8
  if (reasons.includes('non_asset')) score += 2
  if (request.method.toUpperCase() === 'GET') score -= 4
  if (isLikelyStaticAsset(request, response)) score -= 50
  return score
}

function isLikelyStaticAsset(request: TimelineRequestEvent, response?: TimelineResponseEvent): boolean {
  const type = String(request.resourceType || '').toLowerCase()
  const mime = String(response?.mime || '').toLowerCase()
  const path = safeUrlPath(request.url).toLowerCase()
  if (['image', 'stylesheet', 'font', 'media'].includes(type)) return true
  if (/^(image|font|audio|video)\//.test(mime)) return true
  if (/text\/css|javascript/.test(mime) && !/\/api(\/|$)/.test(path)) return true
  return /\.(png|jpe?g|webp|gif|ico|svg|css|js|mjs|woff2?|ttf|map)(\?|$)/.test(path)
}

function safeUrlPath(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search
  } catch {
    return url
  }
}

function serializeActionApiLink(link: ActionApiLink): Record<string, unknown> {
  return {
    relation: 'api_after_action',
    requestId: link.requestId,
    requestIndex: link.requestIndex,
    responseIndex: link.responseIndex,
    deltaMs: link.deltaMs,
    method: link.method,
    url: link.url,
    status: link.status,
    mime: link.mime,
    resourceType: link.resourceType,
    reason: link.reason
  }
}

function summarizeActionApiCorrelations(records: IngestRecord[], maxLines: number): string {
  if (!records.length || maxLines <= 0) return ''
  const events = records.map((record) => record.event)
  const timelineIndex = buildTimelineIndex(events)
  const linksByAction = buildActionApiLinks(records, timelineIndex, { windowMs: 5000, limit: 4 })
  const lines: string[] = []
  for (const [actionIndex, links] of linksByAction) {
    const action = records[actionIndex - 1]?.event
    if (!action || action.kind !== 'action') continue
    const api = links
      .map((link) => `${link.method} ${clipText(link.url, 180)}${link.status ? ` -> ${link.status}` : ''} (+${link.deltaMs}ms, ${link.reason.join('/')})`)
      .join('; ')
    if (!api) continue
    lines.push(`- after [${actionIndex}] ${clipText(action.desc, 120)} => ${api}`)
    if (lines.length >= maxLines) break
  }
  return lines.join('\n')
}

function timelineRequestId(event: TraceEvent): string | undefined {
  return event.kind === 'net.request' || event.kind === 'net.response' ? event.requestId : undefined
}

function timelineSearchMatchesRecord(record: IngestRecord, tokens: string[]): boolean {
  if (!tokens.length) return true
  const text = [
    timelineSearchText(record.event),
    record.spec || '',
    record.flagged ? 'flagged key evidence operator starred important' : ''
  ]
    .join('\n')
    .toLowerCase()
  return tokens.every((token) => text.includes(token))
}

function timelineSearchText(event: TraceEvent): string {
  const parts = [event.kind, ingestEventLabel(event)]
  if (event.kind === 'net.request') {
    parts.push(event.method, event.url, event.resourceType || '', Object.keys(event.headers || {}).join(' '), event.postData || '')
  } else if (event.kind === 'net.response') {
    parts.push(String(event.status), event.url, event.mime, Object.keys(event.headers || {}).join(' '), event.bodyPreview || '', event.bodyOmittedReason || '')
  } else if (event.kind === 'action') {
    const target = event.step.target
    parts.push(
      event.type,
      event.url,
      event.selector || '',
      event.value || '',
      event.step.value || '',
      target.tag,
      target.role || '',
      target.name || '',
      target.label || '',
      target.text || '',
      target.placeholder || '',
      target.inputType || '',
      event.step.yaml || ''
    )
  } else if (event.kind === 'snapshot') {
    parts.push(event.url, event.title || '', event.yaml)
  } else {
    parts.push(event.msg)
  }
  return parts.filter(Boolean).join('\n')
}

function summarizeTimelineEvent(
  event: TraceEvent,
  index: number,
  includeBodies: boolean,
  includeHeaders: boolean,
  request?: TimelineRequestEvent
): Record<string, unknown> {
  const base = {
    index,
    kind: event.kind,
    ts: event.ts,
    time: new Date(event.ts).toISOString(),
    label: ingestEventLabel(event)
  }
  if (event.kind === 'net.request') {
    return {
      ...base,
      method: event.method,
      url: event.url,
      resourceType: event.resourceType,
      headers: summarizeTimelineHeaders(event.headers, includeHeaders),
      hasBody: !!event.postData,
      bodyPreview: includeBodies && event.postData ? clipText(event.postData, 1800) : undefined
    }
  }
  if (event.kind === 'net.response') {
    return {
      ...base,
      method: request?.method,
      url: event.url,
      status: event.status,
      mime: event.mime,
      requestIndexHint: request ? undefined : 'request event not found in memory window',
      headers: summarizeTimelineHeaders(event.headers, includeHeaders),
      bodyTruncated: event.bodyTruncated,
      bodyOmittedReason: event.bodyOmittedReason,
      bodyByteLength: event.bodyByteLength,
      bodyBase64Encoded: event.bodyBase64Encoded,
      bodyStreamed: event.bodyStreamed,
      bodyChunkCount: event.bodyChunkCount,
      decodedDataLength: event.decodedDataLength,
      encodedDataLength: event.encodedDataLength,
      bodyPreview: includeBodies && event.bodyPreview ? clipText(event.bodyPreview, 2400) : undefined
    }
  }
  if (event.kind === 'action') {
    const target = event.step.target
    return {
      ...base,
      action: event.type,
      url: event.url,
      selector: event.selector,
      target: {
        tag: target.tag,
        role: target.role,
        name: target.name,
        label: target.label,
        text: target.text,
        placeholder: target.placeholder,
        inputType: target.inputType
      },
      hasValue: !!(event.value || event.step.value),
      valuePreview: includeBodies && (event.value || event.step.value) ? clipText(String(event.value || event.step.value), 400) : undefined,
      yamlPreview: clipText(event.step.yaml || '', includeBodies ? 2200 : 900)
    }
  }
  if (event.kind === 'snapshot') {
    return {
      ...base,
      url: event.url,
      title: event.title,
      nodeCount: event.nodeCount,
      yamlPreview: clipText(event.yaml, includeBodies ? 4500 : 1600)
    }
  }
  return {
    ...base,
    message: event.msg
  }
}

function summarizeTimelineRecord(
  record: IngestRecord,
  index: number,
  includeBodies: boolean,
  includeHeaders: boolean,
  request?: TimelineRequestEvent,
  apiAfterAction?: ActionApiLink[]
): Record<string, unknown> {
  const summary = withCaptureRecordMeta(summarizeTimelineEvent(record.event, index, includeBodies, includeHeaders, request), record)
  if (record.event.kind === 'action' && apiAfterAction?.length) summary.apiAfterAction = apiAfterAction.map(serializeActionApiLink)
  return summary
}

function summarizeTimelineDetailRecord(
  record: IngestRecord,
  index: number,
  includeBodies: boolean,
  includeHeaders: boolean,
  timelineIndex: TimelineIndex,
  apiAfterAction?: ActionApiLink[]
): Record<string, unknown> {
  const summary = withCaptureRecordMeta(summarizeTimelineDetailEvent(record.event, index, includeBodies, includeHeaders, timelineIndex), record)
  if (record.event.kind === 'action' && apiAfterAction?.length) summary.apiAfterAction = apiAfterAction.map(serializeActionApiLink)
  return summary
}

function withCaptureRecordMeta(summary: Record<string, unknown>, record: IngestRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { ...summary }
  if (record.flagged) out.flagged = true
  if (record.spec?.trim()) out.operatorSpec = clipText(record.spec.trim(), 1200)
  return out
}

function summarizeTimelineDetailEvent(
  event: TraceEvent,
  index: number,
  includeBodies: boolean,
  includeHeaders: boolean,
  timelineIndex: TimelineIndex
): Record<string, unknown> {
  const requestId = timelineRequestId(event)
  const request = requestId ? timelineIndex.requestById.get(requestId) : undefined
  const summary = summarizeTimelineEvent(event, index, includeBodies, includeHeaders, request)
  if (event.kind === 'net.request') {
    return {
      ...summary,
      requestId: event.requestId,
      responseIndexes: timelineIndex.responseIndexesById.get(event.requestId) || [],
      headers: summarizeTimelineHeaders(event.headers, includeHeaders),
      bodyPreview: includeBodies && event.postData ? clipText(event.postData, 12_000) : undefined
    }
  }
  if (event.kind === 'net.response') {
    return {
      ...summary,
      requestId: event.requestId,
      requestIndex: timelineIndex.requestIndexById.get(event.requestId),
      headers: summarizeTimelineHeaders(event.headers, includeHeaders),
      bodyOmittedReason: event.bodyOmittedReason,
      bodyByteLength: event.bodyByteLength,
      bodyBase64Encoded: event.bodyBase64Encoded,
      bodyStreamed: event.bodyStreamed,
      bodyChunkCount: event.bodyChunkCount,
      decodedDataLength: event.decodedDataLength,
      encodedDataLength: event.encodedDataLength,
      bodyPreview: includeBodies && event.bodyPreview ? clipText(event.bodyPreview, 16_000) : undefined
    }
  }
  if (event.kind === 'action') {
    return {
      ...summary,
      valuePreview: includeBodies && (event.value || event.step.value) ? clipText(String(event.value || event.step.value), 1000) : undefined,
      yamlPreview: clipText(event.step.yaml || '', includeBodies ? 12_000 : 1800)
    }
  }
  if (event.kind === 'snapshot') {
    return {
      ...summary,
      yamlPreview: clipText(event.yaml, includeBodies ? 20_000 : 3000)
    }
  }
  return summary
}

function summarizeTimelineHeaders(headers: HeaderMap | undefined, includeValues: boolean): string[] | Record<string, string | string[]> {
  const keys = Object.keys(headers || {}).sort((a, b) => a.localeCompare(b))
  if (!includeValues) return keys
  const out: Record<string, string | string[]> = {}
  for (const key of keys) {
    const value = headers?.[key]
    if (value == null) continue
    out[key] = redactOrClipHeaderValue(key, value)
  }
  return out
}

function redactOrClipHeaderValue(key: string, value: string | string[]): string | string[] {
  if (/(authorization|cookie|token|secret|api[-_]key|set-cookie)/i.test(key)) return '<redacted>'
  if (Array.isArray(value)) return value.map((item) => clipText(item, 300))
  return clipText(value, 500)
}

function captureTimelineHints(params: {
  capturing: boolean
  total: number
  returned: number
  apiWindowMs: number
  includeBodies: boolean
  includeHeaders: boolean
}): string[] {
  const hints: string[] = []
  if (!params.total) hints.push('No captured events are in memory. Start Capture, perform the workflow, then read capture_timeline again.')
  if (params.total && !params.returned) hints.push('No events matched the selected kind filter.')
  if (!params.capturing && params.total) hints.push('Capture is currently stopped; this is the last in-memory recording.')
  if (params.apiWindowMs) hints.push('UI action rows may include apiAfterAction: likely business API requests triggered after that action within the configured window.')
  if (!params.includeBodies) hints.push('Payloads are hidden. Call again with include_bodies=true only if request/response bodies or UI fill values are needed.')
  if (!params.includeHeaders) hints.push('Header values are hidden. Call again with include_headers=true only if header shape is needed; auth/cookie values remain redacted.')
  return hints
}

function ingestEventLabel(event: TraceEvent): string {
  if (event.kind === 'action') return event.desc
  if (event.kind === 'net.request') return `${event.method} ${event.url}`
  if (event.kind === 'net.response') return `${event.status} ${event.url}`
  if (event.kind === 'snapshot') return `snapshot ${event.title || event.url}`
  return event.msg
}

function buildIngestSpecNotes(records: IngestRecord[], workflow?: string): string {
  const lines: string[] = []
  const cleanedWorkflow = workflow?.trim()
  if (cleanedWorkflow) lines.push(`- [workflow] ${cleanedWorkflow}`)
  for (const record of records) {
    const notes: string[] = []
    if (record.flagged) notes.push('flagged by operator as key evidence')
    if (record.spec && record.spec.trim()) notes.push(record.spec.trim())
    if (notes.length) lines.push(`- [${record.event.kind}] ${ingestEventLabel(record.event)} — ${notes.join('; ')}`)
  }
  const correlations = summarizeActionApiCorrelations(records, 14)
  if (correlations) lines.push(`[likely UI→API links]\n${correlations}`)
  return lines.join('\n')
}

function normalizePersistedCaptureRecordOptions(
  value: unknown
): { records: IngestRecord[]; workflow?: string; startedAt?: number; updatedAt: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as PersistedCaptureRecordOptions
  if (!Array.isArray(raw.records)) return null
  const records = raw.records.filter(isPersistedIngestRecord).map((record) => ({
    event: record.event,
    spec: record.spec?.trim() || undefined,
    flagged: record.flagged || undefined
  }))
  return {
    records,
    workflow: raw.workflow?.trim() || undefined,
    startedAt: Number.isFinite(raw.startedAt) && Number(raw.startedAt) > 0 ? Number(raw.startedAt) : undefined,
    updatedAt: Number.isFinite(raw.updatedAt) && Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : Date.now()
  }
}

function normalizeHostToolPolicies(value: unknown): HostToolPolicyMap {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const out: HostToolPolicyMap = {}
  for (const [key, itemValue] of Object.entries(raw)) {
    const item = itemValue && typeof itemValue === 'object' && !Array.isArray(itemValue) ? (itemValue as Record<string, unknown>) : {}
    const toolName = String(item.toolName || key || '').trim()
    if (!toolName) continue
    out[toolName] = {
      toolName,
      mode: normalizeHostToolPolicyMode(item.mode),
      updatedAt: Number.isFinite(Number(item.updatedAt)) && Number(item.updatedAt) > 0 ? Number(item.updatedAt) : Date.now()
    }
  }
  return out
}

function normalizeHostToolPolicyMode(value: unknown): HostToolPolicyMode {
  if (value === 'disabled') return 'disabled'
  if (value === 'confirm') return 'confirm'
  return 'bypass'
}

function isPersistedIngestRecord(value: unknown): value is IngestRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = (value as { event?: unknown }).event
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false
  const e = event as { kind?: unknown; ts?: unknown }
  return typeof e.kind === 'string' && typeof e.ts === 'number'
}

const COMPACT_CONTEXT_SYSTEM_PROMPT = [
  'SYSTEM: You are a context compaction engine for an ongoing coding/browser agent chat.',
  'Your job is to rewrite older conversation context into one cumulative memory summary that can replace those older turns.',
  'Use only the supplied previous summary and message excerpts. Do not invent facts, tool results, account state, URLs, IDs, or decisions.',
  'If a newer raw message conflicts with the previous summary, prefer the newer raw message and note the correction briefly.',
  'The previous summary is cumulative historical context. Merge it with the newly compacted range instead of appending duplicates.',
  'Preserve the previous summary as much as possible. It is acceptable for the cumulative summary to grow over time and consume more of the context window, as long as it stays within the hard output budget.',
  'Recent bridge messages are provided only to orient the boundary with newer uncompressed turns; do not over-summarize details that will remain verbatim.',
  'Preserve user goals, decisions, constraints, important data, browser/app state, unresolved tasks, failed attempts, and assumptions.',
  'Discard greetings, acknowledgements, duplicated wording, low-level token filler, and messages marked as stopped or unavailable.',
  'Output only the summary. No preface, no code fence.'
].join('\n')

function buildConversationCompactPrompt(params: AgentCompactRequest): string {
  const maxSummaryChars = Math.max(800, Math.min(500_000, Math.round(params.maxSummaryChars || 6000)))
  return [
    COMPACT_CONTEXT_SYSTEM_PROMPT,
    '',
    `Target context window: ${params.targetContextLabel || 'unknown'}`,
    `Hard output budget: ${maxSummaryChars} characters.`,
    '',
    'Required output shape:',
    '# Compact Summary',
    '## Durable Facts',
    '- ...',
    '## Current User Goal',
    '- ...',
    '## Decisions And Constraints',
    '- ...',
    '## Open Threads',
    '- ...',
    '## Recent Handoff Notes',
    '- ...',
    '',
    'Previous cumulative summary:',
    params.previousSummary?.trim() || '(none)',
    '',
    'Messages to compact, chronological:',
    formatCompactMessages(params.messages || []),
    '',
    'Recent bridge messages that remain verbatim after this compact, chronological:',
    formatCompactMessages(params.bridgeMessages || []),
    '',
    'Rewrite the previous summary plus messages-to-compact into the required shape. Keep it concise and bounded.'
  ].join('\n')
}

function formatCompactMessages(messages: AgentCompactRequest['messages']): string {
  if (!messages.length) return '(none)'
  return messages
    .map((message, index) => {
      const role = message.role === 'human' ? 'Human' : 'Assistant'
      const ts = message.ts ? new Date(message.ts).toISOString() : 'unknown-time'
      return `### ${index + 1}. ${role} (${ts})\n${clipText(message.content || '', 3000)}`
    })
    .join('\n\n')
}

function normalizeCompactSummary(text: string, maxChars: number): string {
  let out = String(text || '').trim()
  out = out.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```$/i, '').trim()
  return clipText(out, maxChars).trim()
}

// Per-turn context for the pi agent: fresh skill catalog + grounding discipline.
// The pi session itself holds the dialogue history, so only the catalog and rules
// are repeated here (they may change between turns as skills are ingested).
interface AgentSkillBrief {
  id: string
  name: string
  triggers: string[]
  description: string
  inputs: SkillSummary['inputs']
  seed: Record<string, string>
  missing: string[]
}

function buildAgentTurnPrompt(params: {
  message: string
  context?: AgentConversationContext
  includeConversationMemory?: boolean
  nowIso: string
  currentUrl: string
  briefs: AgentSkillBrief[]
}): string {
  let domain = params.currentUrl
  try {
    domain = new URL(params.currentUrl).hostname
  } catch {
    /* keep raw */
  }
  const selectedBriefs = selectAgentSkillBriefs(params.briefs, params.message)
  const omittedSkillCount = Math.max(0, params.briefs.length - selectedBriefs.length)
  const list = selectedBriefs.length
    ? selectedBriefs
        .map((c) => {
          const inputs = c.inputs.length
            ? c.inputs
                .slice(0, MAX_AGENT_SKILL_INPUTS)
                .map((input) => {
                  const required = input.required ? 'required' : 'optional'
                  const label = clipInline(input.label || input.name, 120)
                  const example = input.example ? `; example=${clipInline(JSON.stringify(input.example), 140)}` : ''
                  return `${clipInline(input.name, 100)} (${required}; label=${JSON.stringify(label)}${example})`
                })
                .concat(c.inputs.length > MAX_AGENT_SKILL_INPUTS ? [`... +${c.inputs.length - MAX_AGENT_SKILL_INPUTS} more inputs`] : [])
                .join(', ')
            : 'none'
          const seed = Object.keys(c.seed).length ? clipInline(JSON.stringify(c.seed), MAX_AGENT_SKILL_INLINE_CHARS) : 'none'
          const missing = c.missing.length ? c.missing.slice(0, MAX_AGENT_SKILL_INPUTS).map((item) => clipInline(item, 100)).join(', ') : 'none'
          const triggers = c.triggers
            .slice(0, MAX_AGENT_SKILL_TRIGGERS)
            .map((item) => clipInline(item, 80))
            .join(', ') || 'none'
          return [
            `- id: ${clipInline(c.id, 160)}`,
            `  name: ${clipInline(c.name, 160)}`,
            `  triggers: ${triggers}${c.triggers.length > MAX_AGENT_SKILL_TRIGGERS ? `, ... +${c.triggers.length - MAX_AGENT_SKILL_TRIGGERS} more` : ''}`,
            `  inputs: ${inputs}`,
            `  message_seed: ${seed}`,
            `  missing_after_seed: ${missing}`,
            `  description: ${clipInline(c.description, MAX_AGENT_SKILL_DESCRIPTION_CHARS)}`
          ].join('\n')
        })
        .concat(omittedSkillCount ? [`- ${omittedSkillCount} lower-relevance skills omitted from this turn's compact index. If no listed skill fits, use browser_use or ask the user to narrow the task.`] : [])
        .join('\n')
    : `(none recorded for ${domain})`
  const recentMessages = params.context?.recentMessages || []
  const recentContext = recentMessages.length
    ? recentMessages
        .map((item) => {
          const role = item.role === 'human' ? 'Human' : 'Assistant'
          return `- ${role} (${new Date(item.ts || Date.now()).toISOString()}): ${item.content}`
        })
        .join('\n')
    : '(none)'
  const compactSummary = params.context?.compactSummary?.trim() || '(none)'
  const workspace = params.context?.workspace
  const workspaceContext = workspace?.path
      ? [
          `Selected workspace: ${workspace.path}`,
          'Use workspace tools for project files: workspace_context, list_workspace_files, search_files, read_file, write_file, create_artifact.',
          'You may create/update files and generated artifacts inside this workspace. Do not delete, rename, move, or target the workspace directory itself.',
          'If a workspace tool reports workspace-not-found / workspace-not-directory, the app clears the stale reference; ask the user to choose the new location.'
        ].join('\n')
    : 'No workspace selected. create_artifact writes generated files to the app userData artifacts directory.'
  const memoryBlock = params.includeConversationMemory
    ? [
        'Conversation memory restored for this agent session:',
        'Compacted older context (summary of older turns):',
        compactSummary,
        '',
        'Recent conversation kept verbatim (newer turns override older summary if they conflict):',
        recentContext
      ]
    : ['Conversation memory: use the live pi session history for prior turns.']
  // The stable execution discipline lives in CoworkAgent.systemPrompt (sent once per session).
  // This per-turn prompt carries changing state. Persisted conversation memory is injected only
  // when a new pi session needs hydration; otherwise the pi session's own history is authoritative.
  return [
    `Context — now: ${params.nowIso} | page: ${params.currentUrl}`,
    `Recorded skills for THIS site (${domain}) — skills from other domains are not available here:`,
    list,
    '',
    'If the user explicitly asks for a chat-only answer, a model-token test, or says not to use browser tools,',
    'answer directly in chat and do not call page_snapshot or ui_act for that turn.',
    '',
    'If a recorded skill above fits the request, load and run it (the fast path). If NONE fit — or none',
    'are recorded — do NOT refuse: fall back to browser_use, i.e. page_snapshot to observe the page then',
    'ui_act to operate it, looping observe→act until the goal is reached.',
    '',
    'Workspace:',
    workspaceContext,
    '',
    ...memoryBlock,
    '',
    'User message:',
    params.message
  ].join('\n')
}

function selectAgentSkillBriefs(briefs: AgentSkillBrief[], message: string): AgentSkillBrief[] {
  if (briefs.length <= MAX_AGENT_SKILL_BRIEFS) return briefs
  const scored = briefs.map((brief, index) => ({
    brief,
    index,
    score: scoreAgentSkillBrief(brief, message)
  }))
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_AGENT_SKILL_BRIEFS)
    .map((item) => item.brief)
}

function scoreAgentSkillBrief(brief: AgentSkillBrief, message: string): number {
  let score = 0
  const seedCount = Object.keys(brief.seed).length
  if (seedCount) score += 80 + seedCount * 8
  if (brief.inputs.some((input) => input.required) && !brief.missing.length && seedCount) score += 80
  const queryTokens = tokenizeSkillCatalogText(message)
  const haystack = tokenizeSkillCatalogText([
    brief.name,
    brief.description,
    brief.triggers.join(' '),
    brief.inputs.map((input) => `${input.name} ${input.label || ''}`).join(' ')
  ].join(' '))
  for (const token of queryTokens) {
    if (haystack.has(token)) score += 6
  }
  const lowerMessage = message.toLowerCase()
  for (const trigger of brief.triggers) {
    const text = String(trigger || '').trim().toLowerCase()
    if (text && (lowerMessage.includes(text) || text.includes(lowerMessage))) score += 30
  }
  return score
}

function tokenizeSkillCatalogText(text: string): Set<string> {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9_\u4e00-\u9fff]+/i)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  )
}

function clipInline(value: unknown, max: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 3)) + '...'
}

function normalizeRecordedSiteHost(value: string | undefined): string {
  const text = String(value || '').trim()
  if (!text) return ''
  return hostFromUrl(text) || text.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase()
}

function recordedSiteHostMatches(actual: string, expected: string): boolean {
  if (!actual || !expected) return false
  return actual === expected || actual.endsWith(`.${expected}`) || expected.endsWith(`.${actual}`)
}

function recordedSiteDryRunUrl(endpoint: IntegrationEndpointContract): { ok: boolean; url?: string; error?: string } {
  if (endpoint.role !== 'read') return { ok: false, error: 'endpoint is not marked read' }
  const method = endpoint.method.toUpperCase()
  if (method !== 'GET') return { ok: false, error: `dry-run only supports GET endpoints, got ${method}` }
  let url: URL
  try {
    url = new URL(endpoint.urlTemplate)
  } catch {
    return { ok: false, error: 'endpoint url is not absolute' }
  }
  if (url.pathname.includes(':id') || /<[^>]+>/.test(url.pathname)) {
    return { ok: false, error: 'endpoint path needs a concrete source id' }
  }
  for (const [key, value] of Array.from(url.searchParams.entries())) {
    if (!/^<[^>]+>$/.test(value)) continue
    const lower = key.toLowerCase()
    if (lower === 'page' || lower === 'p') url.searchParams.set(key, '1')
    else if (lower === 'page_size' || lower === 'pagesize' || lower === 'limit' || lower === 'per_page' || lower === 'perpage') {
      url.searchParams.set(key, '20')
    } else {
      url.searchParams.delete(key)
    }
  }
  return { ok: true, url: url.toString() }
}

function recordedSiteEndpointNeedsRow(endpoint: IntegrationEndpointContract): boolean {
  if (endpoint.method.toUpperCase() !== 'GET') return false
  try {
    const url = new URL(endpoint.urlTemplate)
    if (url.pathname.split('/').some((part) => part.startsWith(':') || /<[^>]+>/.test(part))) return true
    return Array.from(url.searchParams.values()).some((value) => recordedSiteQueryPlaceholder(value))
  } catch {
    return /(^|\/):[A-Za-z_][A-Za-z0-9_]*|<[^>]+>/.test(endpoint.urlTemplate)
  }
}

function recordedSiteDetailEndpointsForEntity(
  endpoints: IntegrationEndpointContract[],
  entity: IntegrationEntity
): IntegrationEndpointContract[] {
  return endpoints.filter((endpoint) => {
    const detected = integrationEntityForEndpoint(endpoint, [entity])
    if (entity === 'mcu_record') return detected === 'mcu_record' || detected === 'mcu_report' || detected === 'patient'
    return detected === entity
  })
}

function recordedSiteRowDetailUrl(endpoint: IntegrationEndpointContract, row: unknown): { ok: boolean; url?: string; error?: string } {
  if (endpoint.role !== 'read') return { ok: false, error: 'endpoint is not marked read' }
  if (endpoint.method.toUpperCase() !== 'GET') return { ok: false, error: `detail fetch only supports GET endpoints, got ${endpoint.method}` }
  let url: URL
  try {
    url = new URL(endpoint.urlTemplate)
  } catch {
    return { ok: false, error: 'endpoint url is not absolute' }
  }
  const replacePlaceholder = (raw: string): string | null => {
    let out = raw
    const tokens = new Set<string>()
    const direct = raw.match(/^:([A-Za-z_][A-Za-z0-9_]*)$/)
    if (direct?.[1]) tokens.add(direct[1])
    for (const match of raw.matchAll(/<([^>]+)>/g)) tokens.add(match[1])
    for (const token of tokens) {
      const value = recordedSitePlaceholderValue(row, token)
      if (!value) return null
      out = out === `:${token}` ? value : out.replaceAll(`<${token}>`, value)
    }
    return out
  }
  const nextParts: string[] = []
  for (const part of url.pathname.split('/')) {
    const next = replacePlaceholder(part)
    if (next === null) return { ok: false, error: `${endpoint.path} missing detail id` }
    nextParts.push(next)
  }
  url.pathname = nextParts.join('/')
  for (const [key, value] of Array.from(url.searchParams.entries())) {
    const token = recordedSiteQueryPlaceholder(value)
    if (!token) continue
    const replacement = recordedSitePlaceholderValue(row, token)
    if (!replacement) return { ok: false, error: `${endpoint.path} missing query ${key}` }
    url.searchParams.set(key, replacement)
  }
  if (url.pathname.includes(':') || /<[^>]+>/.test(url.toString())) return { ok: false, error: `${endpoint.path} unresolved detail placeholder` }
  return { ok: true, url: url.toString() }
}

function recordedSiteQueryPlaceholder(value: string): string {
  const text = String(value || '').trim()
  const angle = text.match(/^<([^>]+)>$/)
  if (angle?.[1]) return angle[1]
  const colon = text.match(/^:([A-Za-z_][A-Za-z0-9_]*)$/)
  return colon?.[1] || ''
}

function recordedSitePlaceholderValue(row: unknown, token: string): string {
  const raw = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {}
  const normalized = normalizeRecordedSiteKey(token)
  const keys = Array.from(new Set([token, token.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`), `${token}_id`, `${token}Id`]))
  const direct = readRecordedSiteValue(raw, keys)
  if (direct) return direct
  if (normalized.includes('patient')) return readRecordedSiteValue(raw, recordedSiteSourceIdKeys('patient'))
  if (normalized.includes('corporate') || normalized.includes('client')) return readRecordedSiteValue(raw, recordedSiteSourceIdKeys('corporate'))
  if (normalized.includes('project') || normalized.includes('batch')) return readRecordedSiteValue(raw, recordedSiteSourceIdKeys('project'))
  if (normalized.includes('mcu') || normalized.includes('record')) {
    return readRecordedSiteValue(raw, ['mcu_record_id', 'mcuRecordId', 'outer_mcu_id', 'outerMcuId', 'record_id', 'recordId', 'mcu_id', 'mcuId', 'id'])
  }
  if (normalized === 'id') return sourceKeyForRecordedSiteRow(row)
  return ''
}

function mergeRecordedSiteRowDetails(row: unknown, details: unknown[]): unknown {
  const base = row && typeof row === 'object' && !Array.isArray(row) ? { ...(row as Record<string, unknown>) } : { value: row }
  details.forEach((detail, index) => {
    const payload = normalizeRecordedSitePayload(detail)
    if (!payload) return
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
        if (base[key] === undefined) base[key] = value
      }
    }
    base[`_detail_${index}`] = payload
  })
  return base
}

function recordedSiteRedactDetailUrl(value: string): string {
  try {
    const url = new URL(value)
    const path = url.pathname
      .split('/')
      .map((part) => (/^\d{5,}$/.test(part) || /^[0-9a-f-]{16,}$/i.test(part) || (part.length >= 20 && /\d/.test(part)) ? ':id' : part))
      .join('/')
    for (const key of Array.from(url.searchParams.keys())) url.searchParams.set(key, '<redacted>')
    return `${url.origin}${path}${url.search}`
  } catch {
    return value.replace(/[A-Za-z0-9_-]{20,}/g, ':id')
  }
}

function integrationEntityForEndpoint(endpoint: IntegrationEndpointContract, fallback: IntegrationEntity[]): IntegrationEntity {
  const text = `${endpoint.path} ${endpoint.urlTemplate}`.toLowerCase()
  if (/patient|patients/.test(text)) return 'patient'
  if (/corporate|corporates|client|clients|institution/.test(text)) return 'corporate'
  if (/project|projects|batch|batches/.test(text)) return 'project'
  if (/mapping|data-map|field-map|field_config|field-config/.test(text)) return 'data_mapping'
  if (/report|conclusion/.test(text)) return 'mcu_report'
  if (/mcu|record|records|observation|examination/.test(text)) return 'mcu_record'
  return fallback[0] || 'patient'
}

function extractRecordedSiteRows(value: unknown, maxRows: number): unknown[] {
  const seen = new Set<unknown>()
  const visit = (item: unknown, depth: number): unknown[] => {
    if (!item || depth > 4 || seen.has(item)) return []
    if (Array.isArray(item)) return item.slice(0, maxRows)
    if (typeof item !== 'object') return []
    seen.add(item)
    const raw = item as Record<string, unknown>
    for (const key of ['list', 'data', 'records', 'items', 'rows', 'results', 'patients', 'projects', 'corporates', 'clients']) {
      const child = raw[key]
      if (Array.isArray(child)) return child.slice(0, maxRows)
      const nested = visit(child, depth + 1)
      if (nested.length) return nested.slice(0, maxRows)
    }
    for (const child of Object.values(raw)) {
      const nested = visit(child, depth + 1)
      if (nested.length) return nested.slice(0, maxRows)
    }
    return []
  }
  return visit(value, 0).slice(0, maxRows)
}

function sourceKeyForRecordedSiteRow(row: unknown): string {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const raw = row as Record<string, unknown>
    const candidateKeys = [
      'id',
      '_id',
      'uuid',
      'source_id',
      'sourceId',
      'external_id',
      'externalId',
      'patient_id',
      'patientId',
      'project_id',
      'projectId',
      'corporate_id',
      'corporateId',
      'client_id',
      'clientId',
      'record_id',
      'recordId',
      'mcu_record_id',
      'mcuRecordId',
      'outer_mcu_id',
      'outerMcuId',
      'code'
    ]
    for (const key of candidateKeys) {
      const value = raw[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
  }
  return `hash:${stableSourceHash(row)}`
}

interface RecordedSiteRowPlan {
  action: 'create' | 'update' | 'noop' | 'conflict'
  missingFields: string[]
}

function recordedSiteRowSyncPlan(
  entity: IntegrationEntity,
  row: unknown,
  mapping: IntegrationMappingEntry | undefined,
  sourceHash: string
): RecordedSiteRowPlan {
  const missingFields = recordedSiteRequiredFields(entity, row)
  if (mapping?.status === 'ignored') return { action: 'noop', missingFields }
  if (mapping?.status === 'conflict') return { action: 'conflict', missingFields }
  if (!mapping?.aiCrmsId) return { action: 'create', missingFields }
  if (mapping.sourceHash && sourceHash && mapping.sourceHash !== sourceHash) return { action: 'update', missingFields }
  return { action: 'noop', missingFields }
}

function recordedSiteRequiredFields(entity: IntegrationEntity, row: unknown): string[] {
  const raw = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {}
  const missing: string[] = []
  if (entity === 'patient' && !hasRecordedSiteField(raw, ['full_name', 'fullName', 'name', 'patient_name', 'patientName'])) {
    missing.push('patient full_name/name')
  }
  if (entity === 'corporate' && !hasRecordedSiteField(raw, ['name', 'corporate_name', 'corporateName', 'client_name', 'clientName', 'company_name', 'companyName'])) {
    missing.push('corporate name')
  }
  if (entity === 'project' && !hasRecordedSiteField(raw, ['name', 'project_name', 'projectName', 'batch_name', 'batchName', 'code'])) {
    missing.push('project name/code')
  }
  if (entity === 'data_mapping') {
    if (!hasRecordedSiteField(raw, ['mcu_type', 'mcuType', 'type', 'category'])) missing.push('mcu_type')
    if (!hasRecordedSiteField(raw, ['column_name', 'columnName', 'field_name', 'fieldName', 'source_value', 'sourceValue'])) {
      missing.push('mapping column/source')
    }
  }
  if (entity === 'mcu_record' && !hasRecordedSiteField(raw, ['patient_id', 'patientId', 'patient_name', 'patientName', 'record_id', 'recordId', 'mcu_record_id', 'mcuRecordId', 'outer_mcu_id', 'outerMcuId', 'mcu_id', 'mcuId'])) {
    missing.push('mcu patient/record identity')
  }
  if (entity === 'mcu_report' && !hasRecordedSiteField(raw, ['mcu_record_id', 'mcuRecordId', 'record_id', 'recordId', 'report_id', 'reportId'])) {
    missing.push('report record identity')
  }
  return missing
}

function hasRecordedSiteField(raw: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = readRecordedSiteValue(raw, [key])
    if (value) return true
  }
  return false
}

const RECORDED_SITE_APPLY_ENTITIES: IntegrationEntity[] = ['patient', 'corporate', 'project', 'data_mapping', 'mcu_record']

function normalizeRecordedSiteApplyEntities(values: unknown): IntegrationEntity[] {
  const requested = Array.isArray(values)
    ? values.map((item) => String(item || '').trim())
    : typeof values === 'string'
      ? values.split(',').map((item) => item.trim())
      : []
  const filtered = requested.filter((item): item is IntegrationEntity =>
    RECORDED_SITE_APPLY_ENTITIES.includes(item as IntegrationEntity)
  )
  return filtered.length ? Array.from(new Set(filtered)) : RECORDED_SITE_APPLY_ENTITIES
}

interface RecordedSiteAiCrmsBodyOptions {
  action: 'create' | 'update'
  mapping?: IntegrationMappingEntry
  dependencyMappings?: {
    patient?: Map<string, IntegrationMappingEntry>
    corporate?: Map<string, IntegrationMappingEntry>
    project?: Map<string, IntegrationMappingEntry>
  }
}

interface RecordedSiteAiCrmsBody {
  body: Record<string, unknown>
  missing: string[]
}

interface RecordedSiteAiCrmsCommandPlan {
  name: string
  args: string[]
  preview: string
  body: Record<string, unknown>
}

function recordedSiteAiCrmsBody(entity: IntegrationEntity, row: unknown, options: RecordedSiteAiCrmsBodyOptions): RecordedSiteAiCrmsBody {
  const raw = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {}
  const body: Record<string, unknown> = {}
  const missing: string[] = []
  if (options.action === 'update') {
    const id = options.mapping?.aiCrmsId || readRecordedSiteValue(raw, ['ai_crms_id', 'aiCrmsId'])
    if (id) {
      if (entity === 'mcu_record') body.mcu_record_id = id
      else body.id = id
    } else {
      missing.push('AI-CRMS id')
    }
  }
  if (entity === 'patient') {
    putIfPresent(body, 'full_name', readRecordedSiteValue(raw, ['full_name', 'fullName', 'name', 'patient_name', 'patientName']))
    putIfPresent(body, 'gender', normalizeRecordedSiteGender(readRecordedSiteValue(raw, ['gender', 'sex', 'jenis_kelamin', 'jenisKelamin'])))
    putIfPresent(body, 'birth_date', readRecordedSiteValue(raw, ['birth_date', 'birthDate', 'date_of_birth', 'dateOfBirth', 'dob', 'tanggal_lahir', 'tanggalLahir']))
    putIfPresent(body, 'national_id', readRecordedSiteValue(raw, ['national_id', 'nationalId', 'nik', 'identity_no', 'identityNo', 'ktp']))
    putIfPresent(body, 'phone', readRecordedSiteValue(raw, ['phone', 'phone_number', 'phoneNumber', 'mobile', 'telephone', 'tel']))
    putIfPresent(body, 'ihs_number', readRecordedSiteValue(raw, ['ihs_number', 'ihsNumber', 'ihs', 'social_security_no', 'socialSecurityNo']))
    putIfPresent(body, 'address', readRecordedSiteValue(raw, ['address', 'alamat']))
    putIfPresent(body, 'status', readRecordedSiteValue(raw, ['status']))
    putIfPresent(body, 'note', readRecordedSiteValue(raw, ['note', 'notes', 'remark', 'remarks']))
    if (!body.full_name) missing.push('patient full_name/name')
  } else if (entity === 'corporate') {
    putIfPresent(body, 'name', readRecordedSiteValue(raw, ['name', 'corporate_name', 'corporateName', 'client_name', 'clientName', 'company_name', 'companyName']))
    putIfPresent(body, 'code', readRecordedSiteValue(raw, ['code', 'corporate_code', 'corporateCode', 'client_code', 'clientCode']))
    putIfPresent(body, 'address', readRecordedSiteValue(raw, ['address', 'alamat']))
    putIfPresent(body, 'status', readRecordedSiteValue(raw, ['status']))
    putIfPresent(body, 'note', readRecordedSiteValue(raw, ['note', 'notes', 'remark', 'remarks']))
    putIfPresent(body, 'prompt', readRecordedSiteValue(raw, ['prompt']))
    if (!body.name) missing.push('corporate name')
  } else if (entity === 'project') {
    putIfPresent(body, 'name', readRecordedSiteValue(raw, ['name', 'project_name', 'projectName', 'batch_name', 'batchName']))
    putIfPresent(body, 'code', readRecordedSiteValue(raw, ['code', 'project_code', 'projectCode', 'batch_code', 'batchCode']))
    putIfPresent(body, 'corporate_id', recordedSiteMappedTargetId(raw, ['corporate'], options.dependencyMappings))
    putIfPresent(body, 'status', readRecordedSiteValue(raw, ['status']))
    putIfPresent(body, 'batch_date', readRecordedSiteValue(raw, ['batch_date', 'batchDate']))
    putIfPresent(body, 'period_start', readRecordedSiteValue(raw, ['period_start', 'periodStart', 'start_date', 'startDate']))
    putIfPresent(body, 'period_end', readRecordedSiteValue(raw, ['period_end', 'periodEnd', 'end_date', 'endDate']))
    putIfPresent(body, 'note', readRecordedSiteValue(raw, ['note', 'notes', 'remark', 'remarks']))
    putIfPresent(body, 'prompt', readRecordedSiteValue(raw, ['prompt']))
    if (!body.name && !body.code) missing.push('project name/code')
    if (!body.corporate_id) missing.push('project corporate_id/corporate mapping')
  } else if (entity === 'data_mapping') {
    putIfPresent(body, 'mcu_type', readRecordedSiteValue(raw, ['mcu_type', 'mcuType', 'type', 'category', 'exam_type', 'examType']))
    putIfPresent(body, 'column_name', readRecordedSiteValue(raw, ['column_name', 'columnName', 'field_name', 'fieldName', 'source_value', 'sourceValue', 'name', 'column']))
    putIfPresent(body, 'system_field', readRecordedSiteValue(raw, ['system_field', 'systemField', 'target_field', 'targetField', 'ai_crms_field', 'aiCrmsField']))
    putIfPresent(body, 'status', readRecordedSiteValue(raw, ['status']))
    putIfPresent(body, 'check_unit', readRecordedSiteValue(raw, ['check_unit', 'checkUnit', 'unit']))
    putIfPresent(body, 'check_method', readRecordedSiteValue(raw, ['check_method', 'checkMethod', 'method']))
    putIfPresent(body, 'reference', readRecordedSiteValue(raw, ['reference', 'reference_range', 'referenceRange', 'normal_range', 'normalRange']))
    if (!body.mcu_type) missing.push('mcu_type')
    if (!body.column_name) missing.push('mapping column/source')
  } else if (entity === 'mcu_record') {
    if (options.action === 'create') {
      putIfPresent(body, 'source_institution_id', readRecordedSiteValue(raw, ['source_institution_id', 'sourceInstitutionId', 'institution_id', 'institutionId']))
      putIfPresent(body, 'patient_id', recordedSiteMappedTargetId(raw, ['patient'], options.dependencyMappings))
      putIfPresent(body, 'medical_client_id', readRecordedSiteValue(raw, ['medical_client_id', 'medicalClientId', 'client_id', 'clientId']))
      putIfPresent(body, 'corporate_id', recordedSiteMappedTargetId(raw, ['corporate'], options.dependencyMappings))
      putIfPresent(body, 'project_id', recordedSiteMappedTargetId(raw, ['project'], options.dependencyMappings))
      putIfPresent(body, 'outer_mcu_id', readRecordedSiteValue(raw, ['outer_mcu_id', 'outerMcuId', 'mcu_id', 'mcuId', 'record_id', 'recordId', 'code']))
      putIfPresent(body, 'operator_user_id', readRecordedSiteValue(raw, ['operator_user_id', 'operatorUserId', 'doctor_id', 'doctorId', 'staff_id', 'staffId']))
      putIfPresent(body, 'user_type', readRecordedSiteValue(raw, ['user_type', 'userType', 'type']))
      if (!body.patient_id) missing.push('mcu patient mapping')
    } else {
      const basicInfo = recordedSitePatientInfoPayload(raw)
      const companyInfo = recordedSitePayload(raw, ['company_info', 'companyInfo', 'corporate_info', 'corporateInfo', 'project_info', 'projectInfo'])
      const diagnosticData = recordedSitePayload(raw, [
        'diagnostic_data',
        'diagnosticData',
        'examination_data',
        'examinationData',
        'observation',
        'observations',
        'results',
        'items'
      ])
      const reportType = normalizeRecordedSiteReportType(
        readRecordedSiteValue(raw, ['report_type', 'reportType', 'mcu_type', 'mcuType', 'exam_type', 'examType', 'category', 'type']) ||
          inferRecordedSiteReportType(diagnosticData)
      )
      const conclusion = recordedSiteConclusionPayload(raw)
      putUnknownIfPresent(body, 'basic_info', basicInfo)
      putUnknownIfPresent(body, 'company_info', companyInfo)
      putUnknownIfPresent(body, 'diagnostic_data', diagnosticData)
      putIfPresent(body, 'report_type', reportType)
      if (conclusion.conclusion_findings) body.conclusion_findings = conclusion.conclusion_findings
      if (conclusion.recommendations) body.recommendations = conclusion.recommendations
      if (conclusion.fitness) body.fitness = conclusion.fitness
      putIfPresent(body, 'conclusion_report_type', normalizeRecordedSiteReportType(conclusion.report_type) || 'individual_conclusion')
      if (body.diagnostic_data && !body.report_type) missing.push('mcu diagnostic report_type')
      if (!body.basic_info && !body.company_info && !body.diagnostic_data && !body.conclusion_findings && !body.recommendations && !body.fitness) {
        missing.push('mcu update payload')
      }
    }
  }
  return { body, missing }
}

function recordedSiteAiCrmsCommands(
  entity: IntegrationEntity,
  action: 'create' | 'update',
  body: Record<string, unknown>
): RecordedSiteAiCrmsCommandPlan[] {
  const bodyJson = JSON.stringify(body)
  if (entity === 'patient') {
    return [{
      name: `patient ${action}`,
      args: ['patients', action, '--body', bodyJson, '--json'],
      preview: `micromeet patients ${action} --body [redacted] --json`,
      body
    }]
  }
  if (entity === 'corporate') {
    return [{
      name: `corporate ${action}`,
      args: ['corporates', action, '--body', bodyJson, '--json'],
      preview: `micromeet corporates ${action} --body [redacted] --json`,
      body
    }]
  }
  if (entity === 'project') {
    return [{
      name: `project ${action}`,
      args: ['corporates', 'projects', action, '--body', bodyJson, '--json'],
      preview: `micromeet corporates projects ${action} --body [redacted] --json`,
      body
    }]
  }
  if (entity === 'data_mapping') {
    return [{
      name: `data-map ${action === 'update' ? 'upsert' : 'create'}`,
      args: ['mapping', 'data-map', 'upsert', '--body', bodyJson, '--json'],
      preview: `micromeet mapping data-map upsert --body [redacted] --json`,
      body
    }]
  }
  if (entity === 'mcu_record' && action === 'create') {
    return [{
      name: 'mcu record create',
      args: ['mcu', 'record', 'create', '--body', bodyJson, '--json'],
      preview: 'micromeet mcu record create --body [redacted] --json',
      body
    }]
  }
  if (entity === 'mcu_record' && action === 'update') {
    return recordedSiteMcuRecordUpdateCommands(body)
  }
  return []
}

function recordedSiteMcuRecordUpdateCommands(body: Record<string, unknown>): RecordedSiteAiCrmsCommandPlan[] {
  const mcuRecordId = stringFrom(body.mcu_record_id)
  if (!mcuRecordId) return []
  const commands: RecordedSiteAiCrmsCommandPlan[] = []
  if (body.basic_info || body.company_info) {
    const commandBody: Record<string, unknown> = { mcu_record_id: mcuRecordId }
    putUnknownIfPresent(commandBody, 'basic_info', body.basic_info)
    putUnknownIfPresent(commandBody, 'company_info', body.company_info)
    commands.push({
      name: 'mcu record patient-info update',
      args: ['mcu', 'record', 'patient-info', 'update', '--body', JSON.stringify(commandBody), '--json'],
      preview: 'micromeet mcu record patient-info update --body [redacted] --json',
      body: commandBody
    })
  }
  if (body.diagnostic_data) {
    const reportType = stringFrom(body.report_type)
    if (reportType) {
      const commandBody = {
        mcu_record_id: mcuRecordId,
        report_type: reportType,
        diagnostic_data: body.diagnostic_data
      }
      commands.push({
        name: 'mcu record diagnostic-data update',
        args: ['mcu', 'record', 'diagnostic-data', 'update', '--body', JSON.stringify(commandBody), '--json'],
        preview: 'micromeet mcu record diagnostic-data update --body [redacted] --json',
        body: commandBody
      })
    }
  }
  if (body.conclusion_findings || body.recommendations || body.fitness) {
    const commandBody: Record<string, unknown> = {
      mcu_record_id: mcuRecordId,
      report_type: stringFrom(body.conclusion_report_type) || 'individual_conclusion'
    }
    putIfPresent(commandBody, 'conclusion_findings', body.conclusion_findings)
    putIfPresent(commandBody, 'recommendations', body.recommendations)
    putIfPresent(commandBody, 'fitness', body.fitness)
    commands.push({
      name: 'mcu record conclusion update',
      args: ['mcu', 'record', 'conclusion', 'update', '--body', JSON.stringify(commandBody), '--json'],
      preview: 'micromeet mcu record conclusion update --body [redacted] --json',
      body: commandBody
    })
  }
  return commands
}

function recordedSiteMappedTargetId(
  raw: Record<string, unknown>,
  entityHints: Array<'patient' | 'corporate' | 'project'>,
  mappings?: RecordedSiteAiCrmsBodyOptions['dependencyMappings']
): string {
  for (const entity of entityHints) {
    const direct = readRecordedSiteValue(raw, recordedSiteDirectTargetIdKeys(entity))
    if (direct) return direct
    const source = readRecordedSiteValue(raw, recordedSiteSourceIdKeys(entity))
    const mapped = source ? mappings?.[entity]?.get(source)?.aiCrmsId : ''
    if (mapped) return mapped
  }
  return ''
}

function recordedSiteDirectTargetIdKeys(entity: 'patient' | 'corporate' | 'project'): string[] {
  if (entity === 'patient') return ['ai_crms_patient_id', 'aiCrmsPatientId', 'target_patient_id', 'targetPatientId']
  if (entity === 'corporate') return ['ai_crms_corporate_id', 'aiCrmsCorporateId', 'target_corporate_id', 'targetCorporateId']
  return ['ai_crms_project_id', 'aiCrmsProjectId', 'target_project_id', 'targetProjectId']
}

function recordedSiteSourceIdKeys(entity: 'patient' | 'corporate' | 'project'): string[] {
  if (entity === 'patient') {
    return ['patient_id', 'patientId', 'source_patient_id', 'sourcePatientId', 'national_id', 'nationalId', 'nik']
  }
  if (entity === 'corporate') {
    return ['corporate_id', 'corporateId', 'client_id', 'clientId', 'corporate_code', 'corporateCode', 'client_code', 'clientCode']
  }
  return ['project_id', 'projectId', 'batch_id', 'batchId', 'project_code', 'projectCode', 'batch_code', 'batchCode']
}

function recordedSiteSourceLabel(entity: IntegrationEntity, row: unknown): string | undefined {
  const raw = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {}
  const label =
    entity === 'patient'
      ? readRecordedSiteValue(raw, ['full_name', 'fullName', 'name', 'patient_name', 'patientName', 'phone'])
      : entity === 'corporate'
        ? readRecordedSiteValue(raw, ['name', 'corporate_name', 'corporateName', 'client_name', 'clientName', 'code'])
        : entity === 'project'
          ? readRecordedSiteValue(raw, ['name', 'project_name', 'projectName', 'batch_name', 'batchName', 'code'])
          : entity === 'data_mapping'
            ? readRecordedSiteValue(raw, ['column_name', 'columnName', 'field_name', 'fieldName', 'source_value', 'sourceValue'])
            : entity === 'mcu_record'
              ? readRecordedSiteValue(raw, ['outer_mcu_id', 'outerMcuId', 'mcu_id', 'mcuId', 'record_id', 'recordId', 'patient_name', 'patientName'])
              : ''
  return label ? clipInline(label, 80) : undefined
}

function aiCrmsIdFromResponse(value: unknown): string {
  const seen = new Set<unknown>()
  const visit = (item: unknown, depth: number): string => {
    if (!item || depth > 4 || seen.has(item)) return ''
    if (typeof item !== 'object' || Array.isArray(item)) return ''
    seen.add(item)
    const raw = item as Record<string, unknown>
    for (const key of [
      'id',
      'patient_id',
      'patientId',
      'corporate_id',
      'corporateId',
      'project_id',
      'projectId',
      'data_map_id',
      'dataMapId',
      'map_id',
      'mapId',
      'mcu_record_id',
      'mcuRecordId',
      'record_id',
      'recordId'
    ]) {
      const value = stringFrom(raw[key])
      if (value) return value
    }
    for (const key of ['data', 'patient', 'corporate', 'project', 'row', 'record']) {
      const nested = visit(raw[key], depth + 1)
      if (nested) return nested
    }
    for (const child of Object.values(raw)) {
      const nested = visit(child, depth + 1)
      if (nested) return nested
    }
    return ''
  }
  return visit(value, 0)
}

function putIfPresent(body: Record<string, unknown>, key: string, value: unknown): void {
  const text = stringFrom(value)
  if (text) body[key] = text
}

function putUnknownIfPresent(body: Record<string, unknown>, key: string, value: unknown): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string' && !value.trim()) return
  if (Array.isArray(value) && !value.length) return
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value as Record<string, unknown>).length) return
  body[key] = value
}

function stringFrom(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return ''
}

function recordedSitePayload(raw: Record<string, unknown>, keys: string[]): unknown {
  const wanted = new Set(keys.map(normalizeRecordedSiteKey))
  const seen = new Set<unknown>()
  const visit = (item: unknown, depth: number): unknown => {
    if (!item || depth > 3 || seen.has(item)) return undefined
    if (typeof item !== 'object' || Array.isArray(item)) return undefined
    seen.add(item)
    const record = item as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (!wanted.has(normalizeRecordedSiteKey(key))) continue
      return normalizeRecordedSitePayload(value)
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = visit(value, depth + 1)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }
  return visit(raw, 0)
}

function normalizeRecordedSitePayload(value: unknown): unknown {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return undefined
    if (/^[\[{]/.test(text)) {
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
    return text
  }
  if (Array.isArray(value)) return value.length ? value : undefined
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>
    return Object.keys(raw).length ? raw : undefined
  }
  return value
}

function recordedSitePatientInfoPayload(raw: Record<string, unknown>): unknown {
  const nested = recordedSitePayload(raw, ['basic_info', 'basicInfo', 'patient_info', 'patientInfo', 'personal_information', 'personalInformation'])
  if (nested) return nested
  const body: Record<string, unknown> = {}
  putIfPresent(body, 'full_name', readRecordedSiteValue(raw, ['full_name', 'fullName', 'name', 'patient_name', 'patientName']))
  putIfPresent(body, 'national_id', readRecordedSiteValue(raw, ['national_id', 'nationalId', 'nik', 'identity_no', 'identityNo', 'ktp']))
  putIfPresent(body, 'gender', normalizeRecordedSiteGender(readRecordedSiteValue(raw, ['gender', 'sex', 'jenis_kelamin', 'jenisKelamin'])))
  putIfPresent(body, 'date_of_birth', readRecordedSiteValue(raw, ['date_of_birth', 'dateOfBirth', 'birth_date', 'birthDate', 'dob', 'tanggal_lahir', 'tanggalLahir']))
  putIfPresent(body, 'checkup_age', readRecordedSiteValue(raw, ['checkup_age', 'checkupAge', 'age', 'umur']))
  putIfPresent(body, 'email', readRecordedSiteValue(raw, ['email', 'recipient_email', 'recipientEmail']))
  return Object.keys(body).length ? body : undefined
}

function recordedSiteConclusionPayload(raw: Record<string, unknown>): Record<string, string> {
  const nested = recordedSitePayload(raw, ['conclusion', 'individual_conclusion', 'individualConclusion', 'overall_mcu_results', 'overallMcuResults'])
  const source = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : raw
  return {
    report_type: readRecordedSiteValue(source, ['report_type', 'reportType']) || 'individual_conclusion',
    conclusion_findings: readRecordedSiteValue(source, ['conclusion_findings', 'conclusionFindings', 'findings', 'summary']),
    recommendations: readRecordedSiteValue(source, ['recommendations', 'recommendation', 'saran']),
    fitness: readRecordedSiteValue(source, ['fitness', 'fitness_for_work', 'fitnessForWork', 'fit_status', 'fitStatus'])
  }
}

function normalizeRecordedSiteReportType(value: string): string {
  const text = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!text) return ''
  if (['lab', 'laboratory', 'laboratory_examination', 'laboratorium'].includes(text)) return 'laboratory_examination'
  if (['xray', 'x_ray', 'roentgen', 'rontgen', 'radiology'].includes(text)) return 'radiology'
  if (['ecg', 'ekg', 'cardio', 'cardiology'].includes(text)) return 'cardiology'
  if (['audio', 'audiometry', 'audiometri'].includes(text)) return 'audiometry'
  if (['spiro', 'spirometry', 'spirometri'].includes(text)) return 'spirometry'
  if (['physical', 'physical_exam', 'physical_examination', 'pemeriksaan_fisik'].includes(text)) return 'physical_examination'
  if (['conclusion', 'individual', 'individual_conclusion'].includes(text)) return 'individual_conclusion'
  return text
}

function inferRecordedSiteReportType(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const reportType = normalizeRecordedSiteReportType(key)
    if (
      reportType === 'laboratory_examination' ||
      reportType === 'radiology' ||
      reportType === 'cardiology' ||
      reportType === 'audiometry' ||
      reportType === 'spirometry' ||
      reportType === 'physical_examination'
    ) {
      return reportType
    }
  }
  return ''
}

function normalizeRecordedSiteGender(value: string): string {
  const text = value.trim().toLowerCase()
  if (!text) return ''
  if (['m', 'male', 'man', 'laki-laki', 'laki', 'pria'].includes(text)) return 'male'
  if (['f', 'female', 'woman', 'perempuan', 'wanita'].includes(text)) return 'female'
  return value
}

function readRecordedSiteValue(raw: Record<string, unknown>, keys: string[]): string {
  const wanted = new Set(keys.map(normalizeRecordedSiteKey))
  const seen = new Set<unknown>()
  const visit = (item: unknown, depth: number): string => {
    if (!item || depth > 3 || seen.has(item)) return ''
    if (typeof item !== 'object' || Array.isArray(item)) return ''
    seen.add(item)
    const record = item as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (!wanted.has(normalizeRecordedSiteKey(key))) continue
      const text = stringFrom(value)
      if (text) return text
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = visit(value, depth + 1)
        if (nested) return nested
      }
    }
    return ''
  }
  return visit(raw, 0)
}

function normalizeRecordedSiteKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function stableSourceHash(value: unknown): string {
  return createHash('sha1').update(stableJson(value)).digest('hex').slice(0, 20)
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    const raw = value as Record<string, unknown>
    return `{${Object.keys(raw).sort().map((key) => `${JSON.stringify(key)}:${stableJson(raw[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hostFromUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function normalizeApiQuery(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') out[key] = item
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeCaptureToolMode(value: string): CaptureMode | undefined {
  const mode = value.trim().toLowerCase()
  if (mode === 'ui' || mode === 'api') return mode
  return undefined
}

function normalizeBrowserCommandId(value: unknown): string | undefined {
  const text = cleanShortText(value)
  if (!text) return undefined
  return text.replace(/\s+/g, '_').slice(0, 80)
}

function browserCommandHasMutatingFetch(cmd: BrowserCommand): boolean {
  if (cmd.command === 'fetch') return isMutatingHttpMethod(cmd.method)
  if (cmd.command === 'parallel') return cmd.commands.some(browserCommandHasMutatingFetch)
  return false
}

function isBrowserFetchResultCommand(command: string): boolean {
  return command === 'fetch' || command.endsWith('.fetch')
}

function normalizeBrowserExecAuth(value: unknown): AuthHint[] | undefined {
  const raw = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []
  const hints: AuthHint[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const rec = item as Record<string, unknown>
    const header = cleanHeaderName(rec.header)
    if (!header || isForbiddenDynamicAuthHeader(header)) continue
    const candidateKeys = uniqueStrings([
      ...asShortStringList(rec.candidateKeys),
      ...asShortStringList(rec.candidate_keys),
      ...asShortStringList(rec.keys),
      ...asShortStringList(rec.storageKeys),
      ...asShortStringList(rec.storage_keys),
      ...asShortStringList(rec.cookieNames),
      ...asShortStringList(rec.cookie_names)
    ]).slice(0, 16)
    const meta = cleanShortText(rec.meta)
    const prefix = cleanAuthPrefix(rec.prefix)
    if (!candidateKeys.length && !meta) continue
    hints.push({ header, candidateKeys, prefix, meta })
  }
  return hints.length ? hints : undefined
}

function mergeAuthHints(base: AuthHint[], extra?: AuthHint | AuthHint[] | null): AuthHint[] {
  const list = [...(base || []), ...(Array.isArray(extra) ? extra : extra ? [extra] : [])]
  const out: AuthHint[] = []
  const seen = new Set<string>()
  for (const hint of list) {
    if (!hint?.header || isForbiddenDynamicAuthHeader(hint.header)) continue
    const normalized: AuthHint = {
      header: cleanHeaderName(hint.header),
      candidateKeys: uniqueStrings(asShortStringList(hint.candidateKeys)).slice(0, 16),
      prefix: cleanAuthPrefix(hint.prefix),
      meta: cleanShortText(hint.meta)
    }
    if (!normalized.header || (!normalized.candidateKeys?.length && !normalized.meta)) continue
    const key = `${normalized.header.toLowerCase()}|${(normalized.candidateKeys || []).join(',')}|${normalized.meta || ''}|${normalized.prefix || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function sanitizeReplayHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const blocked = /^(authorization|cookie|set-cookie|host|origin|referer|user-agent|content-length)$/i
  const dynamicSecret = /(csrf|xsrf|token|secret|credential|session|jwt|bearer|api[-_]?key)/i
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (blocked.test(key) || dynamicSecret.test(key)) continue
    const lower = key.toLowerCase()
    if (lower.startsWith('sec-') || lower === 'accept-encoding') continue
    const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(', ') : raw == null ? '' : String(raw)
    if (text) out[key] = text
  }
  return Object.keys(out).length ? out : undefined
}

function cleanHeaderName(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,80}$/.test(text) ? text : ''
}

function isForbiddenDynamicAuthHeader(header: string): boolean {
  return /^(cookie|set-cookie|host|origin|referer|user-agent|content-length|proxy-authorization)$/i.test(header)
}

function cleanShortText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > 80 || /[\r\n]/.test(text) || looksLikeSecretLiteral(text)) return undefined
  return text
}

function cleanAuthPrefix(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value
  if (text.length > 40 || /[\r\n]/.test(text) || looksLikeSecretLiteral(text)) return undefined
  return text
}

function asShortStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanShortText(item))
    .filter((item): item is string => Boolean(item))
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function looksLikeSecretLiteral(value: string): boolean {
  return /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(value) ||
    /\bbearer\s+[A-Za-z0-9._~-]{12,}/i.test(value) ||
    /^[A-Za-z0-9._~-]{120,}$/.test(value)
}

function compactReplayData(value: unknown): unknown {
  if (typeof value === 'string') return clipText(value, 24_000)
  if (value == null || typeof value !== 'object') return value
  try {
    const text = JSON.stringify(value)
    if (text.length <= 24_000) return value
    return { truncated: true, preview: clipText(text, 24_000) }
  } catch {
    return String(value)
  }
}

function summarizeApprovalArgs(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((key) => !/(body|headers?|token|secret|cookie|password|credential|authorization)/i.test(key))
    .slice(0, 8)
  return keys.length ? `args: ${keys.join(', ')}` : 'args omitted'
}

function agentMediaMimeForPath(path: string): string {
  const ext = extname(path).toLowerCase()
  return AGENT_IMAGE_MIME_BY_EXT[ext] || AGENT_FILE_MIME_BY_EXT[ext] || 'application/octet-stream'
}

function replayResponsePreview(value: unknown): string | undefined {
  if (value === undefined) return undefined
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  const trimmed = text.trim()
  return trimmed ? clipText(trimmed, REPLAY_RESPONSE_PREVIEW_LIMIT) : undefined
}

function clipText(text: string, limit = TOOL_RESULT_LIMIT): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + `\n...[truncated ${text.length - limit} chars]`
}
