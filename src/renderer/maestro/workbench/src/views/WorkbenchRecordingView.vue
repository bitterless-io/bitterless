<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Dropdown, Empty, Message, Modal, Switch } from '@arco-design/web-vue'
import { IconDownload, IconFilter, IconSearch, IconX } from '@tabler/icons-vue'
import { useRouter } from 'vue-router'
import RecordItem from '@maestro-renderer/control/src/record/RecordItem.vue'
import RecordPreviewSheet from '@maestro-renderer/control/src/record/RecordPreviewSheet.vue'
import { fmtHeaders, statusBadge } from '@maestro-renderer/control/src/record/record.format'
import type { BrowserRequestReplayRequest, BrowserRequestReplayResult, CaptureExportFormat } from '@maestro-shared/coach.api'
import type { HeaderMap, NetworkTiming } from '@maestro-shared/trace.types'
import type { Row } from '@maestro-renderer/control/src/record/record.types'
import { workbenchStore as store } from '../workbench.store'
import CaptureFilterPanel from '../components/CaptureFilterPanel.vue'
import './WorkbenchRecordingView.less'

const router = useRouter()
const filterVisible = ref(false)
const selectedNetwork = computed(() => store.selectedNetworkDetail)
const replayingRequest = ref(false)
const replayResult = ref<BrowserRequestReplayResult | null>(null)

interface TimingRow {
  label: string
  valueMs: number
}

interface TimingSegment extends TimingRow {
  startMs: number
  color: string
}

type BodyKind = 'empty' | 'json' | 'form' | 'image' | 'raw'

interface BodyEntry {
  key: string
  value: string
}

interface BodyView {
  kind: BodyKind
  label: string
  text: string
  entries: BodyEntry[]
  imageSrc: string
  note: string
}

const rowRequestId = (row: Row): string => {
  const event = row.event
  return event.kind === 'net.request' || event.kind === 'net.response' ? event.requestId : ''
}

const rowKey = (row: Row, index: number): string => {
  const event = row.event
  if (event.kind === 'net.request' || event.kind === 'net.response') return `${event.kind}:${event.requestId}:${event.ts}`
  return `${row.kind}:${row.ts}:${index}`
}

