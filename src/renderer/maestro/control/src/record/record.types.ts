import type { HeaderMap, TraceEvent } from '@maestro-shared/trace.types'

// The `net.response` half of a network exchange, folded onto the request row.
export type NetResponseEvent = Extract<TraceEvent, { kind: 'net.response' }>

// One row in the Record list — a display projection of a TraceEvent plus the
// editable per-record `spec` and the soft-delete bookkeeping.
export interface Row {
  kind: string
  text: string
  title: string
  ts: number
  yaml?: string
  body?: string | null
  method?: string
  status?: number
  url?: string
  headers?: HeaderMap
  // Base64 data-URL thumbnail of the clicked element (click) or viewport (snapshot).
  shot?: string
  // The original trace event this row was built from — the ingest source of truth.
  // For a `net.request` row this is the request; its response (when it arrives) is
  // folded into `response` so one network exchange renders as a single record.
  event: TraceEvent
  // The matching `net.response` event, attached once the response lands. Undefined
  // while the request is still pending. Not set on standalone (orphan) response rows.
  response?: NetResponseEvent
  // Operator note consumed at ingest time (the per-record "spec").
  spec: string
  // Operator-marked key evidence. Flagged rows are surfaced first and carried into
  // export/skill ingest so the generator focuses on the meaningful API/UI records.
  flagged: boolean
  // Soft delete: the row stays in `rows`; `delete_flag` is the ms timestamp it was
  // deleted (0 when live), which Cmd/Ctrl+Z restores in most-recent-first order.
  is_deleted: boolean
  delete_flag: number
}
