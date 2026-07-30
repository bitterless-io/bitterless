import type { IngestRecord } from '@maestro-shared/coach.api'
import type { HeaderMap, TraceEvent } from '@maestro-shared/trace.types'

const TOOL_RESULT_LIMIT = 8_000

export type TimelineKindFilter = 'all' | 'ui' | 'api' | 'snapshot' | 'error'
export type TimelineRequestEvent = Extract<TraceEvent, { kind: 'net.request' }>
export type TimelineResponseEvent = Extract<TraceEvent, { kind: 'net.response' }>

export interface TimelineIndex {
  requestById: Map<string, TimelineRequestEvent>
  responseById: Map<string, TimelineResponseEvent>
  requestIndexById: Map<string, number>
  responseIndexesById: Map<string, number[]>
}

export interface ActionApiLink {
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

export const clipText = (text: string, limit = TOOL_RESULT_LIMIT): string => {
  if (text.length <= limit) return text
  return text.slice(0, limit) + `\n...[truncated ${text.length - limit} chars]`
}

export const normalizeTimelineKind = (value: unknown): TimelineKindFilter => {
  const raw = String(value || 'all').toLowerCase()
  if (raw === 'ui' || raw === 'api' || raw === 'snapshot' || raw === 'error') return raw
  return 'all'
}

export const normalizeTimelineLimit = (value: unknown): number => {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return 80
  return Math.max(1, Math.min(200, Math.floor(raw)))
}

export const normalizeTimelineAround = (value: unknown): number => {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw < 0) return 2
  return Math.max(0, Math.min(20, Math.floor(raw)))
}

export const normalizeApiWindowMs = (value: unknown): number => {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw < 0) return 5000
  return Math.max(0, Math.min(30_000, Math.floor(raw)))
}

export const normalizeApiWindowLimit = (value: unknown): number => {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return 6
  return Math.max(1, Math.min(20, Math.floor(raw)))
}

export const coerceToolBoolean = (value: unknown): boolean => {
  if (value === true) return true
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes'
  return false
}

export const timelineKindMatches = (event: TraceEvent, kind: TimelineKindFilter): boolean => {
  if (kind === 'all') return event.kind !== 'info'
  if (kind === 'ui') return event.kind === 'action' || event.kind === 'snapshot'
  if (kind === 'api') return event.kind === 'net.request' || event.kind === 'net.response'
  if (kind === 'snapshot') return event.kind === 'snapshot'
  if (kind === 'error') return event.kind === 'error'
  return true
}

