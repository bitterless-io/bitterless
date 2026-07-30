import type { IngestRecord } from '@maestro-shared/coach.api'
import type { TraceEvent } from '@maestro-shared/trace.types'

export type CapturedRequest = Extract<TraceEvent, { kind: 'net.request' }>

export type CapturedResponse = Extract<TraceEvent, { kind: 'net.response' }>

export interface NetworkExchange {
  requestId: string
  request?: CapturedRequest
  response?: CapturedResponse
  flagged?: boolean
}

export const buildNetworkExchanges = (records: IngestRecord[]): NetworkExchange[] => {
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