const formatSize = (bytes?: number): string => {
  if (!bytes || bytes < 0) return '-'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

const formatDuration = (ms?: number): string => {
  if (ms === undefined) return '-'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  return `${Math.round(ms)} ms`
}

const timingSpan = (timing: NetworkTiming | undefined, start: keyof NetworkTiming, end: keyof NetworkTiming): number | undefined => {
  const a = timing?.[start]
  const b = timing?.[end]
  if (typeof a !== 'number' || typeof b !== 'number' || a < 0 || b < 0 || b < a) return undefined
  return b - a
}

const timingSegment = (
  timing: NetworkTiming | undefined,
  label: string,
  start: keyof NetworkTiming,
  end: keyof NetworkTiming,
  color: string
): TimingSegment | undefined => {
  const startMs = timing?.[start]
  const valueMs = timingSpan(timing, start, end)
  if (typeof startMs !== 'number' || typeof valueMs !== 'number' || valueMs < 0) return undefined
  return { label, startMs, valueMs, color }
}

const networkTimingRows = (timing?: NetworkTiming, totalMs?: number): TimingRow[] => {
  if (!timing) return []
  const rows: Array<TimingRow | undefined> = [
    { label: 'Proxy', valueMs: timingSpan(timing, 'proxyStart', 'proxyEnd') ?? -1 },
    { label: 'DNS', valueMs: timingSpan(timing, 'dnsStart', 'dnsEnd') ?? -1 },
    { label: 'Connect', valueMs: timingSpan(timing, 'connectStart', 'connectEnd') ?? -1 },
    { label: 'SSL', valueMs: timingSpan(timing, 'sslStart', 'sslEnd') ?? -1 },
    { label: 'Send', valueMs: timingSpan(timing, 'sendStart', 'sendEnd') ?? -1 },
    { label: 'Wait', valueMs: timingSpan(timing, 'sendEnd', 'receiveHeadersEnd') ?? -1 },
    typeof totalMs === 'number' && typeof timing.receiveHeadersEnd === 'number' && timing.receiveHeadersEnd >= 0 && totalMs >= timing.receiveHeadersEnd
      ? { label: 'Receive', valueMs: totalMs - timing.receiveHeadersEnd }
      : undefined
  ]
  return rows.filter((row): row is TimingRow => Boolean(row && row.valueMs >= 0))
}

const selectedTimingRows = computed(() => networkTimingRows(selectedNetwork.value?.timing, selectedNetwork.value?.durationMs))

const networkTimingSegments = (timing?: NetworkTiming, totalMs?: number): TimingSegment[] => {
  if (!timing) return []
  const segments: Array<TimingSegment | undefined> = [
    timingSegment(timing, 'Proxy', 'proxyStart', 'proxyEnd', '#64748b'),
    timingSegment(timing, 'DNS', 'dnsStart', 'dnsEnd', '#0f766e'),
    timingSegment(timing, 'Connect', 'connectStart', 'connectEnd', '#2563eb'),
    timingSegment(timing, 'SSL', 'sslStart', 'sslEnd', '#7c3aed'),
    timingSegment(timing, 'Send', 'sendStart', 'sendEnd', '#ca8a04'),
    timingSegment(timing, 'Wait', 'sendEnd', 'receiveHeadersEnd', '#dc2626'),
    typeof totalMs === 'number' && typeof timing.receiveHeadersEnd === 'number' && timing.receiveHeadersEnd >= 0 && totalMs >= timing.receiveHeadersEnd
      ? { label: 'Receive', startMs: timing.receiveHeadersEnd, valueMs: totalMs - timing.receiveHeadersEnd, color: '#0891b2' }
      : undefined
  ]
  return segments.filter((row): row is TimingSegment => Boolean(row && row.valueMs >= 0))
}

const selectedTimingSegments = computed(() => networkTimingSegments(selectedNetwork.value?.timing, selectedNetwork.value?.durationMs))

const selectedTimingScale = computed(() => {
  const total = selectedNetwork.value?.durationMs || 0
  const segmentEnd = selectedTimingSegments.value.reduce((max, row) => Math.max(max, row.startMs + row.valueMs), 0)
  return Math.max(1, total, segmentEnd)
})

const waterfallStyle = (row: TimingSegment): Record<string, string> => {
  const scale = selectedTimingScale.value
  const left = Math.max(0, Math.min(100, (row.startMs / scale) * 100))
  const width = Math.max(row.valueMs > 0 ? 1.8 : 1, Math.min(100 - left, (row.valueMs / scale) * 100))
  return {
    left: `${left.toFixed(2)}%`,
    width: `${width.toFixed(2)}%`,
    backgroundColor: row.color
  }
}

const formatHeaderBlock = (headers?: HeaderMap): string => fmtHeaders(headers) || '(none)'

const headerValue = (headers: HeaderMap | undefined, name: string): string => {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() !== target) continue
    return Array.isArray(value) ? value.join(', ') : String(value || '')
  }
  return ''
}

const normalizeMime = (mime?: string): string => String(mime || '').split(';')[0].trim().toLowerCase()

const bodyMime = (headers: HeaderMap | undefined, fallback?: string): string =>
  headerValue(headers, 'content-type') || fallback || ''

