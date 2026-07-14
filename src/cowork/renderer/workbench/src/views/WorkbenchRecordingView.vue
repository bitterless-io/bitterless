<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Dropdown, Empty, Message, Modal, Switch } from '@arco-design/web-vue'
import { IconDownload, IconFilter, IconSearch, IconX } from '@tabler/icons-vue'
import { useRouter } from 'vue-router'
import RecordItem from '@cowork-renderer/control/src/record/RecordItem.vue'
import RecordPreviewSheet from '@cowork-renderer/control/src/record/RecordPreviewSheet.vue'
import { fmtHeaders, statusBadge } from '@cowork-renderer/control/src/record/record.format'
import type { BrowserRequestReplayRequest, BrowserRequestReplayResult, CaptureExportFormat } from '@cowork-shared/coach.api'
import type { HeaderMap, NetworkTiming } from '@cowork-shared/trace.types'
import type { Row } from '@cowork-renderer/control/src/record/record.types'
import { workbenchStore as store } from '../workbench.store'
import CaptureFilterPanel from '../components/CaptureFilterPanel.vue'

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
  <section class="flex h-full min-h-0 flex-col bg-white">
    <div class="flex min-h-0 flex-1 flex-col gap-2 bg-white">
      <div class="grid shrink-0 grid-cols-5 overflow-hidden rounded-lg bg-[#f8fafc] text-center">
        <div class="border-r border-[#edf1f6] px-2.5 py-1.5">
          <b class="block text-[15px] leading-5 text-gray-900">{{ store.visibleRows.length }}</b>
          <span class="text-[10px] uppercase text-gray-500">events</span>
        </div>
        <div class="border-r border-[#edf1f6] px-2.5 py-1.5">
          <b class="block text-[15px] leading-5 text-gray-900">{{ store.apiCount }}</b>
          <span class="text-[10px] uppercase text-gray-500">api</span>
        </div>
        <div class="border-r border-[#edf1f6] px-2.5 py-1.5">
          <b class="block text-[15px] leading-5 text-gray-900">{{ store.uiCount }}</b>
          <span class="text-[10px] uppercase text-gray-500">ui</span>
        </div>
        <div class="border-r border-[#edf1f6] px-2.5 py-1.5">
          <b class="block text-[15px] leading-5 text-gray-900">{{ store.flaggedCount }}</b>
          <span class="text-[10px] uppercase text-gray-500">flagged</span>
        </div>
        <div class="px-2.5 py-1.5">
          <b class="block text-[15px] leading-5 text-gray-900">{{ store.tokenCount.toLocaleString() }}</b>
          <span class="text-[10px] uppercase text-gray-500">tokens</span>
        </div>
      </div>

      <div class="flex shrink-0 items-center justify-between gap-2 rounded-lg bg-[#f8fafc] px-2 py-1.5">
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <label
            name="recording__search"
            class="flex h-7 min-w-[180px] flex-1 items-center gap-1.5 rounded-md border border-[#d8e2ed] bg-white px-2 text-gray-500"
          >
            <IconSearch :size="14" class="shrink-0" />
            <input
              v-model="store.recordSearch"
              class="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-gray-700 outline-none placeholder:text-gray-400"
              placeholder="Search records"
            />
            <button
              v-if="store.recordSearch"
              type="button"
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition hover:bg-[#f1f5f9] hover:text-gray-700"
              title="Clear search"
              aria-label="Clear search"
              @click="store.clearRecordSearch()"
            >
              <IconX :size="13" />
            </button>
          </label>
          <div class="flex shrink-0 items-center gap-1">
            <button
              class="h-6 rounded-md border px-2.5 text-[11px] font-semibold transition"
              :class="!store.activeFilters.length ? 'border-[#165dff]/30 bg-[#eaf2ff] text-[#165dff]' : 'border-[#d8e2ed] bg-[#f8fafc] text-gray-500 hover:bg-white'"
              type="button"
              @click="store.clearFilters()"
            >
              All
            </button>
            <button
              v-for="cat in store.filterCats"
              :key="cat.key"
              class="h-6 rounded-md border px-2.5 text-[11px] font-semibold transition"
              :class="store.activeFilters.includes(cat.key) ? 'border-[#165dff]/30 bg-[#eaf2ff] text-[#165dff]' : 'border-[#d8e2ed] bg-[#f8fafc] text-gray-500 hover:bg-white'"
              type="button"
              @click="store.toggleFilter(cat.key)"
            >
              {{ cat.label }}
            </button>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <label class="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
            <span>Action</span>
            <Switch :model-value="store.recordActions" size="small" @change="(value) => setActionCapture(Boolean(value))" />
          </label>
          <label class="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
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
                class="block h-8 w-[172px] px-3 text-left text-[12px] font-semibold text-gray-700 hover:bg-[#f3f7ff] hover:text-[#165dff]"
                @click="exportRecording('json')"
              >
                Capture JSON
              </button>
              <button
                type="button"
                class="block h-8 w-[172px] px-3 text-left text-[12px] font-semibold text-gray-700 hover:bg-[#f3f7ff] hover:text-[#165dff]"
                @click="exportRecording('har')"
              >
                HTTP Archive HAR
              </button>
            </template>
          </Dropdown>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-hidden rounded-lg bg-[#f8fafc]">
        <div class="grid h-full min-h-0 gap-2" :class="selectedNetwork ? 'grid-cols-[minmax(0,1fr)_380px]' : 'grid-cols-1'">
          <div class="min-h-0 overflow-auto rounded-lg bg-[#f8fafc]">
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
              class="mt-10"
              :description="store.visibleRows.length ? 'No records match the search or filter.' : 'No records'"
            />
          </div>

          <aside v-if="selectedNetwork" class="min-h-0 overflow-hidden rounded-lg border border-[#e5edf6] bg-white">
            <div class="flex min-h-10 items-start justify-between gap-2 border-b border-[#edf2f7] px-3 py-2">
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span v-if="selectedNetwork.method" class="rounded bg-[#eaf2ff] px-1.5 py-px font-mono text-[10px] font-bold text-[#165dff]">
                    {{ selectedNetwork.method }}
                  </span>
                  <span
                    v-if="selectedNetwork.status"
                    class="rounded px-1.5 py-px font-mono text-[10px] font-bold"
                    :class="statusBadge(selectedNetwork.status)"
                  >
                    {{ selectedNetwork.status }}
                  </span>
                  <span class="truncate text-[12px] font-semibold text-gray-900" :title="selectedNetwork.path">{{ selectedNetwork.path }}</span>
                </div>
                <div class="mt-1 truncate font-mono text-[10.5px] text-gray-400" :title="selectedNetwork.url">{{ selectedNetwork.host }}</div>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="h-7 rounded-md px-2 text-[11px] font-semibold text-gray-500 transition hover:bg-[#f1f5f9] hover:text-[#165dff] disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="replayingRequest"
                  title="Replay this request in the live browser session"
                  @click="replaySelectedRequest"
                >
                  {{ replayingRequest ? 'Replaying' : 'Replay' }}
                </button>
                <button
                  type="button"
                  class="h-7 rounded-md px-2 text-[11px] font-semibold text-gray-500 transition hover:bg-[#f1f5f9] hover:text-[#165dff]"
                  title="Copy browser_exec fetch command"
                  @click="copyBrowserExecCommand"
                >
                  Copy command
                </button>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-[#f1f5f9] hover:text-gray-800"
                  title="Close detail"
                  aria-label="Close detail"
                  @click="store.clearNetworkSelection()"
                >
                  <IconX :size="15" />
                </button>
              </div>
            </div>

            <div class="h-full min-h-0 overflow-auto px-3 py-2 pb-12">
              <div class="grid grid-cols-2 gap-1.5 text-[11px]">
                <div class="rounded bg-[#f8fafc] px-2 py-1">
                  <span class="block text-[10px] font-bold uppercase text-gray-400">Duration</span>
                  <span class="font-mono text-gray-700">{{ formatDuration(selectedNetwork.durationMs) }}</span>
                </div>
                <div class="rounded bg-[#f8fafc] px-2 py-1">
                  <span class="block text-[10px] font-bold uppercase text-gray-400">Size</span>
                  <span class="font-mono text-gray-700">{{ formatSize(selectedNetwork.encodedDataLength) }}</span>
                </div>
                <div class="rounded bg-[#f8fafc] px-2 py-1">
                  <span class="block text-[10px] font-bold uppercase text-gray-400">Decoded</span>
                  <span class="font-mono text-gray-700">{{ formatSize(selectedNetwork.decodedDataLength) }}</span>
                </div>
                <div class="rounded bg-[#f8fafc] px-2 py-1">
                  <span class="block text-[10px] font-bold uppercase text-gray-400">Chunks</span>
                  <span class="font-mono text-gray-700">{{ selectedNetwork.responseBodyChunkCount ?? '-' }}</span>
                </div>
                <div class="rounded bg-[#f8fafc] px-2 py-1">
                  <span class="block text-[10px] font-bold uppercase text-gray-400">Type</span>
                  <span class="font-mono text-gray-700">{{ selectedNetwork.resourceType || '-' }}</span>
                </div>
                <div class="rounded bg-[#f8fafc] px-2 py-1">
                  <span class="block text-[10px] font-bold uppercase text-gray-400">MIME</span>
                  <span class="font-mono text-gray-700">{{ selectedNetwork.mime || '-' }}</span>
                </div>
              </div>

              <section v-if="selectedTimingRows.length" class="mt-3">
                <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Timing</div>
                <div class="grid grid-cols-2 gap-1.5 text-[11px]">
                  <div v-for="row in selectedTimingRows" :key="row.label" class="rounded bg-[#f8fafc] px-2 py-1">
                    <span class="block text-[10px] font-bold uppercase text-gray-400">{{ row.label }}</span>
                    <span class="font-mono text-gray-700">{{ formatDuration(row.valueMs) }}</span>
                  </div>
                </div>
                <div v-if="selectedTimingSegments.length" class="mt-2 rounded bg-[#f8fafc] px-2 py-2">
                  <div v-for="row in selectedTimingSegments" :key="row.label" class="grid grid-cols-[68px_minmax(0,1fr)] items-center gap-2 py-1">
                    <div class="min-w-0">
                      <div class="truncate text-[10px] font-bold uppercase text-gray-500">{{ row.label }}</div>
                      <div class="font-mono text-[10px] text-gray-400">{{ formatDuration(row.valueMs) }}</div>
                    </div>
                    <div class="relative h-3 overflow-hidden rounded bg-[#e8eef5]">
                      <div class="absolute top-0 h-full rounded" :style="waterfallStyle(row)"></div>
                    </div>
                  </div>
                </div>
              </section>

              <section class="mt-3">
                <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Request headers</div>
                <pre class="max-h-[150px] overflow-auto whitespace-pre-wrap rounded bg-[#f8fafc] px-2 py-1.5 font-mono text-[10.5px] leading-4 text-gray-700">{{ formatHeaderBlock(selectedNetwork.requestHeaders) }}</pre>
              </section>

              <section v-if="selectedQueryEntries.length" class="mt-3">
                <div class="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  <span>Request query</span>
                  <span class="rounded bg-[#eaf2ff] px-1.5 py-px text-[9px] text-[#165dff]">{{ selectedQueryEntries.length }}</span>
                </div>
                <div class="max-h-[190px] overflow-auto rounded bg-[#f8fafc] text-[10.5px] leading-4">
                  <div
                    v-for="entry in selectedQueryEntries"
                    :key="`${entry.key}:${entry.value}`"
                    class="grid grid-cols-[92px_minmax(0,1fr)] border-b border-[#e8eef5] last:border-b-0"
                  >
                    <span class="truncate px-2 py-1.5 font-mono font-semibold text-gray-500" :title="entry.key">{{ entry.key }}</span>
                    <span class="min-w-0 break-words px-2 py-1.5 font-mono text-gray-700">{{ entry.value || '(empty)' }}</span>
                  </div>
                </div>
              </section>

              <section class="mt-3">
                <div class="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  <span>Request body</span>
                  <span class="rounded bg-[#eaf2ff] px-1.5 py-px text-[9px] text-[#165dff]">{{ selectedRequestBodyView.label }}</span>
                  <span v-if="selectedNetwork.requestBodyTruncated" class="rounded bg-amber-100 px-1.5 py-px text-[9px] text-amber-700">truncated</span>
                  <span v-if="selectedRequestBodyView.note" class="text-[9px] normal-case text-gray-400">{{ selectedRequestBodyView.note }}</span>
                </div>
                <div
                  v-if="selectedRequestBodyView.imageSrc"
                  class="max-h-[190px] overflow-auto rounded bg-[#f8fafc] p-2"
                >
                  <img :src="selectedRequestBodyView.imageSrc" alt="Request body preview" class="max-h-[155px] max-w-full rounded border border-[#d8e2ed] bg-white object-contain" />
                </div>
                <div
                  v-else-if="selectedRequestBodyView.entries.length"
                  class="max-h-[190px] overflow-auto rounded bg-[#f8fafc] text-[10.5px] leading-4"
                >
                  <div
                    v-for="entry in selectedRequestBodyView.entries"
                    :key="`${entry.key}:${entry.value}`"
                    class="grid grid-cols-[92px_minmax(0,1fr)] border-b border-[#e8eef5] last:border-b-0"
                  >
                    <span class="truncate px-2 py-1.5 font-mono font-semibold text-gray-500" :title="entry.key">{{ entry.key }}</span>
                    <span class="min-w-0 break-words px-2 py-1.5 font-mono text-gray-700">{{ entry.value || '(empty)' }}</span>
                  </div>
                </div>
                <pre v-else class="max-h-[190px] overflow-auto whitespace-pre-wrap rounded bg-[#f8fafc] px-2 py-1.5 font-mono text-[10.5px] leading-4 text-gray-700">{{ selectedRequestBodyView.text }}</pre>
              </section>

              <section class="mt-3">
                <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Response headers</div>
                <pre class="max-h-[150px] overflow-auto whitespace-pre-wrap rounded bg-[#f8fafc] px-2 py-1.5 font-mono text-[10.5px] leading-4 text-gray-700">{{ formatHeaderBlock(selectedNetwork.responseHeaders) }}</pre>
              </section>

              <section class="mt-3">
                <div class="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  <span>Response body</span>
                  <span class="rounded bg-[#eaf2ff] px-1.5 py-px text-[9px] text-[#165dff]">{{ selectedResponseBodyView.label }}</span>
                  <span v-if="selectedNetwork.responseBodyTruncated" class="rounded bg-amber-100 px-1.5 py-px text-[9px] text-amber-700">truncated</span>
                  <span v-if="selectedResponseBodyView.note" class="text-[9px] normal-case text-gray-400">{{ selectedResponseBodyView.note }}</span>
                </div>
                <div
                  v-if="selectedResponseBodyView.imageSrc"
                  class="max-h-[240px] overflow-auto rounded bg-[#f8fafc] p-2"
                >
                  <img :src="selectedResponseBodyView.imageSrc" alt="Response body preview" class="max-h-[205px] max-w-full rounded border border-[#d8e2ed] bg-white object-contain" />
                </div>
                <div
                  v-else-if="selectedResponseBodyView.entries.length"
                  class="max-h-[240px] overflow-auto rounded bg-[#f8fafc] text-[10.5px] leading-4"
                >
                  <div
                    v-for="entry in selectedResponseBodyView.entries"
                    :key="`${entry.key}:${entry.value}`"
                    class="grid grid-cols-[92px_minmax(0,1fr)] border-b border-[#e8eef5] last:border-b-0"
                  >
                    <span class="truncate px-2 py-1.5 font-mono font-semibold text-gray-500" :title="entry.key">{{ entry.key }}</span>
                    <span class="min-w-0 break-words px-2 py-1.5 font-mono text-gray-700">{{ entry.value || '(empty)' }}</span>
                  </div>
                </div>
                <pre v-else class="max-h-[240px] overflow-auto whitespace-pre-wrap rounded bg-[#f8fafc] px-2 py-1.5 font-mono text-[10.5px] leading-4 text-gray-700">{{ selectedResponseBodyView.text }}</pre>
              </section>

              <section v-if="replayResult" class="mt-3">
                <div class="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  <span>Replay result</span>
                  <span
                    class="rounded px-1.5 py-px font-mono text-[9px]"
                    :class="replayResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'"
                  >
                    {{ replayResult.status || (replayResult.ok ? 'ok' : 'failed') }}
                  </span>
                  <span class="text-[9px] normal-case text-gray-400">{{ formatDuration(replayResult.durationMs) }}</span>
                </div>
                <div v-if="replayAuthText" class="mb-1 rounded bg-[#f8fafc] px-2 py-1 font-mono text-[10px] text-gray-500">
                  {{ replayAuthText }}
                </div>
                <pre class="max-h-[220px] overflow-auto whitespace-pre-wrap rounded bg-[#f8fafc] px-2 py-1.5 font-mono text-[10.5px] leading-4 text-gray-700">{{ replayResultText }}</pre>
              </section>
            </div>
          </aside>
        </div>
      </div>
    </div>

    <div class="shrink-0 bg-white pt-2">
      <textarea
        v-model="store.workflowDesc"
        placeholder="Workflow description"
        class="h-[70px] w-full resize-none rounded-md border border-gray-300 px-2.5 py-1.5 text-[12px] leading-relaxed outline-none focus:border-[#165dff]"
        @input="store.markCaptureRecordsEdited()"
        @keydown.enter.exact.prevent
      ></textarea>
      <div class="mt-2 flex items-center justify-end gap-2">
        <Button size="small" :disabled="!store.ingestRows.length" @click="store.previewVisible = true">Preview</Button>
        <Button size="small" type="primary" :loading="store.ingesting" :disabled="!store.ingestRows.length" @click="ingest">
          Ingest
        </Button>
      </div>
    </div>
  </section>

  <Modal v-model:visible="filterVisible" title="Network filter" :width="660" unmount-on-close :footer="false">
    <div class="h-[560px] overflow-hidden rounded-lg">
      <CaptureFilterPanel @saved="store.syncCaptureOptions()" />
    </div>
  </Modal>

  <RecordPreviewSheet v-model:visible="store.previewVisible" :rows="store.ingestRows" :workflow="store.workflowDesc" />
</template>
