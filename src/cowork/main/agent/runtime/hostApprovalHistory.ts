import type { HostApprovalEvent, HostApprovalExportPayload } from '@cowork-shared/coach.api'

export class HostApprovalHistory {
  private seq = 0
  private events: HostApprovalEvent[] = []

  constructor(private readonly maxEvents = 80) {}

  list(): HostApprovalEvent[] {
    return this.events.slice().reverse()
  }

  snapshot(): HostApprovalEvent[] {
    return this.events.map((event) => ({ ...event }))
  }

  exportPayload(): HostApprovalExportPayload {
    const events = this.snapshot()
    return {
      exportedAt: Date.now(),
      count: events.length,
      events
    }
  }

  replace(events: HostApprovalEvent[]): HostApprovalEvent[] {
    this.events = events
      .map(normalizeHostApprovalEvent)
      .filter((event): event is HostApprovalEvent => Boolean(event))
      .sort((a, b) => a.requestedAt - b.requestedAt)
      .slice(-this.maxEvents)
    this.seq = this.events.reduce((max, event) => Math.max(max, approvalSeq(event.id)), 0)
    return this.list()
  }

  clear(): HostApprovalEvent[] {
    this.events = []
    return []
  }

  push(event: Omit<HostApprovalEvent, 'id' | 'requestedAt'>): HostApprovalEvent {
    const now = Date.now()
    const item = normalizeHostApprovalEvent({
      ...event,
      id: `approval-${++this.seq}`,
      requestedAt: now,
      resolvedAt: event.status === 'pending' ? undefined : now
    })
    if (!item) throw new Error('invalid host approval event')
    this.events.push(item)
    if (this.events.length > this.maxEvents) this.events = this.events.slice(-this.maxEvents)
    return { ...item }
  }

  resolve(id: string, status: HostApprovalEvent['status']): HostApprovalEvent | null {
    const item = this.events.find((event) => event.id === id)
    if (!item) return null
    item.status = status
    item.resolvedAt = Date.now()
    return { ...item }
  }
}

function normalizeHostApprovalEvent(value: unknown): HostApprovalEvent | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  const kind = rec.kind === 'tool' || rec.kind === 'api' ? rec.kind : null
  const status = rec.status === 'pending' || rec.status === 'approved' || rec.status === 'denied' || rec.status === 'blocked' ? rec.status : null
  const label = cleanApprovalText(rec.label, 300)
  const requestedAt = typeof rec.requestedAt === 'number' && Number.isFinite(rec.requestedAt) ? rec.requestedAt : 0
  if (!kind || !status || !label || !requestedAt) return null
  const item: HostApprovalEvent = {
    id: cleanApprovalId(rec.id) || `approval-${Date.now()}`,
    kind,
    status,
    label,
    requestedAt
  }
  const scope = rec.scope === 'cowork' || rec.scope === 'trainer' ? rec.scope : undefined
  if (scope) item.scope = scope
  const detail = cleanApprovalText(rec.detail, 500)
  if (detail) item.detail = detail
  const toolName = cleanApprovalText(rec.toolName, 120)
  if (toolName) item.toolName = toolName
  const method = cleanApprovalMethod(rec.method)
  if (method) item.method = method
  const path = cleanApprovalText(rec.path, 500)
  if (path) item.path = path
  const reason = cleanApprovalText(rec.reason, 500)
  if (reason) item.reason = reason
  if (typeof rec.resolvedAt === 'number' && Number.isFinite(rec.resolvedAt)) item.resolvedAt = rec.resolvedAt
  return item
}

function approvalSeq(id: string): number {
  const match = String(id || '').match(/^approval-(\d+)$/)
  return match ? Number(match[1]) || 0 : 0
}

function cleanApprovalId(value: unknown): string {
  const text = String(value || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-')
  return clip(redactApprovalText(text), 80)
}

function cleanApprovalMethod(value: unknown): string {
  const text = String(value || '').trim().toUpperCase()
  return /^[A-Z]{2,20}$/.test(text) ? text : ''
}

function cleanApprovalText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? clip(redactApprovalText(text), max) : ''
}

function redactApprovalText(value: string): string {
  return value
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    .replace(/\bbearer\s+[A-Za-z0-9._~-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(authorization|cookie|set-cookie|token|secret|password|credential|session|jwt|api[-_]?key|csrf|xsrf)\b\s*[:=]\s*([^&\s,;)\]}]+)/gi,
      (_match, key: string) => `${key}=[REDACTED]`
    )
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}
