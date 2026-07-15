import type { HeaderMap } from '@maestro-shared/trace.types'

// HH:mm:ss (24h) for the record's right-side timestamp.
export function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Status pill color by HTTP range (2xx ok, 4xx client, 5xx server).
export function statusBadge(status?: number): string {
  if (status && status >= 500) return 'record-status record-status--server-error'
  if (status && status >= 400) return 'record-status record-status--client-error'
  if (status && status >= 200 && status < 300) return 'record-status record-status--success'
  return 'record-status record-status--neutral'
}

// Headers → one "key: value" per line (array values joined). '' when none.
export function fmtHeaders(headers?: HeaderMap): string {
  if (!headers) return ''
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n')
}

// Kind-label color for the record header.
export function kindClass(kind: string): string {
  if (kind === 'net.request') return 'record-kind record-kind--request'
  if (kind === 'net.response') return 'record-kind record-kind--response'
  if (kind === 'action') return 'record-kind record-kind--action'
  if (kind === 'snapshot') return 'record-kind record-kind--snapshot'
  if (kind === 'error') return 'record-kind record-kind--error'
  return 'record-kind record-kind--neutral'
}

// Path (+ query) of a URL, for the snapshot record. Full URL falls back if unparseable.
export function urlPath(url?: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}
