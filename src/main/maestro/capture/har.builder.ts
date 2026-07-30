import type { IngestRecord } from '@maestro-shared/coach.api'
import type { HeaderMap, NetworkTiming } from '@maestro-shared/trace.types'
import { type CapturedRequest, buildNetworkExchanges } from './networkExchange'

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

const timingDuration = (
  timing: NetworkTiming | undefined,
  start: keyof NetworkTiming,
  end: keyof NetworkTiming
): number | undefined => {
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

const buildHarPostData = (request: CapturedRequest): Record<string, unknown> | undefined => {
  if (!request.postData) return undefined
  return {
    mimeType: headerValue(request.headers, 'content-type') || 'text/plain',
    text: request.postData,
    _coachTruncated: Boolean(request.postDataTruncated)
  }
}

export const buildHar = (params: { startedAt: number; records: IngestRecord[] }): Record<string, unknown> => {
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
