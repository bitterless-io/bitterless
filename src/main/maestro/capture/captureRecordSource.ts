import type { IngestRecord } from '@maestro-shared/coach.api'

export interface CaptureRecordSource {
  source: 'edited' | 'raw'
  records: IngestRecord[]
  workflow?: string
  updatedAt?: number
}

export interface PersistedCaptureRecordOptions {
  startedAt?: number
  workflow?: string
  updatedAt?: number
  records?: IngestRecord[]
}

const isPersistedIngestRecord = (value: unknown): value is IngestRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = (value as { event?: unknown }).event
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false
  const candidate = event as { kind?: unknown; ts?: unknown }
  return typeof candidate.kind === 'string' && typeof candidate.ts === 'number'
}

export const normalizePersistedCaptureRecordOptions = (
  value: unknown
): { records: IngestRecord[]; workflow?: string; startedAt?: number; updatedAt: number } | null => {
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