export const buildTimelineIndex = (events: TraceEvent[]): TimelineIndex => {
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

const actionApiWindowEndTs = (records: IngestRecord[], actionZeroIndex: number, actionTs: number, windowMs: number): number => {
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

const safeUrlPath = (url: string): string => {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search
  } catch {
    return url
  }
}

const isLikelyStaticAsset = (request: TimelineRequestEvent, response?: TimelineResponseEvent): boolean => {
  const type = String(request.resourceType || '').toLowerCase()
  const mime = String(response?.mime || '').toLowerCase()
  const path = safeUrlPath(request.url).toLowerCase()
  if (['image', 'stylesheet', 'font', 'media'].includes(type)) return true
  if (/^(image|font|audio|video)\//.test(mime)) return true
  if (/text\/css|javascript/.test(mime) && !/\/api(\/|$)/.test(path)) return true
  return /\.(png|jpe?g|webp|gif|ico|svg|css|js|mjs|woff2?|ttf|map)(\?|$)/.test(path)
}

const actionApiReasons = (request: TimelineRequestEvent, response?: TimelineResponseEvent): string[] => {
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

const actionApiScore = (request: TimelineRequestEvent, response: TimelineResponseEvent | undefined, reasons: string[]): number => {
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

const buildActionApiLink = (
  request: TimelineRequestEvent,
  requestIndex: number,
  response: TimelineResponseEvent | undefined,
  responseIndex: number | undefined,
  actionTs: number
): ActionApiLink | null => {
  const reasons = actionApiReasons(request, response)
  if (!reasons.length) return null
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
    score: actionApiScore(request, response, reasons)
  }
}

export const buildActionApiLinks = (
  records: IngestRecord[],
  timelineIndex: TimelineIndex,
  options: ActionApiLinkOptions
): Map<number, ActionApiLink[]> => {
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
      const link = buildActionApiLink(
        candidate,
        i + 1,
        response,
        timelineIndex.responseIndexesById.get(candidate.requestId)?.[0],
        event.ts
      )
      if (link) links.push(link)
    }
    if (!links.length) continue
    const selected =
      links.length > options.limit
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

const serializeActionApiLink = (link: ActionApiLink): Record<string, unknown> => ({
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
})

export const summarizeActionApiCorrelations = (records: IngestRecord[], maxLines: number): string => {
  if (!records.length || maxLines <= 0) return ''
  const timelineIndex = buildTimelineIndex(records.map((record) => record.event))
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

export const timelineRequestId = (event: TraceEvent): string | undefined =>
  event.kind === 'net.request' || event.kind === 'net.response' ? event.requestId : undefined

const ingestEventLabel = (event: TraceEvent): string => {
  if (event.kind === 'action') return event.desc
  if (event.kind === 'net.request') return `${event.method} ${event.url}`
  if (event.kind === 'net.response') return `${event.status} ${event.url}`
  if (event.kind === 'snapshot') return `snapshot ${event.title || event.url}`
  return event.msg
}

const timelineSearchText = (event: TraceEvent): string => {
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

export const timelineSearchMatchesRecord = (record: IngestRecord, tokens: string[]): boolean => {
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

const redactOrClipHeaderValue = (key: string, value: string | string[]): string | string[] => {
  if (/(authorization|cookie|token|secret|api[-_]key|set-cookie)/i.test(key)) return '<redacted>'
  if (Array.isArray(value)) return value.map((item) => clipText(item, 300))
  return clipText(value, 500)
}

const summarizeTimelineHeaders = (
  headers: HeaderMap | undefined,
  includeValues: boolean
): string[] | Record<string, string | string[]> => {
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

const summarizeTimelineEvent = (
  event: TraceEvent,
  index: number,
  includeBodies: boolean,
  includeHeaders: boolean,
  request?: TimelineRequestEvent
): Record<string, unknown> => {
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
  return { ...base, message: event.msg }
}

const withCaptureRecordMeta = (summary: Record<string, unknown>, record: IngestRecord): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...summary }
  if (record.flagged) out.flagged = true
  if (record.spec?.trim()) out.operatorSpec = clipText(record.spec.trim(), 1200)
  return out
}

export const summarizeTimelineRecord = (
  record: IngestRecord,
  index: number,
  includeBodies: boolean,
  includeHeaders: boolean,
  request?: TimelineRequestEvent,
  apiAfterAction?: ActionApiLink[]
): Record<string, unknown> => {
  const summary = withCaptureRecordMeta(
    summarizeTimelineEvent(record.event, index, includeBodies, includeHeaders, request),
    record
  )
  if (record.event.kind === 'action' && apiAfterAction?.length) {
    summary.apiAfterAction = apiAfterAction.map(serializeActionApiLink)
  }
  return summary
}

const summarizeTimelineDetailEvent = (
  event: TraceEvent,
  index: number,
  includeBodies: boolean,
  includeHeaders: boolean,
  timelineIndex: TimelineIndex
): Record<string, unknown> => {
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

export const summarizeTimelineDetailRecord = (
  record: IngestRecord,
  index: number,
  includeBodies: boolean,
  includeHeaders: boolean,
  timelineIndex: TimelineIndex,
  apiAfterAction?: ActionApiLink[]
): Record<string, unknown> => {
  const summary = withCaptureRecordMeta(
    summarizeTimelineDetailEvent(record.event, index, includeBodies, includeHeaders, timelineIndex),
    record
  )
  if (record.event.kind === 'action' && apiAfterAction?.length) {
    summary.apiAfterAction = apiAfterAction.map(serializeActionApiLink)
  }
  return summary
}

export const captureTimelineHints = (params: {
  capturing: boolean
  total: number
  returned: number
  apiWindowMs: number
  includeBodies: boolean
  includeHeaders: boolean
}): string[] => {
  const hints: string[] = []
  if (!params.total) hints.push('No captured events are in memory. Start Capture, perform the workflow, then read capture_timeline again.')
  if (params.total && !params.returned) hints.push('No events matched the selected kind filter.')
  if (!params.capturing && params.total) hints.push('Capture is currently stopped; this is the last in-memory recording.')
  if (params.apiWindowMs) hints.push('UI action rows may include apiAfterAction: likely business API requests triggered after that action within the configured window.')
  if (!params.includeBodies) hints.push('Payloads are hidden. Call again with include_bodies=true only if request/response bodies or UI fill values are needed.')
  if (!params.includeHeaders) hints.push('Header values are hidden. Call again with include_headers=true only if header shape is needed; auth/cookie values remain redacted.')
  return hints
}

export const buildIngestSpecNotes = (records: IngestRecord[], workflow?: string): string => {
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
