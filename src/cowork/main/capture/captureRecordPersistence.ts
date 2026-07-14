import type { IngestRecord } from '@cowork-shared/coach.api'
import type { TraceEvent } from '@cowork-shared/trace.types'

export interface PersistedCaptureRecordSet {
  records: IngestRecord[]
  startedAt?: number
  updatedAt: number
}

export const buildPersistedRawCaptureRecords = (
  events: TraceEvent[],
  startedAt?: number,
  updatedAt = Date.now()
): PersistedCaptureRecordSet | null => {
  const records = events.filter(Boolean).map((event) => ({ event: stripDisplayOnlyShot(event) }))
  if (!records.length) return null
  return JSON.parse(
    JSON.stringify({
      records,
      startedAt: Number.isFinite(Number(startedAt)) && Number(startedAt) > 0 ? Number(startedAt) : undefined,
      updatedAt
    })
  ) as PersistedCaptureRecordSet
}

const stripDisplayOnlyShot = (event: TraceEvent): TraceEvent => {
  if ((event.kind === 'action' || event.kind === 'snapshot') && event.shot) return { ...event, shot: undefined }
  return event
}