const isJsonBody = (text: string, mime?: string): boolean =>
  /(\+json|\/json|\bjson\b)/i.test(mime || '') || /^[\s\n\r]*[{[]/.test(text)

const isFormBody = (text: string, mime?: string): boolean =>
  /x-www-form-urlencoded|multipart\/form-data/i.test(mime || '') || (/^[^=&\s]+=[\s\S]*&?/.test(text) && text.includes('='))

const isImageBody = (text: string, mime?: string): boolean =>
  /^image\//.test(normalizeMime(mime)) || /^data:image\//i.test(text) || /^\s*<svg[\s>]/i.test(text)

const parseFormEntries = (text: string): BodyEntry[] => {
  if (!text.includes('=')) return []
  try {
    const params = new URLSearchParams(text)
    const entries = Array.from(params.entries()).map(([key, value]) => ({ key, value }))
    return entries.some((entry) => entry.key) ? entries : []
  } catch {
    return []
  }
}

const isBase64Text = (text: string): boolean => {
  const compact = text.replace(/\s+/g, '')
  return compact.length >= 24 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
}

const imageSrcForBody = (text: string, mime?: string, truncated?: boolean): string => {
  if (!text || truncated) return ''
  if (/^data:image\//i.test(text)) return text
  if (/image\/svg/i.test(mime || '') || /^\s*<svg[\s>]/i.test(text)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
  }
  const baseMime = normalizeMime(mime)
  if (/^image\//.test(baseMime) && isBase64Text(text)) return `data:${baseMime};base64,${text.replace(/\s+/g, '')}`
  return ''
}

const prettyBody = (body?: string | null, mime?: string): string => {
  const text = String(body || '')
  if (!text) return '(empty)'
  if (isJsonBody(text, mime)) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }
  return text
}

const omittedReasonText = (reason?: string): string => {
  if (reason === 'unsupported-mime') return 'not captured: unsupported mime'
  if (reason === 'too-large-image') return 'not captured: image too large'
  if (reason === 'binary') return 'not captured: binary body'
  if (reason === 'streaming') return 'not captured: streaming body'
  if (reason === 'get-body-failed') return 'not captured: body unavailable'
  if (reason === 'empty') return 'empty response'
  if (reason) return `not captured: ${reason}`
  return ''
}

const buildBodyView = (body: string | null | undefined, mime?: string, truncated?: boolean, omittedReason?: string): BodyView => {
  const text = String(body || '')
  const label = normalizeMime(mime) || 'raw'
  const reasonText = omittedReasonText(omittedReason)
  if (!text) {
    return {
      kind: 'empty',
      label: label === 'raw' ? 'empty' : label,
      text: reasonText || (/^image\//.test(label) ? '(image body not captured)' : '(empty)'),
      entries: [],
      imageSrc: '',
      note: reasonText
    }
  }
  const imageSrc = imageSrcForBody(text, mime, truncated)
  if (imageSrc) {
    return { kind: 'image', label: label || 'image', text, entries: [], imageSrc, note: 'preview' }
  }
  if (isJsonBody(text, mime)) {
    return { kind: 'json', label: 'json', text: prettyBody(text, mime), entries: [], imageSrc: '', note: '' }
  }
  if (isFormBody(text, mime)) {
    if (/multipart\/form-data/i.test(mime || '')) {
      return { kind: 'raw', label: 'multipart', text, entries: [], imageSrc: '', note: 'multipart preview' }
    }
    const entries = parseFormEntries(text)
    if (entries.length) return { kind: 'form', label: 'form', text, entries, imageSrc: '', note: '' }
  }
  return {
    kind: isImageBody(text, mime) ? 'image' : 'raw',
    label,
    text,
    entries: [],
    imageSrc: '',
    note: truncated && isImageBody(text, mime) ? 'preview truncated' : ''
  }
}

const selectedRequestBodyView = computed(() => {
  const detail = selectedNetwork.value
  return buildBodyView(detail?.requestBody, bodyMime(detail?.requestHeaders), detail?.requestBodyTruncated)
})

const selectedQueryEntries = computed<BodyEntry[]>(() => {
  const url = selectedNetwork.value?.url
  if (!url) return []
  try {
    return Array.from(new URL(url).searchParams.entries()).map(([key, value]) => ({ key, value }))
  } catch {
    return []
  }
})

const selectedResponseBodyView = computed(() => {
  const detail = selectedNetwork.value
  return buildBodyView(detail?.responseBody, bodyMime(detail?.responseHeaders, detail?.mime), detail?.responseBodyTruncated, detail?.responseBodyOmittedReason)
})

const browserExecUrl = (url: string): { url: string; query?: Record<string, string> } => {
  try {
    const parsed = new URL(url)
    const query: Record<string, string> = {}
    for (const [key, value] of parsed.searchParams.entries()) query[key] = value
    return {
      url: `${parsed.origin}${parsed.pathname || '/'}`,
      query: Object.keys(query).length ? query : undefined
    }
  } catch {
    return { url }
  }
}

const browserExecHeaders = (headers?: HeaderMap): Record<string, string> | undefined => {
  const safe: Record<string, string> = {}
  const blocked = /^(authorization|cookie|set-cookie|host|origin|referer|user-agent|content-length)$/i
  const dynamicSecret = /(csrf|xsrf|token|secret|credential|session|jwt|bearer|api[-_]?key)/i
  for (const [key, value] of Object.entries(headers || {})) {
    if (blocked.test(key) || dynamicSecret.test(key)) continue
    const lower = key.toLowerCase()
    if (lower.startsWith('sec-') || lower === 'accept-encoding') continue
    const text = Array.isArray(value) ? value.join(', ') : String(value)
    if (text) safe[key] = text
  }
  return Object.keys(safe).length ? safe : undefined
}

const browserExecBody = (body?: string | null, mime?: string): unknown => {
  const text = String(body || '')
  if (!text) return undefined
  if (/json/i.test(mime || '') || /^[\s\n\r]*[{[]/.test(text)) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

const buildBrowserFetchRequest = (): BrowserRequestReplayRequest | null => {
  const detail = selectedNetwork.value
  if (!detail) return null
  const target = browserExecUrl(detail.url)
  const call: BrowserRequestReplayRequest = {
    url: target.url,
    method: detail.method || 'GET'
  }
  if (target.query) call.query = target.query
  const headers = browserExecHeaders(detail.requestHeaders)
  if (headers) call.headers = headers
  const body = browserExecBody(detail.requestBody, bodyMime(detail.requestHeaders))
  if (body !== undefined) call.body = body
  return call
}

const copyBrowserExecCommand = async (): Promise<void> => {
  const call = buildBrowserFetchRequest()
  if (!call) return
  const command: Record<string, unknown> = {
    command: 'fetch',
    ...call
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify([command], null, 2))
    Message.success('Copied browser_exec fetch command')
  } catch (err) {
    Message.error('Copy failed: ' + (err as Error).message)
  }
}

const replayResultText = computed(() => {
  const result = replayResult.value
  if (!result) return ''
  if (result.error) return result.error
  if (typeof result.data === 'string') return result.data || '(empty)'
  if (result.data === undefined || result.data === null) return '(empty)'
  try {
    return JSON.stringify(result.data, null, 2)
  } catch {
    return String(result.data)
  }
})

const replayAuthText = computed(() => {
  const auth = replayResult.value?.auth || []
  if (!auth.length) return ''
  return auth.map((item) => `${item.header}: ${item.source}${item.key ? `(${item.key})` : ''}${item.applied ? '' : ' missing'}`).join(', ')
})

const isMutatingReplay = (method?: string): boolean => /^(POST|PUT|PATCH|DELETE)$/i.test(method || '')

const runBrowserReplay = async (call: BrowserRequestReplayRequest): Promise<void> => {
  replayingRequest.value = true
  replayResult.value = null
  try {
    const result = await store.replayBrowserRequest(call)
    replayResult.value = result
    if (result.ok) Message.success(`Replay returned ${result.status}`)
    else Message.error(result.error || `Replay failed: ${result.status}`)
  } catch (err) {
    const message = (err as Error).message
    replayResult.value = { ok: false, status: 0, error: message, durationMs: 0 }
    Message.error('Replay failed: ' + message)
  } finally {
    replayingRequest.value = false
  }
}

const replaySelectedRequest = async (): Promise<void> => {
  const call = buildBrowserFetchRequest()
  if (!call) return
  if (!isMutatingReplay(call.method)) {
    await runBrowserReplay(call)
    return
  }
  Modal.confirm({
    title: 'Replay request?',
    content: `${(call.method || 'GET').toUpperCase()} ${call.url} may change data on the live site. Continue?`,
    okText: 'Replay',
    cancelText: 'Cancel',
    onOk: () => runBrowserReplay(call)
  })
}

watch(selectedNetwork, () => {
  replayResult.value = null
})

const ingest = async (): Promise<void> => {
  const result = await store.ingest()
  if (result.ok) {
    Message.success(result.message)
    await router.push({ name: 'skills' })
    return
  }
  Message.error(result.message || result.error || 'Ingest failed')
}

const exportRecording = async (format: CaptureExportFormat = 'json'): Promise<void> => {
  const result = await store.exportRecording(format)
  if (result.ok) {
    const label = (result.format || format).toUpperCase()
    Message.success(result.path ? `Exported ${label} to ${result.path}` : `${label} capture exported`)
    return
  }
  if (!result.canceled) Message.error(result.error || 'Export failed')
}

const setActionCapture = async (value: boolean): Promise<void> => {
  await store.setRecordActions(value)
  if (value) Message.info('Start capturing actions')
  else Message.warning('Stop capturing actions')
}

const setNetworkCapture = async (value: boolean): Promise<void> => {
  await store.setRecordNetwork(value)
  if (value) Message.info('Start capturing network activity')
  else Message.warning('Stop capturing network activity')
}

const addCaptureRule = async (row: Row, type: 'whitelist' | 'blacklist'): Promise<void> => {
  const result = await store.addCaptureRuleForRow(row, type)
  if (!result.ok) {
    Message.warning('No host to add for this record')
    return
  }
  Message.success(`Added ${result.host} to ${type === 'whitelist' ? 'allowlist' : 'blocklist'}`)
  if (result.whitelistInactive) Message.info('Enable the allowlist in Network filter to apply it')
}
</script>

<template>
  <section class="workbench-recording">
    <div class="workbench-recording__main">
      <div class="workbench-recording__stats">
        <div class="workbench-recording__stat">
          <b class="workbench-recording__stat__value">{{ store.visibleRows.length }}</b>
          <span class="workbench-recording__stat__label">events</span>
        </div>
        <div class="workbench-recording__stat">
          <b class="workbench-recording__stat__value">{{ store.apiCount }}</b>
          <span class="workbench-recording__stat__label">api</span>
        </div>
        <div class="workbench-recording__stat">
          <b class="workbench-recording__stat__value">{{ store.uiCount }}</b>
          <span class="workbench-recording__stat__label">ui</span>
        </div>
        <div class="workbench-recording__stat">
          <b class="workbench-recording__stat__value">{{ store.flaggedCount }}</b>
          <span class="workbench-recording__stat__label">flagged</span>
        </div>
        <div class="workbench-recording__stat workbench-recording__stat--last">
          <b class="workbench-recording__stat__value">{{ store.tokenCount.toLocaleString() }}</b>
          <span class="workbench-recording__stat__label">tokens</span>
        </div>
      </div>

      <div class="workbench-recording__toolbar">
        <div class="workbench-recording__toolbar__left">
          <label
            name="recording__search"
            class="workbench-recording__search"
          >
            <IconSearch :size="14" class="workbench-recording__search__icon" />
            <input
              v-model="store.recordSearch"
              class="workbench-recording__search__input"
              placeholder="Search records"
            />
            <button
              v-if="store.recordSearch"
              type="button"
              class="workbench-recording__search__clear"
              title="Clear search"
              aria-label="Clear search"
              @click="store.clearRecordSearch()"
            >
              <IconX :size="13" />
            </button>
          </label>
          <div class="workbench-recording__filters">
            <button
              class="workbench-recording__filter"
              :class="{ 'workbench-recording__filter--active': !store.activeFilters.length }"
              type="button"
              @click="store.clearFilters()"
            >
              All
            </button>
            <button
              v-for="cat in store.filterCats"
              :key="cat.key"
              class="workbench-recording__filter"
              :class="{ 'workbench-recording__filter--active': store.activeFilters.includes(cat.key) }"
              type="button"
              @click="store.toggleFilter(cat.key)"
            >
              {{ cat.label }}
            </button>
          </div>
        </div>
        <div class="workbench-recording__toolbar__right">
          <label class="workbench-recording__capture-toggle">
            <span>Action</span>
            <Switch :model-value="store.recordActions" size="small" @change="(value) => setActionCapture(Boolean(value))" />
          </label>
          <label class="workbench-recording__capture-toggle">
            <span>Network</span>
            <Switch :model-value="store.recordNetwork" size="small" @change="(value) => setNetworkCapture(Boolean(value))" />
          </label>
          <Button size="mini" @click="filterVisible = true">
            <template #icon><IconFilter :size="14" /></template>
            Network filter
          </Button>
          <Dropdown trigger="click" :disabled="!store.visibleRows.length">
            <Button size="mini" :disabled="!store.visibleRows.length">
              <template #icon><IconDownload :size="14" /></template>
              Export
            </Button>
            <template #content>
              <button
                type="button"
                class="workbench-recording__export-option"
                @click="exportRecording('json')"
              >
                Capture JSON
              </button>
              <button
                type="button"
                class="workbench-recording__export-option"
                @click="exportRecording('har')"
              >
                HTTP Archive HAR
              </button>
            </template>
          </Dropdown>
        </div>
      </div>

      <div class="workbench-recording__records">
        <div class="workbench-recording__records-layout" :class="{ 'workbench-recording__records-layout--detail': selectedNetwork }">
          <div class="workbench-recording__records-list">
            <RecordItem
              v-for="(row, index) in store.displayedRows"
              :key="rowKey(row, index)"
              :row="row"
              :selected="Boolean(rowRequestId(row) && rowRequestId(row) === store.selectedNetworkRequestId)"
              @select="store.selectRecord(row)"
              @flag="store.toggleFlag(row)"
              @changed="store.markCaptureRecordsEdited()"
              @delete="store.deleteRow(row)"
              @allowlist="addCaptureRule(row, 'whitelist')"
              @blocklist="addCaptureRule(row, 'blacklist')"
            />
            <Empty
              v-if="!store.displayedRows.length"
              class="workbench-recording__empty"
              :description="store.visibleRows.length ? 'No records match the search or filter.' : 'No records'"
            />
          </div>

          <aside v-if="selectedNetwork" class="workbench-recording__detail">
            <div class="workbench-recording__detail__header">
              <div class="workbench-recording__detail__identity">
                <div class="workbench-recording__detail__title-row">
                  <span v-if="selectedNetwork.method" class="workbench-recording__badge workbench-recording__badge--primary">
                    {{ selectedNetwork.method }}
                  </span>
                  <span
                    v-if="selectedNetwork.status"
                    class="workbench-recording__badge"
                    :class="statusBadge(selectedNetwork.status)"
                  >
                    {{ selectedNetwork.status }}
                  </span>
                  <span class="workbench-recording__detail__path" :title="selectedNetwork.path">{{ selectedNetwork.path }}</span>
                </div>
                <div class="workbench-recording__detail__host" :title="selectedNetwork.url">{{ selectedNetwork.host }}</div>
              </div>
              <div class="workbench-recording__detail__actions">
                <button
                  type="button"
                  class="workbench-recording__detail__action"
                  :disabled="replayingRequest"
                  title="Replay this request in the live browser session"
                  @click="replaySelectedRequest"
                >
                  {{ replayingRequest ? 'Replaying' : 'Replay' }}
                </button>
                <button
                  type="button"
                  class="workbench-recording__detail__action"
                  title="Copy browser_exec fetch command"
                  @click="copyBrowserExecCommand"
                >
                  Copy command
                </button>
                <button
                  type="button"
                  class="workbench-recording__detail__action workbench-recording__detail__action--close"
                  title="Close detail"
                  aria-label="Close detail"
                  @click="store.clearNetworkSelection()"
                >
                  <IconX :size="15" />
                </button>
              </div>
            </div>

            <div class="workbench-recording__detail__body">
              <div class="workbench-recording__summary">
                <div class="workbench-recording__summary__item">
                  <span class="workbench-recording__summary__label">Duration</span>
                  <span class="workbench-recording__summary__value">{{ formatDuration(selectedNetwork.durationMs) }}</span>
                </div>
                <div class="workbench-recording__summary__item">
                  <span class="workbench-recording__summary__label">Size</span>
                  <span class="workbench-recording__summary__value">{{ formatSize(selectedNetwork.encodedDataLength) }}</span>
                </div>
                <div class="workbench-recording__summary__item">
                  <span class="workbench-recording__summary__label">Decoded</span>
                  <span class="workbench-recording__summary__value">{{ formatSize(selectedNetwork.decodedDataLength) }}</span>
                </div>
                <div class="workbench-recording__summary__item">
                  <span class="workbench-recording__summary__label">Chunks</span>
                  <span class="workbench-recording__summary__value">{{ selectedNetwork.responseBodyChunkCount ?? '-' }}</span>
                </div>
                <div class="workbench-recording__summary__item">
                  <span class="workbench-recording__summary__label">Type</span>
                  <span class="workbench-recording__summary__value">{{ selectedNetwork.resourceType || '-' }}</span>
                </div>
                <div class="workbench-recording__summary__item">
                  <span class="workbench-recording__summary__label">MIME</span>
                  <span class="workbench-recording__summary__value">{{ selectedNetwork.mime || '-' }}</span>
                </div>
              </div>

              <section v-if="selectedTimingRows.length" class="workbench-recording__section">
                <div class="workbench-recording__section__title">Timing</div>
                <div class="workbench-recording__summary">
                  <div v-for="row in selectedTimingRows" :key="row.label" class="workbench-recording__summary__item">
                    <span class="workbench-recording__summary__label">{{ row.label }}</span>
                    <span class="workbench-recording__summary__value">{{ formatDuration(row.valueMs) }}</span>
                  </div>
                </div>
                <div v-if="selectedTimingSegments.length" class="workbench-recording__waterfall">
                  <div v-for="row in selectedTimingSegments" :key="row.label" class="workbench-recording__waterfall__row">
                    <div class="workbench-recording__waterfall__identity">
                      <div class="workbench-recording__waterfall__label">{{ row.label }}</div>
                      <div class="workbench-recording__waterfall__duration">{{ formatDuration(row.valueMs) }}</div>
                    </div>
                    <div class="workbench-recording__waterfall__track">
                      <div class="workbench-recording__waterfall__segment" :style="waterfallStyle(row)"></div>
                    </div>
                  </div>
                </div>
              </section>

              <section class="workbench-recording__section">
                <div class="workbench-recording__section__title">Request headers</div>
                <pre class="workbench-recording__code workbench-recording__code--headers">{{ formatHeaderBlock(selectedNetwork.requestHeaders) }}</pre>
              </section>

              <section v-if="selectedQueryEntries.length" class="workbench-recording__section">
                <div class="workbench-recording__section__title-row">
                  <span>Request query</span>
                  <span class="workbench-recording__badge workbench-recording__badge--primary">{{ selectedQueryEntries.length }}</span>
                </div>
                <div class="workbench-recording__entries workbench-recording__entries--request">
                  <div
                    v-for="entry in selectedQueryEntries"
                    :key="`${entry.key}:${entry.value}`"
                    class="workbench-recording__entry"
                  >
                    <span class="workbench-recording__entry__key" :title="entry.key">{{ entry.key }}</span>
                    <span class="workbench-recording__entry__value">{{ entry.value || '(empty)' }}</span>
                  </div>
                </div>
              </section>

              <section class="workbench-recording__section">
                <div class="workbench-recording__section__title-row">
                  <span>Request body</span>
                  <span class="workbench-recording__badge workbench-recording__badge--primary">{{ selectedRequestBodyView.label }}</span>
                  <span v-if="selectedNetwork.requestBodyTruncated" class="workbench-recording__badge workbench-recording__badge--warning">truncated</span>
                  <span v-if="selectedRequestBodyView.note" class="workbench-recording__section__note">{{ selectedRequestBodyView.note }}</span>
                </div>
                <div
                  v-if="selectedRequestBodyView.imageSrc"
                  class="workbench-recording__body-preview workbench-recording__body-preview--request"
                >
                  <img :src="selectedRequestBodyView.imageSrc" alt="Request body preview" class="workbench-recording__body-image workbench-recording__body-image--request" />
                </div>
                <div
                  v-else-if="selectedRequestBodyView.entries.length"
                  class="workbench-recording__entries workbench-recording__entries--request"
                >
                  <div
                    v-for="entry in selectedRequestBodyView.entries"
                    :key="`${entry.key}:${entry.value}`"
                    class="workbench-recording__entry"
                  >
                    <span class="workbench-recording__entry__key" :title="entry.key">{{ entry.key }}</span>
                    <span class="workbench-recording__entry__value">{{ entry.value || '(empty)' }}</span>
                  </div>
                </div>
                <pre v-else class="workbench-recording__code workbench-recording__code--request">{{ selectedRequestBodyView.text }}</pre>
              </section>

              <section class="workbench-recording__section">
                <div class="workbench-recording__section__title">Response headers</div>
                <pre class="workbench-recording__code workbench-recording__code--headers">{{ formatHeaderBlock(selectedNetwork.responseHeaders) }}</pre>
              </section>

              <section class="workbench-recording__section">
                <div class="workbench-recording__section__title-row">
                  <span>Response body</span>
                  <span class="workbench-recording__badge workbench-recording__badge--primary">{{ selectedResponseBodyView.label }}</span>
                  <span v-if="selectedNetwork.responseBodyTruncated" class="workbench-recording__badge workbench-recording__badge--warning">truncated</span>
                  <span v-if="selectedResponseBodyView.note" class="workbench-recording__section__note">{{ selectedResponseBodyView.note }}</span>
                </div>
                <div
                  v-if="selectedResponseBodyView.imageSrc"
                  class="workbench-recording__body-preview workbench-recording__body-preview--response"
                >
                  <img :src="selectedResponseBodyView.imageSrc" alt="Response body preview" class="workbench-recording__body-image workbench-recording__body-image--response" />
                </div>
                <div
                  v-else-if="selectedResponseBodyView.entries.length"
                  class="workbench-recording__entries workbench-recording__entries--response"
                >
                  <div
                    v-for="entry in selectedResponseBodyView.entries"
                    :key="`${entry.key}:${entry.value}`"
                    class="workbench-recording__entry"
                  >
                    <span class="workbench-recording__entry__key" :title="entry.key">{{ entry.key }}</span>
                    <span class="workbench-recording__entry__value">{{ entry.value || '(empty)' }}</span>
                  </div>
                </div>
                <pre v-else class="workbench-recording__code workbench-recording__code--response">{{ selectedResponseBodyView.text }}</pre>
              </section>

              <section v-if="replayResult" class="workbench-recording__section">
                <div class="workbench-recording__section__title-row">
                  <span>Replay result</span>
                  <span
                    class="workbench-recording__replay-status"
                    :class="{ 'workbench-recording__replay-status--failed': !replayResult.ok }"
                  >
                    {{ replayResult.status || (replayResult.ok ? 'ok' : 'failed') }}
                  </span>
                  <span class="workbench-recording__section__note">{{ formatDuration(replayResult.durationMs) }}</span>
                </div>
                <div v-if="replayAuthText" class="workbench-recording__replay-auth">
                  {{ replayAuthText }}
                </div>
                <pre class="workbench-recording__code workbench-recording__code--replay">{{ replayResultText }}</pre>
              </section>
            </div>
          </aside>
        </div>
      </div>
    </div>

    <div class="workbench-recording__footer">
      <textarea
        v-model="store.workflowDesc"
        placeholder="Workflow description"
        class="workbench-recording__description"
        @input="store.markCaptureRecordsEdited()"
        @keydown.enter.exact.prevent
      ></textarea>
      <div class="workbench-recording__footer__actions">
        <Button size="small" :disabled="!store.ingestRows.length" @click="store.previewVisible = true">Preview</Button>
        <Button size="small" type="primary" :loading="store.ingesting" :disabled="!store.ingestRows.length" @click="ingest">
          Ingest
        </Button>
      </div>
    </div>
  </section>

  <Modal v-model:visible="filterVisible" title="Network filter" :width="660" unmount-on-close :footer="false">
    <div class="workbench-recording__filter-modal">
      <CaptureFilterPanel @saved="store.syncCaptureOptions()" />
    </div>
  </Modal>

  <RecordPreviewSheet v-model:visible="store.previewVisible" :rows="store.ingestRows" :workflow="store.workflowDesc" />
</template>
